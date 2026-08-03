// What a night costs and whether it may be sold, as the property edits it —
// the write side of `docs/architecture/property-and-tariff.md` §3.
//
// `availability.ts` is the same three tables read by a guest. This is the same
// three tables changed by a manager, and the two are separate contracts because
// they answer to different rows of the RBAC matrix: availability is the one
// unauthenticated row in the document, and everything here is staff-only. A
// single contract serving both would put the calendar's raw rows — including
// nights the property has not published — behind the same declaration that
// makes a rate search public.
//
// Two capability rows govern the six routes. "Rate plans, rate calendar,
// promotions" covers the first four, "Stay restrictions (min/max, CTA/CTD)" the
// last two, and both give a receptionist 👁 and a manager ✅ — so each pair is a
// read route and a write route over one row, which is what the second argument
// to `@RequiresCapability` exists to tell apart.
//
// What is deliberately NOT here:
//
// - **Promotions** (`FR-PRC-03`), named in the matrix row above but with no
//   table behind it yet. A route for a table that does not exist is a promise
//   the client would be typed against and nobody could keep.
// - **Rate override on a booking**. Its own matrix row
//   (`pricing.rate-override`, MANAGER and ADMIN, "Beyond the plan's price"), and
//   it needs a booking to override — which is `M4`.
// - **Creating or deleting a rate plan.** The three codes are a Postgres enum
//   built from `RATE_PLAN_CODES`; a fourth plan is a migration, not a POST.

import { oc } from "@orpc/contract";
import { z } from "zod";
import { vndAmountInputSchema, vndAmountSchema } from "../money.js";
import { ratePlanCodeSchema, roomTypeCodeSchema } from "../rate-calendar.js";
import {
  isoStayDateSchema,
  nightCount,
  type StayDate,
  stayDateSchema,
} from "../stay-date.js";

/**
 * The nights one call may touch.
 *
 * `NFR-03` sizes the calendar at twelve months, so a little over a year is the
 * longest edit that is a real one. Past that the number came from a mistyped
 * year, and the request would write several thousand rows before anybody
 * noticed the price was wrong on all of them.
 */
const LONGEST_EDITABLE_RANGE = 400;

/**
 * A stay of no more nights than the property plans in — the ceiling on
 * `minimumStay` and `maximumStay` both.
 *
 * The columns are `smallint`, so an unbounded number here reaches Postgres as
 * an out-of-range error and surfaces as a 500. A year is already far beyond any
 * rule a hotel writes.
 */
const LONGEST_STAY_RULE = 365;

/**
 * The nights an edit covers, stated as two dates and inclusive of both.
 *
 * Not the half-open [checkIn, checkOut) of `stayRangeSchema`, and the
 * difference is deliberate: a stay names an arrival and a departure, where this
 * names the first night and the last night the manager is pricing. Half-open
 * here would mean a manager pricing Christmas week could not price the last
 * night of it without naming a date they were not editing.
 */
const nightRangeFields = {
  from: stayDateSchema,
  to: stayDateSchema,
};

interface NightRange {
  readonly from: StayDate;
  readonly to: StayDate;
}

/** Nights a `from`/`to` pair covers, both ends included. */
function nightsInRange(range: NightRange): number {
  return nightCount({
    checkIn: range.from,
    checkOut: range.to.add({ days: 1 }),
  });
}

const RANGE_ORDER = {
  message: "to must not fall before from",
  path: ["to"],
};

const RANGE_LENGTH = {
  message: `a single edit covers at most ${LONGEST_EDITABLE_RANGE} nights`,
  path: ["to"],
};

const inOrder = (range: NightRange) => range.from.compare(range.to) <= 0;

// Only meaningful once the pair is in order, so a reversed range reports the
// order failure alone rather than both at once.
const withinLength = (range: NightRange) =>
  !inOrder(range) || nightsInRange(range) <= LONGEST_EDITABLE_RANGE;

// ── Rate plans ─────────────────────────────────────────────────────────────

