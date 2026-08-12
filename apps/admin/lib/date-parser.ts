// Reading a date the way an operator types it.
//
// Every date on the console is typed, not picked. A receptionist with a guest
// waiting does not open a calendar widget and click through to March; they type
// "15/3", or "+2d" for the night after tomorrow, or paste "2026-03-15" out of
// an email. A field that accepts one spelling and rejects the rest moves the
// cost of the format onto the person under time pressure, which is the wrong
// place for it.
//
// So this is liberal in what it accepts and exact in what it returns: any
// recognised spelling in, one `YYYY-MM-DD` out, or `null`. Never a guess — a
// date the console misreads is a guest booked into the wrong night.
//
// Two conventions are settled rather than chosen here:
//
// **Day before month, always.** "3/4" is 3 April. Vietnam writes dates that
// way, `apps/admin/lib/business-date.ts` already formats through `en-GB` for
// the same reason, and a parser that guessed by value — 3/4 as March 4th but
// 15/4 as 15 April — would be right most of the time and silently wrong for
// the twelve days a month where both readings are legal.
//
// **The reference day is the caller's.** Nothing here reads the clock. "today"
// means the property's business date, which rolls at 04:00 and is not the
// browser's calendar date at 01:30 — `business-date.ts` computes it and this
// module is handed the answer, the same way that module takes an instant.

// A Map rather than an object literal. `KEYWORDS["constructor"]` on a literal
// walks up to `Object.prototype` and finds a *function*, which then flows into
// the arithmetic below as `NaN` and comes back out as the string
// "NaN-NaN-NaN" — a return value that is neither a date nor null, from a module
// whose whole contract is that it returns one or the other. A Map has no
// prototype chain to walk.
const KEYWORDS = new Map<string, number>([
  ["today", 0],
  ["now", 0],
  ["tomorrow", 1],
  ["tmr", 1],
  ["yesterday", -1],
]);

// "+3d", "-2w". Days and weeks only: a hotel counts nights and the odd week,
// and "+1m" has no answer on 31 January that is not a house rule.
const OFFSET = /^([+-])(\d{1,3})\s*(d|w)$/;

const ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

// "15/3/2026", "15-3-26", "15.03.2026", and the same three without a year. The
// backreference is what stops "15/3-2026" — a slip, not a spelling — from being
// read as confidently as a date somebody meant.
const WRITTEN = /^(\d{1,2})([/\-.])(\d{1,2})(?:\2(\d{2}|\d{4}))?$/;

// What a fast typist or a desk scanner emits with the separators left out.
const DIGITS = /^(\d{4}|\d{8})$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }

  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function pad(value: number, width = 2): string {
  return value.toString().padStart(width, "0");
}

/**
 * A calendar triple, or null if it never existed.
 *
 * The validity check is the point: `new Date(2026, 1, 31)` rolls into 3 March
 * without complaint, so a typo'd 31 February would become a real booking on a
 * real night. Rejecting here is what makes the return type honest.
 */
function assemble(year: number, month: number, day: number): string | null {
  // Integers first, and this guard is load-bearing rather than defensive: every
  // comparison below is false for NaN, so a NaN that reached here would pass
  // each range check in turn and be formatted into "NaN-NaN-NaN". Refusing the
  // non-number closes the whole class rather than the one route that found it.
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return null;
  }

  // Four digits, so the output is always the width the return type claims. The
  // console has no first-millennium stays, but a year that formatted as "50-"
  // would be a malformed string rather than a rejected one.
  if (year < 1000 || year > 9999) {
    return null;
  }

  if (month < 1 || month > 12 || day < 1) {
    return null;
  }

  if (day > daysInMonth(year, month)) {
    return null;
  }

  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** Two digits are this century. The console has no nineteenth-century stays. */
function fullYear(raw: string): number {
  const value = Number.parseInt(raw, 10);
  return raw.length === 2 ? 2000 + value : value;
}

