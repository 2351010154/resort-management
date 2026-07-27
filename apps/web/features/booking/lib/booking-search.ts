// `/booking`'s entire state, as search params.
//
// `repository-structure.md` is explicit that this route is stateless and its
// state is the query string, so it is shareable and a marketing call to action
// can link straight into a date range. Resy does the same thing and rewrites the
// URL on load, which is what makes its no-availability page linkable.
//
// So this module is the only place that knows the param names, and it is a codec
// in both directions: the page reads a URL into a search, and every control
// writes a search back into a URL. Two separate readers would drift the first
// time a param was renamed.
//
// A date that will not parse is dropped rather than defaulted. A guest arriving
// on `?from=garbage` should see the screen asking for dates, not a silently
// invented stay they did not choose.

import { type CalendarDate, parseDate } from "@internationalized/date";
import {
  nightCount,
  type RatePlanCode,
  type StayDate,
  type StayRange,
} from "@mariva/shared";
import type { Child, Party } from "./stay-quote";

const PARAM = {
  from: "from",
  to: "to",
  adults: "adults",
  /** Comma-separated child ages. Ages, not a count — see below. */
  childAges: "ages",
  plan: "plan",
} as const;

export const DEFAULT_PLAN: RatePlanCode = "STANDARD";

/** The most a party can be, across every type — `property-and-tariff.md` §1. */
export const MAX_PARTY = 4;
export const MAX_ADULTS = 4;
export const MAX_CHILDREN = 3;
/** Old enough to count as an adult is old enough to be booked as one — §3. */
export const MAX_CHILD_AGE = 11;

export interface BookingSearch {
  /** Both or neither. A half-open range prices nothing, so it is not a range. */
  readonly range: StayRange | null;
  readonly party: Party;
  readonly plan: RatePlanCode;
}

function parseStayDate(raw: string | null): StayDate | null {
  if (!raw) return null;
  try {
    return parseDate(raw);
  } catch {
    return null;
  }
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function parseCount(
  raw: string | null,
  fallback: number,
  high: number,
): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isNaN(parsed) ? fallback : clamp(parsed, 0, high);
}

/**
 * Child ages, not a child count.
 *
 * §3 prices under-6 free, 6–11 at half the extra-person rate and 12-plus as an
 * adult, so an age changes the total. A number that changes the price cannot be
 * collected later, and it cannot be carried in a URL as a count either — a
 * shared link that loses the ages re-prices itself on arrival.
 */
function parseChildren(raw: string | null): Child[] {
  if (!raw) return [];

  return raw
    .split(",")
    .slice(0, MAX_CHILDREN)
    .map((part) => Number.parseInt(part, 10))
    .filter((age) => !Number.isNaN(age))
    .map((age) => ({ age: clamp(age, 0, MAX_CHILD_AGE) }));
}

function parsePlan(raw: string | null): RatePlanCode {
  return raw === "BB" || raw === "NONREF" || raw === "STANDARD"
    ? raw
    : DEFAULT_PLAN;
}

export function readBookingSearch(params: URLSearchParams): BookingSearch {
  const checkIn = parseStayDate(params.get(PARAM.from));
  const checkOut = parseStayDate(params.get(PARAM.to));

  return {
    // Ordered, or it is not a stay. `?from=12&to=10` is a typo, not a request to
    // swap them — swapping would quote a stay the link never asked for.
    range:
      checkIn && checkOut && checkIn.compare(checkOut) < 0
        ? { checkIn, checkOut }
        : null,
    party: {
      adults: Math.max(1, parseCount(params.get(PARAM.adults), 2, MAX_ADULTS)),
      children: parseChildren(params.get(PARAM.childAges)),
    },
    plan: parsePlan(params.get(PARAM.plan)),
  };
}

/**
 * A search as a query string, in a stable key order.
 *
 * Stable so that two identical searches produce one URL and the browser's
 * history does not fill with permutations of the same page. Defaults are omitted
 * rather than written out, so the shortest link that means something is the one
 * a guest gets asked to share.
 */
export function writeBookingSearch(search: BookingSearch): string {
  const params = new URLSearchParams();

  if (search.range) {
    params.set(PARAM.from, search.range.checkIn.toString());
    params.set(PARAM.to, search.range.checkOut.toString());
  }
  if (search.party.adults !== 2) {
    params.set(PARAM.adults, String(search.party.adults));
  }
  if (search.party.children.length > 0) {
    params.set(
      PARAM.childAges,
      search.party.children.map((child) => child.age).join(","),
    );
  }
  if (search.plan !== DEFAULT_PLAN) {
    params.set(PARAM.plan, search.plan);
  }

  const query = params.toString();
  return query ? `?${query}` : "";
}

/**
 * The stay, as the search band says it: "10–12 Aug · 2 nights".
 *
 * Formatted with an explicit property time zone. Never `new Date(iso)` and never
 * a local format of a bare date string — a browser at UTC+9 parsing "2026-08-10"
 * and formatting locally renders the ninth, silently, for exactly the guests
 * most likely to book a resort in Vietnam.
 */
export function formatStayDates(
  range: StayRange,
  locale = "en-GB",
): { readonly dates: string; readonly nights: string } {
  const sameMonth =
    range.checkIn.month === range.checkOut.month &&
    range.checkIn.year === range.checkOut.year;

  const dayOnly = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    timeZone: "UTC",
  });
  const dayAndMonth = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });

  // "UTC" is safe here and only here: a CalendarDate converted at UTC midnight
  // formats as itself, which is the point — no zone arithmetic is wanted, the
  // date is already the property's.
  const start = (sameMonth ? dayOnly : dayAndMonth).format(
    range.checkIn.toDate("UTC"),
  );
  const end = dayAndMonth.format(range.checkOut.toDate("UTC"));

  const nights = nightCount(range);
  return {
    dates: `${start} – ${end}`,
    nights: nights === 1 ? "1 night" : `${nights} nights`,
  };
}

/** A single date, spelled out: "10 August 2026". For an accessible name. */
export function formatStayDate(date: CalendarDate, locale = "en-GB"): string {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date.toDate("UTC"));
}
