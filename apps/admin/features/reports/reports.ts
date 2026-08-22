/* The Reports family, as the console has to reason about it: which of the three
 * pages a role is offered, what a typed range parses to before any of it is
 * sent, what a bucket is called, and what each chart is handed.
 *
 * Pure, and separate from the hooks and the markup beside it, for the reason
 * `features/finance/cash-book.ts` and `features/shifts/shift-day.ts` both give:
 * everything below is a judgement the API does not make for the console — which
 * roles are offered which door, whether a typed day is a day, and how a bigint
 * of đồng becomes a bar's height.
 *
 * Five rules hold throughout, and `reports.spec.ts` holds this file to them:
 *
 * 1. **Three pages, and every figure `docs/screens.md` names has one.** That
 *    document describes the family as "revenue, room status, occupancy, ADR and
 *    RevPAR": the first two are `FR-RPT-02` and the last three are `FR-RPT-03`,
 *    which they share a page with. {@link REPORT_PAGES} is the whole inventory,
 *    and every entry on it is a door that opens.
 * 2. **Each page is offered from its own matrix row.** Revenue is
 *    `reporting.financial` — the accountant and management — room status is
 *    `reporting.operational`, which the desk holds and the accountant does not,
 *    and occupancy/ADR/RevPAR is `reporting.performance`, a third row that
 *    happens to grant the same three roles as the financial one and is still not
 *    that row. They are genuinely different rows and the menu is filtered per
 *    page rather than per family: a receptionist opening Reports finds exactly
 *    the room-status page, which is why `nav-inventory.ts` grants the family to
 *    `LEDGER` and is correct to.
 * 3. **The page stamp is a boundary, not a source.** `docs/screens.md` is
 *    explicit: what it promises is that no page shows a day the night audit has
 *    not closed, *not* that every figure was read from a frozen row. The revenue
 *    page mixes frozen snapshot revenue with a live ledger sum of §4's
 *    penalties; the room-status page counts `room_condition` now and reads no
 *    snapshot at all. {@link boundaryNote} is that sentence written once so the
 *    three pages cannot word it differently. The performance page is the
 *    strictest case of the same promise: every figure on it is a ratio of two
 *    counts the audit froze, so it reads no live table at all and still carries
 *    the identical sentence.
 * 4. **The room-status page has no range and is not given one.** A housekeeping
 *    status is where a room stands now, so there is no stretch of days to cut.
 *    A picker on that page would be a control the API accepts and ignores, which
 *    is worse than one that is not there — so {@link RangeFields} belongs to the
 *    two ranged pages — revenue and performance, which take the same picker
 *    unchanged — and the room-status page carries the stamp and the instant
 *    instead.
 * 5. **Money crosses to `number` once, at the chart, and never on the way to a
 *    reader.** Every figure a person reads is `formatVnd` over the `bigint` the
 *    API sent. A bar's height is a pixel scale and has to be a `number`;
 *    {@link revenueSeries} and {@link performanceSeries} are the only two
 *    places that conversion happens and both say what it costs. The corollary
 *    on the performance page is that a *missing* ratio never becomes a `0`:
 *    {@link formatOccupancy} and {@link formatRatioVnd} print a dash, and the
 *    series carries `null` so no bar is drawn at all.
 */

import type { ApiClient } from "@mariva/api-client";
import {
  formatVnd,
  type HousekeepingStatus,
  type RevenueBucket,
  type StaffRole,
} from "@mariva/shared";

import { CONDITION_LABELS } from "@/features/housekeeping/housekeeping-board";
import { parseLiberalDate } from "@/lib/date-parser";

/* The wire's shapes, read off the client rather than restated — the argument
 * every other feature in this console makes: `@mariva/shared` types the client
 * from the contract's own schemas, so a field renamed there breaks this file in
 * the pull request that renamed it, where a hand-written interface would compile
 * until it was wrong. */

