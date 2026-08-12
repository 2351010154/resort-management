import { describe, expect, it } from "vitest";

import { parseLiberalDate } from "./date-parser";

// Every case counts from a Sunday in a leap year, so month-end and February
// arithmetic are both reachable without a second reference.
const REFERENCE = "2026-03-15";

describe("parseLiberalDate", () => {
  describe("relative expressions", () => {
    it("resolves the keywords against the reference, not the clock", () => {
      expect(parseLiberalDate("today", REFERENCE)).toBe("2026-03-15");
      expect(parseLiberalDate("now", REFERENCE)).toBe("2026-03-15");
      expect(parseLiberalDate("tomorrow", REFERENCE)).toBe("2026-03-16");
      expect(parseLiberalDate("tmr", REFERENCE)).toBe("2026-03-16");
      expect(parseLiberalDate("yesterday", REFERENCE)).toBe("2026-03-14");
    });

    it("counts days and weeks in both directions", () => {
      expect(parseLiberalDate("+3d", REFERENCE)).toBe("2026-03-18");
      expect(parseLiberalDate("-2d", REFERENCE)).toBe("2026-03-13");
      expect(parseLiberalDate("+1w", REFERENCE)).toBe("2026-03-22");
      expect(parseLiberalDate("-2w", REFERENCE)).toBe("2026-03-01");
    });

    it("crosses month and year boundaries", () => {
      expect(parseLiberalDate("+17d", REFERENCE)).toBe("2026-04-01");
      expect(parseLiberalDate("-15d", REFERENCE)).toBe("2026-02-28");
      expect(parseLiberalDate("+292d", REFERENCE)).toBe("2027-01-01");
    });

    it("counts February from a leap year correctly", () => {
      // 2028 is a leap year: 14 days back from 1 March must reach the 16th of a
      // 29-day February, not the 15th.
      expect(parseLiberalDate("-14d", "2028-03-01")).toBe("2028-02-16");
      expect(parseLiberalDate("-14d", "2027-03-01")).toBe("2027-02-15");
    });
  });

  describe("written dates", () => {
    it("takes an ISO date as written", () => {
      expect(parseLiberalDate("2026-03-15", REFERENCE)).toBe("2026-03-15");
      expect(parseLiberalDate("2026-3-5", REFERENCE)).toBe("2026-03-05");
    });

    it("reads day before month on every separator", () => {
      expect(parseLiberalDate("15/3/2026", REFERENCE)).toBe("2026-03-15");
      expect(parseLiberalDate("15-3-2026", REFERENCE)).toBe("2026-03-15");
      expect(parseLiberalDate("15.03.2026", REFERENCE)).toBe("2026-03-15");
    });

    it("reads a two-digit year as this century", () => {
      expect(parseLiberalDate("15/3/26", REFERENCE)).toBe("2026-03-15");
      expect(parseLiberalDate("01/01/30", REFERENCE)).toBe("2030-01-01");
    });

    it("borrows the reference's year when none is typed", () => {
      expect(parseLiberalDate("15/3", REFERENCE)).toBe("2026-03-15");
      expect(parseLiberalDate("1.12", REFERENCE)).toBe("2026-12-01");
    });

    it("is day-first even when the month reading would also be legal", () => {
      // The case the convention exists for: both 3 April and 4 March are real
      // dates, and only one of them is what a Vietnamese desk means.
      expect(parseLiberalDate("3/4/2026", REFERENCE)).toBe("2026-04-03");
    });

    it("accepts the separators left out", () => {
      expect(parseLiberalDate("1503", REFERENCE)).toBe("2026-03-15");
      expect(parseLiberalDate("15032026", REFERENCE)).toBe("2026-03-15");
      expect(parseLiberalDate("01012027", REFERENCE)).toBe("2027-01-01");
    });
  });

  describe("what it refuses", () => {
    it("rejects a day the month does not have", () => {
      expect(parseLiberalDate("31/02/2026", REFERENCE)).toBeNull();
      expect(parseLiberalDate("31/4/2026", REFERENCE)).toBeNull();
      expect(parseLiberalDate("2026-02-30", REFERENCE)).toBeNull();
    });

    it("knows which Februaries have 29 days", () => {
      expect(parseLiberalDate("29/2/2028", REFERENCE)).toBe("2028-02-29");
      expect(parseLiberalDate("29/2/2027", REFERENCE)).toBeNull();
      // Not a leap year despite dividing by four.
      expect(parseLiberalDate("29/2/2100", REFERENCE)).toBeNull();
      expect(parseLiberalDate("29/2/2000", REFERENCE)).toBe("2000-02-29");
    });

    it("rejects an impossible month or a zero", () => {
      expect(parseLiberalDate("15/13/2026", REFERENCE)).toBeNull();
      expect(parseLiberalDate("0/3/2026", REFERENCE)).toBeNull();
      expect(parseLiberalDate("15/0/2026", REFERENCE)).toBeNull();
    });

    it("rejects text that is not a date at all", () => {
      expect(parseLiberalDate("", REFERENCE)).toBeNull();
      expect(parseLiberalDate("   ", REFERENCE)).toBeNull();
      expect(parseLiberalDate("next tuesday", REFERENCE)).toBeNull();
      expect(parseLiberalDate("15 March", REFERENCE)).toBeNull();
      expect(parseLiberalDate("+3", REFERENCE)).toBeNull();
      expect(parseLiberalDate("+1m", REFERENCE)).toBeNull();
      expect(parseLiberalDate("2026", REFERENCE)).toBeNull();
    });

    it("rejects a partial match rather than reading the prefix", () => {
      // "15/3 pm" must not quietly become 15 March: half-understood input from
      // a person under time pressure is exactly what should come back empty.
      expect(parseLiberalDate("15/3 pm", REFERENCE)).toBeNull();
      expect(parseLiberalDate("x2026-03-15", REFERENCE)).toBeNull();
    });

    it("returns null when the reference is not a date", () => {
      expect(parseLiberalDate("today", "not-a-date")).toBeNull();
      expect(parseLiberalDate("15/3", "")).toBeNull();
    });
  });

  it("ignores surrounding space and case", () => {
    expect(parseLiberalDate("  TOMORROW  ", REFERENCE)).toBe("2026-03-16");
    expect(parseLiberalDate(" +3D ", REFERENCE)).toBe("2026-03-18");
  });

  it("refuses a slip that mixes separators", () => {
    // "15/3-2026" is a typo, not a spelling anybody uses. Reading it as
    // confidently as a date somebody meant is the thing to avoid.
    expect(parseLiberalDate("15/3-2026", REFERENCE)).toBeNull();
    expect(parseLiberalDate("15.3/2026", REFERENCE)).toBeNull();
  });

  it("returns null when the reference is a shape-valid date that never existed", () => {
    // The reference is validated as a calendar date, not just matched against
    // the pattern: `Date.UTC` would roll 30 February into 2 March and every
    // relative expression counted from it would be a day wrong.
    expect(parseLiberalDate("today", "2026-02-30")).toBeNull();
    expect(parseLiberalDate("+1d", "2027-02-29")).toBeNull();
    expect(parseLiberalDate("15/3", "2026-13-01")).toBeNull();
  });

  it("never returns a year narrower than four digits", () => {
    expect(parseLiberalDate("0050-03-15", REFERENCE)).toBeNull();
    expect(parseLiberalDate("15/3/0050", REFERENCE)).toBeNull();
  });

  // The contract in one assertion, run over every input the suite above uses
  // plus the shapes that reach the arithmetic by an unintended route. The two
  // that motivated it — "constructor" and "__proto__" — walked an object
  // literal's prototype chain into the day arithmetic and came back out as the
  // string "NaN-NaN-NaN": neither a date nor null, from the one function whose
  // promise is that it returns one or the other.
  it("returns a YYYY-MM-DD or null, for anything at all", () => {
    const inputs = [
      "constructor",
      "__proto__",
      "toString",
      "valueOf",
      "hasOwnProperty",
      "today",
      "+3d",
      "-99999d",
      "+999d",
      "2026-03-15",
      "15/3/2026",
      "1503",
      "15032026",
      "0000-00-00",
      "9999-12-31",
      "99/99/9999",
      "0/0",
      "",
      " ",
      "NaN",
      "Infinity",
      "null",
      "undefined",
    ];

    for (const input of inputs) {
      const result = parseLiberalDate(input, REFERENCE);

      if (result !== null) {
        expect(result, `parsing ${JSON.stringify(input)}`).toMatch(
          /^\d{4}-\d{2}-\d{2}$/,
        );
      }
    }
  });
});
