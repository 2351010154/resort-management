// The guests who arrive tomorrow, told so — `FR-NTF-01`'s pre-arrival reminder.
//
// The confirmation goes out the moment a stay is paid for, which can be months
// before the guest travels. Nothing else in the tree writes to them again, so a
// guest who booked in March arrives in July having forgotten the room type they
// chose, without the property's address, and — the one that costs more than a
// conversation at the counter — possibly without an identity document. `FR-GST-02`
// has the desk read and transcribe one *before* the room is handed over, so that
// guest cannot be checked in at all.
//
// ## The mark is written by the statement that selects
//
// One `update … returning` over the arrivals of a day, which is the shape
// `sweep-job.ts` describes and the one this sweep genuinely has: there is no
// inventory arithmetic here and no transition, so there is no service whose
// invariants a second implementation could drift from. What it buys is the
// property the runner insists on. `job-runner.service.ts` re-runs a sweep inside
// the same transaction and requires the second pass to be empty, and the mark and
// the selection being one statement is what makes that true by construction
// rather than by a promise: the rows the first pass returned no longer match the
// predicate the second pass evaluates, on the same connection, before anything
// has committed.
//
// **The mark has to be persistent, and `booking.pre_arrival_reminder_sent_at` is
// where it lives.** Nothing about the state of a confirmed booking distinguishes
// a guest who has been reminded from one who has not — the arrival date does not
// move and the state does not change — so without a written mark every tick of
// this sweep would mail the same guest again. A set in this process would forget
// at the next deploy, would be one set per process, and would not survive the
// runner's own rollback; a log line is not readable by a predicate at all.
//
// ## Hourly, because the rollover hour is configuration
//
// The requirement is a daily reminder and the obvious reading — one cron a few
// minutes past 04:00 — is the one `no-show-sweep.ts` refuses and the other sweeps
// inherit by citation: the rollover hour is a `system_config` row an `ADMIN` edits
// without a deploy, and a cron holding `4` would be that number's second home.
// The morning after somebody moved it, a daily sweep would read the previous
// business date and remind the wrong day's arrivals.
//
// Hourly costs nothing here and asks nothing of anybody's agreement. The mark is
// what makes a guest hear from the property once, so the cadence is only a
// statement about lateness: whenever the day rolls, the next tick finds the
// arrivals that have just come into range, and every tick after it is one indexed
// scan of `booking_state_check_in_date_idx` returning nothing.
//
// ## The messages leave after the commit, and that is not a detail
//
// pg-boss writes on its own connection and commits on its own, so a message
// handed over inside this transaction would survive the transaction being rolled
// back — and this transaction can roll back after the sweep has done its work,
// because the runner's second pass and its idempotency refusal happen inside it.
// Enqueued early, a run the runner rejected would still have mailed the night's
// arrivals, and the marks it wrote would be gone. `afterCommit` is what makes "the
// guest was reminded" follow from "the mark is durable" rather than accompany it.

import type { StayDate } from "@mariva/shared";
import { Injectable } from "@nestjs/common";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { DbExecutor } from "../../database/database.module.js";
import { booking } from "../../database/schema/booking.js";
import { roomType } from "../../database/schema/inventory.js";
import { afterCommit } from "../../database/transaction-runner.js";
import type { SweepJob } from "../../jobs/sweep-job.js";
import { PreArrivalReminderService } from "../notification/pre-arrival-reminder.service.js";

// See the header. Ten past the hour, which is off the boundary the rest of the
// schedule crowds onto, off `e-invoice.job.ts`'s five-minute grid, and ahead of
// the no-show sweep at twenty past — the two read the same index, and a reminder
// for tomorrow is cheaper work than a write-off of yesterday.
const HOURLY = "10 * * * *";

/**
 * Reminds every guest arriving on the day after the business date, once.
 *
 * Registered in `jobs.module.ts` and owned here, which is the split that file
 * describes: the scheduler is machinery, and a sweep belongs to the requirement
 * that asked for it. This one is a booking question — which stays arrive
 * tomorrow — so it sits with the bookings and takes the message it sends from the
 * module that owns how anything leaves this process.
 */
@Injectable()
export class PreArrivalReminderSweep implements SweepJob {
  readonly name = "pre-arrival-reminder";
  readonly schedule = HOURLY;

  constructor(private readonly reminders: PreArrivalReminderService) {}

