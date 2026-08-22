// The six sheets — what goes in each column of each, and where the rows come
// from.
//
// This is the half of the export that knows what it is exporting.
// `excel-sheet.ts` holds the half that does not, and the split is what makes
// `FR-OPS-03` one mechanism used six times rather than six exports: the
// Reports pages arrived at M9 as three more methods here and two new column
// kinds there — a count, because a room tally has to be summable and there was
// no numeric column that was not đồng, and then a proportion, because
// `FR-RPT-03`'s occupancy is neither whole nor money and a percentage stored as
// text is a column nobody can chart. Each kind arrived with the sheet that
// needed it and none was anticipated.
//
// **Every row is read through the list's own service, and no query is written
// in this file.** `CashBookService.list`, `ShiftService.history`,
// `AuditService.list` and `ReportQueries` already decide what their filters mean — that the cash
// book's days are `business_date` and not the instant somebody typed, that a
// shift's days are `opening_business_date` so a 01:00 shift is answerable for
// the day before, that the change log's scope goes into the predicate before
// anything the caller typed. An export that composed its own `select` would be
// a second opinion about all of that, and the first thing to drift would be the
// narrowing. So the reads here are the reads the screens make, with the page
// taken off.
//
// **The three report sheets are the one exception to the paging below, and they
// are not an exception to the rule above it.** A report is an aggregate: a
// bucket per day, month or quarter of the range, or a row per room type. There
// is no page to walk because the service does not hand out one — the whole
// answer is the same object the screen draws, which is exactly the property this
// file is arranged to keep. {@link theseRows} yields it, so the writer's
// interface is unchanged and the streaming below still holds for the three
// sheets that need it.
//
// **The rows arrive a page at a time and are never all resident.**
// {@link eachRowOf} walks each list with the same `limit`/`offset` the console
// pages with, yielding rows into the writer as they arrive, so a year of the
// change log is neither a workbook in memory nor a result set in memory. The
// page size is each contract's own `LONGEST_*_PAGE` — the figure the contract
// already calls the most rows this list hands over at once, rather than a fourth
// number invented here.
//
// One honest cost of paging by offset inside one transaction: Postgres takes a
// fresh snapshot per statement at the default isolation, and all three lists are
// ordered newest-first, so an entry recorded *while* a file is being written
// shifts the window and can put one row in the file twice. It cannot drop a row
// — all three tables are append-only, which `cash-book.service.ts`,
// `schema/audit.ts` and the shift's close all state from their own side. The
// alternative was a keyset cursor, which means re-deriving each list's ordering
// and predicate here, which is the one thing this file is arranged not to do.
//
// **The change log export reads the list and never the detail.** That is the
// whole of what keeps a withheld value withheld: `migrations/0041` writes the
// string `withheld` in place of a guest's CCCD and a password digest, and
// `audit.service.ts` does not select `before` or `after` as columns on the list
// at all. There is nothing in {@link LoggedChange} for this file to un-withhold,
// and the way it stays that way is that the sheet's columns are that type's own
// fields rather than a second query reaching past it.
//
// **Enum values are rendered, not translated.** A category arrives as
// `TAXES_AND_FEES` and lands in the cell as "Taxes and fees" —
// {@link readable} is a mechanical rendering of the value stored, so there is
// nothing here to keep in step with anything. The console's own labels carry the
// Vietnamese beside the English because a screen has room for both; a column an
// accountant sorts does not, and a second vocabulary maintained in this file
// would be a third opinion about what a category is called.

