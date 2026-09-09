// The price a booking freezes onto itself — `booking-state-machine.md` §8.
//
// §8 settles the question this file exists to answer: a booking records the
// total it was quoted and the inputs that produced it, and never re-derives one.
// Every input to a price — the rate calendar, a plan's percentage, its breakfast
// figure, the property's extra-person rate — is a row the RBAC matrix lets a
// manager edit, so a booking holding only its dates and a plan code would hold a
// *recipe*. Re-running that recipe after any of those moved answers with a
// number the guest never agreed to, confidently.
//
// So this reads those four inputs once, at the moment of sale, and hands the
// caller both the total and the figures behind it. `booking.service.ts` writes
// all of them onto the row in the same transaction that consumes the inventory.
//
// **The caller never supplies a price.** The whole point of quoting here rather
// than trusting an input is that `FR-BOOK-02`'s hold is created by the public
// funnel — a request a stranger composes. A `quotedStayTotalGross` arriving on
// the wire would be a guest naming their own total.
//
// The arithmetic itself is `@mariva/shared`'s and not this file's. `stay-quote.ts`
// makes the argument: `modules/inventory` answers "what does this stay cost"
// while the guest is still choosing, this answers it again when they commit, and
// two implementations of one percentage would let a stay be shown one figure and
// sold at another with nothing failing.
//
// Reading `pricing`'s tables from here is a read across a module boundary, the
// same one `modules/inventory` already makes and for a related reason: the price
// has to be read inside the caller's transaction, beside the inventory movement,
// and a second service reached through Nest would be a second connection with
// its own snapshot of a calendar a manager may be editing.
//
// ## §7's member discount, and why the tier arrives rather than being derived
//
// `FR-GST-04` puts the tier discount "through the promotions path
// (`FR-PRC-03`)", and the path is this one: a `promotion` row carrying
// `requires_loyalty_tier` is read here beside the plan and frozen onto the
// booking beside the plan's percentage.
//
// The tier itself arrives on the request and is not derived here. Two reasons,
// and the second is the load-bearing one. What tier a guest holds is
// `TierDerivationService`'s single answer — `FR-GST-04` makes it a derived value
// and that file makes it the only derivation of it — so a second caller of it
// belongs where the guest is known, which is the booking service and not the
// arithmetic. And this service is constructed bare in a dozen test files that
// price stays for nobody at all; a collaborator it needs for a discount that
// does not apply would be a dependency every one of them had to satisfy to
// assert a price.
//
// `MEMBER` arrives as `null`, which is `rate-calendar.ts`'s rule about
// `LOYALTY_TIERS` reaching this file intact: §7 gives the base tier no discount,
// so a promotion gated on it would be gated on nothing, and the absence of a
// tier and the absence of a discount are the same sentence.
//
// **Which row applies is not decided here.** `modules/pricing/tier-promotion.ts`
// owns that, because `availability.service.ts` now asks the same question while
// the guest is still choosing: a signed-in member is shown the discounted total
// on the room card and in the month grid, and the figure this service freezes has
// to be the one they were shown. Two readings of `valid_to` would be a card and
// a confirmation free to disagree, which is the failure the paragraph above
// describes one level down, about the arithmetic.
//
// **Only tier-gated promotions are read.** A row with `requires_loyalty_tier`
// null is a campaign open to everyone, and applying one would move the price of
// every stay the property sells; until the funnel can show a campaign price,
// quoting one only at the moment of sale would show a guest one figure and sell
// them another. §7's discount has no such problem — the funnel quotes it too.

