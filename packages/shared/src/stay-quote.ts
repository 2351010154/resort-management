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
//
// ## The promotion, and why it lands where it does
//
// §7 states the loyalty discount as "Silver 5% · Gold 10%, applied as a
// promotions rate modifier (`FR-PRC-03`) — rides the existing pricing path;
// never a folio adjustment". So it arrives here, as a third term over the same
// room figure, and both sentences above hold of it unchanged:
//
// - **It moves the room rate and nothing else**, on §3's argument repeated. A
//   tier discount that took 10% off breakfast would post a meal line the menu
//   does not price, and one that took it off the extra person would discount a
//   head the room rate never covered. §7 calls it a *member discount*, and what
//   the member is being given a discount on is the room.
// - **It applies after the plan's percentage, over the summed total.** After,
//   because §3's `NONREF` is a property of the *rate* — what the room costs
//   under that plan — and §7's is a property of the *guest*. Reversing them
//   would price a Gold guest's non-refundable stay off a figure the property
//   does not sell at. Over the summed total for the reason above: one division
//   for the stay costs at most one đồng, and one per night costs one per night.
//
// The room-charge sweep prices a single night as this function through tonight
// minus this function through last night, which telescopes: whatever each night
// loses to truncation, the nights still sum to exactly the figure the guest was
// quoted. That property is why the promotion has to be a term inside here and
// could not be a subtraction the caller makes afterwards.

import type { VndAmount } from "./money.js";
import {
  breakfastHeads,
  extraPersonPerNight,
  type Party,
} from "./occupancy-pricing.js";
import type { PromotionType } from "./rate-calendar.js";

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
/**
 * A promotion as a quote carries it — the two figures that reproduce what it
 * took off, and never the row it came from.
 *
 * The code is deliberately absent. A stay is repriced from what was frozen onto
 * it, and a `promotion` row an `ADMIN` has since retuned is exactly the input
 * that must not be re-read; the code belongs beside the frozen pair as a label
 * for a human, not as an argument to this arithmetic.
 */
export interface QuotedPromotion {
  readonly type: PromotionType;
  /** Whole points when `PERCENTAGE`, whole đồng when `FIXED_AMOUNT`. Negative. */
  readonly value: bigint;
}

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
  /** Null on a stay no promotion applied to, which is most of them. */
  readonly promotion?: QuotedPromotion | null;
}

/** Gross for the whole stay: the room rate under the plan, discounted by any
 *  promotion, then the heads beyond it, then breakfast. */
export function stayTotalGross({
  standardTotal,
  percentAdjustment,
  breakfastPerPersonGross,
  extraPersonPerNightGross,
  nights,
  party,
  promotion = null,
}: StayQuoteInput): VndAmount {
  const room = planAdjustedRoomGross(standardTotal, percentAdjustment);
  const adjusted = room - promotionReduction(room, promotion);

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

/**
 * The room rate for the stay under the plan, before any promotion.
 *
 * Exported because the pricing path has to *choose* a promotion before it can
 * apply one, and both of §7's forms are only comparable against the figure they
 * would reduce — five percent and 200,000 ₫ off order differently on a one-night
 * stay than on a week. A caller ranking candidates therefore needs this exact
 * number, and computing it there would be the second implementation of a
 * percentage this file exists to prevent.
 */
export function planAdjustedRoomGross(
  standardTotal: VndAmount,
  percentAdjustment: number,
): VndAmount {
  return (standardTotal * BigInt(100 + percentAdjustment)) / 100n;
}

/**
 * What a promotion takes off a room figure — never negative, never more than
 * the room.
 *
 * Stated as the reduction rather than as the reduced price because that is the
 * question a caller with several candidates is asking: the one that takes the
 * most off is the one the guest gets. `stayTotalGross` subtracts it and needs no
 * second form of the rule.
 *
 * Both scales reduce and neither can raise — `schema/pricing.ts` holds a
 * `PERCENTAGE` row between −99 and −1 and a `FIXED_AMOUNT` row below zero, which
 * is `rate_plan.percent_adjustment`'s sign convention, so the negation below is
 * the only place the sign is handled.
 *
 * The ceiling at the room's own value binds on the fixed form only, which is the
 * only one that can overshoot: a percentage cannot reach −100 by the constraint
 * above, while "200,000 ₫ off" can exceed a one-night stay in low season. A room
 * reduced to nothing is not sold for nothing — `booking_quoted_total_positive`
 * refuses a stay that came to zero, and that refusal is the honest outcome,
 * because a comped room is a folio adjustment rather than a price
 * (`rate_calendar` makes the same argument).
 */
export function promotionReduction(
  roomGross: VndAmount,
  promotion: QuotedPromotion | null,
): VndAmount {
  if (promotion === null) {
    return 0n;
  }

  if (promotion.type === "PERCENTAGE") {
    return roomGross - (roomGross * (100n + promotion.value)) / 100n;
  }

  const asked = -promotion.value;

  return asked < roomGross ? asked : roomGross;
}
