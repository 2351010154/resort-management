// The Reports family over the wire — `FR-RPT-02`'s two read routes,
// `FR-RPT-03`'s KPI read, and `FR-OPS-03`'s Excel exports.
//
// **Two kinds of route live here, and the file is named after the family rather
// than after either of them.** The reads are ordinary oRPC procedures like every
// other router in this folder. The exports are not, and the paragraph below says
// why; they were here first, because `FR-OPS-03` landed at M8 and the pages that
// draw the same data landed at M9. What holds the two together is that an export
// is a page taken away as a file, so the address, the filters and the shapes
// belong beside each other rather than in two folders.
//
// **A contract that oRPC cannot carry, declared here anyway.** Every other
// router in this folder is one the API implements and the client calls, and the
// compile-time guarantee `index.ts` describes comes from that — the three reads
// below are exactly that. The six exports are not. Each answers with a
// spreadsheet: a few hundred kilobytes of zip written a chunk at a time, which
// is not JSON and is not a shape a serialiser can validate. So they
// are ordinary HTTP routes on the API and ordinary `fetch` calls in the console
// — and what the two sides still have to agree about is declared here rather
// than typed out twice: the address, the filters, the media type and the name
// the file lands under. `tech-stack.md` records the library decision behind the
// streaming half.
//
// **The filters are the list's filters with the paging taken out, and that is
// the whole difference.** An export answers with everything the filters match,
// because a spreadsheet holding the fifty rows that happened to be on screen is
// a spreadsheet whose totals are wrong in a way nobody reading it can see. So
// `limit` and `offset` are absent — not optional, absent, since an export has no
// page for them to name. Everything else below is field-for-field what
// `finance.ts`, `operations.ts` and `audit.ts` already take, and
// `reporting.spec.ts` holds the three pairs to that agreement so a filter added
// to a list cannot quietly stop reaching its export. The three report exports
// take their page's query object itself rather than a copy of it with two fields
// removed — a report is an aggregate over a range and has no page to drop, so
// there is nothing for a second shape to differ from and every way for it to
// drift.
//
// **Nothing here says who may run one.** `rbac-matrix.md`'s *Excel export* row
// governs the routes and the list's own row governs what goes in the file, and
// both are resolved by the API. A shape cannot hold an authorisation decision,
// and a second copy of one here would be the matrix written twice.

import { oc } from "@orpc/contract";
import { z } from "zod";
import { housekeepingStatusSchema } from "../housekeeping-status.js";
import { vndAmountSchema } from "../money.js";
import { roomTypeCodeSchema } from "../rate-calendar.js";
import { isoStayDateSchema, stayDateSchema } from "../stay-date.js";
import { auditActionSchema, LONGEST_TABLE_NAME } from "./audit.js";
import {
  cashBookCategorySchema,
  cashBookDirectionSchema,
  cashBookMethodSchema,
} from "./finance.js";

/**
 * What an `.xlsx` is, as the browser and Excel both know it.
 *
 * Spelled once because it is long enough to mistype and wrong enough to matter:
 * a workbook served as `application/octet-stream` downloads without an icon and
 * opens in whatever the operating system guesses.
 */
export const EXCEL_MEDIA_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Where each export answers.
 *
 * Under `/exports` rather than beside the list each one draws from, because they
 * are one act performed on six subjects and the console offers them under one
 * name. The `.xlsx` suffix is on the path deliberately: a browser handed a url
 * with no extension by a person who copied it out of the network panel still
 * saves a file Excel opens.
 */
export const CASH_BOOK_EXPORT_PATH = "exports/cash-book.xlsx";
export const SHIFT_HISTORY_EXPORT_PATH = "exports/shifts.xlsx";
export const CHANGE_LOG_EXPORT_PATH = "exports/change-log.xlsx";
export const REVENUE_REPORT_EXPORT_PATH = "exports/revenue.xlsx";
export const ROOM_STATUS_REPORT_EXPORT_PATH = "exports/room-status.xlsx";
export const PERFORMANCE_REPORT_EXPORT_PATH = "exports/performance.xlsx";

/**
 * What the property's own book is exported by — `listCashBookEntriesInput`
 * without its page.
 *
 * Both ends of the range are inclusive trading days and filter `business_date`
 * rather than the instant somebody typed the entry in, which is
 * `finance.ts`'s decision and the reason a Friday transfer recorded on Monday
 * lands in Friday's month here too.
 */
