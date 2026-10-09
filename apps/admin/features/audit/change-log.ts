/* The audit screen's decisions: which changes the console asked the API for,
 * which of them a reader is offered at all, and how a snapshot is drawn without
 * any of it passing through a number.
 *
 * Pure, and separate from the hooks and the markup beside it, for the reason
 * `features/payments/payment-day.ts` gives about its own: everything below is a
 * judgement the API does not make for the console — whether what an operator
 * typed is a query the contract will take, which stretch of time a day picker
 * means in the property's own zone, which columns of a change are worth reading
 * first, and which operator is offered the screen.
 *
 * Three rules hold throughout, and `change-log.spec.ts` holds this file to
 * them:
 *
 * 1. **No value out of a snapshot is ever converted.** This is the sharpest one
 *    and it is the reason the wire carries text at all. `contract/audit.ts` and
 *    `audit.service.ts` both state it from their own side: a whole row rendered
 *    by `to_jsonb` carries `bigint` đồng amounts, Postgres `jsonb` numbers are
 *    arbitrary precision, and a JavaScript `number` is not — so an amount is
 *    extracted as text by Postgres and drawn as that text here. Nothing in this
 *    file calls `Number`, `parseInt`, `parseFloat` or `JSON.parse`, and nothing
 *    in the screen beside it does either. A viewer that quietly rounded the
 *    figure it was built to show would be worse than no viewer.
 * 2. **The property's day is a day here and instants on the wire.** The route
 *    filters on `occurred_at`, which is an instant; a person picking a day means
 *    that day in Ho Chi Minh City. {@link dayWindow} is the one place the two
 *    meet, and it produces the half-open window `contract/audit.ts` promises so
 *    a reader stepping day by day does not see midnight's changes twice.
 * 3. **An order that cannot move under the reader.** The route promises a total
 *    order — newest change first, the id breaking a tie — and
 *    {@link changedFirst} only ever partitions the columns of a single change,
 *    which is a set that does not refetch.
 *
 * The screen is read-only, and so is this module: `schema/audit.ts` has no
 * update path and the matrix grants this row a viewer rather than an editor. A
 * helper here that shaped a correction would be this family growing an act the
 * record does not allow.
 */

import type { ApiClient } from "@mariva/api-client";
import {
  AUDIT_PAGE_SIZE,
  auditActionSchema,
  LONGEST_TABLE_NAME,
  type StaffRole,
} from "@mariva/shared";

import { parseLiberalDate } from "@/lib/date-parser";

/* The wire's shapes, read off the client rather than restated — the same
 * argument every other feature makes: `@mariva/shared` types the client from the
 * contract's own schemas, so a field renamed there breaks this file in the pull
 * request that renamed it, where a hand-written interface would compile until it
 * was wrong. */

/** A page of changes, how many the filters matched, and how much of the log the
 *  reader is being shown. */
export type ChangePage = Awaited<ReturnType<ApiClient["audit"]["list"]>>;

/** What `GET /audit-entries` takes. */
export type ChangeListQuery = Parameters<ApiClient["audit"]["list"]>[0];

/** One change as the list draws it. */
export type LoggedChange = ChangePage["entries"][number];

/** How much of the log a reader is being shown. */
export type LogScope = ChangePage["scope"];

/** One change in full: who made it, and every column of the row it landed on. */
export type LoggedChangeDetail = Awaited<
  ReturnType<ApiClient["audit"]["read"]>
>;

/** One column of the changed row, before and after, as text. */
export type ChangedField = LoggedChangeDetail["fields"][number];

/** What happened to the row. */
export type ChangeAction = LoggedChange["action"];

/**
 * Who is offered this screen — the matrix's *Audit log viewer* row, which is
 * `ACCOUNTANT`, `MANAGER` and `ADMIN`.
 *
 * The same three `features/shell/nav-inventory.ts` puts the family behind, and
 * for the same reason: the accountant's `⚠` is about what is in the list rather
 * than about reaching it, so all three are offered the screen and one of them is
 * shown less of the log once they are on it.
 *
 * Not a wall. The API's capability guard is the wall; what this decides is
 * whether a screen is drawn for somebody it would refuse, which is the console's
 * own rule for every other role-gated surface.
 */
export function mayReadTheLog(role: StaffRole): boolean {
  return role === "ACCOUNTANT" || role === "MANAGER" || role === "ADMIN";
}

/**
 * The three shapes a change can take, in the contract's own order.
 *
 * Read off the schema rather than written out, so a fourth member added there
 * appears in the filter the day it exists instead of the day somebody remembers
 * this list.
 */
export const CHANGE_ACTIONS: readonly ChangeAction[] =
  auditActionSchema.options;