/**
 * A plan and the arithmetic it applies to the calendar — `property-and-tariff.md`
 * §3, as the row a manager edits rather than as a formula in a service.
 */
export const ratePlanSchema = z.object({
  code: ratePlanCodeSchema,
  name: z.string(),
  /** Signed whole percent off the calendar price. 0 on `STANDARD`. */
  percentAdjustment: z.number().int().min(-100).max(100),
  /** Per person per night, and null on a plan that includes no breakfast. */
  breakfastPerPersonGross: vndAmountSchema.nullable(),
  /**
   * Read-only. The three plans are ordered once and the column is unique, so
   * reordering is a swap of two rows rather than a field on a PATCH — and
   * nothing has asked to reorder them.
   */
  displayOrder: z.number().int(),
});

/**
 * A change to one plan.
 *
 * Every field is optional and the omitted ones are left alone, which is what
 * makes this a PATCH. `breakfastPerPersonGross` distinguishes the two ways a
 * field can be absent: undefined leaves the plan's breakfast as it was, and an
 * explicit null removes it — the difference between editing `BB`'s name and
 * turning `BB` into a room-only plan.
 */
export const updateRatePlanInput = z.object({
  code: ratePlanCodeSchema,
  name: z.string().trim().min(1).max(80).optional(),
  percentAdjustment: z.number().int().min(-100).max(100).optional(),
  // Positive, mirroring the column's check: a breakfast of zero is not
  // breakfast at no charge, it is a folio line saying something happened that
  // did not.
  breakfastPerPersonGross: vndAmountInputSchema
    .refine((amount) => amount > 0n, "breakfast must cost something")
    .nullable()
    .optional(),
});

// ── Rate calendar ──────────────────────────────────────────────────────────

/**
 * One night of the calendar as the property sees it, price or gap.
 *
 * `grossPerNight` is null on a night with no row — a night the property has not
 * published. That is a different thing from a night that is sold out, and it is
 * the one thing this view exists to show: the guest-facing calendar renders an
 * unpublished night as unavailable, and a manager looking at the same month
 * needs to know it is unpriced rather than taken.
 */
export const rateCalendarNightSchema = z.object({
  date: isoStayDateSchema,
  grossPerNight: vndAmountSchema.nullable(),
});

/** Every night of the requested range, gaps included. */
export const rateCalendarPageSchema = z.object({
  roomType: roomTypeCodeSchema,
  nights: z.array(rateCalendarNightSchema),
});

/** Which type, and which nights. The query behind both read routes. */
export const pricingRangeQuery = z
  .object({ roomType: roomTypeCodeSchema, ...nightRangeFields })
  .refine(inOrder, RANGE_ORDER)
  .refine(withinLength, RANGE_LENGTH);

/**
 * One price across a range of nights.
 *
 * One price and not a list of them, because that is the edit: a season is a
 * name over a set of dates and the property charges one figure across it. A
 * week of differing prices is a call per band, which is how the prices were
 * decided in the first place.
 */
export const setRateCalendarInput = z
  .object({
    roomType: roomTypeCodeSchema,
    ...nightRangeFields,
    // Positive, mirroring `rate_calendar_gross_positive`: a free night is a
    // comp, and a comp is a folio adjustment rather than a rate.
    grossPerNight: vndAmountInputSchema.refine(
      (amount) => amount > 0n,
      "a night must cost something — a free night is a comp, not a rate",
    ),
  })
  .refine(inOrder, RANGE_ORDER)
  .refine(withinLength, RANGE_LENGTH);

// ── Stay restrictions ──────────────────────────────────────────────────────

/**
 * One night's rule — `FR-PRC-02`.
 *
 * Only nights that carry one are returned. A type-date with no row is
 * unrestricted, and filling a year of them with "no rule" would be the 73,000
 * rows a year the table is shaped to avoid, restated on the wire.
 */