/**
 * The reference day as three numbers, or null if it is not a real date.
 *
 * Shape is not enough. "2026-02-30" matches the ISO pattern and `Date.UTC`
 * rolls it forward into 2 March without complaint, so counting "today" from a
 * caller's bad reference would return a confidently wrong day — the one failure
 * this module exists to prevent. Validity is decided by `assemble`, so there is
 * one calendar in the file rather than two.
 */
function readReference(
  reference: string,
): { year: number; month: number; day: number } | null {
  const parsed = ISO.exec(reference);
  if (parsed === null) {
    return null;
  }

  const year = Number.parseInt(parsed[1], 10);
  const month = Number.parseInt(parsed[2], 10);
  const day = Number.parseInt(parsed[3], 10);

  return assemble(year, month, day) === null ? null : { year, month, day };
}

function shiftDays(
  from: { year: number; month: number; day: number },
  days: number,
): string | null {
  // Walked in UTC so the arithmetic is pure calendar days: a local-zone Date
  // would cross a DST boundary in any zone that has one and land an hour off,
  // which rounds to the wrong day at the edges.
  const at = new Date(Date.UTC(from.year, from.month - 1, from.day));
  at.setUTCDate(at.getUTCDate() + days);

  return assemble(at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate());
}

/**
 * Reads whatever the operator typed into `YYYY-MM-DD`, or null.
 *
 * `reference` is the day relative expressions count from, as `YYYY-MM-DD` —
 * the property's business date, from `business-date.ts`. It is required rather
 * than defaulted to the system clock so that a screen cannot accidentally
 * resolve "today" against the wrong day during the small hours.
 *
 * Accepted:
 *
 * | Typed | Means |
 * |---|---|
 * | `today`, `now`, `tomorrow`, `tmr`, `yesterday` | relative to `reference` |
 * | `+3d`, `-2d`, `+1w`, `-2w` | days or weeks from `reference` |
 * | `2026-03-15` | as written |
 * | `15/3/2026`, `15-3-26`, `15.03.2026` | day first |
 * | `15/3`, `15.03` | day first, `reference`'s year |
 * | `1503`, `15032026` | the same, separators omitted |
 *
 * Not for a date of birth. Every two-digit year here resolves to this century,
 * because every date this parser was written for is a stay date: "15/3/26" at
 * a front desk is 2026. On the registration card's birth date the same rule
 * turns a guest born in 1985 into one born in 2085, confidently and without
 * complaint. A birth date field needs its own reading of a two-digit year, or
 * no two-digit year at all.
 */
export function parseLiberalDate(
  input: string,
  reference: string,
): string | null {
  const text = input.trim().toLowerCase();

  if (text === "") {
    return null;
  }

  // Every branch below needs the reference: the relative ones count from it and
  // the partial ones borrow its year. Reading it once, up front, is also what
  // makes a bad reference a null rather than a wrong date.
  const from = readReference(reference);
  if (from === null) {
    return null;
  }

  const keyword = KEYWORDS.get(text);
  if (keyword !== undefined) {
    return shiftDays(from, keyword);
  }

  const offset = OFFSET.exec(text);
  if (offset !== null) {
    const magnitude =
      Number.parseInt(offset[2], 10) * (offset[3] === "w" ? 7 : 1);
    return shiftDays(from, offset[1] === "-" ? -magnitude : magnitude);
  }

  const iso = ISO.exec(text);
  if (iso !== null) {
    return assemble(
      Number.parseInt(iso[1], 10),
      Number.parseInt(iso[2], 10),
      Number.parseInt(iso[3], 10),
    );
  }

  const written = WRITTEN.exec(text);
  if (written !== null) {
    return assemble(
      written[4] === undefined ? from.year : fullYear(written[4]),
      Number.parseInt(written[3], 10),
      Number.parseInt(written[1], 10),
    );
  }

  const digits = DIGITS.exec(text);
  if (digits !== null) {
    const run = digits[1];
    return assemble(
      run.length === 8 ? fullYear(run.slice(4)) : from.year,
      Number.parseInt(run.slice(2, 4), 10),
      Number.parseInt(run.slice(0, 2), 10),
    );
  }

  return null;
}