export const cashBookExportInput = z
  .object({
    from: stayDateSchema.optional(),
    to: stayDateSchema.optional(),
    direction: cashBookDirectionSchema.optional(),
    category: cashBookCategorySchema.optional(),
    method: cashBookMethodSchema.optional(),
  })
  .refine(
    (query) => !query.from || !query.to || query.from.compare(query.to) <= 0,
    { message: "to must not fall before from", path: ["to"] },
  );

/**
 * What the desk's working days are exported by — `listShiftHistoryInput`
 * without its page.
 *
 * `operatorId` is carried and is not a scope. A caller narrowed to their own
 * shifts has it overwritten rather than refused, exactly as the list does and
 * for the reason `shift.controller.ts` gives: a filter this route is about to
 * answer anyway is not a filter worth a 403.
 */
export const shiftHistoryExportInput = z
  .object({
    operatorId: z.uuid().optional(),
    from: stayDateSchema.optional(),
    to: stayDateSchema.optional(),
  })
  .refine(
    (query) => !query.from || !query.to || query.from.compare(query.to) <= 0,
    { message: "to must not fall before from", path: ["to"] },
  );

/**
 * What the change log is exported by — `listAuditEntriesInput` without its
 * page.
 *
 * The window is two instants and half-open, `from` inclusive and `to`
 * exclusive, which is `audit.ts`'s promise: a reader stepping day by day does
 * not export midnight's changes twice.
 */
export const changeLogExportInput = z
  .object({
    tableName: z.string().trim().min(1).max(LONGEST_TABLE_NAME).optional(),
    rowId: z.uuid().optional(),
    actorId: z.uuid().optional(),
    action: auditActionSchema.optional(),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
  })
  .refine(
    (query) => query.rowId === undefined || query.tableName !== undefined,
    {
      message: "a row id names a record only alongside the table it is in",
      path: ["tableName"],
    },
  )
  .refine((query) => !query.from || !query.to || query.from < query.to, {
    message: "to must fall after from",
    path: ["to"],
  });

/**
 * What each export's file is called, before the day is added.
 *
 * Hyphenated lower case rather than the screen's own words, because this is a
 * name that lands in a downloads folder beside a hundred others and is sorted
 * by a file manager rather than read as a sentence.
 */
export const CASH_BOOK_EXPORT_STEM = "cash-book";
export const SHIFT_HISTORY_EXPORT_STEM = "shifts";
export const CHANGE_LOG_EXPORT_STEM = "change-log";
export const REVENUE_REPORT_EXPORT_STEM = "revenue";
export const ROOM_STATUS_REPORT_EXPORT_STEM = "room-status";
export const PERFORMANCE_REPORT_EXPORT_STEM = "performance";

/**
 * The name a downloaded export lands under.
 *
 * Declared here because both sides need it and neither can read it from the
 * other. The API puts it in `Content-Disposition`, so a person who opens the url
 * directly gets a named file; the console names the download itself, because
 * `Content-Disposition` is not one of the headers CORS exposes to page code and
 * a name read back through a proxy would be a name the browser had already
 * discarded.
 *
 * The day is the day the export was taken, in the property's own zone, and it is
 * the file's coarse stamp — the sheet inside carries the minute and the filters.
 * Two exports taken on one day overwrite each other in a downloads folder, which
 * is the browser's ordinary behaviour for a repeated name and is the right one
 * here: the second is the same question asked again.
 */
export function excelExportFileName(stem: string, isoDay: string): string {
  return `${stem}-${isoDay}.xlsx`;
}

