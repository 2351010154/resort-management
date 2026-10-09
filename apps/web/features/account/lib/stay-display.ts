// How a stay's nights and party are written on the guest's own screens.
//
// Two screens say it now — the stays list on every line, and the profile under
// the guest's next stay — and two copies of a date format are two places a
// guest can be told different days. So the wording lives here, beside
// `stay-history.ts`, which decides *which* stays a screen shows; this decides
// how one is written.

import type { CalendarDate } from "@internationalized/date";

/**
 * The formatter every stay date on the account goes through.
 *
 * "UTC" is safe here and only here: a `CalendarDate` converted at UTC midnight
 * formats as itself, which is the point. A browser at UTC+9 parsing the ISO
 * text and formatting locally renders the day before, silently, for exactly
 * the guests most likely to book a resort in Vietnam.
 */
const DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** "19 August 2026" — the property's own date, never the browser's instant. */
export function longDate(date: CalendarDate): string {
  return DAY.format(date.toDate("UTC"));
}

/**
 * "13 to 16 October 2026", "28 April to 2 May 2027".
 *
 * A month or a year shared by both ends is said once — the way a person writes
 * a stay down — and twice only when the stay crosses it. Joined with "to"
 * rather than a dash: the account sets its dates as a sentence, not as a
 * range glyph, and the platform's own `formatRange` answers with a dash.
 */
export function longDateRange(
  checkIn: CalendarDate,
  checkOut: CalendarDate,
): string {
  if (checkIn.year !== checkOut.year) {
    return `${longDate(checkIn)} to ${longDate(checkOut)}`;
  }

  if (checkIn.month !== checkOut.month) {
    return `${checkIn.day} ${MONTH.format(checkIn.toDate("UTC"))} to ${longDate(checkOut)}`;
  }

  return `${checkIn.day} to ${longDate(checkOut)}`;
}

/** A month on its own — "April" — at the same UTC as `DAY`. */
const MONTH = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  timeZone: "UTC",
});

/**
 * How far off an arrival is, said the way a person would: "Arriving
 * tomorrow", "In 5 days", "In 3 weeks", "In 7 months".
 *
 * Days while they are worth counting, then weeks, then months — "in 203 days"
 * is a number a guest has to divide before it means anything. Both dates are
 * the property's calendar days, so the count is the property's too.
 */
export function untilArrival(
  today: CalendarDate,
  checkIn: CalendarDate,
): string {
  // `compare` answers the distance in days between two calendar dates.
  const days = checkIn.compare(today);

  if (days <= 0) {
    return "Arriving today";
  }

  if (days === 1) {
    return "Arriving tomorrow";
  }

  if (days < 14) {
    return `In ${days} days`;
  }

  if (days < 63) {
    return `In ${Math.round(days / 7)} weeks`;
  }

  return `In ${Math.round(days / 30.44)} months`;
}

/**
 * "2 adults", "2 adults and 1 child" — who a stay is for, as a phrase.
 *
 * It is the value beside a "Guests" label, so it is said the way a person says
 * a party, joined with "and" — never run together with the nights and the plan
 * behind a separator glyph. Children are left out rather than printed as a
 * zero: "0 children" is a fact about a form field and not about a stay, and
 * most stays have none.
 */
export function partyLine(adults: number, children: number): string {
  const grown = adults === 1 ? "1 adult" : `${adults} adults`;

  if (children === 0) {
    return grown;
  }

  return `${grown} and ${children === 1 ? "1 child" : `${children} children`}`;
}