import {
  type LoyaltyTier,
  nightCount,
  type Party,
  partySize,
  planAdjustedRoomGross,
  type RatePlanCode,
  type RoomTypeCode,
  type StayDate,
  stayTotalGross,
  type VndAmount,
} from "@mariva/shared";
import { parseDate } from "@internationalized/date";
import { Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import type { DbExecutor } from "../../database/database.module.js";
import { roomType } from "../../database/schema/inventory.js";
import {
  propertyTariff,
  rateCalendar,
  ratePlan,
} from "../../database/schema/pricing.js";
import {
  type AppliedPromotion,
  bestTierPromotion,
  tierPromotions,
} from "../pricing/tier-promotion.js";

// Re-exported because this service's answer is what a booking freezes, and the
// callers that read a frozen quote have always named the type from here.
export type { AppliedPromotion };

export interface StayQuoteRequest {
  readonly roomType: RoomTypeCode;
  readonly checkIn: StayDate;
  readonly checkOut: StayDate;
  readonly plan: RatePlanCode;
  readonly party: Party;
  /**
   * The tier the guest holds, or null for a stay nobody signed in for and for a
   * guest standing at `MEMBER` — see the header on why those are one case.
   */
  readonly loyaltyTier?: LoyaltyTier | null;
}

/** One night at the calendar price it was sold at — a `booking_night` row. */
export interface QuotedNight {
  readonly stayDate: StayDate;
  readonly standardGross: VndAmount;
}

/**
 * The total, and the four figures that reproduce it.
 *
 * Named the way `booking` stores them, because that is what they are for: a
 * folio line at `M6` explains the number by re-running `stayTotalGross` over
 * these, without reading a table that has since changed.
 */
export interface FrozenQuote {
  readonly roomTypeId: string;
  /** One per night of `[checkIn, checkOut)`, in stay order. */
  readonly nights: readonly QuotedNight[];
  readonly stayTotalGross: VndAmount;
  readonly percentAdjustment: number;
  readonly breakfastPerPersonGross: VndAmount | null;
  readonly extraPersonPerNightGross: VndAmount;
  /** Null on a stay no promotion reduced, which is most of them. */
  readonly promotion: AppliedPromotion | null;
}

@Injectable()
export class StayQuoteService {
  /**
   * Prices a stay against the calendar as it stands right now.
   *
   * Refuses rather than approximates. A night the property has not published a
   * price for produces no row here, and quoting the stay without it would sell
   * a range for less than it covers — so a partly-priced stay is a `409` the
   * desk resolves by publishing the calendar, exactly as a partly-opened one is.
   */
  async quote(exec: DbExecutor, request: StayQuoteRequest): Promise<FrozenQuote> {
    const nights = nightCount(request);

    // `booking_covers_at_least_one_night` refuses the row that would follow, but
    // the refusal further down would name the calendar rather than the range.
    if (nights < 1) {
      throw new ORPCError("BAD_REQUEST", {
        message: "A stay must cover at least one night",
      });
    }

    const [type] = await exec
      .select({ id: roomType.id, maxOccupancy: roomType.maxOccupancy })
      .from(roomType)
      .where(eq(roomType.code, request.roomType))
      .limit(1);

    if (!type) {
      throw new ORPCError("NOT_FOUND", {
        message: `No room type coded ${request.roomType}`,
      });
    }

    // The one guard the storage layer cannot make. `type_inventory` counts
    // rooms, not heads, so nothing below would refuse a party of six sold into
    // a room that sleeps two — the booking would price, consume a room and
    // arrive at the desk as a party nobody can accommodate. Every head counts,
    // including the ones §3 prices at nothing: an under-six sleeping in
    // existing bedding still occupies the room they are sleeping in.
    const heads = partySize(request.party);

    if (heads > type.maxOccupancy) {
      throw new ORPCError("CONFLICT", {
        message: `A ${request.roomType} sleeps ${type.maxOccupancy}, and the party is ${heads}`,
      });
    }

    const priced = await this.calendarNights(
      exec,
      type.id,
      request.checkIn,
      request.checkOut,
    );

    const plan = await this.planPricing(exec, request.plan);
    const extraPersonPerNightGross = await this.extraPersonRate(exec);

    const standardTotal = priced.reduce<VndAmount>(
      (total, night) => total + night.standardGross,
      0n,
    );

    const applied = await this.tierPromotion(exec, request, {
      nights,
      roomGross: planAdjustedRoomGross(standardTotal, plan.percentAdjustment),
    });

    return {
      roomTypeId: type.id,
      nights: priced,
      stayTotalGross: stayTotalGross({
        standardTotal,
        percentAdjustment: plan.percentAdjustment,
        breakfastPerPersonGross: plan.breakfastPerPersonGross,
        extraPersonPerNightGross,
        nights,
        party: request.party,
        promotion: applied,
      }),
      percentAdjustment: plan.percentAdjustment,
      breakfastPerPersonGross: plan.breakfastPerPersonGross,
      extraPersonPerNightGross,
      promotion: applied,
    };
  }

  /**
   * The promotion §7's ladder entitles this guest to, or null.
   *
   * Both halves are `modules/pricing/tier-promotion.ts`'s — which rows the tier
   * reaches, and which of them takes the most off this stay. The header says why
   * they are not written out here: the funnel asks the same question before the
   * guest commits, and one of the two answers has to be the other's.
   */
  private async tierPromotion(
    exec: DbExecutor,
    request: StayQuoteRequest,
    stay: { nights: number; roomGross: VndAmount },
  ): Promise<AppliedPromotion | null> {
    const candidates = await tierPromotions(exec, request.loyaltyTier ?? null);

    return bestTierPromotion(candidates, {
      checkIn: request.checkIn,
      checkOut: request.checkOut,
      nights: stay.nights,
      roomGross: stay.roomGross,
    });
  }

  /**
   * The calendar price of every night in a range, in stay order.
   *
   * Public because a stay that is extended has to price the nights it adds, and
   * those nights have no frozen price to reuse — nobody sold them. What that
   * caller must *not* do is re-read the plan and the property tariff, which is
   * why it reaches for this rather than for {@link quote}: §8 freezes those two
   * onto the booking at the moment of sale, and a stay lengthened after a manager
   * moved the percentage would otherwise be totalled under terms the guest never
   * agreed to. The calendar is the one input an extension legitimately reads.
   *
   * Refuses rather than approximates, on the same grounds {@link quote} does — a
   * night the property has published no price for produces no row, and pricing
   * the range without it would sell it for less than it covers.
   */
  async calendarNights(
    exec: DbExecutor,
    roomTypeId: string,
    checkIn: StayDate,
    checkOut: StayDate,
  ): Promise<readonly QuotedNight[]> {
    const priced = await exec
      .select({
        stayDate: rateCalendar.stayDate,
        grossPerNight: rateCalendar.grossPerNight,
      })
      .from(rateCalendar)
      .where(
        and(
          eq(rateCalendar.roomTypeId, roomTypeId),
          gte(rateCalendar.stayDate, checkIn.toString()),
          lt(rateCalendar.stayDate, checkOut.toString()),
        ),
      )
      .orderBy(asc(rateCalendar.stayDate));

    if (priced.length !== nightCount({ checkIn, checkOut })) {
      throw new ORPCError("CONFLICT", {
        message:
          "The stay includes nights the property has published no price for — set the rate calendar for them first",
      });
    }

    return priced.map((night) => ({
      stayDate: parseDate(night.stayDate),
      standardGross: night.grossPerNight,
    }));
  }

  /**
   * The plan's derivation, read rather than compiled in.
   *
   * A plan absent from the table prices as the calendar does — the same
   * fallback `availability.service.ts` takes, and it has to be the same one:
   * these two must agree about a stay or the funnel shows a figure the booking
   * contradicts. Quoting the calendar price is also the only safe direction, in
   * that a missing row must never invent a discount nobody configured.
   */
  private async planPricing(
    exec: DbExecutor,
    code: RatePlanCode,
  ): Promise<{
    percentAdjustment: number;
    breakfastPerPersonGross: VndAmount | null;
  }> {
    const [row] = await exec
      .select({
        percentAdjustment: ratePlan.percentAdjustment,
        breakfastPerPersonGross: ratePlan.breakfastPerPersonGross,
      })
      .from(ratePlan)
      .where(eq(ratePlan.code, code))
      .limit(1);

    return row ?? { percentAdjustment: 0, breakfastPerPersonGross: null };
  }

  /**
   * The property's extra-person rate — §3, and the figure its bands are of.
   *
   * Required here where `availability.service.ts` requires it only for a party
   * beyond the included occupancy, and the difference is not an inconsistency.
   * A search that never prices a third head can answer without the tariff; a
   * booking cannot be *stored* without it, because
   * `booking_quoted_extra_person_positive` refuses the row and zero is not a
   * rate. A property with no tariff row therefore cannot sell at all, which is
   * the honest reading of a configuration that has not been completed — and it
   * fails at the point of sale rather than by quietly freezing a zero that would
   * price every later extra bed at nothing.
   */
  private async extraPersonRate(exec: DbExecutor): Promise<VndAmount> {
    const [row] = await exec
      .select({ gross: propertyTariff.extraPersonPerNightGross })
      .from(propertyTariff)
      .limit(1);

    if (!row) {
      throw new Error(
        "property_tariff holds no row, so no stay can be quoted an extra-person rate to freeze",
      );
    }

    return row.gross;
  }
}