import {
  type cashBookExportInput,
  type changeLogExportInput,
  HOUSEKEEPING_STATUSES,
  LONGEST_AUDIT_PAGE,
  LONGEST_CASH_BOOK_PAGE,
  LONGEST_SHIFT_PAGE,
  type performanceReportQuery,
  type RevenueBucket,
  type revenueReportQuery,
  type shiftHistoryExportInput,
} from "@mariva/shared";
import { Injectable } from "@nestjs/common";
import type { z } from "zod";
import type { DbExecutor } from "../../database/database.module.js";
import type { LoggedChange } from "../audit/audit.service.js";
import { AuditService } from "../audit/audit.service.js";
import type { CashBookEntry } from "../operations/cash-book.service.js";
import { CashBookService } from "../operations/cash-book.service.js";
import type { Shift } from "../operations/shift.service.js";
import { ShiftService } from "../operations/shift.service.js";
import {
  type ExcelSheet,
  inPropertyZone,
  type SheetColumn,
} from "./excel-sheet.js";
import {
  type PerformanceBucketRow,
  type PerformanceFigures,
  PerformanceQueries,
  type PerformanceTotals,
} from "./performance-queries.service.js";
import type {
  RevenueBucketRow,
  RoomStatusType,
} from "./report-queries.service.js";
import { ReportQueries } from "./report-queries.service.js";

/** The filters each export was asked for, as the contract decoded them. Taken
 *  off the schema rather than restated, so a filter added there is a compile
 *  error here rather than a column quietly missing from a file. */
export type CashBookExportFilters = z.infer<typeof cashBookExportInput>;
export type ShiftExportFilters = z.infer<typeof shiftHistoryExportInput>;
export type ChangeLogExportFilters = z.infer<typeof changeLogExportInput>;
/** The revenue page's own query, whole. A report has no page to drop, so
 *  `contract/reporting.ts` declares one shape for the screen and for the file,
 *  and this is it. */
export type RevenueExportFilters = z.infer<typeof revenueReportQuery>;
/** The performance page's own query, whole, for the reason the revenue one is:
 *  `contract/reporting.ts` declares one shape for the screen and for the file,
 *  and a second export-shaped copy could only drift from it. */
export type PerformanceExportFilters = z.infer<typeof performanceReportQuery>;

/**
 * One line of the performance sheet: one bucket's figures for one scope.
 *
 * Flat, because a cell is flat. The six figures are spread from whichever
 * {@link PerformanceFigures} the row is about — the bucket's property row or one
 * of its types — and nothing is recomputed on the way, which is what keeps the
 * "never averaged" rule `performance-queries.service.ts` holds structurally from
 * being quietly undone by a spreadsheet.
 */
export interface PerformanceSheetRow extends PerformanceFigures {
  readonly from: string;
  readonly to: string;
  readonly closedDays: number;
  /** {@link PROPERTY_WIDE} on the bucket's own row, and the room type's code on
   *  each row under it. */
  readonly scope: string;
}

/** What the scope column says on the row counted over the whole property. A
 *  word rather than a blank, because a blank in a column a reader filters on is
 *  a row they cannot select — and rather than a code, because it must not
 *  collide with one `room_type` could hold. */
const PROPERTY_WIDE = "Property";

@Injectable()
export class ManagementExports {
  constructor(
    private readonly cashBook: CashBookService,
    private readonly shifts: ShiftService,
    private readonly audit: AuditService,
    private readonly reports: ReportQueries,
    private readonly performance: PerformanceQueries,
  ) {}

  /**
   * The property's own money over a stretch of trading days — `FR-OPS-02`'s
   * book as a file.
   *
   * **Thu and Chi are two money columns rather than one signed one**, which is
   * what the screen draws and what a cash book is: everything on the left came
   * in and everything on the right went out, and each column totals on its own.
   * A single signed column would need a `Side` beside it to be readable and
   * would sum to a net figure that hides a month which took eighty million and
   * spent seventy-nine — `cashBookPageSchema` refuses to send that net for the
   * same reason.
   *
   * **No totals row.** The two figures the screen prints come from a separate
   * aggregate over the whole predicate, and writing them into a cell under a
   * column that Excel is also summing would give a reader two totals that agree
   * until somebody filters the sheet. The columns are numeric precisely so the
   * spreadsheet can answer that question itself.
   *
   * The two ids come last. They are how a row here is matched back to the book
   * and to the drawer it moved through, which is a reconciliation rather than
   * something anybody reads down a page.
   */
  cashBookSheet(
    exec: DbExecutor,
    filters: CashBookExportFilters,
    takenAt: Date,
  ): ExcelSheet<CashBookEntry> {
    return {
      sheetName: "Cash book",
      title: "Cash book — the property's own income and expense (thu chi)",
      stamp: [
        takenLine(takenAt),
        filterLine([
          ["from", filters.from?.toString()],
          ["to", filters.to?.toString()],
          ["side", filters.direction && readable(filters.direction)],
          ["category", filters.category && readable(filters.category)],
          ["method", filters.method && readable(filters.method)],
        ]),
      ],
      columns: CASH_BOOK_COLUMNS,
      rows: eachRowOf(LONGEST_CASH_BOOK_PAGE, async (limit, offset) => {
        const page = await this.cashBook.list(exec, {
          from: filters.from,
          to: filters.to,
          direction: filters.direction,
          category: filters.category,
          method: filters.method,
          limit,
          offset,
        });

        return page.entries;
      }),
    };
  }