/* ── `FR-RPT-02` — revenue and room status ─────────────────────────────────
 *
 * Two pages, and everything below is what they ask for and what they get back.
 *
 * **The page stamp is a boundary and not a statement of source.**
 * `docs/screens.md` puts the same words on every report page: what the stamp
 * promises is that no page ever shows a day the night audit has not closed, not
 * that every figure on it was read from a frozen row. That reframing is what
 * makes a page assembled from three kinds of read coherent. Room revenue and
 * other revenue come from `night_audit_snapshot`, which is frozen and cannot
 * move. Cancellation and no-show penalties are summed from the folio ledger,
 * because `night-audit.service.ts` deliberately leaves `POLICY_CHARGE` out of
 * `other_revenue_vnd` — a forfeited booking is not a sale — and they are still
 * cut at the last closed business date, which is safe for the reason that file
 * gives: a penalty is posted to the trading day it was taken on and the ledger
 * is append-only, so a closed day's total cannot move afterwards. Room status is
 * a live count and has no frozen row at all, and {@link roomStatusReportSchema}
 * says so in its own words rather than leaving a reader to infer it from the
 * stamp.
 *
 * **Occupancy, ADR and RevPAR are `FR-RPT-03` and are further down this file.**
 * They are ratios rather than sums, they are taken from the three countable
 * facts `schema/night-audit.ts` holds, and they are a page of their own that
 * `rbac-matrix.md` grants separately — but they are the same family, cut by the
 * same buckets over the same closed days, so the shapes sit here beside the ones
 * they reuse rather than in a file of their own.
 */

/**
 * How a stretch of trading days is grouped — `FR-RPT-02`'s "by day / month /
 * quarter".
 *
 * **The requirement's fourth option, "arbitrary range", is not a fourth member,
 * and that is the simpler of the two readings rather than a narrowing of it.**
 * The range is always free: {@link revenueReportQuery} takes any `from` and `to`
 * a reader cares to name, whatever the grouping is. A `RANGE` member would
 * produce exactly one bucket whose four figures are the range totals
 * {@link revenueReportSchema} already carries beside the buckets — the same
 * numbers in two places on one response, and a chart drawing a single bar. So
 * the bucket says how to cut the range and the range says what to cut, and
 * asking for the whole range as one figure is reading `totals` and ignoring
 * `buckets`.
 */
export const REVENUE_BUCKETS = ["DAY", "MONTH", "QUARTER"] as const;

export const revenueBucketSchema = z.enum(REVENUE_BUCKETS);

export type RevenueBucket = z.infer<typeof revenueBucketSchema>;

/**
 * Which trading days the revenue page is asking about, and how to group them.
 *
 * Both ends are inclusive trading days, like every other range in this file, and
 * each is optional on its own: an open lower bound is "everything the property
 * has ever closed", which is a legitimate question for a property in its first
 * year. The upper bound is narrowed by the API to the last day the night audit
 * closed, whatever a reader typed, because the alternative is a page showing a
 * day the property has not agreed on yet.
 *
 * The days are `business_date` throughout — the snapshot is keyed by it and the
 * folio line carries it — so a walk-in taken at 01:30 lands in the trading day
 * the desk was working rather than in the calendar day the clock had reached.
 *
 * The bucket defaults to `DAY` because that is the report with nothing
 * summarised away, and a default that hides detail is a default answering a
 * question nobody asked.
 *
 * This is also what the revenue export takes. There is no second shape for it:
 * an aggregate has no page to drop, so a copy would differ from this one only by
 * going stale.
 */
export const revenueReportQuery = reportRangeQuery();

/**
 * What every report in this family is asked for: a bucket and a range.
 *
 * A function returning a fresh schema rather than one constant the two reports
 * share, because a schema is an object oRPC hangs a procedure's input off and
 * two procedures pointing at one instance is a coupling nothing here needs. What
 * is shared is the declaration — the three fields, the `DAY` default, and above
 * all the ordering rule, which exists in exactly one place. A second copy of a
 * refinement is a second thing to remember when the message changes, and the
 * three list exports above already show what that costs.
 *
 * Not exported. The reports export their own queries; this is how they are
 * built, and a caller taking the builder instead would be a fourth report
 * nobody declared.
 */
function reportRangeQuery() {
  return z
    .object({
      bucket: revenueBucketSchema.default("DAY"),
      from: stayDateSchema.optional(),
      to: stayDateSchema.optional(),
    })
    .refine(
      (query) => !query.from || !query.to || query.from.compare(query.to) <= 0,
      { message: "to must not fall before from", path: ["to"] },
    );
}

