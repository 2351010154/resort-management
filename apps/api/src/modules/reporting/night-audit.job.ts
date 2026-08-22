// The night audit — `FR-RPT-01`, and the first thing M9 owes.
//
// Three clauses, and this file is two of them. It posts the room charges for the
// day that has ended, and it freezes the snapshot the reports read. Rolling the
// business date is the third and is deliberately no code at all:
// `business-date.service.ts` derives what day it is from the clock and the
// configured rollover hour, and refuses to hold the answer anywhere on the
// argument that a second copy of it will differ and will be the one nothing can
// correct. So the date has already rolled by the time this runs, and closing the
// day that just ended *is* the roll as far as anything downstream can observe —
// a report reads snapshots, and a day acquires one here or is not a day the
// reports have.
//
// It issues no invoice. `FR-RPT-01` says so in a clause of its own and names
// `FR-FOL-04` as what does; `e-invoice.job.ts` hangs that off the moment a desk
// agreed an account, which is a different event on a different schedule, and an
// audit that also invoiced would draw a document from a folio the guest has not
// checked out of.
//
// ## The charges are posted by the sweep that already posts them
//
// `RoomChargeSweep` runs hourly and puts the night on each in-house account, and
// this calls that same sweep over the day it is about to close rather than
// writing a second implementation of what a night costs. That file spends most
// of its length on why the figure is the difference of two stay totals and where
// the odd đồng lands, and a night charged one way by the hourly sweep and
// another way by the audit would leave two folios in the property disagreeing
// about the same room.
//
// In the ordinary case the call finds nothing: the hourly sweep charged the
// night hours ago and its own `not exists` refuses to charge it again. What it
// catches is the night the hourly sweep could not — a check-in keyed after the
// stay's first night had begun, an hour the process was down — and it catches it
// while the day is still being closed rather than after the snapshot has frozen
// a figure that is short by a night. That ordering is the whole reason the call
// is here and not left to the next hourly tick.
//
// The hourly sweep stays. It is what keeps a folio current during the day, which
// is what `booking-state-machine.md` §4's check-out guard reads at eleven in the
// morning, and an audit-only posting would leave every departing guest's account
// showing only the nights before last.
//
// ## Which days are closed, and why the cron is ordinary
//
// The date the runner hands over is the day the property is *currently having*,
// and it is never frozen: a day still being traded has room charges still to
// post and corrections still to make, and a snapshot of it would be a figure the
// evening then walks away from. So this works the closed days behind it and
// takes each one that has no snapshot yet — `reconciliation.job.ts` reaches the
// same shape from the same constraint and argues it at length.
//
// That predicate is what lets the cron be a plain hourly one. `no-show-sweep.ts`
// refuses to compile the rollover into a daily cron because the hour is
// configuration and a pinned cron would be its second home; here the sweep is
// about the boundary itself, so it asks every hour and whichever tick first
// finds yesterday closed does the work. The other twenty-three find the day
// frozen and write nothing.
//
// A date the caller names is that date, which is how a manager closes a night
// that failed — the same door `job-trigger.controller.ts` opens for every other
// sweep, and the reason the look-back window below is a convenience rather than
// the only way back.
//
// ## A day that would freeze short is not frozen at all
//
// The look-back above is what makes this necessary. `RoomChargeSweep` charges
// stays that are `CHECKED_IN`, which is every stay in the building on the
// ordinary path — the day is closed within five minutes of rolling, hours
// before anybody checks out, and the case below never fires. A day closed *late*
// is the other one: the stays that occupied it have since departed, and no run
// will ever charge them, because a departed stay's account has been agreed and
// `0016`'s trigger refuses a further line on a closed folio with `MV002`.
// Charging them anyway is not available, and would not be wanted if it were —
// §4's check-out guard already balanced that account to zero and `FR-FOL-04` has
// drawn an invoice from it, so a night posted afterwards is money the guest was
// never asked for on a document that cannot be reissued.
//
// So a date carrying a night that cannot be charged is not frozen. The choice is
// between a day left open, which a person can still close once they repair
// whatever went missing, and a day frozen short, which `schema/night-audit.ts`
// makes permanent by design — the whole value of the row is that nothing
// rewrites it, and that value is exactly what makes freezing a wrong figure the
// worse of the two. Somebody is paged, because a day nobody closes is the
// silence the watchdog beside this file exists for, and this one can say which
// stays.
//
// It refuses that date and no other. A backlog is worked oldest first and each
// day stands alone — a snapshot is per business date and reads only the postings
// dated to it — so one unclosable morning must not stop the six days behind it
// from closing, which is the shape a throw from inside the loop would have.
//
// ## Idempotency is the row, not a promise
//
// `job-runner.service.ts` re-runs a sweep inside the same transaction and
// requires the second pass to come back empty. This satisfies that in the
// strongest available form: the first pass writes a snapshot row keyed on the
// business date, and the second finds that date no longer outstanding and
// returns nothing. The charges underneath settle the same way, because the sweep
// that posts them is itself idempotent against the line it wrote. Nothing here
// checks a flag it set earlier — the freeze is refused by the primary key rather
// than by a caller that looked first, which is what makes a manager's manual
// re-run at nine in the morning safe rather than merely unlikely.

