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
// **Only tier-gated promotions are read here.** A row with
// `requires_loyalty_tier` null is a campaign open to everyone, and applying one
// would move the price of every stay the property sells — including the ones
// `availability.service.ts` quotes, which prices no promotions at all and says
// so. Until the funnel can show a campaign price, quoting one only at the moment
// of sale would show a guest one figure and sell them another. §7's discount has
// no such problem: an anonymous search has no tier, so there is nothing it could
// have been shown that this contradicts, and what changes at the point of sale
// changes downward for a guest who has signed in.

import {
  type LoyaltyTier,
  nightCount,
  type Party,
  partySize,
  planAdjustedRoomGross,
  promotionReduction,
  type QuotedPromotion,
  type RatePlanCode,
  type RoomTypeCode,
  type StayDate,
  stayTotalGross,
  type VndAmount,
} from "@mariva/shared";
import { parseDate } from "@internationalized/date";
import { Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import {
  and,
  asc,
  eq,
  gte,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
} from "drizzle-orm";
import type { DbExecutor } from "../../database/database.module.js";
import { roomType } from "../../database/schema/inventory.js";
import {
  promotion,
  propertyTariff,
  rateCalendar,
  ratePlan,
} from "../../database/schema/pricing.js";

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

/** A promotion as it was frozen, and the code that names the row it came from. */
export interface AppliedPromotion extends QuotedPromotion {
  readonly code: string;
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
   * **The gate is a floor, not an equality.** `pricing.ts` calls
   * `requires_loyalty_tier` "the tier a discount is *gated on*", and a gate is
   * something a guest is at least as high as — which is also the only reading
   * under which `rate-calendar.ts`'s sentence about MEMBER holds, since a
   * promotion gated on the tier everybody has would be gated on nothing. So a
   * Gold guest qualifies for a Silver-gated campaign as well as a Gold-gated
   * one, and `loyalty_tier`'s declaration order is what `<=` compares on.
   *
   * **One promotion applies, and it is the one that takes the most off.**
   * Stacking is a decision about campaigns rather than about tiers — which two
   * combine, in what order, to what floor — and §7 asks for none of it: a guest
   * is on one rung and is owed one discount. Ranking by what each candidate
   * actually reduces, rather than by its stored value, is what makes the two
   * scales comparable at all: −5% and 200,000 ₫ off order differently on one
   * night than on seven.
   *
   * **The window has to cover the whole stay.** The discount is taken off the
   * summed room total, so a campaign that expires mid-stay would otherwise
   * discount nights it had already stopped applying to. Requiring it to cover
   * the departure's last night is the reading that cannot overpay, and §7's own
   * rows carry no window at all — a loyalty discount is open-ended by
   * construction, which is what the nullable ends of `promotion` are for.
   */
  private async tierPromotion(
    exec: DbExecutor,
    request: StayQuoteRequest,
    stay: { nights: number; roomGross: VndAmount },
  ): Promise<AppliedPromotion | null> {
    const tier = request.loyaltyTier ?? null;

    if (tier === null) {
      return null;
    }

    // The last night of the stay, which is the departure date less one — the
    // departure is not a night sold, and a campaign ending on the guest's last
    // morning covered every night they were charged for.
    const lastNight = request.checkOut.subtract({ days: 1 }).toString();

    const candidates = await exec
      .select({
        code: promotion.code,
        type: promotion.type,
        value: promotion.value,
      })
      .from(promotion)
      .where(
        and(
          eq(promotion.isActive, true),
          // Tier-gated rows only. The header says why an open campaign is not
          // this milestone's to apply.
          isNotNull(promotion.requiresLoyaltyTier),
          lte(promotion.requiresLoyaltyTier, tier),
          // A null at either end is a campaign that has always been running or
          // has no end — which is what §7's two rows are.
          or(
            isNull(promotion.validFrom),
            lte(promotion.validFrom, request.checkIn.toString()),
          ),
          or(isNull(promotion.validTo), gte(promotion.validTo, lastNight)),
          or(
            isNull(promotion.minNights),
            lte(promotion.minNights, stay.nights),
          ),
        ),
      );

    return best(candidates, stay);
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

/**
 * The candidate that takes the most off this stay's room rate, or null.
 *
 * Ranked by what each one actually reduces rather than by its stored value,
 * because the two scales are not otherwise comparable — `promotionReduction` is
 * the same arithmetic `stayTotalGross` will apply, so the row that wins here is
 * the row that produces the lowest total there.
 *
 * A tie goes to the first row read. It is a tie in đồng, so nothing about the
 * guest's price depends on which one wins; what it decides is only which code
 * the booking freezes, and a property that configured two identical loyalty
 * discounts has said the two are interchangeable.
 *
 * A candidate that reduces by nothing is discarded rather than frozen. A
 * `FIXED_AMOUNT` row cannot reduce by nothing — the constraint keeps it below
 * zero — but a `PERCENTAGE` row can, against a stay whose room total is small
 * enough that integer division truncates the discount away. Freezing that one
 * would put a code and a value on a booking whose total they did not move, and
 * a guest reading their confirmation would find a discount that took nothing
 * off.
 */
function best(
  candidates: readonly AppliedPromotion[],
  stay: { roomGross: VndAmount },
): AppliedPromotion | null {
  let winner: AppliedPromotion | null = null;
  let deepest = 0n;

  for (const candidate of candidates) {
    const reduction = promotionReduction(stay.roomGross, candidate);

    if (reduction > deepest) {
      winner = candidate;
      deepest = reduction;
    }
  }

  return winner;
}