/**
 * What the property earned over one bucket of the range.
 *
 * **Every amount is signed, and the sign is doing work.** A day whose room
 * charges were reversed within it nets to nothing, and a day carrying a
 * correction to an earlier night is genuinely a day of negative room revenue —
 * `schema/night-audit.ts` stores the figure signed for exactly that reason, and
 * a report taking magnitudes would report a month of corrections as a good one.
 * The same is true of a penalty the property waived after the fact.
 *
 * `from` and `to` are the first and last *closed* day inside the bucket rather
 * than the bucket's own calendar span, and `closedDays` counts them. A month
 * whose audit has only reached the twentieth reads `2026-08-01 → 2026-08-20`
 * over twenty days, which is the boundary said again at the resolution somebody
 * comparing two months actually needs — a bucket labelled "August" spanning the
 * whole month while holding two thirds of it is the one way this page could
 * mislead without being wrong.
 *
 * There is no label. What a bucket is called — "14 Aug", "August 2026", "Q3
 * 2026" — is presentation, it is language-dependent, and the console composes it
 * from `from` and the bucket the answer echoes back.
 */
export const revenueBucketRowSchema = z.object({
  /** The first closed trading day in this bucket. */
  from: isoStayDateSchema,
  /** The last, inclusive. Equal to `from` on a daily bucket. */
  to: isoStayDateSchema,
  /** How many closed days the figures below were assembled from. Never zero — a
   *  bucket with no closed day is not in the answer at all. */
  closedDays: z.number().int().min(1),
  /** Net room charges, from the frozen snapshot. VAT and the service charge
   *  stand outside it, which is `FR-GST-04`'s basis. */
  roomRevenueVnd: vndAmountSchema,
  /** Everything else the property sold — service items today — also frozen and
   *  also net. */
  otherRevenueVnd: vndAmountSchema,
  /** §4's cancellation and no-show charges, summed from the folio ledger. Not a
   *  sale, which is why the snapshot excludes it and why it is a column of its
   *  own here rather than folded into the other two. */
  penaltyRevenueVnd: vndAmountSchema,
  /** The three added up. Carried rather than left to the reader because it is
   *  the figure the chart draws and the one an export totals, and two places
   *  adding three columns is two chances to add them differently. */
  totalVnd: vndAmountSchema,
});

/** What the whole range came to, on the same four columns. Counted over every
 *  closed day the range reached, which is the set the buckets partition — so
 *  this cannot disagree with their sum, and it is carried so that nothing on the
 *  far side has to add them up. */
export const revenueTotalsSchema = z.object({
  closedDays: z.number().int().min(0),
  roomRevenueVnd: vndAmountSchema,
  otherRevenueVnd: vndAmountSchema,
  penaltyRevenueVnd: vndAmountSchema,
  totalVnd: vndAmountSchema,
});

/**
 * The revenue page — `FR-RPT-02`, the money half.
 *
 * `lastClosedBusinessDate` is the page stamp and is null on a property whose
 * night audit has never run. Null is a real answer rather than a missing one:
 * the buckets are then empty and the totals are zero, and a page that said
 * nothing about why would read as a property that earned nothing.
 *
 * `bucket` is echoed because the query's own default supplies it when a caller
 * did not, and a chart that has to guess how its x-axis was cut would guess.
 *
 * The buckets are chronological, earliest first — a chart is read left to right,
 * and a total order the API promises is one the console does not have to impose.
 */
export const revenueReportSchema = z.object({
  /** How the range was cut, as the answer was actually assembled. */
  bucket: revenueBucketSchema,
  /** The last trading day the night audit has closed. Every figure above stops
   *  here, whatever the query asked for. Null when no day has been closed. */
  lastClosedBusinessDate: isoStayDateSchema.nullable(),
  buckets: z.array(revenueBucketRowSchema),
  totals: revenueTotalsSchema,
});

/**
 * The room-status page's query, which names nothing.
 *
 * **A live count has no range, and an empty object is how that is said in a
 * shape.** `room_condition` holds one row per room and no history —
 * `schema/housekeeping.ts` argues at length why a status is where a room stands
 * now and never a fact about a night that has ended — so there is no stretch of
 * days for a filter to cut. A range parameter here would be a control the API
 * accepted and ignored, which is worse than one it refuses.
 *
 * Declared rather than left off, so that the route has an input shape like every
 * other and so that the page and its export ask the same nothing.
 */
export const roomStatusReportQuery = z.object({});

