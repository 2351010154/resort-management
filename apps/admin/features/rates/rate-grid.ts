/* The rate grid's decisions: what a cell says, what a drag selects, who may
 * edit, and exactly what goes on the wire.
 *
 * Pure, and separate from the hooks and the markup beside it, for the reason
 * `features/rooms/room-list.ts` gives about its own screen: everything below is
 * a judgement the API does not make for the console — which nights are on
 * screen, whether a night is unpriced or merely unrestricted, what a span of
 * cells means once the operator lets go of the mouse, how few calls that span
 * costs, and which of the two pricing rows of the matrix an operator holds.
 *
 * Four rules hold throughout, and `rate-grid.spec.ts` holds this file to them:
 *
 * 1. **An unpublished night is not a sold-out night.** `contract/pricing.ts`
 *    says this is the whole reason the staff calendar exists as its own
 *    contract: the guest-facing calendar renders a night with no row as
 *    unavailable, and a manager looking at the same month needs to read it as
 *    *unpriced*. So {@link rateCell} carries `isPublished` as its own fact,
 *    never a price of zero and never an availability claim, and the grid draws
 *    the two differently.
 * 2. **A season is one edit.** `docs/screens.md` §"Staff surfaces" asks for
 *    range selection "so a weekend uplift or a Tết season is one edit rather
 *    than fourteen". `setRateCalendarInput` and `setStayRestrictionsInput` each
 *    take one room type and an inclusive night range, so the floor is one call
 *    per selected type however many nights the span covers —
 *    {@link priceEdit} and {@link restrictionEdit} build exactly that many and
 *    no more.
 * 3. **Money is an integer count of đồng, and nothing here divides.**
 *    `packages/shared/src/money.ts` makes the argument; what this file adds is
 *    that the figure an operator types is read as a whole number of đồng or
 *    refused, never coerced through a float. The only rounding in sight is
 *    `formatVndThousands`, which is display and is named as such.
 * 4. **A control an operator cannot use is not offered.** The four predicates
 *    below mirror two rows of `docs/architecture/rbac-matrix.md` §3, and
 *    neither is a wall — the API's capability guard is. What they decide is
 *    whether the console shows a manager's edit to a receptionist who would
 *    read a 403 for pressing it.
 *
 * The rows come from `ROOM_TYPE_CODES` rather than from a read. There is no
 * room-type route in the contract at all — `features/rooms/room-list.ts` says
 * the same about its own groups — and the five codes are the Postgres enum, so
 * the compile-time tuple *is* the catalogue rather than a guess at one.
 */

import type { ApiClient } from "@mariva/api-client";
import {
  formatVnd,
  formatVndThousands,
  isUnrestricted,
  updateRatePlanInput as planPatchSchema,
  ROOM_TYPE_CODES,
  type RoomTypeCode,
  setRateCalendarInput as rateWriteSchema,
  setStayRestrictionsInput as restrictionWriteSchema,
  type StaffRole,
} from "@mariva/shared";

/* `shiftDate` is taken from the module that owns it rather than through
 * `features/dashboard`'s barrel, which re-exports client components — the
 * argument `features/bookings/booking-search.ts` makes about reaching past a
 * barrel for the same function. */
import { shiftDate } from "@/features/dashboard/day-counts";
import { formatShortDate } from "@/lib/business-date";

/* The wire shapes, read off the client rather than restated: `@mariva/shared`
 * types the client from the contract's own schemas, so a field renamed there
 * breaks this file in the pull request that renamed it — where a hand-written
 * interface would compile until it was wrong. */
export type RatePlan = Awaited<
  ReturnType<ApiClient["pricing"]["listRatePlans"]>
>["plans"][number];
export type CalendarNight = Awaited<
  ReturnType<ApiClient["pricing"]["readRateCalendar"]>
>["nights"][number];
export type StayRestriction = Awaited<
  ReturnType<ApiClient["pricing"]["readStayRestrictions"]>
>["restrictions"][number];
export type PricingRangeQuery = Parameters<
  ApiClient["pricing"]["readRateCalendar"]
>[0];
export type SetRateCalendarInput = Parameters<
  ApiClient["pricing"]["setRateCalendar"]
>[0];
export type SetStayRestrictionsInput = Parameters<
  ApiClient["pricing"]["setStayRestrictions"]
>[0];
export type UpdateRatePlanInput = Parameters<
  ApiClient["pricing"]["updateRatePlan"]
>[0];

// ── Who is offered what ────────────────────────────────────────────────────