/**
 * What each of them is called on screen.
 *
 * A `Record` over the union rather than a lookup with a fallback: a member added
 * to the contract stops this file compiling, where a `?? action` would quietly
 * print a database enum at an accountant.
 */
export const ACTION_LABELS: Record<ChangeAction, string> = {
  INSERT: "Created",
  UPDATE: "Changed",
  DELETE: "Deleted",
};

/** What each scope means, said rather than implied — a reader handed a short
 *  list has no other way to tell a quiet fortnight from a narrowed one. */
export const SCOPE_NOTES: Record<LogScope, string> = {
  financial:
    "Financial entries only — the ledger, payments, the cash drawer and the " +
    "prices they are computed from. Changes to anything else are outside this " +
    "log.",
  everything: "Every change the property records.",
};

/** What the operator has typed into the filters. Strings throughout, because
 *  that is what a form holds; {@link auditFilters} is where they become a
 *  question or a sentence saying why they are not one. */
export interface AuditFilterFields {
  /** A day in the property's own zone, in any spelling `parseLiberalDate`
   *  takes. Empty is every day. */
  readonly day: string;
  /** The physical table, as Postgres names it. Empty is every table. */
  readonly tableName: string;
  /** The row a history link named. Only ever alongside a table. */
  readonly rowId: string;
  /** The member of staff. Empty is everybody, unattended writers included. */
  readonly actorId: string;
  readonly action: ChangeAction | "ANY";
}

/** The filters a screen opens on: every change, most recent first. */
export const DEFAULT_AUDIT_FILTERS: AuditFilterFields = {
  day: "",
  tableName: "",
  rowId: "",
  actorId: "",
  action: "ANY",
};

/** What the screen is asking the route, with the day it was built from beside
 *  it — the heading needs the day, and the query carries two instants that
 *  cannot be read back as one. */
export interface ChangeQuestion {
  readonly input: ChangeListQuery;
  /** The day on screen, `YYYY-MM-DD`, or null for every day at once. */
  readonly day: string | null;
}

/** Either a question the route will take, or the sentence saying why what was
 *  typed is not one. */
export type FilterAttempt =
  | { readonly question: ChangeQuestion }
  | { readonly problem: string };

/** Postgres' own uuid spelling. Checked here so a mistyped id is a sentence
 *  under the field rather than a 400 the operator reads as a broken screen. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether a string is an id a record could be addressed by.
 *
 * Exported because the filters are reached two ways and both have to apply the
 * same test: an operator types one into the field below, and a history link
 * arrives carrying one in the query string, where there is nobody to read a
 * sentence about it. One predicate rather than two spellings of the same
 * pattern, which is how the form and the url cannot come to disagree about what
 * a record id looks like.
 */
export function isRecordId(value: string): boolean {
  return UUID.test(value);
}

/**
 * The half-open window a picked day means, as two instants.
 *
 * **The property's zone and not the browser's.** A console open on a laptop
 * somebody brought back from a conference would otherwise read a different day
 * than the desk beside it. Vietnam keeps no daylight saving, so the offset is a
 * constant rather than a lookup — `business-date.ts` states that, and it is why
 * two string literals get the right answer where a zone with a summer rule would
 * need a table.
 *
 * Midnight to midnight, the second end exclusive, which is the window
 * `contract/audit.ts` takes: a reader stepping day by day over a closed range
 * sees midnight's changes on both days.
 *
 * This is the rollover-free boundary deliberately. The business date rolls at
 * 04:00 and a change log is not a trading day — an entry filed at 02:00 belongs
 * to the night somebody was working, and filing it under the previous day would
 * be the viewer disagreeing with the timestamp it is about to print.
 */
export function dayWindow(isoDay: string): { from: string; to: string } {
  const midnight = Date.parse(`${isoDay}T00:00:00.000${PROPERTY_OFFSET}`);

  return {
    from: new Date(midnight).toISOString(),
    to: new Date(midnight + A_DAY_IN_MS).toISOString(),
  };
}

/** Indochina Time — the offset of `business-date.ts`'s `PROPERTY_TIME_ZONE`, as
 *  a literal because that zone keeps no daylight saving and so has exactly one.
 *  `change-log.spec.ts` pins it against a named instant, so the two cannot
 *  drift apart silently. */
const PROPERTY_OFFSET = "+07:00";
const A_DAY_IN_MS = 24 * 60 * 60 * 1000;