/** What the property earned over a range, bucketed and totalled. */
export type RevenueReport = Awaited<
  ReturnType<ApiClient["reporting"]["revenue"]>
>;

/** One bucket of it. */
export type RevenueBucketRow = RevenueReport["buckets"][number];

/** What `GET /reports/revenue` takes. */
export type RevenueQuery = Parameters<ApiClient["reporting"]["revenue"]>[0];

/** Where every room stands, counted at an instant. */
export type RoomStatusReport = Awaited<
  ReturnType<ApiClient["reporting"]["roomStatus"]>
>;

/** One room type's share of it. */
export type RoomStatusTypeRow = RoomStatusReport["byType"][number];

/** How full the property was, what it sold a room for, and what each sellable
 *  room earned — over a range, bucketed and totalled. */
export type PerformanceReport = Awaited<
  ReturnType<ApiClient["reporting"]["performance"]>
>;

/** One bucket of it. */
export type PerformanceBucketRow = PerformanceReport["buckets"][number];

/** The six figures one row carries — three counts and the three ratios they are
 *  divisions of. The same shape property-wide and per type, which is what lets
 *  one table print both. */
export type PerformanceFigures = PerformanceBucketRow["property"];

/** One room type's six, with its code. */
export type PerformanceTypeRow = PerformanceBucketRow["byType"][number];

/** What `GET /reports/performance` takes. Field for field the revenue query —
 *  `contract/reporting.ts` builds both from one helper — and still its own type,
 *  because the two routes are free to diverge and a shared alias would hide it. */
export type PerformanceQuery = Parameters<
  ApiClient["reporting"]["performance"]
>[0];

/**
 * Who may read what the property earned.
 *
 * The matrix's *Revenue and financial reports* row, which is `full` for
 * `ACCOUNTANT`, `MANAGER` and `ADMIN` and names nobody else. **`RECEPTIONIST` is
 * absent and that is the decision rather than an omission**: the person standing
 * at the till holds the drawer and does not read the property's takings, which
 * is the same separation `mayKeepTheBook` draws for the cash book. The API
 * refuses them this route, and this is what stops the console offering a door
 * that answers 403.
 */
export function mayReadRevenue(role: StaffRole): boolean {
  return role === "ACCOUNTANT" || role === "MANAGER" || role === "ADMIN";
}

/**
 * Who may read where the rooms stand.
 *
 * The matrix's *Operational reports* row. It is the mirror of the one above:
 * the desk is on it and the accountant is not, because how many rooms are dirty
 * on the third floor is the state of the floors rather than the state of the
 * books.
 *
 * **`HOUSEKEEPING` is on it, and their `⚠` narrows nothing on this page.** The
 * warning is "own board", which is what the row's *arrivals and in-house* half
 * owes a housekeeper — a list of guests is scoped or it is not theirs. A count
 * of rooms by condition has no such half: it is the board's own subject
 * totalled, and they hold `housekeeping.board` outright, so there is no figure
 * here they cannot already read room by room. Leaving them off would have the
 * console refuse a page the API's guard admits, and the refusal would protect
 * nothing.
 *
 * The rail is a separate question and `nav-inventory.ts` still answers it the
 * same way: a housekeeper is offered one family, the board. This decides who
 * the page opens for, not who is invited to it.
 */
export function mayReadRoomStatus(role: StaffRole): boolean {
  return (
    role === "RECEPTIONIST" ||
    role === "HOUSEKEEPING" ||
    role === "MANAGER" ||
    role === "ADMIN"
  );
}

/**
 * Who may read how the property performed.
 *
 * The matrix's *Occupancy / ADR / RevPAR* row — `reporting.performance` — which
 * is `ACCOUNTANT 👁`, `MANAGER ✅`, `ADMIN ✅` and names nobody else. **It grants
 * the same three roles as {@link mayReadRevenue} and is deliberately a second
 * function rather than an alias of it**: they are two rows of `rbac-matrix.md`,
 * the API guards them under two capabilities, and a console that collapsed them
 * because today's answers coincide would silently offer the wrong door the day
 * one row moves.
 *
 * The accountant's grant is an eye rather than a tick, which is `read` and is
 * not a narrowing — there is nothing on a report to withhold. What the eye
 * denies them is writing, and nothing on this page writes.
 */
