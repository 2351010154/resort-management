// Stay boundaries are calendar dates, not instants. A night belongs to a date
// the property agrees on: an arrival at 23:50 and one at 00:10 are different
// nights because the clock rolled in Ho Chi Minh City, not because it rolled in
// UTC. Mixing the two is the usual source of off-by-one-night bugs, so a stay
// date never carries a time and the property's zone is stated once, here.
// Timestamps of *events* (a payment, an audit entry) are a different type and
// stay as instants.
//
// The type that enforces that is `CalendarDate`, not a string. Both it and
// `ZonedDateTime` declare private fields, so TypeScript compares them
// nominally: an instant handed to something expecting a stay date does not
// compile, which is the whole reason this dependency is here rather than a
// regex over `YYYY-MM-DD`. A string would have accepted it silently.

import { CalendarDate, parseDate } from "@internationalized/date";
import { z } from "zod";

export const PROPERTY_TIME_ZONE = "Asia/Ho_Chi_Minh" as const;

/** The wire form: ISO calendar date — no time, no offset. "2026-08-14". */
const isoStayDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected a YYYY-MM-DD calendar date");

/**
 * A stay boundary, decoded from the wire into a `CalendarDate` and encoded back
 * to the same string.
 *
 * A codec rather than a one-way transform because the contract runs in both
 * directions: a request carries a date in and a response carries one out, and
 * two independent schemas for one type is how the two ends drift. No serializer
 * knows what a `CalendarDate` is — `bigint` it would carry natively, this it
 * would flatten into an object of loose numbers — so the crossing is declared
 * here, once.
 */
export const stayDateSchema = z.codec(isoStayDate, z.instanceof(CalendarDate), {
  decode: (value, ctx) => {
    // The shape check alone accepts 2026-02-31. `parseDate` rejects it rather
    // than rolling it forward into March, which is what `new Date` would do.
    try {
      return parseDate(value);
    } catch {
      ctx.issues.push({
        code: "custom",
        message: "not a date that exists",
        input: value,
      });
      return z.NEVER;
    }
  },
  encode: (date) => date.toString(),
});

export type StayDate = z.output<typeof stayDateSchema>;

/**
 * Half-open [checkIn, checkOut): the departure date is not a night sold. That
 * convention is what makes two back-to-back stays in one room simply not
 * overlap, rather than a conflict every caller has to special-case.
 */
export const stayRangeSchema = z
  .object({ checkIn: stayDateSchema, checkOut: stayDateSchema })
  .refine((range) => range.checkIn.compare(range.checkOut) < 0, {
    message: "checkOut must fall after checkIn",
    path: ["checkOut"],
  });

export type StayRange = z.output<typeof stayRangeSchema>;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Nights a range sells — its length under the half-open convention.
 *
 * Measured at UTC midnight rather than in the property's own zone: the two
 * agree here because Vietnam keeps no daylight saving, and anchoring to a zone
 * that has none means the arithmetic stays right if that ever stops being true.
 */
export function nightCount({ checkIn, checkOut }: StayRange): number {
  return Math.round(
    (checkOut.toDate("UTC").getTime() - checkIn.toDate("UTC").getTime()) /
      MS_PER_DAY,
  );
}