/** How many rooms stand in one condition. */
export const roomStatusCountSchema = z.object({
  status: housekeepingStatusSchema,
  rooms: z.number().int().min(0),
});

/** One room type, and how its rooms are standing. Every status appears, zero
 *  included: a grid with a missing column reads as a column nobody measured,
 *  and a type with no dirty room is a fact worth showing rather than a gap. */
export const roomStatusTypeSchema = z.object({
  roomType: roomTypeCodeSchema,
  rooms: z.number().int().min(0),
  byStatus: z.array(roomStatusCountSchema),
});

/**
 * The room-status page — `FR-RPT-02`, the operational half.
 *
 * **These counts are live and the stamp is not their source.** Every other
 * figure the Reports family draws comes from a frozen snapshot;
 * `docs/screens.md` is explicit that this one cannot, because a housekeeping
 * status is where a room stands now and a frozen copy of it would be exactly the
 * confusion the page exists to avoid. `lastClosedBusinessDate` is carried anyway
 * and means what it means on every other report page — the boundary the family
 * draws — so that a reader moving between the two pages reads one piece of
 * furniture rather than two. `takenAt` is what these counts are actually as of,
 * and it is on the response so that the distinction reaches the page rather than
 * stopping at this comment.
 *
 * The property-wide `byStatus` is not the per-type rows added up: it is counted
 * over the same rooms in the same statement, so the two cannot disagree, and a
 * reader of one is not obliged to assemble it from the other.
 */
export const roomStatusReportSchema = z.object({
  /** The moment the rooms were counted. An instant, because that is what a live
   *  count is a fact about. */
  takenAt: z.iso.datetime(),
  /** The family's boundary, carried for the page furniture. It is not where
   *  these counts came from. Null when no day has been closed. */
  lastClosedBusinessDate: isoStayDateSchema.nullable(),
  /** Every room the property has. */
  rooms: z.number().int().min(0),
  /** Property-wide, every status present. */
  byStatus: z.array(roomStatusCountSchema),
  /** And per type, by code. */
  byType: z.array(roomStatusTypeSchema),
});

/* ── `FR-RPT-03` — occupancy, ADR and RevPAR ───────────────────────────────
 *
 * One page, three ratios, and the same range picker the revenue page above
 * takes.
 *
 * **The ratios are served and are never stored, and that is a decision about
 * the database rather than about this file.** `schema/night-audit.ts` freezes
 * three countable facts per closed trading day — `sellable_rooms`,
 * `rooms_sold`, `net_room_revenue_vnd` — and deliberately freezes no ratio
 * beside them, because a stored ADR cannot be re-totalled. A month's ADR is not
 * assembled from thirty stored daily ADRs, a quarter's is not assembled from
 * three months', and the property's is not assembled from the five types' — and
 * a range picker asks for every one of those. The counts add and the quotients
 * do not, so the counts are what a row keeps and the ratios are what a reader
 * is answered with.
 *
 * **And they are carried by the API rather than left to the console to divide,
 * on {@link revenueBucketRowSchema}'s precedent.** `totalVnd` is the sum of the
 * three columns beside it and is on the wire anyway, for the reason stated
 * there: two places doing one piece of arithmetic are two chances to do it
 * differently, and the chart and the export are exactly those two places. That
 * argument is stronger here, because the arithmetic is not addition. A console
 * dividing per bucket and a spreadsheet dividing per range would agree on every
 * daily figure and disagree on every monthly one, which is the disagreement
 * hardest to notice and worst to publish.
 *
 * **A ratio is never averaged.** A bucket's ADR is Σ`netRoomRevenueVnd` /
 * Σ`roomsSold` over the bucket's closed days, never the mean of its daily ADRs.
 * The two differ whenever the nights differ in size, which is always: a mean
 * weights a quiet Tuesday equally with a full Saturday. The counts travel on
 * every row beside the ratios they are divisions of, so a reader of this shape
 * — a chart, a sheet, or a person — can re-derive any figure at any level from
 * the counts rather than by combining ratios.
 *
 * **What ADR and RevPAR are a rate *of*, and what they leave out.** Both read
 * `netRoomRevenueVnd` alone. §4's cancellation and no-show charges stand
 * outside it, because `night-audit.service.ts` keeps `POLICY_CHARGE` out of the
 * snapshot's revenue on the grounds that a forfeited booking is not a sale —
 * and an average *rate* assembled from money nobody stayed for is not a rate.
 * A night of mass cancellations must not read as a good night. Those penalties
 * are real money and the revenue page above carries them, in
 * `penaltyRevenueVnd`, which is the column that exists so they are reported
 * without being averaged into a room rate.
 *
 * **Nothing here says who may read it.** `rbac-matrix.md` separates *Occupancy
 * / ADR / RevPAR* from *Revenue and financial reports*, and the API resolves
 * that row as it does for every other route in this file.
 */

