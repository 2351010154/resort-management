// The change log every state-changing action writes to — `FR-AUD-01`, and the
// `audit` row of docs/architecture/repository-structure.md's domain table.
//
// **One table for every such question rather than two columns per table.**
// That sentence is `config.ts`'s, not this file's, and it is the reason this
// table exists in the shape it does. `system_config` and `payment` both
// declined an `updated_at`/`updated_by` pair on the explicit promise that this
// would serve them; `pricing.ts` makes the argument they both cite — a column
// nothing reads is worse than its absence, because a reader cannot tell an
// unset value from an unbuilt one. Per-table attribution columns would have to
// be added, backfilled and read twenty-two times over, and would still not hold
// the *previous* value, which is the half an investigation actually needs.
//
// What a row means: at `occurred_at`, whoever `actor_kind` and `actor_id` name
// between them changed the row `row_id` of `table_name`, and it looked like
// `before` and now looks like `after`. Both snapshots are whole rows rendered
// by Postgres itself (`to_jsonb`), not a hand-listed subset — a column added by
// a later migration is then audited the day it exists rather than the day
// somebody remembers to add it here.
//
// **Who acted is two columns, because not every act has a person behind it.**
// `actor_kind` says whether there is somebody to name and `actor_id` names them,
// and `audit_entry_actor_check` refuses every row where the two disagree. A
// `staff` row without an actor is an attribution the writer lost on the way
// here; a `system` row *with* one is worse, because the account it names did
// nothing and the trail reads as though it did. The alternative — one
// placeholder staff row standing for the sweeps — was declined for exactly that
// reason: it makes an unattributable write indistinguishable from an attributed
// one at a glance, and `payment.posted_by` and `folio_posting.posted_by` both
// already leave the column null rather than mint such an account.
//
// Two kinds and not three. The question this column answers is whether an
// investigation has anybody to ask, and the sweeps and the payment gateway
// answer it the same way. *Which* unattended writer acted is a finer question,
// and `table_name` with the snapshots beside it already answers it for every
// row the system writes — a `gateway` member would restate in an enum what the
// row states in full, and it can be added the day something reads it rather
// than guessed at now.
//
// What is deliberately NOT here:
//
// - **A retention or expiry column.** `product-requirements.md` states no
//   retention period for the change log, and `ASM-02`'s floor is scoped to the
//   registration record rather than to this table. That floor is a
//   do-not-delete-before with no code that reads it — `config.ts` declines to
//   store it for that reason, and the same reasoning lands harder here, where a
//   column would have to be read by an expiry job this system does not have and
//   nobody has asked for. The rows accumulate until somebody says otherwise.
// - **An anonymous actor.** `actor_id` is nullable, but only where `actor_kind`
//   is `system`: there is no row that declines to say which of the two it was.
//   `cccd_unmask_audit.unmasked_by` states the danger a bare nullable column
//   carries — leaving room for an unattributable write lets the interesting
//   ones be the unattributable ones — and the check above is what keeps that
//   room from opening. A staff write still names a real account, and nothing
//   unattended may borrow one.
// - **A reason.** `cccd_unmask_audit.reason` exists because a CCCD read has one
//   worth asking for. A reprice does not, and a mandatory reason field produces
//   a column full of "update".
// - **A request or correlation id.** Rows written by one statement share
//   `occurred_at` exactly — inside a transaction `now()` is the transaction's
//   start — so a season repriced across four hundred nights already groups. A
//   column would be added the day that grouping proves insufficient for the
//   viewer `FR-AUD-02` asks for.

import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { staffUser } from "./identity.js";

/** What happened to the row. The three shapes a `before`/`after` pair can take. */
export const auditActionEnum = pgEnum("audit_action", [
  "INSERT",
  "UPDATE",
  "DELETE",
]);

/**
 * Whether the change has a person behind it.
 *
 * `staff` is a member of staff, named by `actor_id`. `system` is the property's
 * own machinery — a sweep, a scheduled job, a payment gateway's callback — and
 * names nobody, because there is nobody. The header says why the second is not
 * a placeholder account and why there are two members here rather than three.
 */
export const auditActorKindEnum = pgEnum("audit_actor_kind", [
  "staff",
  "system",
]);

export const auditEntry = pgTable(
  "audit_entry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Which of the two an investigation is looking at, and it is never left to
    // be inferred from the null beside it: a reader holding a row with no actor
    // would otherwise have to decide between an unattended write and a bug in
    // whatever filed it.
    actorKind: auditActorKindEnum("actor_kind").notNull(),
    // Null exactly when `actor_kind` is `system` — the check below is what says
    // so. No `onDelete`, so Postgres restricts: an account cannot be deleted out
    // from under the trail that names it. `room_assignment` states the same
    // rule about the room it points at.
    actorId: uuid("actor_id").references(() => staffUser.id),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    // The physical table, as Postgres names it — `rate_calendar`, not
    // `rateCalendar`. The snapshots below are `to_jsonb` of a row of it and
    // carry its column names, so a reader holding one and not the other would
    // have to translate between two spellings of the same schema.
    tableName: text("table_name").notNull(),
    // Every table in this schema carries a surrogate `uuid` primary key, which
    // is what lets one column address a row of any of them.
    rowId: uuid("row_id").notNull(),
    action: auditActionEnum("action").notNull(),
    // Null exactly when the row did not exist yet.
    before: jsonb("before"),
    // Null exactly when the row no longer exists.
    after: jsonb("after"),
  },
  (table) => [
    // The history link `screens.md` puts on every record: everything that has
    // happened to this row, newest last.
    index("audit_entry_row_idx").on(
      table.tableName,
      table.rowId,
      table.occurredAt,
    ),
    // The other question, and it is not answerable from the one above:
    // everything this member of staff did. `cccd_unmask_audit` carries the same
    // pair for the same reason.
    index("audit_entry_actor_idx").on(table.actorId, table.occurredAt),
    // The two halves of the attribution have to agree. A `staff` row with no
    // actor is an attribution lost between the guard and this table, and a
    // `system` row that names one credits an account with a change it did not
    // make — which is the failure a placeholder staff account would produce on
    // every unattended write rather than on a buggy one.
    check(
      "audit_entry_actor_check",
      sql`(
        ${table.actorKind} = 'staff' and ${table.actorId} is not null
      ) or (
        ${table.actorKind} = 'system' and ${table.actorId} is null
      )`,
    ),
    // A row with neither snapshot records that something happened to a row and
    // declines to say what, which is indistinguishable from a bug in whatever
    // wrote it. The three legal shapes are insert (no before), update (both)
    // and delete (no after); this refuses the fourth.
    check(
      "audit_entry_states_present",
      sql`${table.before} is not null or ${table.after} is not null`,
    ),
    // The action and the snapshots have to agree, or the column is a label a
    // writer chose rather than a fact about the row. An `INSERT` that carries a
    // previous state and a `DELETE` that carries a subsequent one are both
    // writers that passed the wrong argument.
    check(
      "audit_entry_action_matches_states",
      sql`(
        ${table.action} = 'INSERT' and ${table.before} is null and ${table.after} is not null
      ) or (
        ${table.action} = 'UPDATE' and ${table.before} is not null and ${table.after} is not null
      ) or (
        ${table.action} = 'DELETE' and ${table.before} is not null and ${table.after} is null
      )`,
    ),
  ],
);

export type AuditEntryRow = typeof auditEntry.$inferSelect;
