// Reading the change log — `FR-AUD-02`, the viewer half of the table
// `schema/audit.ts` writes. Who changed what, when, and what it looked like
// before they did.
//
// **Two routes over one row of the matrix.** `audit.read` — "Audit log viewer" —
// governs both, and no key was invented for either. The row reads
// `ACCOUNTANT: ⚠`, `MANAGER: ✅`, `ADMIN: ✅` with the note "ACC: financial
// entries only", and that note is the whole of the scoping: a manager reads the
// log and an accountant reads the money in it. Which tables count as money is a
// decision the *server* owns — `modules/audit/financial-tables.ts` names them
// and says why — because a list the console could see would be a list the
// console could argue with. What travels back is {@link auditScopeSchema}, so a
// narrowed reader is told the answer is narrowed rather than left to infer it
// from a short list.
//
// **The list and the entry are two routes because they are two questions.**
// `screens.md` draws the line: "Audit is reached from the record, not only from
// the menu: every booking, folio, invoice and guest record carries a history
// link that opens the audit view pre-filtered to that record, and the standalone
// screen with actor, action and date filters remains for sweeps." Both of those
// are the list, narrowed differently. The second question is the one somebody
// asks having found the row — *what actually changed* — and that answer is the
// two snapshots, which are far too heavy to carry fifty at a time and are the
// only thing on this contract that needs care.
//
// **The snapshots never cross this wire as JSON, and that is the sharpest rule
// here.** `audit.service.ts` states the reason from the writing side: a whole
// row rendered by `to_jsonb` carries `bigint` đồng amounts, and Postgres `jsonb`
// numbers are arbitrary precision where a JavaScript `number` is not — a stay
// total of 12,345,678,901,234,567 ₫ parsed into one comes back a different
// figure. The write path solves it by never parsing, and this contract solves
// the read the same way: a snapshot arrives already split into
// {@link auditFieldSchema} rows whose values are **text**, extracted by Postgres
// with `->>`, so no number on this route is ever a number in either runtime. A
// route that handed over `before` and `after` as objects would look tidier and
// would lose a digit — in a log whose entire purpose is to be believed.
//
// `changed` is computed by Postgres too, by comparing the two values as `jsonb`
// rather than as the text below. That is deliberate: text comparison would call
// a column changed because the same amount was rendered differently, and the
// point of the flag is to mark the fields somebody actually touched.
//
// **Nothing here writes.** `schema/audit.ts` has no update path and no expiry
// column, and `rbac-matrix.md` grants this row a viewer rather than an editor. A
// log with a correction route is not a log.

import { oc } from "@orpc/contract";
import { z } from "zod";

/** What happened to the row — the `audit_action` enum, as the wire spells it. */
export const auditActionSchema = z.enum(["INSERT", "UPDATE", "DELETE"]);

/**
 * Whether the change had a person behind it.
 *
 * `staff` names somebody through `actorId`; `system` is the property's own
 * machinery and names nobody, because there is nobody. `schema/audit.ts` argues
 * at length why the second is not a placeholder account — an unattributable
 * write must not be indistinguishable from an attributed one at a glance — and
 * this field is what keeps the two tellable apart on screen.
 */
export const auditActorKindSchema = z.enum(["staff", "system"]);

/**
 * How much of the log a reader is being shown.
 *
 * `everything` is the matrix's ✅ and `financial` is its ⚠ with the note "ACC:
 * financial entries only". It travels on every page for the reason
 * `searchResultsSchema` carries its own scope: a reader handed a short list has
 * no way to tell a quiet fortnight from a narrowed one, and a viewer that let
 * them confuse the two would be a viewer nobody can rely on.
 */
export const auditScopeSchema = z.enum(["financial", "everything"]);

/**
 * The longest table name this log can be asked about.
 *
 * Postgres' own identifier limit, and it is the honest bound: `table_name` holds
 * a physical table as Postgres names it, so nothing longer than this could ever
 * match a row. Stated here so a filter typed into a search box is a 400 with a
 * sentence rather than a scan of the whole table for something that cannot
 * exist.
 */
export const LONGEST_TABLE_NAME = 63;