/**
 * Who may read the calendar and the plans — the matrix's
 * `pricing.rate-plans` row, which gives `RECEPTIONIST` and `ACCOUNTANT` 👁 and
 * `MANAGER` and `ADMIN` ✅.
 *
 * The housekeeper is the one staff role denied it, and that is the same line
 * `nav-inventory.ts` already draws by listing this family for `LEDGER`: a
 * corridor does not need to know what a night costs.
 */
export function mayReadRates(role: StaffRole): boolean {
  return (
    role === "RECEPTIONIST" ||
    role === "ACCOUNTANT" ||
    role === "MANAGER" ||
    role === "ADMIN"
  );
}

/** Who is offered a price edit — the same row at ✅, which is management only,
 *  because what a night costs is a commercial decision. */
export function mayEditRates(role: StaffRole): boolean {
  return role === "MANAGER" || role === "ADMIN";
}

/**
 * Who may read stay restrictions — `pricing.stay-restrictions`, a narrower row
 * than the one above.
 *
 * The accountant is absent, and `stay-restriction.controller.ts` says why: a
 * minimum stay is a rule about what the property will sell and never a figure
 * that appears on an invoice. So an accountant reads the grid's prices and the
 * grid says its rules are not theirs to see, rather than asking for a read that
 * would answer 403 on every window.
 */
export function mayReadRestrictions(role: StaffRole): boolean {
  return role === "RECEPTIONIST" || role === "MANAGER" || role === "ADMIN";
}

/** Who is offered a restriction edit — the same row at ✅. */
export function mayEditRestrictions(role: StaffRole): boolean {
  return role === "MANAGER" || role === "ADMIN";
}

// ── The nights on screen ───────────────────────────────────────────────────

/**
 * How many nights the grid holds at once.
 *
 * Four weeks, so every column of the grid is the same weekday as the column
 * four to its left — which is what makes a weekend pattern legible at a glance
 * and is the reason a rate grid is the industry's mental model in the first
 * place. Well inside the 400 nights one write may cover, so no span an operator
 * can draw on screen is a span the contract refuses for its length.
 */
export const WINDOW_NIGHTS = 28;

/** The nights one screenful covers, as the contract's inclusive pair and as the
 *  columns drawn from it. */
export interface NightWindow {
  /** The first night on screen. */
  readonly from: string;
  /** The last night on screen — inclusive, which is `nightRangeFields`' own
   *  convention and not the half-open range a stay uses. */
  readonly to: string;
  readonly dates: readonly string[];
}

/**
 * A window of nights beginning on an ISO date.
 *
 * Both ends are inclusive because that is what `contract/pricing.ts` declares
 * and argues for: a manager pricing Christmas week names the first night and
 * the last night they are pricing, where a half-open range would make them name
 * a date they are not editing.
 */
export function nightWindow(from: string, nights = WINDOW_NIGHTS): NightWindow {
  const dates: string[] = [];

  for (let offset = 0; offset < Math.max(nights, 1); offset += 1) {
    dates.push(shiftDate(from, offset));
  }

  return { from, to: dates[dates.length - 1], dates };
}

/** The window `steps` screenfuls either side of this one, keeping its length. */
export function shiftWindow(window: NightWindow, steps: number): NightWindow {
  return nightWindow(
    shiftDate(window.from, steps * window.dates.length),
    window.dates.length,
  );
}

/** One column heading: the night, and enough of a calendar to place it. */
export interface NightColumn {
  readonly date: string;
  /** Day of the month, unpadded — "1", "16". */
  readonly dayLabel: string;
  /** "Mon", in the property's own reading order beside the day. */
  readonly weekdayLabel: string;
  /**
   * The month, on the first column and again wherever one begins. Null
   * elsewhere: repeating "Aug" twenty-eight times is noise, and printing it
   * nowhere leaves a grid whose columns could be any month of the year.
   */
  readonly monthLabel: string | null;
  /** Saturday or Sunday. The weekend uplift `screens.md` names is the reason
   *  the grid marks them at all. */
  readonly isWeekend: boolean;
}

/* Read at UTC midnight rather than in the property's zone, the reading
 * `business-date.ts` uses for a calendar triple: the value has no time in it,
 * and interpreting it in a +07:00 zone would re-apply an offset that was never
 * applied. */
const columnFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  weekday: "short",
  month: "short",
});

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function utcMidnight(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);

  if (!year || !month || !day) {
    throw new Error(`not a YYYY-MM-DD calendar date: ${isoDate}`);
  }

  return new Date(Date.UTC(year, month - 1, day));
}

function readPart(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): string {
  return parts.find((part) => part.type === type)?.value ?? "";
}

