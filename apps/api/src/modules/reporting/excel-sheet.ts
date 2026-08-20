// One sheet of management data, written as a stream — the whole of what
// `FR-OPS-03` means by "streamed", and the only place in this tree that produces
// a spreadsheet.
//
// **Nothing here knows what it is exporting.** A caller hands over a list of
// columns, a few lines of stamp and an async source of rows, and gets back
// nothing at all: the bytes went to the writable it named. That is what makes
// three exports one mechanism rather than three — `management-exports.ts`
// decides what a cash book row looks like in a cell, and this file decides what
// a cell looks like in a file, and neither has an opinion about the other.
//
// ## The workbook is never assembled
//
// `WorkbookWriter` is exceljs's streaming writer, and it is the reason this
// module exists at all rather than a `workbook.xlsx.write(response)` one-liner.
// A `Workbook` holds every row until it is asked for bytes, so a year of the
// change log would be the whole year resident in this process and then a second
// copy of it zipped — on the one month somebody actually needs, which is the
// month the property had a problem. The writer instead flushes `sheet1.xml`
// into the zip as rows arrive, so the resident set is one row and one deflate
// window whether the sheet holds fifty rows or fifty thousand.
//
// Two options below are load-bearing rather than tuning:
//
// - **`useSharedStrings: false`.** The shared-string table is the one structure
//   in xlsx that must be complete before it can be written, so turning it on
//   would put every distinct string in the sheet back into memory and undo the
//   streaming this file is for. The cost is a larger file — each string is
//   written inline — and a larger file that streams is the trade this makes
//   deliberately.
// - **`useStyles: true`.** Styles are a fixed, tiny table rather than a growing
//   one, and without them a đồng amount lands in a cell as an undecorated run of
//   digits. The number format is the only style asked for.
//
// Each row is `commit()`ed as it is added and the sheet is committed before the
// workbook, which is the writer's contract for releasing a row: an uncommitted
// row is one it still holds.
//
// ## How a đồng amount becomes a cell — the sharpest decision here
//
// **An amount is written as a number, and the conversion happens at the cell.**
// The reason is what the file is for: an accountant opens it to sum a column,
// and a column of text sums to nothing in every spreadsheet program there is. An
// export that cannot be totalled is a screenshot with extra steps.
//
// That is a real cost and it is worth stating exactly. `schema/pricing.ts` is
// emphatic that a đồng amount taken through a JavaScript `number` is the one
// conversion that makes a figure unrepresentable, and every other path in this
// codebase honours that — `audit.service.ts` splits snapshots into text inside
// Postgres so the driver never parses a `jsonb` number, and `cash-book.service.ts`
// reads a `sum()` back as text and returns to `bigint` from there. An xlsx
// numeric cell has no such option: the format stores a decimal literal and Excel
// reads it into an IEEE double, so the choice is a number or it is not summable.
//
// **The bound, said plainly.** Excel keeps 15 significant decimal digits — a
// tighter limit than the double's own 2^53−1, and the one that actually
// applies. So every đồng amount up to **999,999,999,999,999** — one đồng short
// of a thousand nghìn tỷ, on the order of 38 billion US dollars — lands in the
// cell exactly, and there is no rounding anywhere below it because an integer
// under that bound is representable in a double outright. To exceed it, one row
// of one of these exports would have to carry a single figure near 10^15 đồng:
// a cash-book entry, a drawer's count, or a shift variance of that size. A
// twenty-room resort in Ninh Thuận does not bill that on one line, and if it
// ever did the number would be the least surprising thing about the day.
//
// **And where the bound is exceeded, the cell degrades to exact text rather
// than to a rounded number.** {@link dongCell} is written that way on purpose:
// the promise this file makes is that no figure in the file is ever wrong, not
// that every figure is summable. A cell holding the digits is a cell an
// accountant can read and cannot total, which is an honest answer; a cell
// holding 1,000,000,000,000,000 where the property billed 999,999,999,999,999 +
// 1 is a lie in the one column the file exists for.
//
// **The conversion is the last thing that happens.** `Number(...)` appears once
// in this file, inside {@link dongCell}, one call away from the cell it lands
// in. Nothing on the way out of the database is a `number`: the services hand
// over `bigint`, the column extractors below return `bigint`, and the crossing
// is here where the bound above can be checked against it.
//
// ## Instants are text, and days are the text they already were
//
// A date cell is a double too — days since 1900 — and it carries no zone, so
// Excel reinterprets it against whoever opens the file. A change filed at 02:00
// in Ho Chi Minh City would read as the previous evening on a laptop in Berlin,
// which on an audit export is the file disagreeing with the log it is about. So
// an instant is rendered once, here, in the property's own zone, and written as
// characters. ISO-8601's ordering is lexicographic, so a column of them still
// sorts chronologically — the one thing the numeric form would have bought.
//
// A trading day never becomes a date at all: it arrives as the ten characters
// the column holds and is written as those ten characters, which is
// `FolioLine`'s decision and `cash-book.service.ts`'s, for the reason both give
// — nothing between the query and the file does arithmetic on it.

