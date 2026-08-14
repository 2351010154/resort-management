// The instants below are written in UTC on purpose. A fixture stated in local
// time would be read by `fromDate` in the property's zone and prove nothing —
// the whole point of this service is that the two disagree, and the assertions
// are only worth making if the input crosses the boundary the code has to get
// right.
//
// The hour itself is stood in for rather than read off `system_config`. That the
// service takes it from the row, and that an edit to the row moves the
// property's day without a deploy, is `test/system-config.e2e-spec.ts`'s against
// a real Postgres — it is a claim about a database and it is asserted against
// one. What is left here is the arithmetic the hour is fed into: the zone
// crossing, the subtraction, and the calendar walk over a month and a year
// boundary. None of that changes with the hour, and none of it needs a
// connection to be wrong.

import { CalendarDate } from "@internationalized/date";
import { describe, expect, it } from "vitest";
import { type Env, parseEnv } from "../../config/env.js";
import type { DbExecutor } from "../../database/database.module.js";
import { SystemConfigService } from "../system-config/system-config.service.js";
import { BusinessDateService } from "./business-date.service.js";

/** A property whose day rolls at `hour`, answering without a row to read. */
class RolloverAt extends SystemConfigService {
  constructor(private readonly hour: number) {
    super();
  }

  override async businessDateRolloverHour(): Promise<number> {
    return this.hour;
  }
}

// Never touched. The configuration above answers out of a field, so nothing
// below opens a connection or needs one — which is also why this file is a spec
// beside the service rather than a suite in `test/`.
const NO_EXECUTOR = undefined as unknown as DbExecutor;

// The four variables with no default, plus whichever rollover the case wants.
// `parseEnv` rather than a hand-built object, so the default this suite asserts
// is the one the API actually seeds the row with.
function envWith(overrides: NodeJS.ProcessEnv = {}): Env {
  return parseEnv({
    NODE_ENV: "test",
    DATABASE_URL: "postgres://localhost:5432/mariva",
    BETTER_AUTH_SECRET: "a".repeat(32),
    STAFF_JWT_SECRET: "b".repeat(32),
    ...overrides,
  });
}

function serviceWith(
  rolloverHour: number = envWith().BUSINESS_DATE_ROLLOVER_HOUR,
): BusinessDateService {
  return new BusinessDateService(new RolloverAt(rolloverHour));
}

describe("the business date", () => {
  it("is seeded to roll at 04:00 — property-and-tariff.md §2", () => {
    expect(envWith().BUSINESS_DATE_ROLLOVER_HOUR).toBe(4);
  });

  it("is a calendar date and never an instant", async () => {
    const date = await serviceWith().current(
      NO_EXECUTOR,
      new Date("2026-08-14T10:00:00Z"),
    );

    expect(date).toBeInstanceOf(CalendarDate);
    expect(date.toString()).toBe("2026-08-14");
  });

  // §2's own example: a booking created at 01:30 on 15 August belongs to
  // business date 14 August, because the night audit has not run.
  it("belongs to the previous date before the rollover", async () => {
    // 18:30Z on the 14th is 01:30 ICT on the 15th.
    const date = await serviceWith().current(
      NO_EXECUTOR,
      new Date("2026-08-14T18:30:00Z"),
    );

    expect(date.toString()).toBe("2026-08-14");
  });

  it("has rolled once the hour is reached", async () => {
    // 21:00Z on the 14th is exactly 04:00 ICT on the 15th.
    const date = await serviceWith().current(
      NO_EXECUTOR,
      new Date("2026-08-14T21:00:00Z"),
    );

    expect(date.toString()).toBe("2026-08-15");
  });

  it("has not rolled a minute before it", async () => {
    // 20:59Z on the 14th is 03:59 ICT on the 15th.
    const date = await serviceWith().current(
      NO_EXECUTOR,
      new Date("2026-08-14T20:59:00Z"),
    );

    expect(date.toString()).toBe("2026-08-14");
  });

  // The off-by-one this service exists to prevent: late on a UTC evening the
  // property is already a day ahead, and a service that took the UTC date and
  // adjusted it would answer the 14th here.
  it("reads the date in the property's zone, not in UTC", async () => {
    // 23:50Z on the 14th is 06:50 ICT on the 15th — past the rollover.
    const date = await serviceWith().current(
      NO_EXECUTOR,
      new Date("2026-08-14T23:50:00Z"),
    );

    expect(date.toString()).toBe("2026-08-15");
  });

  it("walks the calendar across a month boundary", async () => {
    // 19:00Z on 31 August is 02:00 ICT on 1 September — before the rollover.
    const date = await serviceWith().current(
      NO_EXECUTOR,
      new Date("2026-08-31T19:00:00Z"),
    );

    expect(date.toString()).toBe("2026-08-31");
  });

  it("walks the calendar across a year boundary", async () => {
    // 18:00Z on 31 December is 01:00 ICT on 1 January.
    const date = await serviceWith().current(
      NO_EXECUTOR,
      new Date("2026-12-31T18:00:00Z"),
    );

    expect(date.toString()).toBe("2026-12-31");
  });

  // §2: "a property that runs its audit at 06:00 changes one row, not a deploy".
  it("honours the hour the configuration gives it", async () => {
    // 22:00Z on the 14th is 05:00 ICT on the 15th — past 04:00, before 06:00.
    const date = await serviceWith(6).current(
      NO_EXECUTOR,
      new Date("2026-08-14T22:00:00Z"),
    );

    expect(date.toString()).toBe("2026-08-14");
  });

  it("rolls at midnight when the property configures no audit window", async () => {
    // 17:10Z on the 14th is 00:10 ICT on the 15th.
    const date = await serviceWith(0).current(
      NO_EXECUTOR,
      new Date("2026-08-14T17:10:00Z"),
    );

    expect(date.toString()).toBe("2026-08-15");
  });

  // The seed's own guard. The row is held to the same range by
  // `system_config_rollover_hour_is_an_hour`, and `config-storage.e2e-spec.ts`
  // asserts that end of it; this is the end that refuses the value before it
  // ever reaches the row.
  it("refuses to seed an hour that is not one", () => {
    expect(() => envWith({ BUSINESS_DATE_ROLLOVER_HOUR: "24" })).toThrow();
    expect(() => envWith({ BUSINESS_DATE_ROLLOVER_HOUR: "-1" })).toThrow();
  });
});