/** The headings for a window's nights, with a month named where one starts. */
export function nightColumns(dates: readonly string[]): NightColumn[] {
  return dates.map((date, index) => {
    const moment = utcMidnight(date);
    const parts = columnFormatter.formatToParts(moment);
    const weekday = moment.getUTCDay();
    const day = moment.getUTCDate();

    return {
      date,
      dayLabel: String(day),
      weekdayLabel: readPart(parts, "weekday"),
      monthLabel: index === 0 || day === 1 ? readPart(parts, "month") : null,
      isWeekend: weekday === 0 || weekday === 6,
    };
  });
}

/**
 * Nights from one date to another with both ends counted.
 *
 * The inclusive twin of `nightCount`, which measures the half-open range a stay
 * occupies. Walked at UTC midnight for `shiftDate`'s reason, and it is a count
 * of days rather than a subtraction of indices because a selection's two ends
 * are dates the operator clicked and not positions in an array — the window can
 * have moved under them.
 */
export function inclusiveNights(from: string, to: string): number {
  return (
    Math.round(
      (utcMidnight(to).getTime() - utcMidnight(from).getTime()) / MS_PER_DAY,
    ) + 1
  );
}

// ── One cell ───────────────────────────────────────────────────────────────

/** What a night with no row is drawn as. Not a zero and not a dash borrowed
 *  from the sold-out state — the property has not said what this night costs. */
export const UNPUBLISHED_MARK = "—";

/** One (type, night) of the grid, and the whole of what the cell may say. */
export interface RateCell {
  readonly roomType: RoomTypeCode;
  readonly date: string;
  /** Whole đồng, or null on a night the property has not published. */
  readonly grossPerNight: bigint | null;
  /**
   * Whether the property has published a price for this night.
   *
   * Its own field rather than `grossPerNight !== null` at each call site,
   * because the distinction it carries is the one thing this screen exists to
   * show and a screen that re-derived it would eventually derive it wrong.
   */
  readonly isPublished: boolean;
  /** Thousands of đồng, the unit stated once in the grid's legend rather than
   *  twenty-eight times in type too small to read. */
  readonly priceLabel: string;
  /** The night's rule, or null — both for a night with no rule and for an
   *  operator not offered the restrictions row. The row says which. */
  readonly restriction: StayRestriction | null;
  /** The rules inside the cell's own footprint — "3+", "≤5", "CTA", "CTD". */
  readonly restrictionMarks: readonly string[];
  /** The cell in one sentence, for its title and for a screen reader. */
  readonly cellLabel: string;
}

/**
 * The rules on a night, spelled out.
 *
 * A minimum of one is not printed: every returned row carries a minimum, and
 * `1` is the unrestricted value — a rule row exists at a minimum of one only
 * because one of the other three fields is set, and saying "minimum stay 1
 * night" would dress the absence of a rule up as one.
 */
export function restrictionSentence(
  rule: StayRestriction | null,
): string | null {
  if (rule === null) {
    return null;
  }

  const said: string[] = [];

  if (rule.minimumStay > 1) {
    said.push(`Minimum stay ${rule.minimumStay} nights`);
  }

  if (rule.maximumStay !== null) {
    said.push(`Maximum stay ${rule.maximumStay} nights`);
  }

  if (rule.closedToArrival) {
    said.push("Closed to arrival");
  }

  if (rule.closedToDeparture) {
    said.push("Closed to departure");
  }

  return said.length === 0 ? null : said.join(". ");
}

/** The same rules in the abbreviations a rate grid is read in. */
export function restrictionMarks(
  rule: StayRestriction | null,
): readonly string[] {
  if (rule === null) {
    return [];
  }

  const marks: string[] = [];

  if (rule.minimumStay > 1) {
    marks.push(`${rule.minimumStay}+`);
  }

  if (rule.maximumStay !== null) {
    marks.push(`≤${rule.maximumStay}`);
  }

  if (rule.closedToArrival) {
    marks.push("CTA");
  }

  if (rule.closedToDeparture) {
    marks.push("CTD");
  }

  return marks;
}

/**
 * One cell, from the night the calendar answered and the rule beside it.
 *
 * The price crosses into the label through `formatVndThousands` and nowhere
 * else: the amount itself stays the `bigint` the contract sent, so nothing
 * downstream can add a displayed figure to another one.
 */
export function rateCell(
  roomType: RoomTypeCode,
  date: string,
  night: CalendarNight | undefined,
  rule: StayRestriction | null,
): RateCell {
  const gross = night?.grossPerNight ?? null;
  const rules = restrictionSentence(rule);
  const priced = gross === null ? "not published" : formatVnd(gross);

  return {
    roomType,
    date,
    grossPerNight: gross,
    isPublished: gross !== null,
    priceLabel: gross === null ? UNPUBLISHED_MARK : formatVndThousands(gross),
    restriction: rule,
    restrictionMarks: restrictionMarks(rule),
    cellLabel: `${roomType}, ${formatShortDate(date)} — ${priced}${
      rules === null ? "" : `. ${rules}`
    }`,
  };
}