import { PROPERTY_TIME_ZONE } from "@mariva/shared";
import ExcelJS from "exceljs";
import type { Writable } from "node:stream";

/**
 * The largest đồng amount an xlsx numeric cell holds without losing a digit.
 *
 * Excel's 15-significant-digit limit rather than `Number.MAX_SAFE_INTEGER`,
 * which is nine times larger and would let a figure through that Excel itself
 * rounds on the way in. The header argues what a property would have to bill to
 * reach it.
 */
export const LARGEST_EXACT_DONG_IN_A_CELL = 999_999_999_999_999n;

/**
 * The number format every money column carries.
 *
 * Grouped and with no decimal place, because VND has no minor unit —
 * `money.ts` is the authority for that and it is why there is nothing here to
 * round. The separator is Excel's own, taken from the locale of whoever opens
 * the file, so a Vietnamese install reads 1.250.000 and an English one 1,250,000
 * from the same cell.
 */
const DONG_FORMAT = "#,##0";

/**
 * One column of a sheet, and what it takes out of a row.
 *
 * A union discriminated by which extractor it carries rather than a `kind`
 * field beside a loosely typed getter: a text column whose extractor returns a
 * `bigint` is then a compile error rather than a run of digits in a cell nobody
 * can sum. The three members are the three things these exports actually hold —
 * words, đồng, and an instant.
 *
 * Null is an empty cell and is always meaningful: a drawer nobody has counted,
 * a change nobody was behind, an entry that moved no cash. It is never a
 * placeholder for a value the extractor could not compute.
 */
export type SheetColumn<Row> =
  | {
      readonly header: string;
      readonly width: number;
      readonly text: (row: Row) => string | null;
    }
  | {
      readonly header: string;
      readonly width: number;
      readonly dong: (row: Row) => bigint | null;
    }
  | {
      readonly header: string;
      readonly width: number;
      readonly at: (row: Row) => Date | null;
    };

/**
 * A sheet, as a caller describes one.
 *
 * `rows` is an `AsyncIterable` and not an array, and that is the half of the
 * streaming promise this file cannot keep on its own: a caller that read every
 * row into memory first would have a workbook that streams out of a list that
 * did not. `management-exports.ts` reads each list a page at a time for that
 * reason.
 */
export interface ExcelSheet<Row> {
  /** The tab's own name, which Excel shows at the foot of the window. */
  readonly sheetName: string;
  /** What this is, in the first cell of the file. */
  readonly title: string;
  /** When it was taken, under whose scope, and which filters were in force —
   *  one line each, under the title. A file that does not say which filters
   *  produced it is a file whose totals cannot be checked against anything. */
  readonly stamp: readonly string[];
  readonly columns: readonly SheetColumn<Row>[];
  readonly rows: AsyncIterable<Row>;
}

