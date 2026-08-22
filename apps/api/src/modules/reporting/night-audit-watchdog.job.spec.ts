// When the phone rings about a day nobody closed, and when it stays quiet.
//
// The whole of this sweep is one boundary, so the suite is that boundary
// approached from both sides. Half an hour after the day rolled, an unfrozen
// business date is `FR-RPT-01`'s missed audit and pages. A minute before that,
// the same unfrozen date is the ordinary state of every morning between the
// rollover and the tick that closes the day, and a watchdog that paged there
// would page every single day and be muted within a week.
//
// The deadline is derived from the configured rollover hour rather than pinned,
// so the third case moves the hour and holds the sweep to moving with it. That
// is §2's "changes one row, not a deploy" in the one place where getting it
// wrong is silent for the property that changed the row and loud for everybody
// carrying the pager.
//
// The second suite is the other way this sweep can fail, and it fails silently.
// `night-audit.job.ts` refuses to freeze a day carrying a night nothing can
// charge, and it looks back seven days — so a day nobody repairs stops being a
// candidate on the eighth morning. A watchdog that only ever asked about
// yesterday would stop mentioning it on the same morning, leaving a permanent
// hole in every report range that spans that date and nothing anywhere saying
// so. So the cases below put a hole behind the look-back and require the page to
// go on naming it, and require the oldest one to be the one it names.
//
// `now()` is Postgres's and not this process's — `sweep-job.ts` says why — so
// the stand-in below answers the one statement the sweep issues about time, and
// the assertions are about which instant it answered with.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import { describe, expect, it } from "vitest";
import type { DbExecutor } from "../../database/database.module.js";
import type {
  OpsAlert,
  OpsAlertService,
} from "../notification/ops-alert.service.js";
import type { SystemConfigService } from "../system-config/system-config.service.js";
import { NightAuditWatchdogJob } from "./night-audit-watchdog.job.js";

/** The day the property is having. It rolled at 04:00 this morning. */
const TODAY = parseDate("2027-11-04");

/** The day that ended at that rollover, and the one that has to be frozen. */
const LAST_NIGHT = TODAY.subtract({ days: 1 });

/**
 * 04:29 and 04:31 in the property's zone, which is UTC+7.
 *
 * The grace is thirty minutes from a 04:00 rollover, so these two instants are a
 * minute either side of the only decision this sweep makes.
 */
const A_MINUTE_BEFORE_THE_DEADLINE = new Date("2027-11-03T21:29:00Z");
const A_MINUTE_AFTER_THE_DEADLINE = new Date("2027-11-03T21:31:00Z");

describe("a business date nobody closed", () => {
  it("pages once the audit's half hour has run out", async () => {
    const watched = await watch({ at: A_MINUTE_AFTER_THE_DEADLINE });

    expect(watched.paged).toHaveLength(1);
    expect(watched.paged[0]?.kind).toBe("night-audit-missed");
    // The date is in the sentence and in the details, because a responder acts
    // on the sentence before they open a console and a receiver routes on the
    // fields.
    expect(watched.paged[0]?.text).toContain(LAST_NIGHT.toString());
    expect(watched.paged[0]?.details.businessDate).toBe(LAST_NIGHT.toString());
  });

  it("says nothing while the audit still has its half hour", async () => {
    const watched = await watch({ at: A_MINUTE_BEFORE_THE_DEADLINE });

    expect(watched.paged).toEqual([]);
  });

  it("moves the deadline when an ADMIN moves the rollover hour", async () => {
    // A property that audits at 06:00 has not even rolled the day at 04:31, so
    // the same instant that pages above must be silent here. A grace pinned to
    // 04:30 would page this property every morning of its life.
    const watched = await watch({
      at: A_MINUTE_AFTER_THE_DEADLINE,
      rolloverHour: 6,
    });

    expect(watched.paged).toEqual([]);
  });
});

describe("a business date the audit closed", () => {
  it("says nothing, however long ago the day rolled", async () => {
    const watched = await watch({
      at: A_MINUTE_AFTER_THE_DEADLINE,
      closed: [LAST_NIGHT.toString()],
    });

    expect(watched.paged).toEqual([]);
    // And it never asks what time it is, because a closed day is closed whatever
    // the answer would have been.
    expect(watched.askedTheTime).toBe(false);
    // Nor does it page about the days before the first one on file. A property
    // traded before it started keeping snapshots, and reading their absence as a
    // backlog would page about every day since it opened, on the morning this
    // deploys.
  });
});