// ── A row, and the grid ────────────────────────────────────────────────────

/** What the calendar read for one type answered. */
export interface CalendarAnswer {
  readonly failed: boolean;
  readonly nights: readonly CalendarNight[] | undefined;
}

/** What the restriction read for one type answered. */
export interface RestrictionAnswer {
  readonly failed: boolean;
  readonly restrictions: readonly StayRestriction[] | undefined;
}

/** One type's two reads, as the grid takes them. */
export interface TypeAnswer {
  readonly roomType: RoomTypeCode;
  readonly calendar: CalendarAnswer;
  /** Null for an operator the matrix does not offer `pricing.stay-restrictions`.
   *  Distinct from a read that failed, which is a `RestrictionAnswer` saying so:
   *  one is a permission and the other is an outage. */
  readonly restrictions: RestrictionAnswer | null;
}

export type RowStatus = "pending" | "failed" | "ready";

/** One room type's nights. */
export interface RateRow {
  readonly roomType: RoomTypeCode;
  readonly status: RowStatus;
  /** Empty unless the prices are on screen. A row drawn from nothing would
   *  read as a type the property never prices. */
  readonly cells: readonly RateCell[];
  /**
   * The prices are here and the rules beside them are not — a restriction read
   * still in flight or failed, never one this operator is not offered. Without
   * it an outage would draw every night of the row as unrestricted, which is a
   * claim about what the property will sell.
   */
  readonly rulesUnread: boolean;
}

/** The grid as the screen draws it. */
export interface RateGridView {
  readonly columns: readonly NightColumn[];
  readonly rows: readonly RateRow[];
  /** `pending` until some row has prices, `failed` when none of them will. */
  readonly status: RowStatus;
}

/**
 * The grid, from one window of nights and one answer per type.
 *
 * Every night of the window gets a cell whether the calendar mentioned it or
 * not: `readRateCalendar` returns "every night of the requested range, gaps
 * included", but the row is built from the window rather than from the response
 * so a short answer draws unpublished nights rather than a narrower row that
 * would silently mis-align with the headings above it.
 *
 * Restrictions arrive as only the nights that carry one — the table stores no
 * row for a night that constrains nothing — so they are indexed and looked up,
 * and a night with no entry has no rule.
 */
export function rateGrid(
  window: NightWindow,
  answers: readonly TypeAnswer[],
): RateGridView {
  const rows = answers.map((answer) => rateRow(window, answer));

  return {
    columns: nightColumns(window.dates),
    rows,
    status: gridStatus(rows),
  };
}

function rateRow(window: NightWindow, answer: TypeAnswer): RateRow {
  const { roomType, calendar, restrictions } = answer;
  const rulesUnread =
    restrictions !== null &&
    (restrictions.failed || restrictions.restrictions === undefined);

  if (calendar.failed) {
    return { roomType, status: "failed", cells: [], rulesUnread };
  }

  if (calendar.nights === undefined) {
    return { roomType, status: "pending", cells: [], rulesUnread };
  }

  const nights = new Map(calendar.nights.map((night) => [night.date, night]));
  const rules = new Map(
    (restrictions?.restrictions ?? []).map((rule) => [rule.date, rule]),
  );

  return {
    roomType,
    status: "ready",
    cells: window.dates.map((date) =>
      rateCell(roomType, date, nights.get(date), rules.get(date) ?? null),
    ),
    rulesUnread,
  };
}

function gridStatus(rows: readonly RateRow[]): RowStatus {
  if (rows.some((row) => row.status === "ready")) {
    return "ready";
  }

  return rows.length > 0 && rows.every((row) => row.status === "failed")
    ? "failed"
    : "pending";
}

/**
 * The types whose prices or whose rules are not on screen.
 *
 * The grid reports its own failures rather than leaving them to the central
 * toast, and `rates-queries.ts` says why at length: the read is a fan-out of
 * one question across five types, so an API that is down would raise a column
 * of ten identical toasts over the work. Named here so the sentence the screen
 * says is derived once and can be held to a spec.
 */
export function unreadTypes(rows: readonly RateRow[]): {
  readonly prices: readonly RoomTypeCode[];
  readonly rules: readonly RoomTypeCode[];
} {
  return {
    prices: rows
      .filter((row) => row.status === "failed")
      .map((row) => row.roomType),
    rules: rows
      .filter((row) => row.status !== "failed" && row.rulesUnread)
      .map((row) => row.roomType),
  };
}