/**
 * Writes `sheet` into `out` as an xlsx workbook, a row at a time.
 *
 * Returns once the last byte has been handed to the stream. Nothing is buffered
 * here beyond what the zip's deflate window holds, and the header says which
 * two writer options that depends on.
 *
 * **Anything thrown mid-write leaves a truncated file.** By the time the first
 * row is added the response headers are long gone, so a failure here cannot
 * become a status code — the caller destroys the connection instead, which is
 * the one signal that reaches a browser as a failed download rather than as a
 * spreadsheet that opens with half a month in it. Everything that *can* be
 * refused — the filters, the capability, the scope — is refused before this is
 * called.
 */
export async function writeExcelSheet<Row>(
  sheet: ExcelSheet<Row>,
  out: Writable,
): Promise<void> {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: out,
    useStyles: true,
    useSharedStrings: false,
  });

  const worksheet = workbook.addWorksheet(sheet.sheetName);

  // Widths and the money format, and deliberately no `header`: setting one
  // would have exceljs write the header row immediately, at the top of the
  // sheet, above the stamp. The header row is written by hand below so the
  // stamp can come first.
  worksheet.columns = sheet.columns.map((column) => ({
    width: column.width,
    style: "dong" in column ? { numFmt: DONG_FORMAT } : {},
  }));

  worksheet.addRow([sheet.title]).commit();

  for (const line of sheet.stamp) {
    worksheet.addRow([line]).commit();
  }

  // One blank row between what the file is and what is in it, so the header row
  // reads as a header rather than as a fourth line of preamble.
  worksheet.addRow([]).commit();
  worksheet.addRow(sheet.columns.map((column) => column.header)).commit();

  for await (const row of sheet.rows) {
    const cells = sheet.columns.map((column) => cellOf(column, row));

    worksheet.addRow(cells).commit();
  }

  await worksheet.commit();
  await workbook.commit();
}

/**
 * A đồng amount as a cell: a number where every digit survives, and the digits
 * themselves where they would not.
 *
 * The header argues both halves at length. In one sentence: a number is what an
 * accountant can sum, text is what cannot lose a digit, and the crossover is
 * Excel's fifteenth significant digit rather than a figure chosen here.
 *
 * The magnitude is what is compared, so a variance of −10^15 degrades exactly as
 * a takings figure of +10^15 would. Nothing in these exports is that large; the
 * comparison exists so that the day something is, the file says so instead of
 * rounding it.
 */
export function dongCell(amount: bigint): number | string {
  const magnitude = amount < 0n ? -amount : amount;

  return magnitude > LARGEST_EXACT_DONG_IN_A_CELL
    ? amount.toString()
    : Number(amount);
}

/**
 * An instant in the property's own zone, as `YYYY-MM-DD HH:mm`.
 *
 * Assembled from parts rather than from a formatted string, so the result does
 * not move with the ICU version the runtime was built against — a locale's
 * pattern is data and this is a format. `h23` rather than `hour12: false`,
 * because the latter renders midnight as 24 in some locales.
 *
 * To the minute. A management export is read against a day's takings and a
 * shift's handover, and the second a row was written is a precision the change
 * log's own detail view already carries for anybody who needs it.
 */
export function inPropertyZone(at: Date): string {
  const parts = new Map(
    PROPERTY_CLOCK.formatToParts(at).map((part) => [part.type, part.value]),
  );

  const day = `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}`;

  return `${day} ${parts.get("hour")}:${parts.get("minute")}`;
}

/**
 * The trading day of an instant in the property's own zone, `YYYY-MM-DD`.
 *
 * The calendar day and not the business date: the rollover is at 04:00 and this
 * stamps a *file* with the day it was taken, which is a fact about a person at a
 * desk rather than about the property's books. `change-log.ts` draws the same
 * distinction for the audit screen's day picker.
 */
export function propertyDayOf(at: Date): string {
  return inPropertyZone(at).slice(0, 10);
}

const PROPERTY_CLOCK = new Intl.DateTimeFormat("en-GB", {
  timeZone: PROPERTY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function cellOf<Row>(
  column: SheetColumn<Row>,
  row: Row,
): string | number | null {
  if ("dong" in column) {
    const amount = column.dong(row);

    return amount === null ? null : dongCell(amount);
  }

  if ("at" in column) {
    const at = column.at(row);

    return at === null ? null : inPropertyZone(at);
  }

  return column.text(row);
}
