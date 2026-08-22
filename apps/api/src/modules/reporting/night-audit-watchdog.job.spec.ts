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
      frozen: true,
    });

    expect(watched.paged).toEqual([]);
    // And it never asks what time it is, because a closed day is closed whatever
    // the answer would have been.
    expect(watched.askedTheTime).toBe(false);
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

/** One tick of the watchdog, and everything it did. */
async function watch({
  at,
  rolloverHour = 4,
  frozen = false,
}: {
  readonly at: Date;
  readonly rolloverHour?: number;
  readonly frozen?: boolean;
}) {
  const paged: OpsAlert[] = [];
  const books = new TheMorningAfter(at, frozen);

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
 * The two statements one tick issues: is the day frozen, and has the deadline
 * passed?
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
    private readonly frozen: boolean,
  ) {}

  get executor(): DbExecutor {
    return this as unknown as DbExecutor;
  }

  select() {
    return {
      from: () => ({
        where: async () =>
          await Promise.resolve(
            this.frozen ? [{ businessDate: LAST_NIGHT.toString() }] : [],
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