// ── Selecting a span ───────────────────────────────────────────────────────

/** One cell, named by the two things that identify it. */
export interface CellRef {
  readonly roomType: RoomTypeCode;
  readonly date: string;
}

/** A selection as the operator made it: where they started and where they are
 *  now. Kept in that form rather than normalised so extending backwards from
 *  the anchor works without the anchor moving under them. */
export interface RateSelection {
  readonly anchor: CellRef;
  readonly focus: CellRef;
}

/** The same selection normalised — the block an edit will be applied to. */
export interface SelectionSpan {
  /** A contiguous run of `ROOM_TYPE_CODES`, in the product's own order. */
  readonly roomTypes: readonly RoomTypeCode[];
  readonly from: string;
  readonly to: string;
  /** Nights the span is wide, both ends counted. */
  readonly nights: number;
  /** Nights the span covers in total — the rows it will actually write. */
  readonly cells: number;
}

/**
 * The block a selection covers, whichever corner it was drawn from.
 *
 * The types are a contiguous slice of `ROOM_TYPE_CODES` rather than the two
 * that were clicked, because the grid's rows are in that fixed order on every
 * screen of the product and a rectangle is what a drag across them means. The
 * dates are compared as text, which is exact for `YYYY-MM-DD`: fixed-width
 * fields in descending significance sort lexicographically the same way they
 * sort chronologically.
 */
export function selectionSpan(selection: RateSelection): SelectionSpan {
  const first = ROOM_TYPE_CODES.indexOf(selection.anchor.roomType);
  const last = ROOM_TYPE_CODES.indexOf(selection.focus.roomType);
  const roomTypes = ROOM_TYPE_CODES.slice(
    Math.min(first, last),
    Math.max(first, last) + 1,
  );

  const [from, to] =
    selection.anchor.date <= selection.focus.date
      ? [selection.anchor.date, selection.focus.date]
      : [selection.focus.date, selection.anchor.date];

  const nights = inclusiveNights(from, to);

  return { roomTypes, from, to, nights, cells: nights * roomTypes.length };
}

/** Whether a cell is inside the span. */
export function isSelected(
  span: SelectionSpan | null,
  roomType: RoomTypeCode,
  date: string,
): boolean {
  if (span === null) {
    return false;
  }

  return (
    span.roomTypes.includes(roomType) && span.from <= date && date <= span.to
  );
}

/* The two axes of the grid, as one string.
 *
 * The roving group tracks its members by a single value — `roving-focus.tsx`
 * argues for a value over an index, because a list re-sorts under the operator
 * — so a cell of a two-dimensional grid has to name both of its coordinates in
 * one. A colon separates them because neither half can contain one: a room type
 * is an enum of capitals and underscores, and a date is nine digits and two
 * hyphens.
 */
const CELL_KEY_SEPARATOR = ":";

/** The value the roving group knows one cell by. */
export function cellKey(cell: CellRef): string {
  return `${cell.roomType}${CELL_KEY_SEPARATOR}${cell.date}`;
}

/** The cell behind a roving value, or null when it is not one. */
export function parseCellKey(value: string | undefined): CellRef | null {
  const [roomType, date, ...rest] = (value ?? "").split(CELL_KEY_SEPARATOR);

  if (rest.length > 0 || date === undefined) {
    return null;
  }

  const known = ROOM_TYPE_CODES.find((code) => code === roomType);

  return known === undefined ? null : { roomType: known, date };
}

/**
 * The same night one row up or down — the arrow movement the roving group has
 * no geometry for.
 *
 * `lib/keyboard/roving-geometry.ts` steps through a flat list, which is right
 * for every other list in the console and is not a grid: down from a Tuesday in
 * `DELUXE` has to be the same Tuesday in `PREMIER`, and one step through the
 * members in document order would be Wednesday. So the group keeps the
 * horizontal axis, which is a flat walk along a row, and this answers the
 * vertical one.
 *
 * `rows` is the types actually drawn rather than `ROOM_TYPE_CODES`, so a type
 * whose prices failed to load is not a row the arrows stop on. Null at either
 * edge: clamping would silently swallow the press, and wrapping from the last
 * type to the first is disorienting on an axis the operator reads as a list.
 */
export function verticalNeighbour(
  rows: readonly RoomTypeCode[],
  from: CellRef,
  step: number,
): CellRef | null {
  const index = rows.indexOf(from.roomType);
  const target = index + step;

  if (index === -1 || target < 0 || target >= rows.length) {
    return null;
  }

  return { roomType: rows[target], date: from.date };
}