/**
 * The six figures one scope of one bucket came to — three counts, and the three
 * ratios they are divisions of.
 *
 *     occupancy = roomsSold / sellableRooms
 *     adrVnd    = netRoomRevenueVnd / roomsSold
 *     revparVnd = netRoomRevenueVnd / sellableRooms
 *
 * **A null ratio is a zero denominator, and it is a real answer rather than a
 * missing one.** `sellableRooms === 0` is a property that had nothing on sale,
 * so `occupancy` and `revparVnd` — which share that denominator — are null.
 * `roomsSold === 0` is a night that sold nothing, which has no rate at all, so
 * `adrVnd` is null. Zero is never the stand-in: a `0` in `adrVnd` reads as "the
 * rooms sold for nothing" and drags down every axis and comparison drawn
 * against it, where a null is drawn as a gap. The counts beside it already
 * state the fact exactly; the ratio's job is to say when it has no answer.
 *
 * **`occupancy` is bounded below and not above.** A day genuinely sold above
 * what was sellable is a true reading rather than a fault to clamp:
 * `schema/night-audit.ts` carries no `rooms_sold <= sellable_rooms` check on
 * purpose, because a closure withdrawing a room after the night was sold leaves
 * exactly that. A cap here would silently rewrite the one reading a manager
 * most needs to see. The lower bound is honest rather than load-bearing — both
 * counts are non-negative, so the quotient cannot be negative.
 *
 * `netRoomRevenueVnd` is signed for {@link revenueBucketRowSchema}'s reason,
 * and so are the two amounts divided out of it: a range carrying corrections to
 * earlier nights has a genuinely negative ADR and RevPAR, and a shape taking
 * magnitudes would turn a month of corrections into a good one.
 */
export const performanceFiguresSchema = z.object({
  /** Rooms the property had on sale, summed over the bucket's closed days. */
  sellableRooms: z.number().int().min(0),
  /** Rooms it sold, summed the same way. May exceed `sellableRooms`. */
  roomsSold: z.number().int().min(0),
  /** Net room charges from the frozen snapshot, signed. §4's penalties stand
   *  outside it, which is what keeps the two rates below rates of rooms sold. */
  netRoomRevenueVnd: vndAmountSchema,
  /** `roomsSold / sellableRooms`, as a fraction. Null when nothing was on sale.
   *  Not capped at 1. */
  occupancy: z.number().min(0).nullable(),
  /** Average daily rate: đồng per room sold, whole đồng. Null on a night that
   *  sold nothing. */
  adrVnd: vndAmountSchema.nullable(),
  /** Revenue per available room: đồng per room on sale, whole đồng. Null when
   *  nothing was on sale, sharing `occupancy`'s denominator and its gap. */
  revparVnd: vndAmountSchema.nullable(),
});

/**
 * The same six figures for one room type.
 *
 * By code rather than by id, like every other shape `rate-calendar.ts` puts on
 * the wire: a report is read by a person, and the five codes are what the
 * console already labels.
 *
 * The per-type rows are counted over their own frozen rows and are not the
 * property row cut up, nor is the property row their sum — each is read from
 * the table that holds it. So a bucket whose types do not add to its property
 * row is reporting what the audit froze rather than contradicting itself.
 */
export const performanceTypeRowSchema = performanceFiguresSchema.extend({
  roomType: roomTypeCodeSchema,
});

/**
 * One bucket of the performance page.
 *
 * `from` and `to` are the first and last *closed* day inside the bucket rather
 * than its calendar span, and `closedDays` counts them —
 * {@link revenueBucketRowSchema}'s boundary, said again because it matters more
 * here. A month's takings read over two thirds of the month at least look
 * small; a ratio read over two thirds of the month is a perfectly plausible
 * number that nothing on a chart would flag.
 *
 * There is no label, for the reason the revenue bucket gives: what a bucket is
 * called is presentation, and the console composes it from `from` and the
 * bucket the answer echoes back.
 */