import type { StayDate } from "@mariva/shared";
import { Injectable } from "@nestjs/common";
import { inArray } from "drizzle-orm";
import { PinoLogger } from "nestjs-pino";
import type { DbExecutor } from "../../database/database.module.js";
import { nightAuditSnapshot } from "../../database/schema/night-audit.js";
import type { SweepJob } from "../../jobs/sweep-job.js";
import { RoomChargeSweep } from "../folio/room-charge-sweep.js";
import { OpsAlertService } from "../notification/ops-alert.service.js";
import { NightAuditService } from "./night-audit.service.js";

// Hourly, five past. The header says why the rollover hour is not compiled in
// here; five past keeps it off the hour boundary and off the three sweeps that
// already run at twenty, thirty-five and fifty past, and it is the first tick
// after a rollover on the hour — so an ordinary night is closed within five
// minutes of ending and the watchdog's thirty never comes near.
const HOURLY = "5 * * * *";

// How far back a day is still closed automatically.
//
// `reconciliation.job.ts` takes a week for reasons that are mostly about a
// gateway's retention, and the same figure here is about something else: a
// snapshot frozen a week late is still exactly right, because every posting it
// reads is dated to the day it belongs to and none of them move. What the bound
// is really for is the first morning this deploys, when "every closed day with
// no snapshot" would otherwise be every day since the property opened — a night
// audit run over a year of history in one transaction, filing figures for months
// nobody was watching. Older than this is a person naming the date, which the
// manual trigger already takes.
const LOOK_BACK_DAYS = 7;

/**
 * How many stays a page names rather than counts.
 *
 * `room-charge-sweep.ts`'s figure, for its reason: enough to start from without
 * turning one stuck stay into a message nobody reads. The count beside them is
 * the whole set.
 */
const NAMED_IN_A_PAGE = 5;

/**
 * Closes every business date the property has finished trading and not yet
 * frozen.
 *
 * Registered in `jobs.module.ts` and owned here, the split that file describes:
 * the scheduler is machinery, and a job belongs to the requirement that asked
 * for it.
 */
@Injectable()
export class NightAuditJob implements SweepJob {
  readonly name = "night-audit";
  readonly schedule = HOURLY;

  /**
   * The business dates this sweep has already paged about, per transaction.
   *
   * `room-charge-sweep.ts` carries the same map and argues it: the runner's
   * transaction stands for the run, it is handed to every pass of one run and to
   * no other, and a run that froze one date and refused another is called twice.
   * Without the mark the refused date would page on both passes, and one
   * incident would reach whoever is on call as two. Weak, so a finished run's
   * transaction is collected rather than held here for the life of the process.
   */
  private readonly pagedOn = new WeakMap<object, Set<string>>();

  constructor(
    private readonly roomCharges: RoomChargeSweep,
    private readonly audit: NightAuditService,
    private readonly alerts: OpsAlertService,
    // The context is set on an injected `PinoLogger` rather than declared with
    // `@InjectPinoLogger`, for the evaluation-order reason
    // `job-runner.service.ts` sets out where it does the same thing.
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("NightAuditJob");
  }