/**
 * The selection after a press on a cell.
 *
 * `extending` is the shift key, which reaches this the same way from a mouse
 * and from a keyboard: Shift+Enter on a focused cell raises a click carrying
 * `shiftKey`, so the grid needs no second binding to be operable without a
 * pointer — and none that would fight the roving group for the arrow keys.
 *
 * Extending with nothing selected anchors instead of throwing away the press.
 */
export function extendSelection(
  selection: RateSelection | null,
  cell: CellRef,
  extending: boolean,
): RateSelection {
  return extending && selection !== null
    ? { anchor: selection.anchor, focus: cell }
    : { anchor: cell, focus: cell };
}

/** The span in the words the panel above the forms uses. */
export function spanLabel(span: SelectionSpan): string {
  const nights = `${span.nights} ${span.nights === 1 ? "night" : "nights"}`;
  const types =
    span.roomTypes.length === 1
      ? span.roomTypes[0]
      : `${span.roomTypes.length} room types`;

  return `${types} · ${nights} · ${formatShortDate(span.from)} to ${formatShortDate(span.to)}`;
}

// ── Reading a figure an operator typed ─────────────────────────────────────

/* Grouped or bare, and grouped means groups of three. "1.850.000" and
 * "1,850,000" are the same figure — Vietnamese writes the first — and both are
 * read as whole đồng. What this deliberately refuses is "1.5": a manager who
 * means one and a half million would otherwise be given fifteen đồng, which the
 * contract accepts because it is positive and nobody would notice until a guest
 * paid it. A separator here has to be followed by exactly three digits or the
 * figure is not one. */
const GROUPED_DONG = /^\d{1,3}(?:[.,\u00A0\u202F ]\d{3})*$/;
const BARE_DONG = /^\d+$/;

/**
 * A whole number of đồng, or null when what was typed is not one.
 *
 * `bigint` throughout — `money.ts` chose the type so an amount cannot be added
 * to a count or a percentage without the compiler saying so, and parsing
 * through `Number` here would give that up at the one boundary where a human
 * supplies the figure.
 */
export function parseDong(typed: string): bigint | null {
  const trimmed = typed.trim();

  if (!GROUPED_DONG.test(trimmed) && !BARE_DONG.test(trimmed)) {
    return null;
  }

  return BigInt(trimmed.replaceAll(/[.,\u00A0\u202F ]/g, ""));
}

/** A whole count — a stay length, a percent — or null. */
function parseWhole(typed: string): number | null {
  const trimmed = typed.trim();

  if (!/^[+-]?\d+$/.test(trimmed)) {
    return null;
  }

  return Number.parseInt(trimmed, 10);
}

// ── The price edit ─────────────────────────────────────────────────────────

/** Either the calls one price edit costs, or the sentence saying why it is not
 *  an edit yet. */
export type RateCalendarEdit =
  | {
      readonly calls: readonly SetRateCalendarInput[];
      /** Nights the edit writes across every selected type. */
      readonly nights: number;
    }
  | { readonly problem: string };

/**
 * One price across a span, as the fewest calls the contract permits.
 *
 * One call per selected room type and one however wide the span is, because
 * `setRateCalendarInput` takes a room type and a night range: a Tết season
 * across every type is five requests, and the same season priced per night
 * would be a hundred and forty. `contract/pricing.ts` argues for why one price
 * per call is the right unit — a week of differing prices is a call per band,
 * which is how the prices were decided in the first place.
 *
 * The contract's own schema is run here rather than restated, so a bound
 * changed in `packages/shared/src/contract/pricing.ts` cannot drift from what
 * this form enforces — and what is *sent* is the typed input rather than the
 * decoded output, because a `CalendarDate` is a shape for a service to hold and
 * not one to put on the wire.
 */
export function priceEdit(
  span: SelectionSpan,
  typed: string,
): RateCalendarEdit {
  const gross = parseDong(typed);

  if (gross === null) {
    return {
      problem:
        "A price is a whole number of đồng — 1850000, or 1.850.000. There is no minor unit to type.",
    };
  }

  const calls: SetRateCalendarInput[] = [];

  for (const roomType of span.roomTypes) {
    const input: SetRateCalendarInput = {
      roomType,
      from: span.from,
      to: span.to,
      // Text on the wire, which is what `vndAmountInputSchema` declares and
      // decodes: a JSON number would quietly lose the last digits of a figure
      // that did not fit a double.
      grossPerNight: gross.toString(),
    };

    const checked = rateWriteSchema.safeParse(input);

    if (!checked.success) {
      // The schema's own words, and the first refusal rather than all of them:
      // one message beside the form is one thing to fix.
      return {
        problem:
          checked.error.issues[0]?.message ??
          "That is not a price the API takes.",
      };
    }

    calls.push(input);
  }

  return { calls, nights: span.cells };
}

