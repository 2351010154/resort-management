import { describe, expect, it } from "vitest";
import { bedsRequired } from "./extra-bed.js";
import type { Child, Party } from "./occupancy-pricing.js";

function party(adults: number, ...ages: number[]): Party {
  return { adults, children: ages.map((age): Child => ({ age })) };
}

/** What each type's bedding sleeps — `property-and-tariff.md` §1. */
const JUNIOR_SUITE_SLEEPS = 2;
const PREMIER_SLEEPS = 3;

describe("beds a party requires", () => {
  it("puts one in the Junior Suite for a third adult", () => {
    // §1's only case under the current mix: a maximum of three against bedding
    // for two, so the third head is the one the bed is carried in for.
    expect(bedsRequired(party(3), JUNIOR_SUITE_SLEEPS)).toBe(1);
  });

  it("puts none in for an under-6, who shares existing bedding", () => {
    // §3: free, sharing existing bedding. The child is still a third head
    // against the maximum — they are simply not a third bed.
    expect(bedsRequired(party(2, 4), JUNIOR_SUITE_SLEEPS)).toBe(0);
  });

  it("puts one in for a 6-to-11 child, who does not", () => {
    // The same party one age band up. §3's free line is where bedding starts
    // being needed, which is why this function reads the age and not the count.
    expect(bedsRequired(party(2, 9), JUNIOR_SUITE_SLEEPS)).toBe(1);
  });

  it("puts none in where the bedding already sleeps the party", () => {
    // The Premier sleeps three in beds it already has, so a third adult needs
    // nothing carried in — and is charged as an extra person all the same.
    expect(bedsRequired(party(3), PREMIER_SLEEPS)).toBe(0);
  });
});