export function mayReadPerformance(role: StaffRole): boolean {
  return role === "ACCOUNTANT" || role === "MANAGER" || role === "ADMIN";
}

/** One named report, as the menu lists it. */
export interface ReportPage {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  /** What the page answers, in one sentence, so the menu is readable rather
   *  than a list of nouns. */
  readonly summary: string;
  /** The matrix predicate that decides whether this role is offered it. */
  readonly mayOpen: (role: StaffRole) => boolean;
}

/**
 * The reports that exist.
 *
 * `docs/screens.md` describes the menu as "revenue, room status, occupancy, ADR
 * and RevPAR" — five figures across three pages, and all three are here. The
 * last three share one page rather than taking one each because they are three
 * divisions of the same two counts over the same range: a reader comparing ADR
 * against occupancy for the month is asking one question, and three routes would
 * make them ask it three times.
 *
 * Order is the order they are read in: what the property earned, where the rooms
 * stand, and how hard the rooms were worked.
 */
export const REPORT_PAGES: readonly ReportPage[] = [
  {
    id: "revenue",
    label: "Revenue",
    href: "/reports/revenue",
    summary:
      "What the property earned over a stretch of closed trading days — room " +
      "charges, everything else it sold, and what cancellations forfeited.",
    mayOpen: mayReadRevenue,
  },
  {
    id: "room-status",
    label: "Room status",
    href: "/reports/room-status",
    summary:
      "Where every room stands right now, by condition and by type. Counted " +
      "live rather than read from a closed night.",
    mayOpen: mayReadRoomStatus,
  },
  {
    id: "performance",
    label: "Occupancy, ADR and RevPAR",
    href: "/reports/performance",
    summary:
      "How full the property was over a stretch of closed trading days, what " +
      "it sold a room for, and what each sellable room earned — property-wide " +
      "and by room type.",
    mayOpen: mayReadPerformance,
  },
];

/** What this role is offered, in the menu's order. Filtered per page and not
 *  per family, because the three pages sit on three different matrix rows: a
 *  receptionist holds exactly one of them, an accountant the other two. */
export function reportsFor(role: StaffRole): readonly ReportPage[] {
  return REPORT_PAGES.filter((page) => page.mayOpen(role));
}

/**
 * The stamp every page in this family carries, worded as the boundary it is.
 *
 * One sentence, written once, because the whole point of `screens.md`'s
 * reframing is that the two pages promise the *same* thing while drawing from
 * different places — and two pages wording it separately would drift into two
 * promises. It says what is not here rather than where anything came from; each
 * page adds its own line about its own source.
 *
 * Null is a property whose night audit has never run, and it gets a sentence
 * rather than a blank: a page with no stamp reads as a page nobody decided the
 * boundary for.
 */
export function boundaryNote(lastClosedBusinessDate: string | null): string {
  return lastClosedBusinessDate === null
    ? "The night audit has closed no trading day yet, so nothing on this page " +
        "reaches a night the property has agreed on."
    : `Nothing on this page reaches past ${lastClosedBusinessDate}, the last ` +
        "trading day the night audit has closed.";
}

/** How each way of cutting a range is offered. A `Record` over the union rather
 *  than a list, so a fourth bucket added to the contract stops this file
 *  compiling instead of quietly not being offered. */
export const BUCKET_LABELS: Record<RevenueBucket, string> = {
  DAY: "Each day",
  MONTH: "Each month",
  QUARTER: "Each quarter",
};