// ── The restriction edit ───────────────────────────────────────────────────

/** What the operator typed into the restrictions form, before any of it is
 *  read. */
export interface RestrictionFields {
  minimumStay: string;
  maximumStay: string;
  closedToArrival: boolean;
  closedToDeparture: boolean;
}

/**
 * The unrestricted rule, which is both the form's identity and the way a rule
 * is removed.
 *
 * `setStayRestrictionsInput` defaults every field to these values and
 * `isUnrestricted` reads them back, so sending all four is how the API is told
 * to delete the rows rather than store a rule that constrains nothing.
 */
export const NO_RESTRICTION_FIELDS: RestrictionFields = {
  minimumStay: "1",
  maximumStay: "",
  closedToArrival: false,
  closedToDeparture: false,
};

/** Either the calls one restriction edit costs, or why it is not one yet. */
export type StayRestrictionEdit =
  | {
      readonly calls: readonly SetStayRestrictionsInput[];
      readonly nights: number;
      /** The rule written is "no rule", so the API deletes rows rather than
       *  storing them — and the operator is told that before pressing. */
      readonly clears: boolean;
    }
  | { readonly problem: string };

/**
 * One rule across a span — `FR-PRC-02`, as this screen edits it.
 *
 * All four fields go out on every call, never only the one that was typed. The
 * contract defaults them for exactly that reason: a body naming a minimum stay
 * alone would leave whatever closed-to-arrival flag was there before, and an
 * operator who cleared the two switches would find the nights still shut.
 *
 * Nothing here validates a *booking* against the rule. `FR-PRC-02` puts that
 * rejection at query time, in the availability read, and a second opinion about
 * it in the console would be a rule the two surfaces could disagree on.
 */
export function restrictionEdit(
  span: SelectionSpan,
  fields: RestrictionFields,
): StayRestrictionEdit {
  const minimumStay =
    fields.minimumStay.trim() === "" ? 1 : parseWhole(fields.minimumStay);
  const maximumStay =
    fields.maximumStay.trim() === "" ? null : parseWhole(fields.maximumStay);

  if (
    minimumStay === null ||
    (fields.maximumStay.trim() !== "" && maximumStay === null)
  ) {
    return {
      problem:
        "A stay length is a whole number of nights. Leave the maximum empty for no ceiling.",
    };
  }

  const rule = {
    minimumStay,
    maximumStay,
    closedToArrival: fields.closedToArrival,
    closedToDeparture: fields.closedToDeparture,
  };

  const calls: SetStayRestrictionsInput[] = [];

  for (const roomType of span.roomTypes) {
    const input: SetStayRestrictionsInput = {
      roomType,
      from: span.from,
      to: span.to,
      ...rule,
    };

    const checked = restrictionWriteSchema.safeParse(input);

    if (!checked.success) {
      return {
        problem:
          checked.error.issues[0]?.message ??
          "That is not a restriction the API takes.",
      };
    }

    calls.push(input);
  }

  return { calls, nights: span.cells, clears: isUnrestricted(rule) };
}

// ── The three plans ────────────────────────────────────────────────────────

/** What the operator typed into one plan's form. */
export interface PlanFields {
  name: string;
  percentAdjustment: string;
  /** Blank leaves the plan's breakfast exactly as it was — the PATCH's own
   *  `undefined`. Seeded blank rather than with the current figure for that
   *  reason: a box holding a value the operator then clears would be asking
   *  this form to guess between "unchanged" and "removed", which is the one
   *  distinction `updateRatePlanInput` exists to keep. */
  breakfastPerPersonGross: string;
  /** The explicit null — the act that turns `BB` into a room-only plan. */
  removesBreakfast: boolean;
}

/**
 * The form as the plan currently stands.
 *
 * Name and adjustment are seeded because they are always present and a PATCH of
 * them is an edit of a value the operator can see. Breakfast is not, for the
 * reason on the field above; the current figure is printed beside the box
 * instead.
 */
export function planFields(plan: RatePlan): PlanFields {
  return {
    name: plan.name,
    percentAdjustment: String(plan.percentAdjustment),
    breakfastPerPersonGross: "",
    removesBreakfast: false,
  };
}

/** Either a PATCH the contract will take — with what it actually says — or the
 *  sentence saying why it is not one. */
export type PlanPatch =
  | {
      readonly input: UpdateRatePlanInput;
      /** What this PATCH changes, in the operator's words, so the two ways a
       *  field can be absent are visible before the press. */
      readonly changes: readonly string[];
    }
  | { readonly problem: string };