/**
 * What the operator typed, as a question the route will take — or the sentence
 * saying why it is not one.
 *
 * **The record is an address and half of it is not.** `contract/audit.ts`
 * refuses a row id with no table beside it, because `audit_entry_row_idx` is on
 * the pair and every caller holding a row id got it from a record that names the
 * table too. That refusal is mirrored here rather than left to the API, for the
 * reason the day is: a sentence under the field is worth more to the person who
 * typed it than a red toast with a validation path in it.
 *
 * **A day that will not parse stops the question.** Empty is every day and is
 * the screen's own default; something typed and unreadable is a filter the
 * operator believes is in force, and answering with the whole log would be the
 * console silently ignoring them.
 *
 * `reference` is the property's business date, which is what `today` and `-2d`
 * count from. Null before it has been read — the screen holds every question
 * until it has, so a relative day is never resolved against the browser's own
 * clock during the small hours.
 */
export function auditFilters(
  fields: AuditFilterFields,
  reference: string | null,
  offset: number,
): FilterAttempt {
  const tableName = fields.tableName.trim();
  const rowId = fields.rowId.trim();
  const actorId = fields.actorId.trim();
  const typedDay = fields.day.trim();

  if (tableName.length > LONGEST_TABLE_NAME) {
    return {
      problem: `No table is named in more than ${LONGEST_TABLE_NAME} characters, so nothing can match that.`,
    };
  }

  if (rowId !== "" && tableName === "") {
    return {
      problem:
        "A record is a table and a row together. Name the table the row is in, or clear the row.",
    };
  }

  if (rowId !== "" && !isRecordId(rowId)) {
    return { problem: "That is not a record id." };
  }

  if (actorId !== "" && !isRecordId(actorId)) {
    return { problem: "That is not a staff id." };
  }

  if (typedDay !== "" && reference === null) {
    return {
      problem:
        "The property's day has not been read yet, and a day typed here is counted from it.",
    };
  }

  const day =
    typedDay === "" ? null : parseLiberalDate(typedDay, reference ?? "");

  if (typedDay !== "" && day === null) {
    return { problem: "That day could not be read." };
  }

  const window = day === null ? null : dayWindow(day);

  return {
    question: {
      day,
      input: {
        ...(tableName === "" ? {} : { tableName }),
        ...(rowId === "" ? {} : { rowId }),
        ...(actorId === "" ? {} : { actorId }),
        ...(fields.action === "ANY" ? {} : { action: fields.action }),
        ...(window === null ? {} : window),
        limit: AUDIT_PAGE_SIZE,
        offset,
      },
    },
  };
}

/**
 * Who made the change, in words.
 *
 * The unattended writers name nobody and that is a fact rather than a gap —
 * `schema/audit.ts` argues at length that a placeholder staff account would make
 * an unattributable write indistinguishable from an attributed one. So they are
 * named as what they are, and an entry whose actor id survived but whose account
 * has since gone is named as that instead of falling back to the same sentence.
 */
export function actorLabel(change: LoggedChange): string {
  if (change.actorKind === "system") {
    return "The property itself";
  }

  return change.actorName ?? "A member of staff no longer on the books";
}

/**
 * A value out of a snapshot, as it is drawn.
 *
 * **Returned unchanged, always.** This is the last place a đồng amount could
 * lose a digit and it is deliberately the dullest function in the module: the
 * value arrived as the characters Postgres holds, and anything done to it here —
 * a thousands separator, a currency format, a round trip through `Number` —
 * would be the console disagreeing with the record it is showing. `money.ts`'s
 * formatter is for a figure the API typed as an amount; a snapshot column is
 * untyped text out of an arbitrary table, and this screen does not know which of
 * them it is holding.
 *
 * Null is the column that held nothing, or held nothing yet.
 */
export function valueLabel(value: string | null): string {
  return value === null ? NOTHING : value;
}

/** What a column holding nothing is drawn as. An em dash rather than the word,
 *  because the cell beside it may legitimately hold the text "null". */
export const NOTHING = "—";

/**
 * The columns of one change, the touched ones first.
 *
 * `screens.md` says the log answers "who changed protected state and when", and
 * the *what* is almost always two columns of forty. Every column is still drawn
 * — the guest's name beside the amount is how somebody recognises the row they
 * are reading about — but the ones that moved come first, because a reader
 * scrolling to find them is a reader who will stop looking.
 *
 * Stable within each half: the route hands the columns back in name order, and
 * this only ever partitions them, so the same change draws the same way twice.
 */
export function changedFirst(
  fields: readonly ChangedField[],
): readonly ChangedField[] {
  return [
    ...fields.filter((field) => field.changed),
    ...fields.filter((field) => !field.changed),
  ];
}

/** How many columns of a change actually moved — the figure the detail panel
 *  leads with, so a reader knows whether the list below it is worth scanning. */
export function changedCount(fields: readonly ChangedField[]): number {
  return fields.filter((field) => field.changed).length;
}
