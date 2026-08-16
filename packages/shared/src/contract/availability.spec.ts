// The bound on the one route a caller holding no session can reach.
//
// `/availability/calendar` takes a window of nights rather than a month, which
// is what lets the funnel open on a year in one request. The same change is what
// makes the ceiling load-bearing: without it a single anonymous GET could ask
// for a century of nights, so the rejection below is part of the contract and
// not a courtesy the handler extends.

import { CalendarDate } from "@internationalized/date";
import { describe, expect, it } from "vitest";
import { LONGEST_CALENDAR_WINDOW, rateCalendarQuery } from "./availability.js";

describe("the rate calendar window", () => {
  it("decodes the boundaries into calendar dates and defaults the plan", () => {
    const query = rateCalendarQuery.parse({
      from: "2027-03-01",
      to: "2027-04-01",
    });

    expect(query.from).toBeInstanceOf(CalendarDate);
    expect(query.from.toString()).toBe("2027-03-01");
    expect(query.plan).toBe("STANDARD");
  });

  it("takes the year the funnel opens on", () => {
    const parsed = rateCalendarQuery.safeParse({
      from: "2027-03-01",
      to: "2028-03-01",
      plan: "BB",
    });

    expect(parsed.success).toBe(true);
  });

  it("takes a window exactly as long as the ceiling", () => {
    const to = new CalendarDate(2027, 3, 1).add({
      days: LONGEST_CALENDAR_WINDOW,
    });

    expect(
      rateCalendarQuery.safeParse({ from: "2027-03-01", to: to.toString() })
        .success,
    ).toBe(true);
  });

  it("refuses one night beyond it, rather than answering a shorter window", () => {
    const to = new CalendarDate(2027, 3, 1).add({
      days: LONGEST_CALENDAR_WINDOW + 1,
    });

    const parsed = rateCalendarQuery.safeParse({
      from: "2027-03-01",
      to: to.toString(),
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toContain(
      String(LONGEST_CALENDAR_WINDOW),
    );
  });

  it("refuses a window that ends before it begins", () => {
    const parsed = rateCalendarQuery.safeParse({
      from: "2027-04-01",
      to: "2027-03-01",
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe("to must fall after from");
  });

  // Half-open, like every other range in the system: a window of no nights is
  // not a grid, it is a question with no cells in it.
  it("refuses a window of no nights at all", () => {
    expect(
      rateCalendarQuery.safeParse({ from: "2027-03-01", to: "2027-03-01" })
        .success,
    ).toBe(false);
  });
});