  /**
   * Answers with the business dates it closed, oldest first.
   *
   * `today` is the day the property is currently having and is never closed —
   * the header says why a day still being traded cannot be.
   */
  async run(exec: DbExecutor, today: StayDate): Promise<readonly string[]> {
    const closed: string[] = [];

    // Sequential, for `room-charge-sweep.ts`'s reason: every statement is on the
    // runner's one connection inside its one transaction, and a night's in-house
    // stays are counted in tens.
    for (const businessDate of await this.outstanding(exec, today)) {
      // Before the freeze, and inside the same transaction, which is the whole
      // ordering `FR-RPT-01` asks for in the words "posts room charges … freezes
      // an immutable snapshot". A charge posted after the snapshot would be
      // money on a night the property has already reported.
      const posted = await this.roomCharges.run(exec, businessDate);

      // After the charges and before the freeze, which is the only place the
      // question can be asked: the sweep above has just posted everything it
      // could, so whatever is still uncharged is what no run will ever post.
      const uncharged = await this.audit.unchargedStays(exec, businessDate);

      if (uncharged.length > 0) {
        await this.reportShort(exec, businessDate, uncharged);

        // The date stays outstanding, so the next tick asks again and a person
        // who repairs the night gets it closed without naming a date by hand.
        // The loop carries on to the days behind it; each one stands alone.
        continue;
      }

      if (!(await this.audit.freeze(exec, businessDate))) {
        // Unreachable through the predicate above, which selected this date
        // because it had no snapshot, and unreachable concurrently, because
        // `JobRunner` holds an advisory lock over the whole run. Logged rather
        // than thrown: the day is closed either way, and failing the run here
        // would roll back a freeze that is already correct.
        this.logger.warn(
          { businessDate: businessDate.toString() },
          "the business date was already frozen, so this run closed nothing",
        );

        continue;
      }

      // At `warn`, because the hourly sweep should have posted these hours ago
      // and a night that reached the audit uncharged is the arrears
      // `room-charge-sweep.ts` reports on arriving at the last moment it can
      // still be fixed. Zero is the ordinary answer and is not logged.
      if (posted.length > 0) {
        this.logger.warn(
          { businessDate: businessDate.toString(), charged: posted.length },
          "the night audit posted room charges the hourly sweep had not, and froze the day with them on it",
        );
      }

      closed.push(businessDate.toString());
    }

    return closed;
  }

  /**
   * Wakes somebody about a day that cannot be closed without understating it.
   *
   * Once per run rather than once per pass, for the reason the map above gives.
   * Awaited rather than dispatched and forgotten: this is inside the runner's
   * transaction, which is about to commit, and a floating promise there is a
   * request nobody is left to observe. `OpsAlertService` never throws, so the
   * days behind this one are not taken down by an endpoint that is refusing.
   */
  private async reportShort(
    exec: DbExecutor,
    businessDate: StayDate,
    uncharged: readonly string[],
  ): Promise<void> {
    const night = businessDate.toString();
    const dates = this.pagedOn.get(exec) ?? new Set<string>();

    this.pagedOn.set(exec, dates);

    if (dates.has(night)) {
      return;
    }

    dates.add(night);

    this.logger.error(
      { businessDate: night, stays: uncharged.length },
      "the business date was not closed: stays occupied it with no room charge, and a snapshot would understate it for good",
    );

    await this.alerts.page({
      kind: "night-audit-day-would-freeze-short",
      text:
        `Business date ${night} has ${uncharged.length} stay(s) that occupied it with no room charge, so the night audit did not close it — ` +
        "a snapshot frozen as it stands would understate that day's room revenue permanently; post the missing nights, then re-run the night audit for that date",
      details: {
        businessDate: night,
        stays: uncharged.length,
        naming: uncharged.slice(0, NAMED_IN_A_PAGE).join(", "),
      },
    });
  }

  /**
   * Every closed business date inside the look-back window with no snapshot.
   *
   * Oldest first, so a backlog is closed in the order the days happened rather
   * than in whatever order the index hands them back — which matters more here
   * than it does for a reconciliation, because closing a day posts the charges
   * standing against it and a later day's arrears report reads them.
   */
  private async outstanding(
    exec: DbExecutor,
    today: StayDate,
  ): Promise<readonly StayDate[]> {
    const candidates: StayDate[] = [];

    for (let back = LOOK_BACK_DAYS; back >= 1; back--) {
      candidates.push(today.subtract({ days: back }));
    }

    const frozen = await exec
      .select({ businessDate: nightAuditSnapshot.businessDate })
      .from(nightAuditSnapshot)
      .where(
        inArray(
          nightAuditSnapshot.businessDate,
          candidates.map((date) => date.toString()),
        ),
      );

    const closed = new Set(frozen.map((row) => row.businessDate));

    return candidates.filter((date) => !closed.has(date.toString()));
  }
}