export const performanceBucketRowSchema = z.object({
  /** The first closed trading day in this bucket. */
  from: isoStayDateSchema,
  /** The last, inclusive. Equal to `from` on a daily bucket. */
  to: isoStayDateSchema,
  /** How many closed days the figures were assembled from. Never zero — a
   *  bucket with no closed day is not in the answer at all. */
  closedDays: z.number().int().min(1),
  /** Property-wide, counted over the snapshot's own columns. */
  property: performanceFiguresSchema,
  /** And per type. Only types the audit froze a row for in these days appear:
   *  an all-null row for a type with no frozen row would look like a
   *  measurement rather than an absence. */
  byType: z.array(performanceTypeRowSchema),
});

/**
 * What the whole range came to, on the same figures.
 *
 * The counts are summed over every closed day the range reached — the set the
 * buckets partition — and the ratios are divided again from those sums rather
 * than combined from the buckets'. A range total is where averaging a ratio is
 * easiest to reach for and hardest to see, since twelve months' ADRs look like
 * twelve numbers asking to be meaned.
 *
 * `closedDays` may be zero here, unlike on a bucket: a range reaching only into
 * days the audit has not closed has no bucket to hold and is still a range
 * somebody asked about.
 */
export const performanceTotalsSchema = z.object({
  closedDays: z.number().int().min(0),
  property: performanceFiguresSchema,
  byType: z.array(performanceTypeRowSchema),
});

/**
 * Which trading days the performance page is asking about, and how to group
 * them.
 *
 * Field for field {@link revenueReportQuery}, because it is the same
 * declaration — both are `reportRangeQuery()`, so the two ranged report pages
 * take one range picker's worth of controls and one ordering rule, and a `to`
 * before `from` cannot mean one thing on the revenue page and another here.
 *
 * This is also what the performance export takes, on the same terms: an
 * aggregate has no page to drop, so there is nothing for a second shape to
 * differ from and every way for it to drift.
 */
export const performanceReportQuery = reportRangeQuery();

/**
 * The performance page — `FR-RPT-03`.
 *
 * `lastClosedBusinessDate` is the family's stamp and means here exactly what it
 * means on the two pages above: no figure reaches a day the night audit has not
 * closed, whatever range a reader typed. Null on a property whose first night
 * audit has not run, which is a real answer — the buckets are then empty and
 * the totals' ratios are null, and a page that said nothing about why would
 * read as a property that sold nothing.
 *
 * `bucket` is echoed for {@link revenueReportSchema}'s reason, and the buckets
 * are chronological, earliest first.
 */
export const performanceReportSchema = z.object({
  /** How the range was cut, as the answer was actually assembled. */
  bucket: revenueBucketSchema,
  /** The last trading day the night audit has closed. Every figure above stops
   *  here, whatever the query asked for. Null when no day has been closed. */
  lastClosedBusinessDate: isoStayDateSchema.nullable(),
  buckets: z.array(performanceBucketRowSchema),
  totals: performanceTotalsSchema,
});

export const reporting = {
  revenue: oc
    // Under `/reports` rather than `/reporting`, because the console's family is
    // called Reports and a url an operator can read is worth more than matching
    // the module's folder name. A GET with the range in the query string, so a
    // month of the property's takings is a link a manager can keep.
    .route({ method: "GET", path: "/reports/revenue" })
    .input(revenueReportQuery)
    .output(revenueReportSchema),

  roomStatus: oc
    .route({ method: "GET", path: "/reports/room-status" })
    .input(roomStatusReportQuery)
    .output(roomStatusReportSchema),

  performance: oc
    // A route of its own rather than a shape on the revenue one, because
    // `rbac-matrix.md` grants the two separately — a reader who may see
    // occupancy need not be a reader who may see takings. A GET taking the same
    // range as the revenue page, so the two are a link apart for whoever holds
    // both.
    .route({ method: "GET", path: "/reports/performance" })
    .input(performanceReportQuery)
    .output(performanceReportSchema),
};
