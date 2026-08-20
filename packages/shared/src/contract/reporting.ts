// The three Excel exports over the wire — `FR-OPS-03`, "Excel export of
// management data, streamed".
//
// **A contract that oRPC cannot carry, declared here anyway.** Every other file
// in this folder is a router the API implements and the client calls, and the
// compile-time guarantee `index.ts` describes comes from that. These three
// answer with a spreadsheet: a few hundred kilobytes of zip written a chunk at a
// time, which is not JSON and is not a shape a serialiser can validate. So they
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
// to a list cannot quietly stop reaching its export.
//
// **Nothing here says who may run one.** `rbac-matrix.md`'s *Excel export* row
// governs the routes and the list's own row governs what goes in the file, and
// both are resolved by the API. A shape cannot hold an authorisation decision,
// and a second copy of one here would be the matrix written twice.

import { z } from "zod";
import { auditActionSchema, LONGEST_TABLE_NAME } from "./audit.js";
import { stayDateSchema } from "../stay-date.js";
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
 * Under `/exports` rather than beside the list each one draws from, because the
 * three are one act performed on three subjects and the console offers them
 * under one name. The `.xlsx` suffix is on the path deliberately: a browser
 * handed a url with no extension by a person who copied it out of the network
 * panel still saves a file Excel opens.
 */
export const CASH_BOOK_EXPORT_PATH = "exports/cash-book.xlsx";
export const SHIFT_HISTORY_EXPORT_PATH = "exports/shifts.xlsx";
export const CHANGE_LOG_EXPORT_PATH = "exports/change-log.xlsx";

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