export const stayRestrictionSchema = z.object({
  date: isoStayDateSchema,
  minimumStay: z.number().int().min(1).max(LONGEST_STAY_RULE),
  maximumStay: z.number().int().min(1).max(LONGEST_STAY_RULE).nullable(),
  closedToArrival: z.boolean(),
  closedToDeparture: z.boolean(),
});

export const stayRestrictionsPageSchema = z.object({
  roomType: roomTypeCodeSchema,
  restrictions: z.array(stayRestrictionSchema),
});

const MAXIMUM_AT_LEAST_MINIMUM = {
  message: "maximumStay must not fall below minimumStay",
  path: ["maximumStay"],
};

/**
 * One rule across a range of nights, or the absence of one.
 *
 * The fields default to the unrestricted values, so a body naming only a
 * `minimumStay` does not silently carry over a closed-to-arrival flag from
 * whatever was there before. Sending all four defaults is how a rule is
 * removed: it is not a rule, and the rows are deleted rather than stored saying
 * nothing.
 */
export const setStayRestrictionsInput = z
  .object({
    roomType: roomTypeCodeSchema,
    ...nightRangeFields,
    minimumStay: z.number().int().min(1).max(LONGEST_STAY_RULE).default(1),
    maximumStay: z
      .number()
      .int()
      .min(1)
      .max(LONGEST_STAY_RULE)
      .nullable()
      .default(null),
    closedToArrival: z.boolean().default(false),
    closedToDeparture: z.boolean().default(false),
  })
  .refine(inOrder, RANGE_ORDER)
  .refine(withinLength, RANGE_LENGTH)
  .refine(
    // Mirrors `stay_restriction_maximum_at_least_minimum`. A maximum below the
    // minimum is a night no stay can satisfy in either direction, which renders
    // in the calendar as a sold-out night nobody can explain.
    (rule) => rule.maximumStay === null || rule.maximumStay >= rule.minimumStay,
    MAXIMUM_AT_LEAST_MINIMUM,
  );

/** True when a rule constrains nothing, and so is stored as no row at all. */
export function isUnrestricted(rule: {
  minimumStay: number;
  maximumStay: number | null;
  closedToArrival: boolean;
  closedToDeparture: boolean;
}): boolean {
  return (
    rule.minimumStay === 1 &&
    rule.maximumStay === null &&
    !rule.closedToArrival &&
    !rule.closedToDeparture
  );
}

// ── Routes ─────────────────────────────────────────────────────────────────

/** What a write over a range actually touched. */
const rangeWriteResult = z.object({
  roomType: roomTypeCodeSchema,
  nights: z.number().int().min(0),
});

export const pricing = {
  listRatePlans: oc
    .route({ method: "GET", path: "/pricing/rate-plans" })
    .output(z.object({ plans: z.array(ratePlanSchema) })),

  updateRatePlan: oc
    .route({ method: "PATCH", path: "/pricing/rate-plans/{code}" })
    .input(updateRatePlanInput)
    .output(ratePlanSchema),

  readRateCalendar: oc
    .route({ method: "GET", path: "/pricing/rate-calendar" })
    .input(pricingRangeQuery)
    .output(rateCalendarPageSchema),

  setRateCalendar: oc
    // PUT and not POST: the same body sent twice leaves the same prices on the
    // same nights, which is the property the upsert underneath gives it.
    .route({ method: "PUT", path: "/pricing/rate-calendar" })
    .input(setRateCalendarInput)
    .output(rangeWriteResult),

  readStayRestrictions: oc
    .route({ method: "GET", path: "/pricing/stay-restrictions" })
    .input(pricingRangeQuery)
    .output(stayRestrictionsPageSchema),

  setStayRestrictions: oc
    .route({ method: "PUT", path: "/pricing/stay-restrictions" })
    .input(setStayRestrictionsInput)
    .output(
      rangeWriteResult.extend({
        /** The rule written was "no rule", so `nights` counts rows removed. */
        cleared: z.boolean(),
      }),
    ),
};
