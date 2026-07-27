import { parseDate } from "@internationalized/date";
import type { NightRate } from "@mariva/shared";
import { describe, expect, it } from "vitest";
import { indexNights } from "@/features/booking/lib/stay-quote";
import {
  type AvailabilityRules,
  rangeViolation,
  reasonSentence,
  unpickableReason,
} from "./stay-availability";

function night(iso: string, over: Partial<NightRate> = {}): NightRate {
  return {
    date: parseDate(iso),
    lowestGross: 2_000_000n,
    isSoldOut: false,
    isClosedToArrival: false,
    minimumStay: 1,
    ...over,
  };
}

/** Ten free nights from the 10th, with whatever overrides a test needs. */
function rules(
  overrides: Record<string, Partial<NightRate>> = {},
  selected: AvailabilityRules["selected"] = null,
): AvailabilityRules {
  const nights = Array.from({ length: 10 }, (_unused, day) => {
    const iso = `2026-08-${String(10 + day).padStart(2, "0")}`;
    return night(iso, overrides[iso] ?? {});
  });
  return { nights: indexNights(nights), selected };
}

const on = (iso: string) => parseDate(iso);

describe("choosing an arrival", () => {
  it("allows a free night", () => {
    expect(unpickableReason(rules(), on("2026-08-10"), null)).toBeNull();
  });

  it("refuses a sold-out night", () => {
    const reason = unpickableReason(
      rules({ "2026-08-10": { isSoldOut: true, lowestGross: null } }),
      on("2026-08-10"),
      null,
    );

    expect(reason).toEqual({ kind: "sold-out" });
  });

  // Amadeus's "Check-out only" as its own named state: a stay may run through this
  // night but not begin on it, and the guest should learn the rule rather than
  // simply be blocked.
  it("refuses a night closed to arrival", () => {
    const reason = unpickableReason(
      rules({ "2026-08-10": { isClosedToArrival: true } }),
      on("2026-08-10"),
      null,
    );

    expect(reason).toEqual({ kind: "closed-to-arrival" });
  });

  it("refuses a night it has no data for", () => {
    expect(unpickableReason(rules(), on("2027-01-01"), null)).toEqual({
      kind: "no-data",
    });
  });
});

describe("choosing a departure", () => {
  const anchor = on("2026-08-10");

  it("allows the night after the arrival when there is no minimum", () => {
    expect(unpickableReason(rules(), on("2026-08-11"), anchor)).toBeNull();
  });

  it("refuses the arrival itself", () => {
    expect(unpickableReason(rules(), anchor, anchor)).toEqual({
      kind: "before-arrival",
    });
  });

  it("refuses a date before the arrival", () => {
    expect(unpickableReason(rules(), on("2026-08-09"), anchor)).toEqual({
      kind: "before-arrival",
    });
  });

  // The rule the guest must meet before they trip over it, not after.
  it("refuses a stay shorter than the arrival night's minimum", () => {
    const withMinimum = rules({ "2026-08-10": { minimumStay: 2 } });

    expect(unpickableReason(withMinimum, on("2026-08-11"), anchor)).toEqual({
      kind: "minimum-stay",
      nights: 2,
    });
    expect(unpickableReason(withMinimum, on("2026-08-12"), anchor)).toBeNull();
  });

  it("refuses a departure that would span a sold-out night", () => {
    const withHole = rules({
      "2026-08-11": { isSoldOut: true, lowestGross: null },
    });

    // Leaving on the 11th sells one night — the 10th — and the 11th itself is not
    // bought, so the hole is not in the way. Leaving on the 12th or later sells the
    // 11th, and it is.
    expect(unpickableReason(withHole, on("2026-08-11"), anchor)).toBeNull();
    expect(unpickableReason(withHole, on("2026-08-12"), anchor)).toEqual({
      kind: "sold-out",
    });
    expect(unpickableReason(withHole, on("2026-08-13"), anchor)).toEqual({
      kind: "sold-out",
    });
  });

  // The half-open range again: the departure buys no night, so a night-level flag on
  // the morning the guest leaves says nothing about their stay. Getting this wrong is
  // what puts three filled boxes on a two-night stay.
  it("allows a departure on a night that is itself sold out", () => {
    const soldOutDeparture = rules({
      "2026-08-12": { isSoldOut: true, lowestGross: null },
    });

    expect(
      unpickableReason(soldOutDeparture, on("2026-08-12"), anchor),
    ).toBeNull();
  });

  it("allows a departure on a night that is closed to arrival", () => {
    const closed = rules({ "2026-08-12": { isClosedToArrival: true } });

    expect(unpickableReason(closed, on("2026-08-12"), anchor)).toBeNull();
  });
});

