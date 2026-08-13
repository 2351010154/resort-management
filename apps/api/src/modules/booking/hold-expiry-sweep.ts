// The other half of `FR-BOOK-02` — the TTL that releases what a hold consumed.
//
// `booking.service.ts`'s `createHold` consumes the nights in full at the moment
// the funnel takes the hold, because a hold that did not consume them would be a
// room two guests could reach the payment step for. That is only half a
// requirement: nothing else in the tree reads `hold_expires_at`, so without this
// file every abandoned funnel session consumes a night for good. Not an attack —
// the ordinary browse-and-leave is enough, and the guest has no route back
// either, since a booking carries no guest until check-in registers one. The
// nights would come back only when somebody at the desk cancelled the booking by
// hand.
//
// ## It reuses `cancel` rather than restating §3 in SQL
//
// The tempting shape is one set-based `update ... returning`, which is what
// `sweep-job.ts` describes and what the no-show sweep will be. It is wrong here.
// §3 gives an expired hold the same inventory effect as any other cancellation,
// and `BookingService.cancel` already is that effect: it releases every night,
// clears the expiry the check constraint would otherwise refuse, and refuses to
// act twice on a booking already cancelled. A statement here that moved
// `sold_rooms` itself would be a second implementation of §3's arithmetic, and
// the two would agree right up until one of them was changed.
//
// The cost is a loop, and it is the right cost. Expired holds are counted in
// ones and twos per run, they are all in the runner's transaction on one
// connection — so the loop is sequential, not `Promise.all` — and the alternative
// duplicates the one piece of arithmetic in this system that must never drift.
//
// ## There is no batch limit, and that is deliberate
//
// A sweep that took the oldest N would be the usual defence against a backlog.
// It is incompatible with how `job-runner.service.ts` establishes idempotency:
// the runner re-runs the sweep inside the same transaction and requires the
// second pass to come back empty, so a limited sweep with more than N expired
// holds would hand back the next batch and be rejected as non-idempotent. The
// backlog this would guard against cannot form anyway while the cron fires every
// minute; if it ever does, the answer is a larger transaction once, not a sweep
// that reports success having done part of the work.

import { Injectable } from "@nestjs/common";
import { and, eq, lt, sql } from "drizzle-orm";
import type { DbExecutor } from "../../database/database.module.js";
import { booking } from "../../database/schema/booking.js";
import type { SweepJob } from "../../jobs/sweep-job.js";
import { BookingService } from "./booking.service.js";

// Every minute, and the cadence is a promise about lateness rather than a
// performance decision: a hold is released somewhere between its TTL and its TTL
// plus this. No cadence makes that overshoot zero — `BOOKING_HOLD_TTL_MINUTES`
// floors at one minute — and the direction it errs in is the safe one, since a
// night still counted as sold is a night the property declines to sell twice.
//
// A minute rather than the two it was, and the minute bought is the last one of
// the overshoot: with the TTL at ten, an abandoned funnel session costs the
// property a room for at most eleven minutes rather than seventeen. That matters
// because the door the hold came through is public and unauthenticated, so the
// overshoot is time a stranger holds a room for free — and it is not paid for in
// load. The query behind each tick is a scan of the partial index
// `booking_hold_expires_at_idx`, which exists for this sweep and covers only the
// rows that are still held; on a night with nothing expired it reads nothing.
const EVERY_MINUTE = "* * * * *";

/**
 * Cancels every hold whose TTL has run out, releasing its nights.
 *
 * Registered in `jobs.module.ts` and owned here, which is the split that file
 * describes: the scheduler is machinery, and a sweep belongs to the requirement
 * that asked for it.
 */
@Injectable()
export class HoldExpirySweep implements SweepJob {
  readonly name = "hold-expiry";
  readonly schedule = EVERY_MINUTE;

  constructor(private readonly bookings: BookingService) {}

  /**
   * The business date is not taken, and its absence is the point.
   *
   * `sweep-job.ts` draws the line: a sweep tied to the property's day takes the
   * date so it can be re-run over a night that failed, and work that is
   * genuinely about *now* asks Postgres instead. A TTL is the second kind. The
   * `now()` below is the runner transaction's start time, so it is one instant
   * for both of the runner's passes and identical on every connection — an
   * expiry cannot fall due between the pass that did the work and the pass that
   * checks it settled.
   */
  async run(exec: DbExecutor): Promise<readonly string[]> {
    // `for update` rather than a plain read, and it is what keeps this sweep off
    // a booking somebody just paid for. Under `read committed` Postgres
    // re-evaluates the predicate after it takes each row's lock, so a hold that
    // a concurrent `confirm` moved to `CONFIRMED` while this statement waited
    // drops out of the result instead of being cancelled a moment later — and
    // §3 would have allowed that cancellation, since `CONFIRMED → CANCELLED` is
    // a legal transition. Ordered by id so that two statements contending for
    // the same rows take them in the same order; the runner's advisory lock
    // already stops two runs of this sweep overlapping, and this holds the line
    // against everything else in the tree that locks a booking.
    const expired = await exec
      .select({ id: booking.id })
      .from(booking)
      .where(
        and(eq(booking.state, "HELD"), lt(booking.holdExpiresAt, sql`now()`)),
      )
      .orderBy(booking.id)
      .for("update");

    const cancelled: string[] = [];

    for (const { id } of expired) {
      // Never waived. The sweep is a clock and not an authority, and §4 prices
      // an abandoned hold by the same grid as any other cancellation.
      await this.bookings.cancel(exec, {
        bookingId: id,
        reason: "HOLD_EXPIRED",
        waivedBy: null,
      });
      cancelled.push(id);
    }

    return cancelled;
  }
}