  /**
   * What happened at the desk over a stretch of trading days — `FR-OPS-01`'s
   * history as a file, variances and handover notes included.
   *
   * `operatorId` arrives already narrowed where the caller is narrowed, exactly
   * as `shift.controller.ts` narrows the list: this method takes the scope as a
   * fact and does not resolve it, for the reason `shift.service.ts` gives about
   * its own — a manager reading a receptionist's day is a call it cannot tell
   * apart from the receptionist's own.
   *
   * **The variance is the API's figure and is not recomputed.** It is a column
   * of the row, null on a drawer nobody has counted, and a file that subtracted
   * the count from the float and the takings would be a second opinion about the
   * one number the whole close exists to produce. The three terms it is made of
   * are in the file beside it, so the arithmetic is checkable without being
   * repeated.
   */
  shiftHistorySheet(
    exec: DbExecutor,
    filters: ShiftExportFilters,
    ownShiftsOnly: boolean,
    takenAt: Date,
  ): ExcelSheet<Shift> {
    return {
      sheetName: "Shifts",
      title: "Shift history — drawers, counts, variances and handovers",
      stamp: [
        takenLine(takenAt),
        filterLine([
          ["from", filters.from?.toString()],
          ["to", filters.to?.toString()],
          ["operator", filters.operatorId],
        ]),
        ownShiftsOnly
          ? "Scope: your own shifts. Another operator's drawer is outside " +
            "this file."
          : "Scope: every operator's drawer.",
      ],
      columns: SHIFT_COLUMNS,
      rows: eachRowOf(LONGEST_SHIFT_PAGE, async (limit, offset) => {
        const page = await this.shifts.history(exec, {
          operatorId: filters.operatorId,
          from: filters.from,
          to: filters.to,
          limit,
          offset,
        });

        return page.shifts;
      }),
    };
  }

  /**
   * Who changed protected state, when — `FR-AUD-02`'s list as a file.
   *
   * **The snapshots are not here, and their absence is the design.** The list
   * this reads does not select `before` or `after`, so the file cannot carry a
   * value the trigger withheld — the header says why that is a structural answer
   * rather than a promise. It is also the only sensible one for a spreadsheet:
   * fifty whole rows of an arbitrary table would be a file measured in megabytes
   * behind eight columns nobody could read.
   *
   * `financialOnly` is the matrix's ⚠ on this row, resolved by the caller and
   * taken here as a fact — and it is stamped into the file, because a reader
   * handed a short sheet has no other way to tell a quiet fortnight from a
   * narrowed one. `auditEntryPageSchema` carries the same fact back to the
   * screen for the same reason.
   */
  changeLogSheet(
    exec: DbExecutor,
    filters: ChangeLogExportFilters,
    financialOnly: boolean,
    takenAt: Date,
  ): ExcelSheet<LoggedChange> {
    return {
      sheetName: "Change log",
      title: "Change log — who changed what, and when",
      stamp: [
        takenLine(takenAt),
        filterLine([
          ["from", filters.from && inPropertyZone(new Date(filters.from))],
          ["to", filters.to && inPropertyZone(new Date(filters.to))],
          ["record type", filters.tableName],
          ["record", filters.rowId],
          ["actor", filters.actorId],
          ["change", filters.action && readable(filters.action)],
        ]),
        financialOnly
          ? "Scope: financial entries only — the ledger, payments, the cash " +
            "drawer and the prices they are computed from."
          : "Scope: every change the property records.",
      ],
      columns: CHANGE_LOG_COLUMNS,
      rows: eachRowOf(LONGEST_AUDIT_PAGE, async (limit, offset) => {
        const page = await this.audit.list(exec, {
          tableName: filters.tableName,
          rowId: filters.rowId,
          actorId: filters.actorId,
          action: filters.action,
          // The window arrives as two ISO instants and the column is a
          // `timestamptz`, which is the same crossing `audit.controller.ts`
          // makes at its own edge and for the same reason: once, where it can
          // be seen, rather than inside the service where every caller would
          // make it again.
          from: filters.from === undefined ? undefined : new Date(filters.from),
          to: filters.to === undefined ? undefined : new Date(filters.to),
          limit,
          offset,
          financialOnly,
        });

        return page.entries;
      }),
    };
  }

