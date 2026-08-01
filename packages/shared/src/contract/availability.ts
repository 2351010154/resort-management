// What a date range costs and whether it can be sold — `FR-INV-03`.
//
// One capability row governs both routes (`availability.search`), and it is the
// single unauthenticated row in the matrix: the public funnel asks the same
// question the front desk does, and answering it discloses only what the hotel
// already prints on a booking page. Two routes rather than one because the
// funnel asks twice, at different granularity — a month of nights before the
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
import { stayDateSchema } from "../stay-date.js";

// A party larger than any room takes is not a search, it is a typo. The real
// ceiling is per type and lives in `room_type.max_occupancy` — §1 — where a
// party above it yields no offer rather than a price (§3). This bound only
// keeps an absurd number from reaching the query planner.
const LARGEST_PLAUSIBLE_PARTY = 10;

/**
 * The query behind "what can I book, and for how much".
 *
 * `occupancy` is the number of heads the rate must cover. It filters types
 * whose maximum it exceeds, because §3 makes occupancy above the maximum a
 * rejection and not a price.
 */
export const stayOfferQuery = z
  .object({
    checkIn: stayDateSchema,
    checkOut: stayDateSchema,
    // The plan is what the prices are quoted under, so it defaults to the one
    // the other two are derived from rather than to nothing.
    plan: ratePlanCodeSchema.default("STANDARD"),
    occupancy: z.coerce
      .number()
      .int()
      .min(1)
      .max(LARGEST_PLAUSIBLE_PARTY)
      .default(2),
  })
  .refine((query) => query.checkIn.compare(query.checkOut) < 0, {
    message: "checkOut must fall after checkIn",
    path: ["checkOut"],
  });

/** A month of nights, for the grid the funnel opens on. */
export const rateCalendarQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  plan: ratePlanCodeSchema.default("STANDARD"),
});

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