/**
 * What one bucket is called on a chart's axis and in a table's first column.
 *
 * Composed here rather than sent, because a label is presentation and the API
 * sends the days instead — `revenueBucketRowSchema` says so. It is built from
 * the bucket's *first closed day*, which is what the API actually promises: a
 * month whose audit has only reached the twentieth still reads "August 2026",
 * and the fact that it holds twenty days of it is on the row beside it rather
 * than smuggled into the name.
 *
 * The month and the quarter are read off the characters of the date rather than
 * out of a `Date`, which is `lib/business-date.ts`'s rule for the same reason:
 * a trading day parsed into an instant is a trading day that can move.
 */
export function bucketLabel(from: string, bucket: RevenueBucket): string {
  const year = from.slice(0, 4);
  const month = Number(from.slice(5, 7));

  if (bucket === "QUARTER") {
    return `Q${Math.floor((month - 1) / 3) + 1} ${year}`;
  }

  const name = MONTH_NAMES[month - 1] ?? from.slice(5, 7);

  return bucket === "MONTH"
    ? `${name} ${year}`
    : `${Number(from.slice(8, 10))} ${name}`;
}

/** English month names, because the console's dates are already English —
 *  `lib/business-date.ts` formats every other day on this screen the same way,
 *  and this exists only because a bucket is named from ten characters rather
 *  than from a `Date` a formatter would take. */
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** What the operator has typed into a ranged page's range — the revenue page's
 *  and the performance page's, which take the same picker and the same fields
 *  because `contract/reporting.ts` builds both queries from one helper. */
export interface RangeFields {
  /** The first trading day of interest, as typed. Empty is no lower bound. */
  from: string;
  /** The last, inclusive. Empty is no upper bound — the API cuts it at the
   *  boundary whatever is typed. */
  to: string;
  /** How the range is cut. */
  bucket: RevenueBucket;
}

/**
 * The range the page opens on: everything the audit has closed, by month.
 *
 * Both ends empty and the coarsest useful cut, because the question somebody
 * opening a revenue report has is "how are we doing" rather than "what did the
 * fourteenth come to" — and a page that opened on days would draw a bar per day
 * of the property's whole history. Narrowing is one field away; a reader who
 * arrives at a chart they cannot read is a reader who leaves.
 */
export const DEFAULT_RANGE_FIELDS: RangeFields = {
  from: "",
  to: "",
  bucket: "MONTH",
};

/** Either a question the route will take, or the sentence saying why it is not
 *  one yet. The shape `bookQuestion` uses, so a form built against either reads
 *  the same way. */
export type RangeQuestion =
  | { readonly query: RevenueQuery }
  | { readonly problem: string };

/**
 * The typed range as a question a ranged route will take, or the first thing
 * wrong with it.
 *
 * Typed as the revenue query and taken unchanged by the performance page:
 * `performanceReportQuery` is `reportRangeQuery()` and so is
 * `revenueReportQuery`, which is the contract saying in one line that the two
 * pages ask over a range the same way. One parser, so a range that means one
 * thing on the revenue page cannot mean another on the performance page.
 *
 * The days are read with the console's own liberal parser against the property's
 * business date, for the reason `cash-book.ts` gives about the same fields:
 * "yesterday" typed at 01:30 means the trading day before the one the desk is
 * working, not the browser's calendar. The order of the two ends is checked here
 * as well as by the contract, so somebody who typed them the wrong way round is
 * told while the words are still in the fields.
 *
 * An upper bound *ahead* of the boundary is not a refusal. Asking for "this
 * month" on the fourteenth is the ordinary question, and the API answers it as
 * far as the audit has reached and stamps the page with where that was — a
 * console that refused it would be inventing a rule the API does not have.
 */