  /**
   * What the property earned over a stretch of trading days — `FR-RPT-02`'s
   * revenue page as a file.
   *
   * **Asynchronous, unlike the three above, and the stamp is why.** A list's
   * stamp is the filters the operator typed, which this method already holds; a
   * report's stamp is the last business date the night audit closed, which is a
   * fact that has to be read. So the sheet is assembled after the answer rather
   * than around a promise of one, and `reporting.controller.ts` awaits it before
   * a byte is written — which it can, because the read is refusable and the
   * status line is still there until `writeExcelSheet` is reached.
   *
   * **The whole report is resident, and that is not the compromise it looks
   * like.** The buckets are one row per day, month or quarter of the range: a
   * decade by day is under four thousand rows, and by month a hundred and
   * twenty. There is no page to walk because the screen does not have one
   * either, so this file's rule — the file holds what the screen holds — is kept
   * by handing the same object over rather than by re-asking for it in slices.
   *
   * **No totals row, for `cashBookSheet`'s reason.** The four figures the page
   * prints come from the service's own aggregate over every closed day in the
   * range; writing them into a cell under columns Excel is also summing would
   * give a reader two totals that agree until somebody filters the sheet. They
   * go in the stamp instead, where they read as what the file is about rather
   * than as a row of it.
   */
  async revenueSheet(
    exec: DbExecutor,
    filters: RevenueExportFilters,
    takenAt: Date,
  ): Promise<ExcelSheet<RevenueBucketRow>> {
    const report = await this.reports.revenue(exec, filters);

    return {
      sheetName: "Revenue",
      title: "Revenue — what the property earned, by closed trading day",
      stamp: [
        takenLine(takenAt),
        filterLine([
          ["from", filters.from?.toString()],
          ["to", filters.to?.toString()],
          ["grouped by", BUCKET_IN_A_FILE[filters.bucket]],
        ]),
        boundaryLine(report.lastClosedBusinessDate),
        `Range totals over ${report.totals.closedDays} closed days · ` +
          `room ${report.totals.roomRevenueVnd} · ` +
          `other ${report.totals.otherRevenueVnd} · ` +
          `penalties ${report.totals.penaltyRevenueVnd} · ` +
          `total ${report.totals.totalVnd} đồng`,
      ],
      columns: REVENUE_COLUMNS,
      rows: theseRows(report.buckets),
    };
  }

  /**
   * How the property's rooms are standing — `FR-RPT-02`'s room-status page as a
   * file.
   *
   * **Live, and the file says so in two places.** The stamp carries the instant
   * the rooms were counted as well as the family's boundary, because a
   * spreadsheet outlives the screen it was taken from: a reader opening this
   * next week has no other way to know that these counts are a photograph of one
   * minute rather than a summary of a closed day. `roomStatusReportSchema` draws
   * the same distinction on the wire and for the same reason.
   *
   * One row per type with a column per status, rather than a row per pair. A
   * property has five types and four conditions, and a grid an eye reads across
   * is what somebody comparing the floors is after — where twenty rows of
   * type-status-count is a pivot table waiting to be built. The columns come from
   * `HOUSEKEEPING_STATUSES`, so a fifth condition becomes a column without this
   * file being touched.
   */
  async roomStatusSheet(
    exec: DbExecutor,
    takenAt: Date,
  ): Promise<ExcelSheet<RoomStatusType>> {
    const report = await this.reports.roomStatus(exec);

    return {
      sheetName: "Room status",
      title: "Room status — where every room stands, counted live",
      stamp: [
        takenLine(takenAt),
        `Counted ${inPropertyZone(report.takenAt)} · ${report.rooms} rooms · ` +
          "a housekeeping status is where a room stands now, so this is a " +
          "count taken at that minute and not a closed day read back",
        boundaryLine(report.lastClosedBusinessDate),
        filterLine([]),
      ],
      columns: ROOM_STATUS_COLUMNS,
      rows: theseRows(report.byType),
    };
  }

