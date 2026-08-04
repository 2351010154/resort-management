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