/** A signed whole percent, as the plan prints it. */
export function percentLabel(percent: number): string {
  return `${percent > 0 ? "+" : ""}${percent}%`;
}

/**
 * A change to one plan — `FR-PRC-01`, as a PATCH rather than a replacement.
 *
 * The whole care of this function is the difference between the two ways
 * `breakfastPerPersonGross` can be absent, which `contract/pricing.ts` names
 * as the difference between editing `BB`'s name and turning `BB` into a
 * room-only plan:
 *
 * - a blank box omits the field, and the plan's breakfast is left alone;
 * - a figure sets it;
 * - the room-only tick sends an explicit `null`, and nothing else does.
 *
 * Both at once is refused rather than resolved. A form that quietly preferred
 * one would be deciding a commercial question on the operator's behalf, and the
 * two acts are a tick apart.
 *
 * A field that has not moved is omitted too, so pressing the button after
 * reading a plan sends nothing — `displayOrder` never appears at all, because
 * the contract makes it read-only and nothing has asked to reorder three plans.
 */
export function planPatch(plan: RatePlan, fields: PlanFields): PlanPatch {
  const name = fields.name.trim();
  const percent = parseWhole(fields.percentAdjustment);
  const typedBreakfast = fields.breakfastPerPersonGross.trim();

  if (percent === null) {
    return {
      problem:
        "The adjustment is a signed whole percent — -10, 0, 8. It is applied to the calendar price.",
    };
  }

  if (fields.removesBreakfast && typedBreakfast !== "") {
    return {
      problem:
        "Decide one: either breakfast costs this much, or the plan is room-only. Clear the figure to remove it.",
    };
  }

  const input: UpdateRatePlanInput = { code: plan.code };
  const changes: string[] = [];

  if (name !== plan.name) {
    input.name = name;
    changes.push(`Renames it to "${name}"`);
  }

  if (percent !== plan.percentAdjustment) {
    input.percentAdjustment = percent;
    changes.push(`Sets the adjustment to ${percentLabel(percent)}`);
  }

  if (typedBreakfast !== "") {
    const breakfast = parseDong(typedBreakfast);

    if (breakfast === null) {
      return {
        problem:
          "Breakfast is a whole number of đồng a head — 120000, or 120.000.",
      };
    }

    input.breakfastPerPersonGross = breakfast.toString();
    changes.push(`Sets breakfast to ${formatVnd(breakfast)} a head`);
  } else if (fields.removesBreakfast && plan.breakfastPerPersonGross !== null) {
    // The explicit null. Only sent when there is breakfast to remove: a null
    // over a plan that already includes none is not a change, and listing it as
    // one would tell the operator this press did something.
    input.breakfastPerPersonGross = null;
    changes.push("Removes breakfast — the plan becomes room-only");
  }

  if (changes.length === 0) {
    return {
      problem:
        "Nothing in the plan has changed. A blank breakfast box leaves breakfast as it is; the room-only tick is what removes it.",
    };
  }

  const checked = planPatchSchema.safeParse(input);

  if (!checked.success) {
    return {
      problem:
        checked.error.issues[0]?.message ??
        "That is not a change to a plan the API takes.",
    };
  }

  return { input, changes };
}

/** What a plan currently includes for breakfast, said beside the empty box. */
export function breakfastLabel(plan: RatePlan): string {
  return plan.breakfastPerPersonGross === null
    ? "Room only — no breakfast included"
    : `${formatVnd(plan.breakfastPerPersonGross)} a head, per night`;
}

// ── What an edit stales ────────────────────────────────────────────────────

/**
 * Whether a cached read was asked about this room type.
 *
 * `rates-queries.ts` invalidates with this rather than with the whole of a
 * route's key, and the reason is the shape of the reads: the grid holds one
 * query per type per window, so a price written on `DELUXE` leaves every other
 * type's answer exactly as correct as it was. Matching the type out of the key
 * is what keeps the refetch to the rows the act touched instead of asking the
 * API for the whole grid again.
 *
 * Reads the key structurally rather than by position: the key's shape belongs
 * to `@orpc/tanstack-query`, and a spec asserting an index in it would be a
 * spec about that library's internals.
 */
export function readsRoomType(
  queryKey: readonly unknown[],
  roomType: RoomTypeCode,
): boolean {
  return queryKey.some((part) => {
    if (typeof part !== "object" || part === null) {
      return false;
    }

    const input = (part as { input?: unknown }).input;

    return (
      typeof input === "object" &&
      input !== null &&
      (input as { roomType?: unknown }).roomType === roomType
    );
  });
}