  /**
   * How the property performed over a stretch of closed trading days —
   * `FR-RPT-03`'s occupancy, ADR and RevPAR as a file.
   *
   * **The ratios are `PerformanceQueries`' and are not derived here.** The
   * counts travel in the file beside them, so the arithmetic is checkable
   * without being repeated — which is {@link shiftHistorySheet}'s argument about
   * the variance, and it is sharper on this sheet: that service divides in
   * exactly one place so that a month's ADR can only ever be Σ revenue / Σ rooms
   * sold rather than the mean of thirty daily ADRs, and a second division
   * written here would be the one that averages. Asynchronous for
   * {@link revenueSheet}'s reason as well — a report's stamp is a fact that has
   * to be read.
   *
   * **One row per bucket per scope, and not the grid {@link roomStatusSheet}
   * argues for.** That argument turns on the status set being fixed and small:
   * four conditions come from `HOUSEKEEPING_STATUSES` and a fifth arrives as a
   * fifth column. Neither half holds here. The second axis is the property's
   * room types, which are its own data — a column per type is a sheet whose
   * shape changes when somebody adds one, and at three figures per type it is
   * three columns each. And the first axis is unbounded: `roomStatusSheet` has
   * one row per type where this has one per day of whatever range was asked for.
   * So the two files disagree about their shape because their axes differ, not
   * because they were written by different hands.
   *
   * Within a bucket the property row comes first and its types follow in the
   * order the service answered in, which is `ROOM_TYPE_CODES` ladder order — so
   * the sheet reads as the page does and a diff between two files is a diff
   * about figures rather than about ordering.
   *
   * **The null ratios stay null all the way to the cell.** A property with
   * nothing on sale has no occupancy and a night that sold nothing has no ADR;
   * `excel-sheet.ts` writes a null as an empty cell, and that is the honest
   * rendering. A nought in its place is a number somebody averages.
   *
   * **No totals row, for {@link cashBookSheet}'s reason** — the range totals go
   * in the stamp, where they read as what the file is about rather than as a row
   * of it that breaks every filter and sum a reader applies afterwards.
   */
  async performanceSheet(
    exec: DbExecutor,
    filters: PerformanceExportFilters,
    takenAt: Date,
  ): Promise<ExcelSheet<PerformanceSheetRow>> {
    const report = await this.performance.performance(exec, filters);

    return {
      sheetName: "Performance",
      title:
        "Performance — occupancy, ADR and RevPAR over closed trading days",
      stamp: [
        takenLine(takenAt),
        filterLine([
          ["from", filters.from?.toString()],
          ["to", filters.to?.toString()],
          ["grouped by", BUCKET_IN_A_FILE[filters.bucket]],
        ]),
        boundaryLine(report.lastClosedBusinessDate),
        rangeTotalsLine(report.totals),
      ],
      columns: PERFORMANCE_COLUMNS,
      rows: theseRows(everyScopeIn(report.buckets)),
    };
  }
}

/**
 * A bucket's rows, property first and then its types.
 *
 * The one place the report's two-level shape is flattened, and it does nothing
 * else: every figure is carried across as it arrived. The property row is the
 * service's own `property`, which is counted over `night_audit_snapshot`'s own
 * columns rather than assembled from the type rows — so a file in which the
 * types do not add up to the property is a file reporting what the audit froze
 * rather than a fault in this function.
 */
