import { CalendarDate, now, parseDate } from "@internationalized/date";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  nightCount,
  PROPERTY_TIME_ZONE,
  type StayDate,
  stayDateSchema,
  stayRangeSchema,
} from "./stay-date.js";

describe("a stay date", () => {
  it("decodes the wire form into a CalendarDate", () => {
    const decoded = stayDateSchema.parse("2026-08-14");

    expect(decoded).toBeInstanceOf(CalendarDate);
    expect([decoded.year, decoded.month, decoded.day]).toEqual([2026, 8, 14]);
  });

  it("encodes back to the string it came from", () => {
    expect(z.encode(stayDateSchema, new CalendarDate(2026, 8, 14))).toBe(
      "2026-08-14",
    );
  });

  // The failure this type exists to prevent. A shape check alone accepts it,
  // and `new Date` rolls it forward into March rather than objecting.
  it("refuses a date that does not exist", () => {
    const result = stayDateSchema.safeParse("2026-02-31");

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("not a date that exists");
  });

  it("refuses anything that is not YYYY-MM-DD", () => {
    for (const value of ["14/08/2026", "2026-8-14", "2026-08-14T00:00:00Z"]) {
      expect(stayDateSchema.safeParse(value).success).toBe(false);
    }
  });

  // `P0-C-02`'s definition of done, asserted the only way a compile-time claim
  // can be: this file is typechecked, so if the assignment below ever starts
  // compiling, `@ts-expect-error` becomes the error instead. Both classes carry
  // private fields, which is what makes TypeScript compare them by name rather
  // than by shape — a `ZonedDateTime` has every field a `CalendarDate` has and
  // would otherwise be accepted.
  it("cannot be assigned an instant", () => {
    const instant = now(PROPERTY_TIME_ZONE);

    // @ts-expect-error a ZonedDateTime is not a stay date
    const wrong: StayDate = instant;

    expect(wrong).toBeDefined();
  });
});

describe("a stay range", () => {
  it("counts nights under the half-open convention", () => {
    expect(
      nightCount(
        stayRangeSchema.parse({
          checkIn: "2026-08-14",
          checkOut: "2026-08-17",
        }),
      ),
    ).toBe(3);
  });

  it("counts a single night", () => {
    expect(
      nightCount(
        stayRangeSchema.parse({
          checkIn: "2026-08-14",
          checkOut: "2026-08-15",
        }),
      ),
    ).toBe(1);
  });

  // The month and year boundaries are where an implementation that subtracts
  // day numbers instead of dates gives a wrong answer.
  it("counts across a month and a year boundary", () => {
    expect(
      nightCount(
        stayRangeSchema.parse({
          checkIn: "2026-01-30",
          checkOut: "2026-02-02",
        }),
      ),
    ).toBe(3);
    expect(
      nightCount(
        stayRangeSchema.parse({
          checkIn: "2026-12-30",
          checkOut: "2027-01-02",
        }),
      ),
    ).toBe(3);
  });

  it("counts across a leap day", () => {
    expect(
      nightCount(
        stayRangeSchema.parse({
          checkIn: "2028-02-27",
          checkOut: "2028-03-01",
        }),
      ),
    ).toBe(3);
  });

  it("refuses a departure before the arrival", () => {
    expect(
      stayRangeSchema.safeParse({
        checkIn: "2026-08-17",
        checkOut: "2026-08-14",
      }).success,
    ).toBe(false);
  });

  // Not a stay. Rejected here so no caller has to decide what zero nights costs.
  it("refuses a range that sells no nights", () => {
    expect(
      stayRangeSchema.safeParse({
        checkIn: "2026-08-14",
        checkOut: "2026-08-14",
      }).success,
    ).toBe(false);
  });

  it("names the field a caller can act on", () => {
    const result = stayRangeSchema.safeParse({
      checkIn: "2026-08-17",
      checkOut: "2026-08-14",
    });

    expect(result.error?.issues[0]?.path).toEqual(["checkOut"]);
  });
});

describe("the property's zone", () => {
  // Stated once so a stay date is never resolved against the server's clock.
  it("is Ho Chi Minh City", () => {
    expect(PROPERTY_TIME_ZONE).toBe("Asia/Ho_Chi_Minh");
  });

  // Vietnam keeps no daylight saving, so midnight-to-midnight is 24 hours
  // everywhere in the year. `nightCount` measures at UTC for the same reason,
  // and this is the assertion that would fail if either fact changed.
  it("has no daylight saving to lose a night to", () => {
    const march = parseDate("2026-03-28").toDate(PROPERTY_TIME_ZONE);
    const october = parseDate("2026-10-24").toDate(PROPERTY_TIME_ZONE);

    expect(
      (parseDate("2026-03-29").toDate(PROPERTY_TIME_ZONE).getTime() -
        march.getTime()) /
        3_600_000,
    ).toBe(24);
    expect(
      (parseDate("2026-10-25").toDate(PROPERTY_TIME_ZONE).getTime() -
        october.getTime()) /
        3_600_000,
    ).toBe(24);
  });
});
