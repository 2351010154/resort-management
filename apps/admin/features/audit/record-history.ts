/* The record's own door into the change log: the url a booking, a folio or a
 * guest hands somebody who has a question about it, and the filters the screen
 * reads back out of that url.
 *
 * `docs/screens.md` asks for both halves in one sentence — "Audit is reached
 * from the record, not only from the menu: every booking, folio, invoice and
 * guest record carries a history link that opens the audit view pre-filtered to
 * that record, and the standalone screen with actor, action and date filters
 * remains for sweeps. Whoever opens an audit log arrives with a question about
 * a thing, so the thing carries the door." A link that landed on the unfiltered
 * screen would be a menu entry with extra steps.
 *
 * Pure and separate from the screen beside it, like `change-log.ts`: everything
 * here is a decision about an address rather than about a render, and
 * `record-history.spec.ts` holds it to the two rules that matter.
 *
 * **The address is a pair, and this module cannot write half of one.**
 * `contract/audit.ts` refuses a `rowId` with no `tableName` beside it —
 * `audit_entry_row_idx` is on the pair, so the narrower-looking half alone is
 * the wider scan — and `auditFilters` mirrors that refusal for what an operator
 * types. A link is neither: nobody is there to read the sentence. So
 * {@link recordHistoryHref} takes both or does not compile, and
 * {@link recordHistoryFilters} drops a row id it cannot pair with a table
 * rather than handing the screen a question the route would answer with a 400.
 *
 * **A url is something anyone can type.** It arrives from a bookmark somebody
 * kept for a month, from a chat message with a bracket swallowed, from a
 * repeated parameter. Every one of those reads as no filter at all and the
 * standalone screen opens — which is the answer that costs the reader nothing
 * to recover from, where a crash or a spinner that never resolves is not.
 *
 * The table name is Postgres' own spelling because that is what the log stores:
 * `schema/audit.ts` writes `table_name` from the physical table, and
 * `contract/audit.ts` carries it out untranslated so a reader holding a link and
 * a row is not translating between two spellings of one schema.
 */

import { LONGEST_TABLE_NAME } from "@mariva/shared";

import {
  type AuditFilterFields,
  DEFAULT_AUDIT_FILTERS,
  isRecordId,
} from "./change-log";

/** Where the console draws the change log. */
const AUDIT_PATH = "/audit";

/* The two parameters, spelled as `contract/audit.ts` spells its own fields.
 * Deliberately the same words: a link in the address bar reads as the query it
 * becomes, and a reader comparing the url against the filters on screen is
 * comparing one vocabulary with itself. */
const TABLE_PARAM = "tableName";
const ROW_PARAM = "rowId";

/**
 * The tables the console offers a history from, in Postgres' own spelling.
 *
 * `screens.md` names four records and there are three tables, because the
 * invoice is not one: `schema/folio.ts` holds the provider's number in
 * `folio.invoice_reference`, a column of the account's own row written once
 * when the account is agreed. The invoice's history is the folio's history, and
 * a fourth key here would be this module inventing a table the database does
 * not have.
 *
 * A closed set rather than a string, so a link site cannot quietly ship a table
 * name the log has never held — a filter that matches nothing looks exactly like
 * a record nobody has touched.
 */
export const RECORD_TABLES = {
  booking: "booking",
  folio: "folio",
  guest: "guest",
} as const;

/** One of the tables a record link may name. */
export type RecordTable = (typeof RECORD_TABLES)[keyof typeof RECORD_TABLES];

/**
 * The audit screen, pre-filtered to one record.
 *
 * Both halves of the address are required arguments, which is how the
 * contract's refinement is kept by construction rather than by a check every
 * caller has to remember: there is no call to this function that produces a url
 * carrying a row id alone.
 */
export function recordHistoryHref(
  tableName: RecordTable,
  rowId: string,
): string {
  // `URLSearchParams` rather than a template, so a value is escaped by the
  // thing that knows the encoding rather than by whoever wrote the string.
  const query = new URLSearchParams([
    [TABLE_PARAM, tableName],
    [ROW_PARAM, rowId],
  ]);

  return `${AUDIT_PATH}?${query.toString()}`;
}

/**
 * What the screen opens on, read off the query string it was reached with.
 *
 * Only the record travels in a url. The actor, the act and the day are the
 * sweep's filters and belong to the person doing the sweep, so a history link
 * narrows to the thing and leaves the rest of the log's width where the reader
 * can see it.
 *
 * Nothing here throws and nothing here is a sentence on screen: every reading
 * below either is a record or is no filter at all.
 *
 * - No table, or a table longer than one Postgres could name: no filter. The
 *   bound is the contract's own, and a value past it cannot match a stored row.
 * - A row id with no table: no filter. Half an address is the whole-table scan
 *   the contract refuses, and the console does not guess the other half.
 * - A table with something that is not a row id beside it: no filter, and not
 *   the table on its own. The link was written to ask about one record, and
 *   answering with every change to every booking would be a different question
 *   wearing the answer's clothes.
 */
export function recordHistoryFilters(
  params: Readonly<Record<string, string | string[] | undefined>>,
): AuditFilterFields {
  const tableName = onlyValue(params[TABLE_PARAM]);
  const rowId = onlyValue(params[ROW_PARAM]);

  if (tableName === null || tableName.length > LONGEST_TABLE_NAME) {
    return DEFAULT_AUDIT_FILTERS;
  }

  if (rowId === null) {
    return { ...DEFAULT_AUDIT_FILTERS, tableName };
  }

  if (!isRecordId(rowId)) {
    return DEFAULT_AUDIT_FILTERS;
  }

  return { ...DEFAULT_AUDIT_FILTERS, tableName, rowId };
}

/**
 * One parameter's value, or null for anything that is not one value.
 *
 * A repeated parameter arrives as an array, and two records is one too many to
 * be the record somebody asked about — `app/(auth)/login/page.tsx` reads the
 * destination it was interrupted with the same way, for the same reason.
 * Trimmed, and empty is absent: `/audit?tableName=` is a url a form or a hand
 * edit produces and it names nothing.
 */
function onlyValue(value: string | string[] | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed === "" ? null : trimmed;
}