function everyScopeIn(
  buckets: readonly PerformanceBucketRow[],
): readonly PerformanceSheetRow[] {
  return buckets.flatMap((bucket) => {
    const when = {
      from: bucket.from,
      to: bucket.to,
      closedDays: bucket.closedDays,
    };

    return [
      { ...when, scope: PROPERTY_WIDE, ...bucket.property },
      ...bucket.byType.map((type) => ({
        ...when,
        scope: type.roomType,
        ...type,
      })),
    ];
  });
}

/**
 * The performance range totals, as the one stamp line they belong on.
 *
 * Every figure is the service's, printed. A ratio with no denominator behind it
 * is named rather than left blank: a stamp is a sentence, and a gap in one reads
 * as an oversight where an empty cell in a column reads as an absence.
 */
function rangeTotalsLine(totals: PerformanceTotals): string {
  const held = totals.property;

  return (
    `Range totals over ${totals.closedDays} closed days · ` +
    `sellable ${held.sellableRooms} · sold ${held.roomsSold} · ` +
    `net room revenue ${held.netRoomRevenueVnd} đồng · ` +
    `occupancy ${asPercentage(held.occupancy)} · ` +
    `ADR ${measured(held.adrVnd)} · RevPAR ${measured(held.revparVnd)}`
  );
}

/** A figure with no denominator behind it, in words.
 *  `performance-queries.service.ts` is the authority for when that happens:
 *  nothing was on sale, or nothing sold. */
const NO_DENOMINATOR = "not measured";

/** A fraction as a percentage, to the one decimal place the cells carry. */
function asPercentage(fraction: number | null): string {
  return fraction === null ? NO_DENOMINATOR : `${(fraction * 100).toFixed(1)}%`;
}

/** A đồng figure, or the words for the absence of one. */
function measured(amount: bigint | null): string {
  return amount === null ? NO_DENOMINATOR : `${amount} đồng`;
}

/**
 * Rows a service handed over whole, as the writer's interface takes them.
 *
 * The reports are aggregates and arrive complete — the header says why that is
 * not the paging rule being broken. A generator rather than a cast, because
 * `ExcelSheet.rows` is an `AsyncIterable` so that a sheet *can* stream, and a
 * sheet that does not need to should say so in one line rather than by widening
 * the type every other sheet depends on.
 */
async function* theseRows<Row>(rows: readonly Row[]): AsyncGenerator<Row> {
  for (const row of rows) {
    yield row;
  }
}

/**
 * Every row a list holds under its filters, a page at a time.
 *
 * The one place these exports read more than a page, and it is written as a
 * generator so that a row reaches the workbook writer as soon as it is read: an
 * array built here first would be the result set resident in this process,
 * which is the memory profile the streaming writer exists to avoid, moved one
 * step earlier.
 *
 * A short page ends the walk. Every list here promises a total order and returns
 * at most `limit` rows, so a page below that size is the last one; asking again
 * would be one round trip per export to be told what the short page already
 * said.
 */
async function* eachRowOf<Row>(
  pageSize: number,
  read: (limit: number, offset: number) => Promise<readonly Row[]>,
): AsyncGenerator<Row> {
  let offset = 0;

  for (;;) {
    const page = await read(pageSize, offset);

    for (const row of page) {
      yield row;
    }

    if (page.length < pageSize) {
      return;
    }

    offset += page.length;
  }
}

const REVENUE_COLUMNS: readonly SheetColumn<RevenueBucketRow>[] = [
  { header: "From", width: 13, text: (held) => held.from },
  { header: "To", width: 13, text: (held) => held.to },
  { header: "Closed days", width: 12, count: (held) => held.closedDays },
  { header: "Room revenue", width: 18, dong: (held) => held.roomRevenueVnd },
  { header: "Other revenue", width: 18, dong: (held) => held.otherRevenueVnd },
  { header: "Penalties", width: 16, dong: (held) => held.penaltyRevenueVnd },
  { header: "Total", width: 18, dong: (held) => held.totalVnd },
];