/**
 * One change, as the list shows it — everything except what changed.
 *
 * **No snapshots.** The two of them are whole rows of an arbitrary table, and
 * fifty entries of a wide table is a page measured in megabytes for a screen
 * that draws eight columns. {@link auditEntryDetailSchema} is where they live,
 * behind the one press somebody makes having found the row they were looking
 * for.
 *
 * `actorName` travels beside the id for the reason `shiftSchema.operatorName`
 * does: the log exists to say who was answerable, and a column of uuids does not
 * say it. It is null on exactly the rows `actorId` is null on — the unattended
 * writers — and `audit_entry_actor_check` is the database refusing every row
 * where those two disagree, so a reader may branch on either and get the same
 * answer.
 *
 * `tableName` is the physical table, as Postgres names it — `rate_calendar`,
 * not `rateCalendar`. `schema/audit.ts` says why it is stored that way, and the
 * field is not translated on the way out here: the snapshots below carry the
 * same spelling, and a reader holding one and not the other would have to
 * translate between two spellings of the same schema.
 */
export const auditEntrySchema = z.object({
  id: z.uuid(),
  actorKind: auditActorKindSchema,
  /** Null on exactly the entries `actorKind` says are the property's own. */
  actorId: z.uuid().nullable(),
  /** Who was answerable, in the name the property employs them under. */
  actorName: z.string().nullable(),
  occurredAt: z.iso.datetime(),
  /** The physical table, as Postgres names it. */
  tableName: z.string(),
  /** The row it happened to — every audited table has a surrogate `uuid` key. */
  rowId: z.uuid(),
  action: auditActionSchema,
});

/**
 * One column of the changed row, before and after, as text.
 *
 * **Text, and never a number.** The header states the rule and this shape is
 * where it is kept: `before` and `after` are `jsonb ->> key`, which is Postgres
 * rendering its own arbitrary-precision value as the characters it holds. A
 * đồng amount arrives here as the digits it was stored as and is drawn as those
 * digits, having passed through no numeric type in either runtime.
 *
 * **Null means the column held nothing, or held nothing yet.** SQL `NULL` in a
 * snapshot and a column absent from it — a column a later migration added,
 * which `schema/audit.ts` points out is audited from the day it exists — render
 * the same way and are the same claim to a reader: there was no value here.
 * `changed` is what separates them where it matters, because it is computed
 * from the `jsonb` values themselves, where an absent key and a stored null are
 * not equal.
 *
 * On an `INSERT` every `before` is null and on a `DELETE` every `after` is; the
 * table's own `audit_entry_action_matches_states` is what makes that reliable
 * rather than conventional.
 */
export const auditFieldSchema = z.object({
  /** The column, as Postgres names it. */
  column: z.string(),
  /** What it held. Null on an insert, and on a column that held nothing. */
  before: z.string().nullable(),
  /** What it holds now. Null on a delete, and on a column that holds nothing. */
  after: z.string().nullable(),
  /** Whether the two values actually differ — Postgres' own `jsonb` comparison,
   *  so a figure rendered two ways is not reported as an edit. */
  changed: z.boolean(),
});

/**
 * One change in full: who made it, and every column of the row it landed on.
 *
 * The fields come back in column-name order and always all of them, changed or
 * not. Ordered by name because `jsonb` does not keep the table's own column
 * order — it stores keys by length and then bytewise — so the declaration order
 * a reader might expect is not available at any price, and alphabetical is at
 * least the same order twice running. All of them because the question this
 * route answers is "what did the row look like", and a diff that hid the
 * untouched columns would answer a different one: the guest's name beside the
 * amount is how somebody recognises the row they are reading about.
 */
export const auditEntryDetailSchema = auditEntrySchema.extend({
  fields: z.array(auditFieldSchema),
});

/**
 * The most entries one page will answer with.
 *
 * `LONGEST_SHIFT_PAGE`'s figure and its argument: this is a screen somebody
 * reads rather than a search, so the tail is reached by `offset` instead of the
 * caller being told to ask a narrower question. It is affordable here only
 * because the snapshots are not on this shape — two hundred whole rows of an
 * arbitrary table would be a different kind of page altogether.
 */
export const LONGEST_AUDIT_PAGE = 200;

