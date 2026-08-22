// The other half of `FR-RPT-01`'s acceptance: "a missed audit pages within 30
// min".
//
// A night audit that fails is quiet. Nothing is refused, no guest is turned
// away, no screen goes red — the property trades on into a day whose predecessor
// was never closed, and the first person to notice is whoever opens a Reports
// page and finds yesterday missing from it, which may be a week later. By then
// the day has been closed late or not at all, and `screens.md`'s promise that a
// report is "stamped with the business date of the night-audit snapshot it
// reads" has quietly become a report with a hole in it.
//
// So the absence is watched for, and it is watched for in a separate sweep
// rather than at the foot of `night-audit.job.ts`. The reason is the failure
// this exists to catch: the audit not running at all. A watchdog inside the
// thing being watched cannot report that the thing did not run, and every way of
// arranging otherwise — a scheduler health check, a heartbeat row — is a second
// mechanism with the same hole one level up. Two registered sweeps mean the page
// depends on the scheduler and on nothing else, and `job-scheduler.service.ts`'s
// own boot log is what covers the scheduler.
//
// ## It asks Postgres what time it is, and that is the exception the rule allows
//
// `sweep-job.ts` says a sweep takes a business date and never reads a clock, and
// then says what this is: "work that is genuinely about *now*". Whether thirty
// minutes have passed since a day rolled is exactly that question, and it cannot
// be asked of a business date, which is the same value for the whole of the
// twenty-four hours this has to distinguish between. The instant comes from
// `now()` inside the runner's transaction — the transaction's own start time, so
// it is one instant for both of the runner's passes and identical on every
// connection — rather than from `new Date()` in this process, whose clock is one
// container's and is the thing nobody notices has drifted.
//
// The deadline it is compared against is derived and not configured. The
// business date the runner handed over began at the configured rollover hour on
// its own calendar day, in the property's zone; thirty minutes after that
// instant is when the day before it should have been closed. So an `ADMIN`
// moving the rollover hour moves this deadline with it, which is what §2 means
// by "changes one row, not a deploy" — a grace period pinned to 04:30 would be
// the rollover hour's second home, and would page every morning at a property
// that audits at six.
//
// ## It writes nothing, and pages again next tick
//
// Nothing is returned to the runner and no row is written, for the reason
// `room-charge-sweep.ts` gives about its own two reports: the runner requires a
// second pass over the same transaction to come back empty, and a sweep
// reporting work it had not done would fail that check for the wrong reason.
// Here it also means the check never runs at all, because the first pass is
// always empty — which is correct, since asking twice whether a day is closed
// cannot make it closed.
//
// The consequence is that an unclosed day pages on every tick until somebody
// closes it. That is the intended behaviour rather than a missing suppression:
// an open incident that stops paging is an incident that gets forgotten, and the
// alternative — a table of pages already sent — is a second thing to keep true
// about a condition the snapshot table already answers. Collapsing repeats
// belongs to whoever receives the page, which `ops-alert.service.ts` argues at
// length is the property's own escalation policy and deliberately not this
// tree's: the `kind` below is stable and the business date is in the details,
// which is everything a receiver needs to dedupe on.

import { toCalendarDateTime, toZoned } from "@internationalized/date";
import { PROPERTY_TIME_ZONE, type StayDate } from "@mariva/shared";
import { Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import type { DbExecutor } from "../../database/database.module.js";
import { nightAuditSnapshot } from "../../database/schema/night-audit.js";
import type { SweepJob } from "../../jobs/sweep-job.js";
import { OpsAlertService } from "../notification/ops-alert.service.js";
import { SystemConfigService } from "../system-config/system-config.service.js";

// Every quarter of an hour. The grace below is thirty minutes and a rollover
// hour is a whole hour, so the deadline always falls on the half hour and a
// quarter-hourly tick lands on it exactly — which is what makes "within 30 min"
// a property of the schedule rather than a hope about how long a cron takes to
// come round.
const QUARTER_HOURLY = "*/15 * * * *";

// How long the property is given to close the day that just ended.
//
// `FR-RPT-01`'s own figure, and it is a deadline rather than an estimate of how
// long the audit takes: `night-audit.job.ts` runs at five past every hour, so an
// ordinary night is closed twenty-five minutes before this expires and the only
// thing that reaches it is a night that did not run or did not finish.
const GRACE_MINUTES = 30;

/**
 * Pages when a business date the property has finished trading is still not
 * frozen half an hour after the day rolled.
 *
 * Registered in `jobs.module.ts` and owned here, the split that file describes.
 */
@Injectable()
export class NightAuditWatchdogJob implements SweepJob {
  readonly name = "night-audit-watchdog";
  readonly schedule = QUARTER_HOURLY;

  constructor(
    private readonly configuration: SystemConfigService,
    private readonly alerts: OpsAlertService,
  ) {}

  /**
   * Answers with nothing, always. The page is the work.
   *
   * Only the day that closed at the most recent rollover is asked about. A day
   * further back that is still unfrozen was this same watchdog's subject on the
   * morning it closed and was paged about then; re-paging it now would say the
   * audit is late by half an hour about a day it is late by a week on, and
   * `night-audit.job.ts` picks it up on its own for a week regardless.
   */
  async run(exec: DbExecutor, today: StayDate): Promise<readonly string[]> {
    const closing = today.subtract({ days: 1 });

    const [frozen] = await exec
      .select({ businessDate: nightAuditSnapshot.businessDate })
      .from(nightAuditSnapshot)
      .where(eq(nightAuditSnapshot.businessDate, closing.toString()));

    if (frozen) {
      return [];
    }

    const rolloverHour =
      await this.configuration.businessDateRolloverHour(exec);

    if (!(await this.graceHasRun(exec, today, rolloverHour))) {
      // The day rolled less than half an hour ago and the audit has its window.
      // This is the ordinary reading between a rollover and the tick that closes
      // the day, and a watchdog that paged here would page every single morning.
      return [];
    }

    await this.alerts.page({
      kind: "night-audit-missed",
      text:
        `Business date ${closing.toString()} ended over ${GRACE_MINUTES} minutes ago and the night audit has not closed it — ` +
        "reports have no figures for that day and room charges for it may still be unposted",
      details: {
        businessDate: closing.toString(),
        rolloverHour,
        graceMinutes: GRACE_MINUTES,
      },
    });

    return [];
  }

  /**
   * Whether the audit's window for closing the previous day has expired.
   *
   * The comparison is made by Postgres against the runner transaction's own
   * start time, which is the instant `sweep-job.ts` points work like this at.
   * The deadline is computed here because it is arithmetic over a calendar date
   * and a configured hour in the property's zone — the one thing this process
   * can do that `now()` cannot.
   */
  private async graceHasRun(
    exec: DbExecutor,
    today: StayDate,
    rolloverHour: number,
  ): Promise<boolean> {
    // The instant the day the property is currently having began: its own
    // calendar date at the rollover hour, read in the property's zone rather
    // than the server's. `business-date.service.ts` derives the date from an
    // instant by the same rule and this is that rule run backwards, which is why
    // neither of them is a subtraction of hours from a UTC timestamp.
    const rolledAt = toZoned(
      toCalendarDateTime(today).set({ hour: rolloverHour }),
      PROPERTY_TIME_ZONE,
    ).add({ minutes: GRACE_MINUTES });

    const asked = await exec.execute(
      sql`select now() >= ${rolledAt.toDate()} as elapsed`,
    );

    return asked.rows[0]?.elapsed === true;
  }
}