/**
 * The bucket, then the scope, then the counts, then the three ratios they are
 * divisions of.
 *
 * The counts come before the ratios deliberately: a reader checking a figure
 * reads left to right along the row it was computed from, and a reader who only
 * wants the KPI reads the last three columns. `Scope` sits between the bucket
 * and the figures because it completes the row's identity — `from`, `to` and
 * `scope` together are what make a row unique, and having the columns left of
 * the first figure be exactly that key is what lets a reader sort or pivot on
 * them without thinking about it.
 *
 * `Occupancy` is a `fraction` and therefore a *number* under a percent format
 * rather than text: the cell holds `roomsSold / sellableRooms` exactly as the
 * service computed it, so a reading above 100% shows as 120.0% rather than
 * being clipped, and the column can still be charted and compared. ADR and
 * RevPAR are đồng and take the money column, which is what makes them summable
 * and what degrades them to exact text past Excel's fifteenth digit.
 */
const PERFORMANCE_COLUMNS: readonly SheetColumn<PerformanceSheetRow>[] = [
  { header: "From", width: 13, text: (held) => held.from },
  { header: "To", width: 13, text: (held) => held.to },
  { header: "Closed days", width: 12, count: (held) => held.closedDays },
  { header: "Scope", width: 14, text: (held) => held.scope },
  { header: "Sellable rooms", width: 15, count: (held) => held.sellableRooms },
  { header: "Rooms sold", width: 12, count: (held) => held.roomsSold },
  {
    header: "Net room revenue",
    width: 18,
    dong: (held) => held.netRoomRevenueVnd,
  },
  { header: "Occupancy", width: 12, fraction: (held) => held.occupancy },
  { header: "ADR", width: 16, dong: (held) => held.adrVnd },
  { header: "RevPAR", width: 16, dong: (held) => held.revparVnd },
];

/**
 * One column per condition, derived from the contract's own tuple.
 *
 * `readable` renders the header, so `OUT_OF_ORDER` lands as "Out of order" and
 * a fifth status added to `HOUSEKEEPING_STATUSES` arrives with a header nobody
 * had to write. The count is read off the row's own `byStatus`, which the
 * service zero-fills for every status — so a type with no dirty room is a nought
 * in the cell rather than an empty one, and the file says the property has
 * nothing dirty of that type instead of saying nothing.
 */
const ROOM_STATUS_COLUMNS: readonly SheetColumn<RoomStatusType>[] = [
  { header: "Room type", width: 20, text: (type) => readable(type.roomType) },
  { header: "Rooms", width: 10, count: (type) => type.rooms },
  ...HOUSEKEEPING_STATUSES.map((status) => ({
    header: readable(status),
    width: 14,
    count: (type: RoomStatusType) =>
      type.byStatus.find((count) => count.status === status)?.rooms ?? 0,
  })),
];

const CASH_BOOK_COLUMNS: readonly SheetColumn<CashBookEntry>[] = [
  { header: "Trading day", width: 13, text: (entry) => entry.businessDate },
  { header: "Recorded at", width: 17, at: (entry) => entry.recordedAt },
  { header: "Category", width: 26, text: (entry) => readable(entry.category) },
  { header: "Method", width: 15, text: (entry) => readable(entry.method) },
  {
    header: "Thu",
    width: 16,
    dong: (entry) => (entry.direction === "INCOME" ? entry.amount : null),
  },
  {
    header: "Chi",
    width: 16,
    dong: (entry) => (entry.direction === "EXPENSE" ? entry.amount : null),
  },
  { header: "Standing", width: 16, text: standingOf },
  { header: "Recorded by", width: 24, text: (entry) => entry.recordedByName },
  { header: "Note", width: 60, text: (entry) => entry.note },
  { header: "Drawer", width: 38, text: (entry) => entry.shiftId },
  { header: "Entry", width: 38, text: (entry) => entry.id },
];

const SHIFT_COLUMNS: readonly SheetColumn<Shift>[] = [
  {
    header: "Trading day",
    width: 13,
    text: (shift) => shift.openingBusinessDate,
  },
  { header: "Operator", width: 24, text: (shift) => shift.operatorName },
  { header: "Opened at", width: 17, at: (shift) => shift.openedAt },
  { header: "Closed at", width: 17, at: (shift) => shift.closedAt },
  { header: "Opening float", width: 16, dong: (shift) => shift.openingFloat },
  { header: "Cash taken", width: 16, dong: (shift) => shift.cashTaken },
  { header: "Cash book net", width: 16, dong: (shift) => shift.cashBookNet },
  { header: "Counted", width: 16, dong: (shift) => shift.closingCount },
  { header: "Variance", width: 16, dong: (shift) => shift.variance },
  { header: "Handover note", width: 60, text: (shift) => shift.handoverNote },
  { header: "Operator id", width: 38, text: (shift) => shift.operatorId },
  { header: "Shift", width: 38, text: (shift) => shift.id },
];

