// Stay boundaries are calendar dates, not instants. A night belongs to a date
// the property agrees on: an arrival at 23:50 and one at 00:10 are different
// nights because the clock rolled in Ho Chi Minh City, not because it rolled in
// UTC. Mixing the two is the usual source of off-by-one-night bugs, so a stay
// date never carries a time and the property's zone is stated once, here.
// Timestamps of *events* (a payment, an audit entry) are a different type and
// stay as instants.

import { z } from "zod";

export const PROPERTY_TIME_ZONE = "Asia/Ho_Chi_Minh" as const;

/** ISO calendar date — no time, no offset: "2026-08-14". */
export const stayDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected a YYYY-MM-DD calendar date")
  // The shape check alone accepts 2026-02-31, which Date would silently roll
  // forward into March. Round-trip it and insist the parts survive.
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    );
  }, "not a date that exists");

export type StayDate = z.infer<typeof stayDateSchema>;

/**
 * Half-open [checkIn, checkOut): the departure date is not a night sold. That
 * convention is what makes two back-to-back stays in one room simply not
 * overlap, rather than a conflict every caller has to special-case.
 */
export const stayRangeSchema = z
  .object({ checkIn: stayDateSchema, checkOut: stayDateSchema })
  .refine((range) => range.checkIn < range.checkOut, {
    message: "checkOut must fall after checkIn",
    path: ["checkOut"],
  });

export type StayRange = z.infer<typeof stayRangeSchema>;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Nights a range sells — its length under the half-open convention. */
export function nightCount({ checkIn, checkOut }: StayRange): number {
  return Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / MS_PER_DAY);
}
