import { parseDate } from "@internationalized/date";
import { describe, expect, it } from "vitest";
import {
  longDate,
  longDateRange,
  occupancySpecs,
  untilArrival,
} from "./stay-display";

describe("untilArrival", () => {
  const today = parseDate("2026-10-08");

  it("says today and tomorrow in words", () => {
    expect(untilArrival(today, parseDate("2026-10-08"))).toBe("Arriving today");
    expect(untilArrival(today, parseDate("2026-10-09"))).toBe(
      "Arriving tomorrow",
    );
  });

  it("counts days, then weeks, then months", () => {
    expect(untilArrival(today, parseDate("2026-10-13"))).toBe("In 5 days");
    expect(untilArrival(today, parseDate("2026-10-29"))).toBe("In 3 weeks");
    expect(untilArrival(today, parseDate("2027-04-26"))).toBe("In 7 months");
  });
});

describe("longDate", () => {
  it("writes a stay date as the day it is, whatever the runtime's zone", () => {
    expect(longDate(parseDate("2026-08-19"))).toBe("19 August 2026");
    expect(longDate(parseDate("2027-01-01"))).toBe("1 January 2027");
  });
});

describe("longDateRange", () => {
  it("says a shared month and year once", () => {
    expect(
      longDateRange(parseDate("2026-10-13"), parseDate("2026-10-16")),
    ).toBe("13 to 16 October 2026");
  });

  it("names both months when the stay crosses one", () => {
    expect(
      longDateRange(parseDate("2027-04-28"), parseDate("2027-05-02")),
    ).toBe("28 April to 2 May 2027");
  });

  it("names both years when the stay crosses one", () => {
    expect(
      longDateRange(parseDate("2026-12-30"), parseDate("2027-01-02")),
    ).toBe("30 December 2026 to 2 January 2027");
  });

  it("never sets a dash", () => {
    expect(
      longDateRange(parseDate("2027-04-28"), parseDate("2027-05-02")),
    ).not.toMatch(/[-–—]/);
  });
});

describe("occupancySpecs", () => {
  it("counts nights and adults, singular and plural", () => {
    expect(occupancySpecs(1, 1, 0)).toEqual(["1 night", "1 adult"]);
    expect(occupancySpecs(4, 2, 0)).toEqual(["4 nights", "2 adults"]);
  });

  it("names children only when there are some", () => {
    expect(occupancySpecs(3, 2, 1)).toEqual([
      "3 nights",
      "2 adults",
      "1 child",
    ]);
    expect(occupancySpecs(3, 2, 2)).toEqual([
      "3 nights",
      "2 adults",
      "2 children",
    ]);
  });
});