/** The page a caller gets for not naming one. Enough to fill a screen. */
export const AUDIT_PAGE_SIZE = 50;

/**
 * Which changes to read back — the record, the person, the act, and the window.
 *
 * These are `screens.md`'s two doors into the same list. **The record** is
 * `tableName` with `rowId`: the history link every booking, folio, invoice and
 * guest record carries, which opens the viewer already pointed at the thing the
 * reader had a question about. **The sweep** is `actorId`, `action` and the
 * window: the standalone screen, where nobody has a row in mind yet.
 *
 * **`rowId` may not be given without `tableName`.** `audit_entry_row_idx` is on
 * the pair, so the narrower-looking half alone is the wider scan; and every
 * caller that has a row id got it from a record, which means it has the table
 * too. Refusing the half-address is a sentence to whoever wrote the link rather
 * than a viewer that appears to work and takes a second longer every month.
 *
 * **The window is two instants and it is half-open** — `from` inclusive, `to`
 * exclusive. `occurred_at` is an instant rather than a trading day, and a
 * property's day is not the same thing as a calendar one anyway: the console
 * turns the day somebody picked into these two instants using the property's
 * own zone, which is a conversion that has to happen exactly once and where the
 * zone is known. Half-open because a reader stepping day by day over a closed
 * range sees midnight's entries on both days.
 *
 * `action` narrows to one of the three shapes a change can take. There is no
 * filter on the actor's *kind*: `actorId` already selects the staff writes of
 * one person, and the unattended ones are visible in the list as the rows with
 * nobody's name on them — a flag would restate in the query string what the
 * answer already carries in a column.
 */
export const listAuditEntriesInput = z
  .object({
    tableName: z.string().trim().min(1).max(LONGEST_TABLE_NAME).optional(),
    rowId: z.uuid().optional(),
    actorId: z.uuid().optional(),
    action: auditActionSchema.optional(),
    /** The first instant of interest, inclusive. */
    from: z.iso.datetime().optional(),
    /** The first instant past it, exclusive. */
    to: z.iso.datetime().optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(LONGEST_AUDIT_PAGE)
      .default(AUDIT_PAGE_SIZE),
    // Rows to skip, not a page number — `folio.ts` says why, and the order this
    // route promises is total for the same reason: newest change first with the
    // id breaking a tie, so a caller stepping by `limit` sees each entry once.
    offset: z.coerce.number().int().min(0).default(0),
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
 * A page of changes, how many the filters matched behind it, and how much of the
 * log the reader is being shown.
 *
 * `total` is counted under the same predicate the page was cut from, on every
 * read — `folioPageSchema`'s argument, and the figure a pager needs in order to
 * offer a last page rather than only a next one. It is counted under the
 * reader's own scope too, so a narrowed reader is never told the log holds more
 * than they can reach.
 */
export const auditEntryPageSchema = z.object({
  entries: z.array(auditEntrySchema),
  total: z.number().int().min(0),
  scope: auditScopeSchema,
});

/**
 * One change, addressed by its own id.
 *
 * An entry a narrowed reader may not see is answered as no such entry rather
 * than as a refusal, which is the same predicate the list applies rather than a
 * second rule beside it: the scope is a filter, and a filter that matches
 * nothing has nothing to hand over. It is also the more honest sentence — the
 * accountant's log does not contain this row, and telling them it exists
 * elsewhere would be the viewer answering a question the matrix put out of
 * scope.
 */
export const readAuditEntryInput = z.object({
  auditEntryId: z.uuid(),
});

export const audit = {
  list: oc
    // The collection, with the narrowing in the query string, so a history link
    // on a record is a url somebody can keep and a sweep is a url somebody can
    // share. Named for the table rather than for the screen: `/audit` is a
    // console route, and this is the rows behind it.
    .route({ method: "GET", path: "/audit-entries" })
    .input(listAuditEntriesInput)
    .output(auditEntryPageSchema),

  read: oc
    // The member, and the only route on this contract that goes near a
    // snapshot. GET, because reading a log changes nothing — the one act this
    // whole module refuses to offer is an edit.
    .route({ method: "GET", path: "/audit-entries/{auditEntryId}" })
    .input(readAuditEntryInput)
    .output(auditEntryDetailSchema),
};
