// What a stay costs under a plan — `property-and-tariff.md` §3, as arithmetic.
//
// It lives here rather than inside a service for the reason `occupancy-pricing.ts`
// gives one file over: the API prices against these rules and the funnel quotes
// against them, and two copies of a pricing boundary is how a quote and an
// invoice come to disagree.
//
// Inside the API that failure has a sharper form. `modules/inventory` answers
// "what does this stay cost" while a guest is still choosing; `modules/booking`
// asks the same question again at the moment of sale and freezes the answer onto
// the row, because `booking-state-machine.md` §8 says a booking never re-derives
// a price it was quoted. Two implementations of one percentage would let a guest
// be shown 5,400,000 ₫ and sold 5,900,000 ₫ with nothing in the tree failing —
// the discrepancy would surface a milestone later, on a folio, as a number
// nobody can trace back to a screen.
//
// Two things about the order below are load-bearing, and both are §3's:
//
// - **The percentage moves the room rate and nothing else.** §3 makes `BB`
//   "`STANDARD` + breakfast" and `NONREF` "`STANDARD` − 10%", and both are
//   statements about the room. A plan that took ten percent off the meal would
//   post a folio line that does not match the menu, and one that took it off the
//   extra person would discount a bed the room rate never included.
// - **It is applied to the summed total, not night by night.** §5 forbids
//   rounding inside a calculation, and integer đồng means every division
//   truncates. Dividing once over the whole stay costs at most one đồng;
//   dividing per night costs one per night, and the stored nights then fail to
//   sum back to the stored total.

import type { VndAmount } from "./money.js";
import {
  breakfastHeads,
  extraPersonPerNight,
  type Party,
} from "./occupancy-pricing.js";

/**
 * Everything a stay total is computed from.
 *
 * The four figures are named separately rather than passed as a "plan" object
 * because they are exactly the four a booking freezes onto its row — the
 * calendar sum, the plan's percentage, its breakfast figure and the property's
 * extra-person rate. A caller assembling this is assembling the record it will
 * store, which is what makes the stored quote reproducible by re-running this
 * function over the stored inputs.
 */
export interface StayQuoteInput {
  /** Sum of the `STANDARD` calendar gross across the stay, un-rounded. */
  readonly standardTotal: VndAmount;
  /** Signed points off the calendar price, as `rate_plan` holds it. */
  readonly percentAdjustment: number;
  /** Null on a plan that includes no breakfast. */
  readonly breakfastPerPersonGross: VndAmount | null;
  /** The property's rate, and the figure §3's age bands are percentages of. */
  readonly extraPersonPerNightGross: VndAmount;
  readonly nights: number;
  readonly party: Party;
}

/** Gross for the whole stay: the room rate under the plan, then the heads beyond
 *  it, then breakfast. */
export function stayTotalGross({
  standardTotal,
  percentAdjustment,
  breakfastPerPersonGross,
  extraPersonPerNightGross,
  nights,
  party,
}: StayQuoteInput): VndAmount {
  const adjusted = (standardTotal * BigInt(100 + percentAdjustment)) / 100n;

  const extraPeople =
    extraPersonPerNight(party, extraPersonPerNightGross) * BigInt(nights);

  const breakfast =
    breakfastPerPersonGross === null
      ? 0n
      : breakfastPerPersonGross *
        BigInt(breakfastHeads(party)) *
        BigInt(nights);

  return adjusted + extraPeople + breakfast;
}
