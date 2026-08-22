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

import {
  parseDate,
  toCalendarDateTime,
  toZoned,
} from "@internationalized/date";
import { PROPERTY_TIME_ZONE, type StayDate } from "@mariva/shared";
import { Injectable } from "@nestjs/common";
import { lte, sql } from "drizzle-orm";
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
   * Every business date the property has finished trading and not frozen is
   * asked about, and not only the one that closed at the most recent rollover.
   * A day the audit refuses is the reason: `night-audit.job.ts` will not freeze
   * a date carrying a night nothing can charge, and it looks back seven days —
   * so a day nobody repairs stops being a candidate on the eighth morning, and a
   * sweep that only ever asked about yesterday would stop mentioning it at the
   * same moment. A permanent hole in every report range that spans that date,
   * and silence about it, is the failure `FR-RPT-01` exists to prevent reached
   * from the other side.
   *
   * The oldest one is what the page names. A backlog is one incident rather
   * than one per morning, the oldest date is what somebody has to act on first,
   * and it holds still from tick to tick — which is what a receiver deduping on
   * `kind` and the business date needs of it.
   */
  async run(exec: DbExecutor, today: StayDate): Promise<readonly string[]> {
    const closing = today.subtract({ days: 1 });
    const unclosed = await this.unclosed(exec, closing);

    if (unclosed.length === 0) {
      return [];
    }

    const rolloverHour =
      await this.configuration.businessDateRolloverHour(exec);

    // Only the day that has just closed can still be inside the audit's window.
    // Anything behind it ended whole days ago and is past the grace by
    // arithmetic rather than by a question, so the clock is asked about exactly
    // one case — and it is the case that would otherwise page every morning
    // between a rollover and the tick that closes the day.
    const onlyLastNight =
      unclosed.length === 1 && unclosed[0] === closing.toString();

    if (onlyLastNight && !(await this.graceHasRun(exec, today, rolloverHour))) {
      return [];
    }

    const [oldest] = unclosed;
    const behind = unclosed.length - 1;

    await this.alerts.page({
      kind: "night-audit-missed",
      text:
        `Business date ${oldest} ended over ${GRACE_MINUTES} minutes ago and the night audit has not closed it — ` +
        "reports have no figures for that day and room charges for it may still be unposted" +
        (behind > 0
          ? `; ${behind} later business date(s) are open too, so the property is behind on closing its days`
          : ""),
      details: {
        businessDate: oldest,
        unclosedDates: unclosed.length,
        rolloverHour,
        graceMinutes: GRACE_MINUTES,
      },
    });

    return [];
  }

  /**
   * Every business date the property finished trading and never froze, oldest
   * first.
   *
   * The window runs from the first day the audit ever closed to the day that
   * has just closed, because that span is exactly what the property owes a
   * snapshot for. Before the first frozen row it was not keeping them, and a
   * watchdog that read their absence as a backlog would page about every day
   * since the property opened on the morning this deploys. An empty table falls
   * back to the day that has just closed — a property whose very first audit has
   * not run, which is the one case with no earlier row to take a horizon from
   * and still a day somebody owes.
   *
   * Reading the whole set is reasonable rather than something to bound, because
   * the set is one row per day the property has traded: a 40-room house closes
   * 365 of them a year, and the table is its own trading history.
   */
  private async unclosed(
    exec: DbExecutor,
    closing: StayDate,
  ): Promise<readonly string[]> {
    const lastNight = closing.toString();

    const rows = await exec
      .select({ businessDate: nightAuditSnapshot.businessDate })
      .from(nightAuditSnapshot)
      .where(lte(nightAuditSnapshot.businessDate, lastNight));

    const frozen = new Set(rows.map((row) => row.businessDate));

    // An ISO date sorts as text, so the earliest is the smallest string — and
    // folding from last night is what makes an empty table answer with the one
    // day it should rather than with no window at all.
    const earliest = [...frozen].reduce(
      (oldest, day) => (day < oldest ? day : oldest),
      lastNight,
    );

    const missing: string[] = [];

    for (
      let day = parseDate(earliest);
      day.compare(closing) <= 0;
      day = day.add({ days: 1 })
    ) {
      const on = day.toString();

      if (!frozen.has(on)) {
        missing.push(on);
      }
    }

    return missing;
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
