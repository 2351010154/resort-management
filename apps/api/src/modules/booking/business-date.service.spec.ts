// The instants below are written in UTC on purpose. A fixture stated in local
// time would be read by `fromDate` in the property's zone and prove nothing —
// the whole point of this service is that the two disagree, and the assertions
// are only worth making if the input crosses the boundary the code has to get
// right.

import { CalendarDate } from "@internationalized/date";
import { describe, expect, it } from "vitest";
import { type Env, parseEnv } from "../../config/env.js";
import { BusinessDateService } from "./business-date.service.js";

// The three variables with no default, plus whichever rollover the case wants.
// `parseEnv` rather than a hand-built object, so the default this suite asserts
// is the one the API actually boots with.
function envWith(overrides: NodeJS.ProcessEnv = {}): Env {
  return parseEnv({
    DATABASE_URL: "postgres://localhost:5432/mariva",
    BETTER_AUTH_SECRET: "a".repeat(32),
    STAFF_JWT_SECRET: "b".repeat(32),
    ...overrides,
  });
}

function serviceWith(overrides: NodeJS.ProcessEnv = {}): BusinessDateService {
  return new BusinessDateService(envWith(overrides));
}

describe("the business date", () => {
  it("rolls at 04:00 by default — property-and-tariff.md §2", () => {
    expect(envWith().BUSINESS_DATE_ROLLOVER_HOUR).toBe(4);
  });

  it("is a calendar date and never an instant", () => {
    const date = serviceWith().current(new Date("2026-08-14T10:00:00Z"));

    expect(date).toBeInstanceOf(CalendarDate);
    expect(date.toString()).toBe("2026-08-14");
  });

  // §2's own example: a booking created at 01:30 on 15 August belongs to
  // business date 14 August, because the night audit has not run.
  it("belongs to the previous date before the rollover", () => {
    // 18:30Z on the 14th is 01:30 ICT on the 15th.
    const date = serviceWith().current(new Date("2026-08-14T18:30:00Z"));

    expect(date.toString()).toBe("2026-08-14");
  });

  it("has rolled once the hour is reached", () => {
    // 21:00Z on the 14th is exactly 04:00 ICT on the 15th.
    const date = serviceWith().current(new Date("2026-08-14T21:00:00Z"));

    expect(date.toString()).toBe("2026-08-15");
  });

  it("has not rolled a minute before it", () => {
    // 20:59Z on the 14th is 03:59 ICT on the 15th.
    const date = serviceWith().current(new Date("2026-08-14T20:59:00Z"));

    expect(date.toString()).toBe("2026-08-14");
  });

  // The off-by-one this service exists to prevent: late on a UTC evening the
  // property is already a day ahead, and a service that took the UTC date and
  // adjusted it would answer the 14th here.
  it("reads the date in the property's zone, not in UTC", () => {
    // 23:50Z on the 14th is 06:50 ICT on the 15th — past the rollover.
    const date = serviceWith().current(new Date("2026-08-14T23:50:00Z"));

    expect(date.toString()).toBe("2026-08-15");
  });

  it("walks the calendar across a month boundary", () => {
    // 19:00Z on 31 August is 02:00 ICT on 1 September — before the rollover.
    const date = serviceWith().current(new Date("2026-08-31T19:00:00Z"));

    expect(date.toString()).toBe("2026-08-31");
  });

  it("walks the calendar across a year boundary", () => {
    // 18:00Z on 31 December is 01:00 ICT on 1 January.
    const date = serviceWith().current(new Date("2026-12-31T18:00:00Z"));

    expect(date.toString()).toBe("2026-12-31");
  });

  // §2: "a property that runs its audit at 06:00 changes one row, not a deploy".
  it("honours a configured rollover hour", () => {
    const service = serviceWith({ BUSINESS_DATE_ROLLOVER_HOUR: "6" });
    // 22:00Z on the 14th is 05:00 ICT on the 15th — past 04:00, before 06:00.
    const date = service.current(new Date("2026-08-14T22:00:00Z"));

    expect(date.toString()).toBe("2026-08-14");
  });

  it("rolls at midnight when the property configures no audit window", () => {
    const service = serviceWith({ BUSINESS_DATE_ROLLOVER_HOUR: "0" });
    // 17:10Z on the 14th is 00:10 ICT on the 15th.
    const date = service.current(new Date("2026-08-14T17:10:00Z"));

    expect(date.toString()).toBe("2026-08-15");
  });

  it("refuses an hour that is not one", () => {
    expect(() => envWith({ BUSINESS_DATE_ROLLOVER_HOUR: "24" })).toThrow();
    expect(() => envWith({ BUSINESS_DATE_ROLLOVER_HOUR: "-1" })).toThrow();
  });
});