export function rangeQuestion(
  fields: RangeFields,
  businessDate: string | null,
): RangeQuestion {
  const from = readDay(fields.from, businessDate, "first day of interest");

  if ("problem" in from) {
    return from;
  }

  const to = readDay(fields.to, businessDate, "last day of interest");

  if ("problem" in to) {
    return to;
  }

  if (from.day !== undefined && to.day !== undefined && from.day > to.day) {
    return {
      problem:
        "The last day of interest falls before the first. Both ends are inclusive trading days, so a single day is that day typed into both.",
    };
  }

  return { query: { bucket: fields.bucket, from: from.day, to: to.day } };
}

/** One bar of the revenue chart: the bucket's name, and its three parts as the
 *  numbers a scale can measure.
 *
 *  A `type` and not an `interface`, which is load-bearing rather than style:
 *  the vendored chart takes `Record<string, unknown>[]` because it reads its
 *  series by key, and TypeScript gives an object type alias an implicit index
 *  signature where it gives an interface none. The alternative was widening the
 *  chart's own parameter, which would let anything through on every chart in
 *  the console. */
export type RevenueBar = {
  readonly bucket: string;
  readonly room: number;
  readonly other: number;
  readonly penalties: number;
};

/** What each stacked series is called, wherever it is named — the chart's
 *  tooltip, the table's header, the legend. One map so the three cannot drift. */
export const REVENUE_SERIES_LABELS = {
  room: "Room revenue",
  other: "Other revenue",
  penalties: "Penalties",
} as const;

/**
 * The buckets as the chart's data.
 *
 * **This is where đồng becomes a `number`, and it is the only place in this
 * feature that happens.** A bar's height is a pixel scale and a scale is
 * arithmetic on doubles; there is no way to draw a `bigint`. The bound is the
 * same one `excel-sheet.ts` argues at length — every integer below 2^53 is
 * exact, which is nine thousand tỷ đồng, and a property that billed that on one
 * bucket would have larger surprises than a rounded bar. Every figure a person
 * *reads* on these pages is `formatVnd` over the `bigint` the API sent, so the
 * conversion never reaches a number anybody is quoted.
 *
 * **Negative parts are floored at nothing, and the table beside the chart is
 * what carries them.** A day of corrections is genuinely negative — the contract
 * keeps the sign for exactly that — but a stacked bar cannot draw a negative
 * segment: it would render below the baseline under the two positive segments
 * and read as a larger month. So the chart shows what was earned and the row
 * underneath shows what the bucket actually came to, sign included.
 */
export function revenueSeries(
  report: Pick<RevenueReport, "buckets" | "bucket">,
): RevenueBar[] {
  return report.buckets.map((held) => ({
    bucket: bucketLabel(held.from, report.bucket),
    room: drawable(held.roomRevenueVnd),
    other: drawable(held.otherRevenueVnd),
    penalties: drawable(held.penaltyRevenueVnd),
  }));
}

/** One bar of the room-status chart: the type, and how many of its rooms stand
 *  in each condition. Keyed by the status itself, so the chart's series names
 *  are the contract's own values and no third vocabulary exists. */
export type RoomStatusBar = { readonly roomType: string } & Partial<
  Record<HousekeepingStatus, number>
>;

/**
 * The types as the chart's data, one stacked bar each.
 *
 * The type is printed as its code, which is what `features/rooms` prints on
 * every row of the room list — a second spelling of `JUNIOR_SUITE` maintained in
 * this file would be a third vocabulary for a value the property already names
 * one way.
 *
 * Every status appears on every bar because the API zero-fills them, which is
 * what keeps the stack's segment order identical from one bar to the next: a
 * chart whose colours mean different things per column is a chart nobody can
 * read across.
 */
export function roomStatusSeries(
  report: Pick<RoomStatusReport, "byType">,
): RoomStatusBar[] {
  return report.byType.map((type) => {
    const bar: Record<string, number | string> = { roomType: type.roomType };

    for (const count of type.byStatus) {
      bar[count.status] = count.rooms;
    }

    return bar as RoomStatusBar;
  });
}

/** How each condition is written on this page — the housekeeping board's own
 *  words, imported rather than repeated. The board is where a room's state is
 *  named for the person who changes it, and a report calling the same state
 *  something else would be the console holding two vocabularies for one column
 *  of one table. */
