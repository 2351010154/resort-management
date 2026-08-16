// What a date range costs and whether it can be sold — `FR-INV-03`.
//
// One capability row governs both routes (`availability.search`), and it is the
// single unauthenticated row in the matrix: the public funnel asks the same
// question the front desk does, and answering it discloses only what the hotel
// already prints on a booking page. Two routes rather than one because the
// funnel asks twice, at different granularity — a window of nights before the
// guest has picked dates, then one offer per type once they have. The shapes
// they answer with are `rate-calendar.ts`'s, and the argument for keeping them
// apart is made there.
//
// Both take dates as `YYYY-MM-DD` in the query string, which `stayDateSchema`
// decodes into a `CalendarDate`. A stay boundary never arrives as a timestamp,
// so there is no zone for the API and the funnel to disagree about.

import { oc } from "@orpc/contract";
import { z } from "zod";
import {
  ratePlanCodeSchema,
  stayOfferSchema,
  wireRateCalendarSchema,
} from "../rate-calendar.js";
import { nightCount, stayDateSchema } from "../stay-date.js";

// A party larger than any room takes is not a search, it is a typo. The real
// ceiling is per type and lives in `room_type.max_occupancy` — §1 — where a
// party above it yields no offer rather than a price (§3). This bound only
// keeps an absurd number from reaching the query planner.
//
// Exported because `booking.ts` bounds the same party. A booking is the search
// made real, and the two disagreeing would let the funnel quote a party it could
// not then book — or the reverse, which is worse.
export const LARGEST_PLAUSIBLE_PARTY = 10;

/**
 * The oldest age that may arrive as a child.
 *
 * §3 charges 12 and over as an adult, so an age above that band changes no
 * price — but it is still the honest way to describe a fifteen-year-old, and a
 * schema that refused one would push the funnel into filing them as an adult.
 * Eighteen and over is not a child in any sense the property means.
 */
export const OLDEST_CHILD_AGE = 17;

/**
 * The ages travelling as children, as they arrive in a query string.
 *
 * Ages and not a count, because `FR-PRC-04` prices children in three bands and
 * a count cannot say which — this is the field that makes the ladder possible
 * to apply on the server at all.
 *
 * A single `childAges=9` arrives as a bare string rather than as an array of
 * one, so it is lifted into one here. Doing it in the schema rather than at the
 * handler is what keeps one guest's child and two guests' children the same
 * shape by the time anything prices them.
 */
const childAgesQuery = z.preprocess(
  (ages) => (ages === undefined ? [] : Array.isArray(ages) ? ages : [ages]),
  z
    .array(z.coerce.number().int().min(0).max(OLDEST_CHILD_AGE))
    .max(LARGEST_PLAUSIBLE_PARTY),
);

/**
 * The query behind "what can I book, and for how much".
 *
 * The party is `adults` plus `childAges` rather than one head count. §3 prices
 * a third head by age — free under 6, half from 6 to 11, in full from 12 — and
 * a number alone cannot carry that, so a bare `occupancy` could only ever have
 * quoted every child as an adult.
 *
 * The total still filters types whose maximum it exceeds, because §3 makes
 * occupancy above the maximum a rejection and not a price. A child under 6 is
 * free and is nonetheless a head against that ceiling: the band decides what a
 * guest costs, never whether the room holds them.
 */
export const stayOfferQuery = z
  .object({
    checkIn: stayDateSchema,
    checkOut: stayDateSchema,
    // The plan is what the prices are quoted under, so it defaults to the one
    // the other two are derived from rather than to nothing.
    plan: ratePlanCodeSchema.default("STANDARD"),
    // At least one, because a stay nobody sleeps in is not a search. The
    // default is the occupancy the rate covers — §1's included two.
    adults: z.coerce
      .number()
      .int()
      .min(1)
      .max(LARGEST_PLAUSIBLE_PARTY)
      .default(2),
    childAges: childAgesQuery,
  })
  .refine((query) => query.checkIn.compare(query.checkOut) < 0, {
    message: "checkOut must fall after checkIn",
    path: ["checkOut"],
  })
  .refine(
    (query) => query.adults + query.childAges.length <= LARGEST_PLAUSIBLE_PARTY,
    {
      message: `a party of more than ${LARGEST_PLAUSIBLE_PARTY} is not a search`,
      path: ["childAges"],
    },
  );

/**
 * The longest window the calendar will answer, in nights.
 *
 * The funnel opens on a 365-night horizon, and a caller that squares that
 * window off to whole months — the shape a month-paged grid wants — adds at
 * most thirty leading and thirty trailing nights to it. 425 is that, and
 * nothing beyond it is a booking horizon anybody has.
 *
 * A ceiling and not a courtesy. This is the one route a caller holding no
 * session can reach, so an unbounded `from`/`to` would let a single GET ask for
 * a century of nights and turn a public read into an amplification lever. It
 * rejects rather than clamping: a grid silently given fewer nights than it
 * asked for renders its tail as unpriced, which a guest cannot tell from a
 * property that has not opened those dates.
 */
export const LONGEST_CALENDAR_WINDOW = 425;

/**
 * A window of nights, for the grid the funnel opens on.
 *
 * Half-open [from, to), which is the convention `stay-date.ts` fixes for every
 * other range in the system: the last date is not a night answered for. That is
 * what lets a caller page one window after another — or ask for a year in one
 * request, which is what `/booking` does — without a night arriving twice.
 *
 * A range rather than the `{year, month}` this route used to take. The funnel
 * needs a year of nights on first paint and was making thirteen calls to get
 * one, and the admin rates grid is days-across rather than a month page, so the
 * month was a shape neither caller actually held.
 */
export const rateCalendarQuery = z
  .object({
    from: stayDateSchema,
    to: stayDateSchema,
    plan: ratePlanCodeSchema.default("STANDARD"),
  })
  .refine((query) => query.from.compare(query.to) < 0, {
    message: "to must fall after from",
    path: ["to"],
  })
  .refine(
    (query) =>
      nightCount({ checkIn: query.from, checkOut: query.to }) <=
      LONGEST_CALENDAR_WINDOW,
    {
      message: `a calendar window may not run longer than ${LONGEST_CALENDAR_WINDOW} nights`,
      path: ["to"],
    },
  );

export const availability = {
  search: oc
    .route({ method: "GET", path: "/availability" })
    .input(stayOfferQuery)
    .output(stayOfferSchema),

  calendar: oc
    .route({ method: "GET", path: "/availability/calendar" })
    .input(rateCalendarQuery)
    .output(wireRateCalendarSchema),
};