  /**
   * Answers with the id of every booking it marked, which is every booking it
   * reminded — the sweep marks exactly what it sends.
   */
  async run(
    exec: DbExecutor,
    businessDate: StayDate,
  ): Promise<readonly string[]> {
    // Tomorrow as the property counts days, and never arithmetic on a clock: the
    // business date is handed in precisely so a run can be repeated over a day
    // that failed, and `stay-date.ts` keeps a stay boundary a calendar date so
    // that a zone cannot move it by a night.
    const arrival = businessDate.add({ days: 1 });

    // One statement, so it takes its row locks in a single scan with nothing
    // interleaved — which is what the `order by` the other sweeps write buys
    // them, and they need it because they lock a row and then call a service
    // with it. The rows this touches are also disjoint from every other sweep's:
    // `hold-expiry` locks `HELD`, `no-show` locks arrivals the property has left
    // behind, and this locks confirmed arrivals it has not reached.
    const due = await exec
      .update(booking)
      .set({
        // Postgres' clock and not this process's, which is the same choice the
        // cancellation instant makes and for a smaller version of the same
        // reason: it is the transaction's own start time, so both of the
        // runner's passes see one instant and every row of a run carries it.
        //
        // `updated_at` is deliberately left where it is. A reminder is something
        // the property did *about* the stay; the stay itself did not change, and
        // the column that says when a booking last changed is read by people
        // asking what somebody did to it.
        preArrivalReminderSentAt: sql`now()`,
      })
      .where(
        and(
          eq(booking.state, "CONFIRMED"),
          eq(booking.checkInDate, arrival.toString()),
          isNull(booking.preArrivalReminderSentAt),
          // No address, no message — and therefore no mark. A stay the desk took
          // from somebody at the counter has this pair null together, so it is
          // not a booking that was skipped: it is not a booking this sweep has
          // anything to do with. Marking it would leave the column reading as a
          // reminder that was never sent.
          isNotNull(booking.contactEmail),
          isNotNull(booking.contactName),
        ),
      )
      .returning({
        id: booking.id,
        reference: booking.reference,
        to: booking.contactEmail,
        guestName: booking.contactName,
        roomTypeId: booking.roomTypeId,
      });

    if (due.length === 0) {
      return [];
    }

    const names = await this.roomTypeNames(exec, due);

    // Composed here, inside the transaction, rather than in the callback below.
    // The three fields the predicate and the foreign key already guarantee are
    // read now, so a row that somehow lacks one takes the run's marks down with
    // it instead of sending a message addressed to an empty string after the
    // marks are durable.
    const mails = due.map((stay) => ({
      to: stated(stay.to, "contact address", stay.reference),
      guestName: stated(stay.guestName, "contact name", stay.reference),
      reference: stay.reference,
      arrival,
      roomType: stated(
        names.get(stay.roomTypeId) ?? null,
        "room type",
        stay.reference,
      ),
    }));

    // One `afterCommit` for the whole run rather than one per guest: the
    // registered work is drained in order by `TransactionRunner`, and a single
    // registration keeps a night's reminders one unit of work whose failures are
    // reported together.
    await afterCommit(exec, async () => {
      // Sequential, because `MailQueue.enqueue` is one insert on the pool per
      // message and a night's arrivals at a forty-room property are counted in
      // tens. Nothing here rejects — the reminder service says why — so one
      // address the vendor will refuse does not cost the rest of the night
      // theirs.
      for (const mail of mails) {
        await this.reminders.enqueue(mail);
      }
    });

    return due.map((stay) => stay.id);
  }

  /**
   * The display name of each type the run's arrivals were booked into.
   *
   * A second statement rather than a join, because the mark is written by an
   * `update … returning` and an update joins nothing. Bounded by the types the
   * property has — five — and read inside the same transaction as the mark, so
   * the name in the mail is the name the row carried when the reminder was
   * decided.
   *
   * The code is not used: `Junior Suite` is what the guest chose in the funnel,
   * and `JUNIOR_SUITE` is what the property's screens say.
   */
  private async roomTypeNames(
    exec: DbExecutor,
    due: readonly { readonly roomTypeId: string }[],
  ): Promise<ReadonlyMap<string, string>> {
    const rows = await exec
      .select({ id: roomType.id, name: roomType.name })
      .from(roomType)
      .where(inArray(roomType.id, due.map((stay) => stay.roomTypeId)));

    return new Map(rows.map((row) => [row.id, row.name]));
  }
}

/**
 * A value the statement above already required, as a value rather than as a
 * maybe.
 *
 * The predicate selects on `contact_email is not null` and `contact_name is not
 * null`, and `booking.room_type_id` is a foreign key, so none of the three can be
 * absent on a row this sweep marked. Drizzle types the columns nullable anyway —
 * it types the table and not the query — and the two honest ways past that are
 * this and a cast. A cast would mail an empty address on the day the predicate
 * changed; this refuses, inside the transaction, before a mark is durable.
 */
function stated(
  value: string | null,
  field: string,
  reference: string,
): string {
  if (value === null) {
    throw new Error(
      `Booking ${reference} was selected as an arrival to remind and has no ${field}, ` +
        "which the sweep's own predicate is supposed to make impossible.",
    );
  }

  return value;
}
