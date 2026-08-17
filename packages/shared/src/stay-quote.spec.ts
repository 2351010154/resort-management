// The three plans of `property-and-tariff.md` §3, and the order they apply in.
//
// The assertions worth their space are the ones about what the percentage does
// NOT touch. A single test of `STANDARD` would pass against an implementation
// that discounted breakfast, so `NONREF` is checked against a party that pays
// for a third head and a `BB` figure that must survive the −10% untouched.

import { describe, expect, it } from "vitest";
import type { Party } from "./occupancy-pricing.js";
import { stayTotalGross } from "./stay-quote.js";

const COUPLE: Party = { adults: 2, children: [] };
const EXTRA_PERSON = 600_000n;

/** Three nights of a Deluxe at the seeded weekday price. */
const THREE_NIGHTS = 5_400_000n;

describe("the plan's percentage", () => {
  it("leaves a STANDARD stay at the calendar price", () => {
    expect(
      stayTotalGross({
        standardTotal: THREE_NIGHTS,
        percentAdjustment: 0,
        breakfastPerPersonGross: null,
        extraPersonPerNightGross: EXTRA_PERSON,
        nights: 3,
        party: COUPLE,
      }),
    ).toBe(THREE_NIGHTS);
  });

  it("takes NONREF's ten percent off the room rate", () => {
    expect(
      stayTotalGross({
        standardTotal: THREE_NIGHTS,
        percentAdjustment: -10,
        breakfastPerPersonGross: null,
        extraPersonPerNightGross: EXTRA_PERSON,
        nights: 3,
        party: COUPLE,
      }),
    ).toBe(4_860_000n);
  });

  it("truncates the odd đồng downward rather than rounding it", () => {
    // §5 forbids rounding inside a calculation, and integer đồng means the
    // division truncates. The guest's direction, and the same choice
    // `occupancy-pricing.ts` makes for its half-rate band.
    expect(
      stayTotalGross({
        standardTotal: 1_000_005n,
        percentAdjustment: -10,
        breakfastPerPersonGross: null,
        extraPersonPerNightGross: EXTRA_PERSON,
        nights: 1,
        party: COUPLE,
      }),
    ).toBe(900_004n);
  });
});

describe("what the percentage does not reach", () => {
  it("charges breakfast per head per night, undiscounted", () => {
    // `BB` is "`STANDARD` + breakfast". A plan that took a percentage off the
    // meal would post a folio line that does not match the menu.
    expect(
      stayTotalGross({
        standardTotal: THREE_NIGHTS,
        percentAdjustment: 0,
        breakfastPerPersonGross: 150_000n,
        extraPersonPerNightGross: EXTRA_PERSON,
        nights: 3,
        party: COUPLE,
      }),
    ).toBe(THREE_NIGHTS + 150_000n * 2n * 3n);
  });

  it("charges the extra person undiscounted under NONREF", () => {
    // The −10% is a statement about the room. Taking it off the third head
    // would discount a bed the room rate never included.
    expect(
      stayTotalGross({
        standardTotal: THREE_NIGHTS,
        percentAdjustment: -10,
        breakfastPerPersonGross: null,
        extraPersonPerNightGross: EXTRA_PERSON,
        nights: 3,
        party: { adults: 3, children: [] },
      }),
    ).toBe(4_860_000n + EXTRA_PERSON * 3n);
  });

  it("does not charge a head the rate already covers", () => {
    expect(
      stayTotalGross({
        standardTotal: THREE_NIGHTS,
        percentAdjustment: 0,
        breakfastPerPersonGross: null,
        extraPersonPerNightGross: EXTRA_PERSON,
        nights: 3,
        party: { adults: 1, children: [] },
      }),
    ).toBe(THREE_NIGHTS);
  });

  it("prices a small child free for the bed and free for the meal", () => {
    // Under `CHILD_FREE_BELOW_AGE` a child shares existing bedding and is not
    // charged for breakfast either — the same line governs both.
    expect(
      stayTotalGross({
        standardTotal: THREE_NIGHTS,
        percentAdjustment: 0,
        breakfastPerPersonGross: 150_000n,
        extraPersonPerNightGross: EXTRA_PERSON,
        nights: 3,
        party: { adults: 2, children: [{ age: 3 }] },
      }),
    ).toBe(THREE_NIGHTS + 150_000n * 2n * 3n);
  });
});

