// The three sheets M8 owns — what goes in each column of each, and where the
// rows come from.
//
// This is the half of the export that knows what it is exporting.
// `excel-sheet.ts` holds the half that does not, and the split is what makes
// `FR-OPS-03` one mechanism used three times rather than three exports: adding
// the Reports pages at M9 is a fourth method here and no change at all there.
//
// **Every row is read through the list's own service, and no query is written
// in this file.** `CashBookService.list`, `ShiftService.history` and
// `AuditService.list` already decide what their filters mean — that the cash
// book's days are `business_date` and not the instant somebody typed, that a
// shift's days are `opening_business_date` so a 01:00 shift is answerable for
// the day before, that the change log's scope goes into the predicate before
// anything the caller typed. An export that composed its own `select` would be
// a second opinion about all of that, and the first thing to drift would be the
// narrowing. So the reads here are the reads the screens make, with the page
// taken off.
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
  LONGEST_AUDIT_PAGE,
  LONGEST_CASH_BOOK_PAGE,
  LONGEST_SHIFT_PAGE,
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

/** The filters each export was asked for, as the contract decoded them. Taken
 *  off the schema rather than restated, so a filter added there is a compile
 *  error here rather than a column quietly missing from a file. */
export type CashBookExportFilters = z.infer<typeof cashBookExportInput>;
export type ShiftExportFilters = z.infer<typeof shiftHistoryExportInput>;
export type ChangeLogExportFilters = z.infer<typeof changeLogExportInput>;

@Injectable()
export class ManagementExports {
  constructor(
    private readonly cashBook: CashBookService,
    private readonly shifts: ShiftService,
    private readonly audit: AuditService,
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