export const ROOM_STATUS_LABELS: Record<HousekeepingStatus, string> =
  CONDITION_LABELS;

/** The three figures the performance page draws, one at a time. The contract
 *  calls them `occupancy`, `adrVnd` and `revparVnd`; these are the names the
 *  selector uses, kept apart from the field names because one of the three is a
 *  fraction and two are money and the chart has to know which. */
export type PerformanceFigure = "OCCUPANCY" | "ADR" | "REVPAR";

/** In the order they are offered, occupancy first. A tuple so the selector is
 *  built from it and a fourth figure cannot be added without being offered. */
export const PERFORMANCE_FIGURES: readonly PerformanceFigure[] = [
  "OCCUPANCY",
  "ADR",
  "REVPAR",
];

/** What each is called wherever it is named — the selector, the chart's
 *  tooltip, the table's header. One map so the three cannot drift. */
export const PERFORMANCE_FIGURE_LABELS: Record<PerformanceFigure, string> = {
  OCCUPANCY: "Occupancy",
  ADR: "ADR",
  REVPAR: "RevPAR",
};

/**
 * The figure the page opens on.
 *
 * Occupancy, because it is the one of the three that needs no other figure to
 * be read: how full the property was is a whole answer on its own, where a rate
 * without an occupancy beside it is half of one. It is also the only one of the
 * three whose scale a reader already knows, which is what makes a chart legible
 * before anybody has touched a control.
 */
export const DEFAULT_PERFORMANCE_FIGURE: PerformanceFigure = "OCCUPANCY";

/** What a figure that has no answer is printed as. A ratio whose denominator was
 *  zero is a real answer — "there was nothing to divide by" — and this is that
 *  answer written down. Never `0%` and never `0 ₫`: the header's rule 5. */
export const ABSENT_FIGURE = "—";

/** One bar of the performance chart: the bucket's name, and the selected figure
 *  as a number a scale can measure — or `null`, which draws no bar.
 *
 *  A `type` and not an `interface`, for {@link RevenueBar}'s reason: the
 *  vendored chart takes `Record<string, unknown>[]` and TypeScript gives an
 *  object type alias the implicit index signature an interface does not get. */
export type PerformanceBar = {
  readonly bucket: string;
  readonly value: number | null;
};

/**
 * The buckets as the chart's data, one figure at a time.
 *
 * **The three do not share an axis and are never drawn together.** Occupancy is
 * a fraction and ADR and RevPAR are đồng; a stack of them would be adding a
 * percentage to a hundred thousand đồng, and an overlay would put a bar of 0.87
 * beside a bar of 850,000 on one scale, where the first is invisible. So the
 * page draws one and offers the other two.
 *
 * **Occupancy crosses as percentage points and money crosses as đồng.** The
 * fraction is multiplied by a hundred here rather than at the tooltip so the bar
 * a reader sees, the number the tooltip prints and any axis drawn against them
 * are all one quantity. This is the second of the two places in this feature
 * where a `bigint` becomes a `number` — {@link revenueSeries} argues the bound,
 * and it holds harder here: an ADR is one night's rate rather than a month's
 * takings.
 *
 * **A null ratio stays null and is not floored at zero.** `typeof null` is not
 * `"number"`, which the vendored bar reads as nothing to draw and the vendored
 * scale leaves out of its maximum — so a closed day is a gap in the chart rather
 * than a day the rooms sold for nothing. That is the opposite treatment from
 * {@link revenueSeries}'s floor, and deliberately: there a negative figure is a
 * real quantity a stack cannot draw, here there is no quantity at all.
 *
 * **Nothing is clipped.** The bar's domain is computed from the data it was
 * given, so a day sold above what was sellable draws above every other bar,
 * which is the true reading `contract/reporting.ts` refuses to bound.
 *
 * **A negative ratio is carried through unchanged and draws no bar**, because
 * the vendored chart grows every bar from a baseline of nothing and has no
 * segment to give one. A range whose corrections outweigh its charges has a
 * genuinely negative ADR, the sign is not thrown away here, and the table under
 * the chart is what prints it — the same division of labour `revenueSeries`
 * makes for a negative bucket.
 */
