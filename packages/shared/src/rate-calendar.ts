// What `/booking` has to ask for before it can quote anything: one row per
// night for a month, and one offer per room type for a chosen range.
//
// Two shapes rather than one, because they are answered at different moments
// and at different granularity. The calendar needs a number per *night* before
// the guest has chosen a room — so it carries the lowest price across all five
// types, which keeps a 31-day grid to 31 numbers instead of 155. The offer
// needs a number per *type* once the range exists. A single schema serving both
// would force the calendar to carry five prices a night that nothing reads.
//
// Restrictions live on the night, not on the booking attempt. A calendar that
// cannot say "you may not arrive on this date" until the guest has clicked it
// is a calendar that teaches the rule by rejection — see
// `docs/architecture/property-and-tariff.md` §3 for the rules themselves.

import { z } from "zod";
import { vndAmountSchema } from "./money.js";
import { stayDateSchema } from "./stay-date.js";

/**
 * The five types in `property-and-tariff.md` §1. A closed enum rather than a
 * string: the mix sums to 40 rooms, and a sixth code arriving from the wire is
 * a seed bug that should fail at the boundary rather than render an empty card.
 *
 * The array is exported alongside the schema because Postgres needs the same
 * five values as an enum type. Deriving both from one tuple is what stops the
 * database and the wire from drifting — the pattern `STAFF_ROLES` already sets
 * for the staff realm.
 */
export const ROOM_TYPE_CODES = [
  "SUPERIOR",
  "DELUXE",
  "PREMIER",
  "JUNIOR_SUITE",
  "PANORAMA_SUITE",
] as const;

export const roomTypeCodeSchema = z.enum(ROOM_TYPE_CODES);

export type RoomTypeCode = z.infer<typeof roomTypeCodeSchema>;

/**
 * Heads the rate covers, for every type — `property-and-tariff.md` §1.
 *
 * A ceiling on what is included, never a floor on who may book: one guest pays
 * the same rate two do. §3's extra-person charge starts at the third head and
 * runs up to the type's own maximum, so this is the number that decides *when*
 * a party costs more, not whether it is allowed.
 *
 * Stated once rather than as a column on `room_type`. §1 makes the argument:
 * a per-type value would imply the property varies what "the rate" covers when
 * it does not. It lives here rather than in either app because the API prices
 * against it and the funnel quotes against it, and two copies of a pricing
 * boundary is how a quote and an invoice come to disagree.
 */
export const INCLUDED_OCCUPANCY = 2;

/** The three plans at launch — `property-and-tariff.md` §3. */
export const ratePlanCodeSchema = z.enum(["STANDARD", "BB", "NONREF"]);

export type RatePlanCode = z.infer<typeof ratePlanCodeSchema>;

/**
 * One night in the calendar, priced and restricted.
 *
 * `lowestGross` is the cheapest a night costs across every type that is still
 * free — gross, per `property-and-tariff.md` §5, so the number in the cell is
 * the number the guest pays. It is absent when the night is sold out, because
 * a price on a night nobody can buy is noise.
 */
export const nightRateSchema = z
  .object({
    date: stayDateSchema,
    /** Cheapest gross rate across the types free that night. */
    lowestGross: vndAmountSchema.nullable(),
    /** No room of any type is free this night. */
    isSoldOut: z.boolean(),
    /**
     * A stay may not *begin* on this night, though it may run through it.
     * Amadeus renders this as its own named cell state — "Check-out only" —
     * rather than as a generic unavailability, which is what lets a guest
     * learn the rule instead of only being blocked by it.
     */
    isClosedToArrival: z.boolean(),
    /** Nights a stay beginning on this date must run for. 1 means no rule. */
    minimumStay: z.number().int().min(1),
  })
  .refine((night) => night.isSoldOut === (night.lowestGross === null), {
    message:
      "a sold-out night carries no price, and a free night must carry one",
    path: ["lowestGross"],
  });

export type NightRate = z.output<typeof nightRateSchema>;

/**
 * A month of nights for one plan.
 *
 * Keyed by plan because the three plans price differently (`NONREF` is
 * `STANDARD` − 10%, `BB` adds breakfast for the booked occupancy), so the
 * cheapest night under one plan is not the cheapest under another. Changing the
 * plan re-quotes the grid; it does not annotate it.
 */
export const rateCalendarSchema = z.object({
  plan: ratePlanCodeSchema,
  nights: z.array(nightRateSchema),
});

export type RateCalendar = z.output<typeof rateCalendarSchema>;

/**
 * What one room type costs for a chosen range, and whether it can be sold.
 *
 * Both `perNightGross` and `stayTotalGross` cross the wire. Not because the
 * client cannot multiply, but because it must not: the total is the un-rounded
 * sum of the nights, and a client deriving it from a display-rounded per-night
 * figure produces two lines that disagree by a few thousand đồng.
 * `property-and-tariff.md` §5 is why that matters more than it looks.
 */
export const roomTypeOfferSchema = z.object({
  code: roomTypeCodeSchema,
  /** Average gross per night over the range — display only. */
  perNightGross: vndAmountSchema,
  /** Gross for the whole stay, summed un-rounded. The authoritative figure. */
  stayTotalGross: vndAmountSchema,
  /** Whether every night of the range has a room of this type free. */
  isAvailable: z.boolean(),
  /** Gross per night for an extra bed, when the type takes one. */
  extraBedPerNightGross: vndAmountSchema.nullable(),
});

export type RoomTypeOffer = z.output<typeof roomTypeOfferSchema>;

/** The response `/booking` renders once it has both dates. */
export const stayOfferSchema = z.object({
  plan: ratePlanCodeSchema,
  offers: z.array(roomTypeOfferSchema),
});

export type StayOffer = z.output<typeof stayOfferSchema>;
