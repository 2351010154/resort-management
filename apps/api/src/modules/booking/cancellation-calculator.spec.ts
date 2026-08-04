// One test per cell of `property-and-tariff.md` §4, and the left column is run
// for both plans it covers — §3 gives `STANDARD` and `BB` the same grid, and a
// suite that only exercised one of them would not notice a calculator that
// special-cased breakfast.

import { parseDate } from "@internationalized/date";
import type { RatePlanCode, VndAmount } from "@mariva/shared";
import { describe, expect, it } from "vitest";
import {
  CANCELLATION_DEADLINE_HOUR,
  FREE_CANCELLATION_DAYS_BEFORE_ARRIVAL,
  freeCancellationDeadline,
  policyCharge,
} from "./cancellation-calculator.js";

const CHECK_IN = parseDate("2026-08-14");

// Three nights, all different, because the grid charges "the first night" and
// "the remaining nights" — figures a suite with a flat rate could satisfy by
// dividing a total by a count, which is precisely what §4 forbids.
const NIGHTS: readonly VndAmount[] = [1_000_000n, 1_500_000n, 1_100_000n];
const STAY_TOTAL = 3_600_000n;

/** 18:00 ICT on 11 August — three days before arrival, in UTC. */
const ON_THE_DEADLINE = new Date("2026-08-11T11:00:00Z");
const AFTER_THE_DEADLINE = new Date("2026-08-11T11:00:01Z");

const GRID_PLANS: readonly RatePlanCode[] = ["STANDARD", "BB"];

describe("the free-cancellation deadline", () => {
  it("falls at 18:00 ICT, three days before arrival", () => {
    expect(FREE_CANCELLATION_DAYS_BEFORE_ARRIVAL).toBe(3);
    expect(CANCELLATION_DEADLINE_HOUR).toBe(18);
    expect(freeCancellationDeadline(CHECK_IN).toISOString()).toBe(
      "2026-08-11T11:00:00.000Z",
    );
  });

  it("walks the calendar across a month boundary", () => {
    // 2 September less three days is 30 August, not the 32nd of anything.
    expect(
      freeCancellationDeadline(parseDate("2026-09-02")).toISOString(),
    ).toBe("2026-08-30T11:00:00.000Z");
  });
});

describe("cancelling three days or more before arrival", () => {
  it.each(GRID_PLANS)("is free under %s", (plan) => {
    expect(
      policyCharge({
        plan,
        checkInDate: CHECK_IN,
        nights: NIGHTS,
        event: { kind: "CANCELLATION", cancelledAt: ON_THE_DEADLINE },
      }),
    ).toStrictEqual({ amount: 0n, basis: "NONE" });
  });

  it("charges NONREF the whole stay", () => {
    expect(
      policyCharge({
        plan: "NONREF",
        checkInDate: CHECK_IN,
        nights: NIGHTS,
        event: { kind: "CANCELLATION", cancelledAt: ON_THE_DEADLINE },
      }),
    ).toStrictEqual({ amount: STAY_TOTAL, basis: "FULL_STAY" });
  });

  // §4 reads "by 18:00" — the deadline is inside the free window, and the
  // second after it is not.
  it("counts a cancellation landing exactly on 18:00 as inside the window", () => {
    const charge = policyCharge({
      plan: "STANDARD",
      checkInDate: CHECK_IN,
      nights: NIGHTS,
      event: { kind: "CANCELLATION", cancelledAt: ON_THE_DEADLINE },
    });

    expect(charge.basis).toBe("NONE");
  });
});

describe("cancelling less than three days before arrival", () => {
  it.each(GRID_PLANS)("charges the first night under %s", (plan) => {
    expect(
      policyCharge({
        plan,
        checkInDate: CHECK_IN,
        nights: NIGHTS,
        event: { kind: "CANCELLATION", cancelledAt: AFTER_THE_DEADLINE },
      }),
    ).toStrictEqual({ amount: NIGHTS[0], basis: "FIRST_NIGHT" });
  });

  it("charges NONREF the whole stay", () => {
    expect(
      policyCharge({
        plan: "NONREF",
        checkInDate: CHECK_IN,
        nights: NIGHTS,
        event: { kind: "CANCELLATION", cancelledAt: AFTER_THE_DEADLINE },
      }),
    ).toStrictEqual({ amount: STAY_TOTAL, basis: "FULL_STAY" });
  });
});