export function performanceSeries(
  report: Pick<PerformanceReport, "buckets" | "bucket">,
  figure: PerformanceFigure,
): PerformanceBar[] {
  return report.buckets.map((held) => ({
    bucket: bucketLabel(held.from, report.bucket),
    value: drawableFigure(held.property, figure),
  }));
}

/**
 * How full the property was, as a reader reads it.
 *
 * The contract sends a plain fraction — 0.87, not 87 — and this is the one place
 * it becomes a percentage for a person. At most one decimal, and a trailing zero
 * dropped, so a small property's 9 of 11 reads `81.8%` and a round figure reads
 * `120%` rather than `120.0%`.
 *
 * **Not capped, and the absence of a cap is the decision.** A closure that
 * withdraws a room after the night was sold leaves a day genuinely sold above
 * what was sellable; `performanceFiguresSchema` refuses to bound it for that
 * reason and a `Math.min` here would be this file quietly disagreeing with the
 * schema about what happened.
 */
export function formatOccupancy(occupancy: number | null): string {
  if (occupancy === null) {
    return ABSENT_FIGURE;
  }

  return `${Number.parseFloat((occupancy * 100).toFixed(1))}%`;
}

/** A ratio in đồng — an ADR or a RevPAR — as `formatVnd` over the `bigint` the
 *  API sent, or the dash when the denominator was zero. The `bigint` never
 *  crosses to a `number` on this path; only the chart's does. */
export function formatRatioVnd(amount: bigint | null): string {
  return amount === null ? ABSENT_FIGURE : formatVnd(amount);
}

/** One row's selected figure, already formatted. The chart's tooltip and the
 *  table's cells reach the same function so a figure cannot be spelled one way
 *  under the pointer and another underneath it. */
export function formatFigure(
  figures: PerformanceFigures,
  figure: PerformanceFigure,
): string {
  return figure === "OCCUPANCY"
    ? formatOccupancy(figures.occupancy)
    : formatRatioVnd(figure === "ADR" ? figures.adrVnd : figures.revparVnd);
}

/** The selected figure as the number a bar is drawn at, or `null` for no bar.
 *  Occupancy in percentage points, money in đồng — the crossing
 *  {@link performanceSeries} argues. */
function drawableFigure(
  figures: PerformanceFigures,
  figure: PerformanceFigure,
): number | null {
  if (figure === "OCCUPANCY") {
    return figures.occupancy === null ? null : figures.occupancy * 100;
  }

  const amount = figure === "ADR" ? figures.adrVnd : figures.revparVnd;

  return amount === null ? null : Number(amount);
}

/** A đồng amount as something a bar can be drawn at. The header argues both the
 *  crossing to `number` and the floor at nothing. */
function drawable(amount: bigint): number {
  return amount > 0n ? Number(amount) : 0;
}

/** One end of a range, read against the property's day. Absent is no bound
 *  rather than a refusal: a report with one end open is an ordinary question —
 *  "everything so far" is what a property in its first year asks. */
function readDay(
  typed: string,
  businessDate: string | null,
  subject: string,
): { readonly day?: string } | { readonly problem: string } {
  if (typed.trim() === "") {
    return {};
  }

  if (businessDate === null) {
    return {
      problem:
        "The property's day has not been read yet, and a typed date is resolved against it rather than against this machine's calendar.",
    };
  }

  const day = parseLiberalDate(typed, businessDate);

  if (day === null) {
    return {
      problem: `The ${subject} could not be read. A trading day is written 2026-08-16, or 16/8, or today.`,
    };
  }

  return { day };
}
