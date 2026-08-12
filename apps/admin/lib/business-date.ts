// What day it is *for the property*, derived in the browser.
//
// The business date is not the calendar date. It rolls at 04:00 in Ho Chi Minh
// City, so at 01:30 on 15 August the property is still working 14 August: the
// night audit has not run and the 14th has not been closed. Every arrival,
// departure and folio figure on the dashboard is keyed to that date, which is
// why it is the first thing the screen says.
//
// The authority for both values is `docs/architecture/property-and-tariff.md`
// §2, and the rollover hour is configuration there rather than a constant —
// `system_config.business_date_rollover_hour`, read by the API. This module
// holds the seeded hour as a literal because it has no session and no API to
// ask, and because a comp that fetched configuration would be proving something
// other than the visual language. A screen wired to the API reads the hour from
// the API and this file goes away with the rest of the comp.
//
// `@internationalized/date` does the same arithmetic in `packages/shared`, but
// pulling the contract barrel into a browser bundle to reach one constant costs
// zod, drizzle-zod and `@orpc/contract` for two derived strings. `Intl` is
// already in the runtime and gets the same answer.

/** The property's zone. Vietnam keeps no daylight saving. */
export const PROPERTY_TIME_ZONE = "Asia/Ho_Chi_Minh";

/** Seeded value of `system_config.business_date_rollover_hour`. */
export const BUSINESS_DATE_ROLLOVER_HOUR = 4;

export interface PropertyMoment {
  /** The date the property is working, `YYYY-MM-DD`. */
  businessDate: string;
  /** The date on the wall calendar, `YYYY-MM-DD`. */
  calendarDate: string;
  /** True when the two above disagree — before rollover, after midnight. */
  beforeRollover: boolean;
  /** Wall clock in the property's zone, `HH:mm`. */
  clock: string;
  /** Hour in the property's zone, 0–23. */
  hour: number;
  /** Minute in the property's zone, 0–59. */
  minute: number;
}

const partsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: PROPERTY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  // h23 rather than the locale default: h24 reports midnight as hour 24, which
  // would put the rollover comparison on the wrong side of the boundary.
  hourCycle: "h23",
});

// The business date is a calendar triple, so it is formatted from a Date pinned
// to UTC midnight. Reading it back in the property's zone would re-apply the
// +07:00 offset to a value that has already had it applied.
const longDateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const shortDateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
  month: "long",
});

function readPart(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): number {
  const raw = parts.find((part) => part.type === type)?.value;
  const value = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);

  if (!Number.isInteger(value)) {
    throw new Error(
      `Intl did not return a numeric "${type}" for ${PROPERTY_TIME_ZONE}`,
    );
  }

  return value;
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * Everything the hero needs to say about a single instant.
 *
 * Pure: the caller supplies the instant, so the same function serves the live
 * clock and any moment somebody wants to inspect.
 */
export function propertyMomentAt(instant: Date): PropertyMoment {
  const parts = partsFormatter.formatToParts(instant);
  const year = readPart(parts, "year");
  const month = readPart(parts, "month");
  const day = readPart(parts, "day");
  const hour = readPart(parts, "hour");
  const minute = readPart(parts, "minute");

  const calendarDate = isoDate(year, month, day);
  const beforeRollover = hour < BUSINESS_DATE_ROLLOVER_HOUR;

  // Walk the calendar rather than the clock: Date.UTC normalises 1 March minus
  // a day into 28 or 29 February without a special case for either.
  const businessDay = new Date(Date.UTC(year, month - 1, day));
  if (beforeRollover) {
    businessDay.setUTCDate(businessDay.getUTCDate() - 1);
  }

  return {
    businessDate: isoDate(
      businessDay.getUTCFullYear(),
      businessDay.getUTCMonth() + 1,
      businessDay.getUTCDate(),
    ),
    calendarDate,
    beforeRollover,
    clock: `${pad(hour)}:${pad(minute)}`,
    hour,
    minute,
  };
}

function utcMidnight(isoCalendarDate: string): Date {
  const [year, month, day] = isoCalendarDate.split("-").map(Number);

  if (!year || !month || !day) {
    throw new Error(`not a YYYY-MM-DD calendar date: ${isoCalendarDate}`);
  }

  return new Date(Date.UTC(year, month - 1, day));
}

/** "Tuesday 11 August 2026". */
export function formatLongDate(isoCalendarDate: string): string {
  return longDateFormatter.format(utcMidnight(isoCalendarDate));
}

/** "11 August", for the supporting line where the year is already stated. */
export function formatShortDate(isoCalendarDate: string): string {
  return shortDateFormatter.format(utcMidnight(isoCalendarDate));
}

/** How long the property has left on this business date, as "19h 45m". */
export function timeToRollover({ hour, minute }: PropertyMoment): string {
  const minutesNow = hour * 60 + minute;
  const minutesAtRollover = BUSINESS_DATE_ROLLOVER_HOUR * 60;
  const remaining =
    minutesNow < minutesAtRollover
      ? minutesAtRollover - minutesNow
      : minutesAtRollover + 24 * 60 - minutesNow;

  return `${Math.floor(remaining / 60)}h ${pad(remaining % 60)}m`;
}

/**
 * The greeting, cut on the property's wall clock rather than the operator's.
 *
 * A receptionist on the night shift in Ho Chi Minh City is not having a morning
 * because the laptop is set to another zone.
 */
export function greetingFor({ hour }: PropertyMoment): string {
  if (hour < 12) {
    return "Good morning";
  }

  return hour < 18 ? "Good afternoon" : "Good evening";
}