describe("a day the audit gave up on", () => {
  it("goes on being paged about after the sweep stopped looking back at it", async () => {
    // Eight days back, so `night-audit.job.ts` no longer offers it as a
    // candidate. Nothing else in the tree mentions the date again, which is the
    // whole reason this sweep has to.
    const watched = await watch({
      at: A_MINUTE_AFTER_THE_DEADLINE,
      closed: closedExcept(["2027-10-27"]),
    });

    expect(watched.paged).toHaveLength(1);
    expect(watched.paged[0]?.details.businessDate).toBe("2027-10-27");
    expect(watched.paged[0]?.details.unclosedDates).toBe(1);
    // The grace is not consulted: a day that ended eight days ago is past it by
    // arithmetic, and asking Postgres the time would be asking a question whose
    // answer cannot change the outcome.
    expect(watched.askedTheTime).toBe(false);
  });

  it("names the oldest of them and says how many are behind it", async () => {
    const watched = await watch({
      at: A_MINUTE_AFTER_THE_DEADLINE,
      closed: closedExcept(["2027-10-27", LAST_NIGHT.toString()]),
    });

    expect(watched.paged).toHaveLength(1);
    // The oldest, because it is what somebody has to act on first and because it
    // holds still from tick to tick — which is what a receiver deduping on the
    // kind and the date needs of it.
    expect(watched.paged[0]?.details.businessDate).toBe("2027-10-27");
    expect(watched.paged[0]?.details.unclosedDates).toBe(2);
    expect(watched.paged[0]?.text).toContain("1 later business date(s)");
  });
});

describe("what the watchdog leaves behind", () => {
  it("reports no work, so the runner never re-runs it to check it settled", async () => {
    // A sweep that returned the day it paged about would be claiming to have
    // changed a row, and `job-runner.service.ts` would run it a second time and
    // require the same day back as nothing. Paging is not work in that sense —
    // it writes no row, and the day is exactly as unfrozen afterwards.
    const watched = await watch({ at: A_MINUTE_AFTER_THE_DEADLINE });

    expect(watched.reported).toEqual([]);
  });
});

/**
 * The days on file when the property has been trading a fortnight, less the
 * ones a case wants missing.
 *
 * Anchored on a first frozen day rather than running to the beginning of time,
 * because that first row is the horizon the sweep takes: before it the property
 * was not keeping snapshots, and their absence there is not a backlog.
 */
function closedExcept(open: readonly string[]): readonly string[] {
  const days: string[] = [];

  for (let back = 14; back >= 1; back--) {
    days.push(TODAY.subtract({ days: back }).toString());
  }

  return days.filter((day) => !open.includes(day));
}

/** One tick of the watchdog, and everything it did. */
async function watch({
  at,
  rolloverHour = 4,
  closed = [],
}: {
  readonly at: Date;
  readonly rolloverHour?: number;
  readonly closed?: readonly string[];
}) {
  const paged: OpsAlert[] = [];
  const books = new TheMorningAfter(at, closed);

  const job = new NightAuditWatchdogJob(
    {
      businessDateRolloverHour: async () => await Promise.resolve(rolloverHour),
    } as unknown as SystemConfigService,
    {
      page: async (alert: OpsAlert) => {
        paged.push(alert);

        return await Promise.resolve(true);
      },
    } as unknown as OpsAlertService,
  );

  const reported = await job.run(books.executor, TODAY);

  return { paged, reported, askedTheTime: books.askedTheTime };
}

/**
 * The two statements one tick issues: which days are frozen, and has the
 * deadline passed?
 *
 * The days come back as the rows themselves rather than as an answer this
 * stand-in worked out, because which of them are missing is exactly what the
 * sweep is being asked — a stand-in that filtered here would be answering
 * instead of it.
 *
 * The comparison is Postgres's in the sweep and is Postgres's here — the
 * `execute` below evaluates the instant the sweep computed against the one this
 * morning is standing at, rather than reporting a boolean the stand-in decided.
 * A stand-in that answered "yes, elapsed" would pass every case in this file
 * without the deadline arithmetic being exercised at all, which is the only
 * thing the sweep does.
 */
class TheMorningAfter {
  askedTheTime = false;

  constructor(
    private readonly now: Date,
    private readonly closed: readonly string[],
  ) {}

  get executor(): DbExecutor {
    return this as unknown as DbExecutor;
  }

  select() {
    return {
      from: () => ({
        where: async () =>
          await Promise.resolve(
            this.closed.map((businessDate) => ({ businessDate })),
          ),
      }),
    };
  }

  async execute(query: { readonly queryChunks: readonly unknown[] }) {
    this.askedTheTime = true;

    // The deadline the sweep computed is the one parameter it bound, so it is
    // the only `Date` among the chunks Drizzle assembled.
    const deadline = query.queryChunks
      .flatMap((chunk) => (chunk instanceof Date ? [chunk] : []))
      .at(0);

    if (!deadline) {
      throw new Error(
        "the watchdog asked Postgres about a time without binding one",
      );
    }

    return await Promise.resolve({
      rows: [{ elapsed: this.now.getTime() >= deadline.getTime() }],
    });
  }
}
