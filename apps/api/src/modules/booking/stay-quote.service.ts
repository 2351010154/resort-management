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

import {
  nightCount,
  type Party,
  partySize,
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

export interface StayQuoteRequest {
  readonly roomType: RoomTypeCode;
  readonly checkIn: StayDate;
  readonly checkOut: StayDate;
  readonly plan: RatePlanCode;
  readonly party: Party;
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

    const priced = await exec
      .select({
        stayDate: rateCalendar.stayDate,
        grossPerNight: rateCalendar.grossPerNight,
      })
      .from(rateCalendar)
      .where(
        and(
          eq(rateCalendar.roomTypeId, type.id),
          gte(rateCalendar.stayDate, request.checkIn.toString()),
          lt(rateCalendar.stayDate, request.checkOut.toString()),
        ),
      )
      .orderBy(asc(rateCalendar.stayDate));

    if (priced.length !== nights) {
      throw new ORPCError("CONFLICT", {
        message:
          "The stay includes nights the property has published no price for — set the rate calendar for them first",
      });
    }

    const plan = await this.planPricing(exec, request.plan);
    const extraPersonPerNightGross = await this.extraPersonRate(exec);

    const standardTotal = priced.reduce<VndAmount>(
      (total, night) => total + night.grossPerNight,
      0n,
    );

    return {
      roomTypeId: type.id,
      nights: priced.map((night) => ({
        stayDate: parseDate(night.stayDate),
        standardGross: night.grossPerNight,
      })),
      stayTotalGross: stayTotalGross({
        standardTotal,
        percentAdjustment: plan.percentAdjustment,
        breakfastPerPersonGross: plan.breakfastPerPersonGross,
        extraPersonPerNightGross,
        nights,
        party: request.party,
      }),
      percentAdjustment: plan.percentAdjustment,
      breakfastPerPersonGross: plan.breakfastPerPersonGross,
      extraPersonPerNightGross,
    };
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