describe("a range already chosen", () => {
  const selected = { checkIn: on("2026-08-10"), checkOut: on("2026-08-12") };

  // Without this exemption React Aria reports the whole selection as invalid and
  // puts aria-invalid on a range that is perfectly legal.
  it("does not call its own departure unavailable when that night is sold out", () => {
    const soldOutDeparture = rules(
      { "2026-08-12": { isSoldOut: true, lowestGross: null } },
      selected,
    );

    expect(
      unpickableReason(soldOutDeparture, on("2026-08-12"), null),
    ).toBeNull();
  });

  it("still refuses that night as a fresh arrival once the range is gone", () => {
    const soldOutDeparture = rules({
      "2026-08-12": { isSoldOut: true, lowestGross: null },
    });

    expect(unpickableReason(soldOutDeparture, on("2026-08-12"), null)).toEqual({
      kind: "sold-out",
    });
  });
});

describe("validating a committed range", () => {
  it("passes a legal stay", () => {
    expect(
      rangeViolation(rules(), {
        checkIn: on("2026-08-10"),
        checkOut: on("2026-08-12"),
      }),
    ).toBeNull();
  });

  // The guard for the one path around the cell predicate: pressing a date inside a
  // range already chosen starts a fresh anchor against an exempted state.
  it("catches an arrival that is closed to arrival", () => {
    const closed = rules({ "2026-08-10": { isClosedToArrival: true } });

    expect(
      rangeViolation(closed, {
        checkIn: on("2026-08-10"),
        checkOut: on("2026-08-12"),
      }),
    ).toEqual({ kind: "closed-to-arrival" });
  });

  it("catches a stay under the minimum", () => {
    const withMinimum = rules({ "2026-08-10": { minimumStay: 3 } });

    expect(
      rangeViolation(withMinimum, {
        checkIn: on("2026-08-10"),
        checkOut: on("2026-08-12"),
      }),
    ).toEqual({ kind: "minimum-stay", nights: 3 });
  });

  it("catches a sold-out night inside the stay", () => {
    const withHole = rules({
      "2026-08-11": { isSoldOut: true, lowestGross: null },
    });

    expect(
      rangeViolation(withHole, {
        checkIn: on("2026-08-10"),
        checkOut: on("2026-08-13"),
      }),
    ).toEqual({ kind: "sold-out" });
  });
});

describe("the sentence a cell's name carries", () => {
  // The improvement over every picker verified for this screen: Amadeus renders the
  // restriction as pixels and names only the date; Resy gives a sold-out day the
  // same name as a free one.
  it("names the minimum and the arrival it counts from", () => {
    expect(
      reasonSentence({ kind: "minimum-stay", nights: 2 }, "10 August 2026"),
    ).toBe("2-night minimum from 10 August 2026.");
  });

  it("explains an arrival restriction rather than calling it unavailable", () => {
    expect(reasonSentence({ kind: "closed-to-arrival" })).toBe(
      "Arrival closed — you cannot start a stay on this date.",
    );
  });

  it("still reads without an arrival to count from", () => {
    expect(reasonSentence({ kind: "minimum-stay", nights: 3 })).toBe(
      "3-night minimum.",
    );
  });
});