// §7's member discount, and the same question asked of it: what does it NOT
// touch. A stay of three nights with a paying third head and breakfast at 150k
// is the shape that can tell a room discount from a stay discount, because the
// three terms differ.
describe("the promotion", () => {
  it("leaves the stay alone when there is none", () => {
    expect(
      stayTotalGross({
        standardTotal: THREE_NIGHTS,
        percentAdjustment: 0,
        breakfastPerPersonGross: null,
        extraPersonPerNightGross: EXTRA_PERSON,
        nights: 3,
        party: COUPLE,
        promotion: null,
      }),
    ).toBe(THREE_NIGHTS);
  });

  it("takes Silver's five percent off the room rate", () => {
    expect(
      stayTotalGross({
        standardTotal: THREE_NIGHTS,
        percentAdjustment: 0,
        breakfastPerPersonGross: null,
        extraPersonPerNightGross: EXTRA_PERSON,
        nights: 3,
        party: COUPLE,
        promotion: { type: "PERCENTAGE", value: -5n },
      }),
    ).toBe(5_130_000n);
  });

  it("takes Gold's ten percent off the room rate", () => {
    expect(
      stayTotalGross({
        standardTotal: THREE_NIGHTS,
        percentAdjustment: 0,
        breakfastPerPersonGross: null,
        extraPersonPerNightGross: EXTRA_PERSON,
        nights: 3,
        party: COUPLE,
        promotion: { type: "PERCENTAGE", value: -10n },
      }),
    ).toBe(4_860_000n);
  });

  it("discounts neither the extra head nor the breakfast", () => {
    const extraHeads = EXTRA_PERSON * 3n;
    const breakfast = 150_000n * 3n * 3n;

    expect(
      stayTotalGross({
        standardTotal: THREE_NIGHTS,
        percentAdjustment: 0,
        breakfastPerPersonGross: 150_000n,
        extraPersonPerNightGross: EXTRA_PERSON,
        nights: 3,
        party: { adults: 3, children: [] },
        promotion: { type: "PERCENTAGE", value: -10n },
      }),
    ).toBe(4_860_000n + extraHeads + breakfast);
  });

  // The plan first, the guest second. Reversed, a Gold guest's NONREF stay
  // would be priced off a figure the property does not sell the room at.
  it("applies after the plan's own percentage", () => {
    expect(
      stayTotalGross({
        standardTotal: THREE_NIGHTS,
        percentAdjustment: -10,
        breakfastPerPersonGross: null,
        extraPersonPerNightGross: EXTRA_PERSON,
        nights: 3,
        party: COUPLE,
        promotion: { type: "PERCENTAGE", value: -10n },
      }),
      // 5,400,000 → 4,860,000 under NONREF → 4,374,000 for a Gold guest.
    ).toBe(4_374_000n);
  });

  it("takes a fixed amount off in đồng", () => {
    expect(
      stayTotalGross({
        standardTotal: THREE_NIGHTS,
        percentAdjustment: 0,
        breakfastPerPersonGross: null,
        extraPersonPerNightGross: EXTRA_PERSON,
        nights: 3,
        party: COUPLE,
        promotion: { type: "FIXED_AMOUNT", value: -200_000n },
      }),
    ).toBe(5_200_000n);
  });

  // The only form that can overshoot. A room floored at nothing still leaves
  // the heads and the meal standing, and a stay that came to nothing is refused
  // by `booking_quoted_total_positive` rather than sold as a comp.
  it("floors the room at nothing rather than turning a fixed amount into a credit", () => {
    expect(
      stayTotalGross({
        standardTotal: THREE_NIGHTS,
        percentAdjustment: 0,
        breakfastPerPersonGross: null,
        extraPersonPerNightGross: EXTRA_PERSON,
        nights: 3,
        party: { adults: 3, children: [] },
        promotion: { type: "FIXED_AMOUNT", value: -9_000_000n },
      }),
    ).toBe(EXTRA_PERSON * 3n);
  });

  // The property the room-charge sweep depends on: it prices one night as the
  // total through tonight minus the total through last night, so the nights
  // have to telescope back to the stay's own figure however each one truncates.
  it("leaves the nights summing to the stay's total", () => {
    const nightly = [1_700_000n, 1_850_000n, 1_850_000n];
    const through = (count: number): bigint =>
      stayTotalGross({
        standardTotal: nightly.slice(0, count).reduce((sum, n) => sum + n, 0n),
        percentAdjustment: -10,
        breakfastPerPersonGross: 150_000n,
        extraPersonPerNightGross: EXTRA_PERSON,
        nights: count,
        party: { adults: 3, children: [] },
        promotion: { type: "PERCENTAGE", value: -5n },
      });

    const perNight = nightly.map(
      (_, index) => through(index + 1) - through(index),
    );

    expect(perNight.reduce((sum, night) => sum + night, 0n)).toBe(through(3));
  });
});
