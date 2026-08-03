import { describe, expect, it } from "vitest";
import {
  breakfastHeads,
  type Child,
  extraPersonPerNight,
  type Party,
  partySize,
} from "./occupancy-pricing.js";

/** ⚑ `property-and-tariff.md` §3's proposed rate — the figure the bands are of. */
const EXTRA_PERSON = 600_000n;

const HALF = EXTRA_PERSON / 2n;

function party(adults: number, ...ages: number[]): Party {
  return { adults, children: ages.map((age): Child => ({ age })) };
}

describe("a party", () => {
  it("counts children as heads", () => {
    expect(partySize(party(2, 9, 3))).toBe(4);
  });
});

describe("the extra-person charge", () => {
  it("costs nothing at or below the included occupancy", () => {
    // §1: the rate covers two, and one guest pays what two do. This is the
    // boundary the whole ladder hangs off, in both directions.
    expect(extraPersonPerNight(party(1), EXTRA_PERSON)).toBe(0n);
    expect(extraPersonPerNight(party(2), EXTRA_PERSON)).toBe(0n);
  });

  it("charges the third adult at the full rate", () => {
    expect(extraPersonPerNight(party(3), EXTRA_PERSON)).toBe(EXTRA_PERSON);
  });

  it("charges two heads beyond the included occupancy, not one", () => {
    expect(extraPersonPerNight(party(4), EXTRA_PERSON)).toBe(EXTRA_PERSON * 2n);
  });

  it("charges a 6-to-11 child at half the rate", () => {
    expect(extraPersonPerNight(party(2, 9), EXTRA_PERSON)).toBe(HALF);
  });

  it("charges nothing for an under-6 beyond the occupancy", () => {
    // §3: free, sharing existing bedding. A third head that costs nothing is
    // still a third head — `partySize` counts them against the maximum.
    expect(extraPersonPerNight(party(2, 3), EXTRA_PERSON)).toBe(0n);
    expect(partySize(party(2, 3))).toBe(3);
  });

  it("charges a 12-year-old as an adult", () => {
    // The band is 6–11, so twelve is the first age that pays in full.
    expect(extraPersonPerNight(party(2, 11), EXTRA_PERSON)).toBe(HALF);
    expect(extraPersonPerNight(party(2, 12), EXTRA_PERSON)).toBe(EXTRA_PERSON);
  });

  it("counts the cheapest heads as the extra ones", () => {
    // §3: two adults and a nine-year-old pay one HALF-rate extra person. The
    // child is the third head — charging an adult instead would make the same
    // family cost more for having brought them.
    const withChild = extraPersonPerNight(party(2, 9), EXTRA_PERSON);
    const withoutChild = extraPersonPerNight(party(3), EXTRA_PERSON);

    expect(withChild).toBeLessThan(withoutChild);
    expect(withChild).toBe(HALF);
  });

  it("puts a free child in the extra slot ahead of a half-rate one", () => {
    // Three heads beyond two: the toddler is free and the nine-year-old is
    // half, so a party of two adults, a nine-year-old and a three-year-old
    // pays for exactly one of the children — the dearer one stays inside the
    // rate only if the cheaper one has taken the slot first.
    expect(extraPersonPerNight(party(2, 9, 3), EXTRA_PERSON)).toBe(HALF);
  });

  it("never charges an adult while a child could take the slot", () => {
    // Two adults, one adult child of fourteen and one of eight: two heads
    // beyond the rate, and the cheapest two are the eight-year-old (half) and
    // one full head — never two full ones.
    expect(extraPersonPerNight(party(3, 8), EXTRA_PERSON)).toBe(
      HALF + EXTRA_PERSON,
    );
  });

  it("truncates an odd đồng downward rather than rounding up", () => {
    // Integer division, in the guest's direction — `money.ts` forbids a float
    // and §5 forbids rounding inside a calculation.
    expect(extraPersonPerNight(party(2, 9), 601n)).toBe(300n);
  });
});

describe("breakfast heads", () => {
  it("charges every adult", () => {
    expect(breakfastHeads(party(3))).toBe(3);
  });

  it("charges a child old enough to be charged for a bed", () => {
    expect(breakfastHeads(party(2, 9))).toBe(3);
  });

  it("does not charge an under-6", () => {
    // The one assumption in the ladder: §3 does not say what a small child
    // eats, and the under-6 line is the nearest rule the property has.
    expect(breakfastHeads(party(2, 3))).toBe(2);
  });

  it("charges heads inside the included occupancy too", () => {
    // A meal is eaten by whoever eats it — unlike the bed, which the rate
    // already covers for two.
    expect(breakfastHeads(party(2))).toBe(2);
  });
});