const CHANGE_LOG_COLUMNS: readonly SheetColumn<LoggedChange>[] = [
  { header: "Occurred at", width: 17, at: (change) => change.occurredAt },
  { header: "Change", width: 12, text: (change) => readable(change.action) },
  { header: "Record type", width: 26, text: (change) => change.tableName },
  { header: "Actor", width: 24, text: (change) => change.actorName },
  {
    header: "Behind it",
    width: 12,
    text: (change) => readable(change.actorKind),
  },
  { header: "Record", width: 38, text: (change) => change.rowId },
  { header: "Actor id", width: 38, text: (change) => change.actorId },
  { header: "Entry", width: 38, text: (change) => change.id },
];

/**
 * Whether an entry still stands, in the three states the book gives it.
 *
 * Read off the two ids the row already carries rather than asked a second time
 * — `cashBookEntrySchema` puts `reversedByEntryId` on the row precisely so a
 * reader does not have to.
 */
function standingOf(entry: CashBookEntry): string {
  if (entry.reversesEntryId !== null) {
    return "A correction";
  }

  return entry.reversedByEntryId === null ? "Stands" : "Corrected";
}

/** How a range was cut, in the words the file uses for it. A `Record` over the
 *  union rather than `readable`, because "Day" alone reads as a column heading
 *  where the stamp needs a phrase. */
const BUCKET_IN_A_FILE: Record<RevenueBucket, string> = {
  DAY: "each trading day",
  MONTH: "each month",
  QUARTER: "each quarter",
};

/**
 * The boundary every report page and every report file carries.
 *
 * Worded as `screens.md` words it — a promise about what is *not* here rather
 * than a claim about where each figure came from — because this file mixes a
 * frozen snapshot with a live ledger sum and a reader is owed the distinction.
 * A property whose audit has never run gets a sentence rather than a blank,
 * since an empty sheet with no explanation reads as a property that earned
 * nothing.
 */
function boundaryLine(lastClosedBusinessDate: string | null): string {
  return lastClosedBusinessDate === null
    ? "Boundary: the night audit has closed no trading day yet, so there is " +
        "nothing here to report on."
    : `Boundary: nothing here reaches past ${lastClosedBusinessDate}, the last ` +
        "trading day the night audit has closed.";
}

/** When this file was taken, and in whose clock. The zone is named because the
 *  file outlives the session that produced it and every instant in it is that
 *  zone's. */
function takenLine(takenAt: Date): string {
  return `Taken ${inPropertyZone(takenAt)} · Asia/Ho_Chi_Minh`;
}

/**
 * The filters that produced the file, in one line.
 *
 * Written out even when none were applied, because "no filter" and "the filter
 * did not reach the export" produce the same rows on a quiet week and a reader
 * has no other way to tell them apart. Absent filters are omitted rather than
 * printed as empty, so the line reads as what was asked rather than as a form.
 */
function filterLine(
  named: readonly (readonly [string, string | undefined])[],
): string {
  const applied = named
    .filter(([, value]) => value !== undefined)
    .map(([label, value]) => `${label} ${value}`);

  return applied.length === 0
    ? "Filters: none — every row this reader may see"
    : `Filters: ${applied.join(" · ")}`;
}

/**
 * A stored enum as a person reads it: `TAXES_AND_FEES` becomes "Taxes and
 * fees".
 *
 * Mechanical on purpose. A map from each value to a phrase would be a second
 * vocabulary to keep in step with the contract, and the first member added
 * without an entry in it would print a database enum at an accountant.
 */
function readable(value: string): string {
  const words = value.toLowerCase().replaceAll("_", " ");

  return words.charAt(0).toUpperCase() + words.slice(1);
}