describe("a no-show", () => {
  it.each(GRID_PLANS)("charges the first night under %s", (plan) => {
    expect(
      policyCharge({
        plan,
        checkInDate: CHECK_IN,
        nights: NIGHTS,
        event: { kind: "NO_SHOW" },
      }),
    ).toStrictEqual({ amount: NIGHTS[0], basis: "FIRST_NIGHT" });
  });

  it("charges NONREF the whole stay", () => {
    expect(
      policyCharge({
        plan: "NONREF",
        checkInDate: CHECK_IN,
        nights: NIGHTS,
        event: { kind: "NO_SHOW" },
      }),
    ).toStrictEqual({ amount: STAY_TOTAL, basis: "FULL_STAY" });
  });

  // The first night is a price and not an average. A no-show on a stay that
  // arrives on a cheap Tuesday must not be charged the weekend it would have
  // run into.
  it("charges the arrival night's own price, not the stay average", () => {
    const charge = policyCharge({
      plan: "STANDARD",
      checkInDate: CHECK_IN,
      nights: NIGHTS,
      event: { kind: "NO_SHOW" },
    });

    expect(charge.amount).toBe(1_000_000n);
    expect(charge.amount).not.toBe(STAY_TOTAL / 3n);
  });
});

describe("an early departure", () => {
  it.each(GRID_PLANS)(
    "charges the remaining nights at 50%% under %s",
    (plan) => {
      expect(
        policyCharge({
          plan,
          checkInDate: CHECK_IN,
          nights: NIGHTS,
          event: { kind: "EARLY_DEPARTURE", nightsSpent: 1 },
        }),
        // 1,500,000 + 1,100,000, halved.
      ).toStrictEqual({ amount: 1_300_000n, basis: "REMAINING_NIGHTS_HALF" });
    },
  );

  // Not "100% of stay". The nights already spent were posted by the night
  // audit as ordinary room charges; billing the whole stay again would charge
  // them twice.
  it("charges NONREF the remaining nights at 100%", () => {
    expect(
      policyCharge({
        plan: "NONREF",
        checkInDate: CHECK_IN,
        nights: NIGHTS,
        event: { kind: "EARLY_DEPARTURE", nightsSpent: 1 },
      }),
    ).toStrictEqual({ amount: 2_600_000n, basis: "REMAINING_NIGHTS_FULL" });
  });

  it("truncates the odd đồng in the guest's direction", () => {
    const charge = policyCharge({
      plan: "STANDARD",
      checkInDate: CHECK_IN,
      nights: [1_000_000n, 1_500_001n],
      event: { kind: "EARLY_DEPARTURE", nightsSpent: 1 },
    });

    expect(charge.amount).toBe(750_000n);
  });

  it("charges nothing when the guest leaves on the final night", () => {
    expect(
      policyCharge({
        plan: "STANDARD",
        checkInDate: CHECK_IN,
        nights: NIGHTS,
        event: { kind: "EARLY_DEPARTURE", nightsSpent: NIGHTS.length },
      }),
    ).toStrictEqual({ amount: 0n, basis: "REMAINING_NIGHTS_HALF" });
  });

  it("charges the whole stay when no night was spent", () => {
    expect(
      policyCharge({
        plan: "NONREF",
        checkInDate: CHECK_IN,
        nights: NIGHTS,
        event: { kind: "EARLY_DEPARTURE", nightsSpent: 0 },
      }),
    ).toStrictEqual({ amount: STAY_TOTAL, basis: "REMAINING_NIGHTS_FULL" });
  });

  it.each([-1, 1.5])("refuses a nightsSpent of %s", (nightsSpent) => {
    expect(() =>
      policyCharge({
        plan: "STANDARD",
        checkInDate: CHECK_IN,
        nights: NIGHTS,
        event: { kind: "EARLY_DEPARTURE", nightsSpent },
      }),
    ).toThrow(RangeError);
  });
});

// A stay of no nights is refused by `booking_covers_at_least_one_night`, so an
// empty list is a caller that assembled its input wrongly. Answering it with
// zero would be a penalty silently waived.
it("refuses a booking with no nights", () => {
  expect(() =>
    policyCharge({
      plan: "STANDARD",
      checkInDate: CHECK_IN,
      nights: [],
      event: { kind: "NO_SHOW" },
    }),
  ).toThrow(RangeError);
});
