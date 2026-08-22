// Reading the change log — `FR-AUD-02`, the viewer over what `FR-AUD-01`
// records.
//
// **Nothing here writes an entry, and that is the design rather than a gap.**
// It used to: five services called a `record` method on this class with a
// pre-image they had captured by hand. What replaced it is a trigger on every
// protected table, which files the entry inside the statement that made the
// change — the same commit, reached without any writer remembering, and reached
// by a support script or a psql session too. `common/audit/audit.interceptor.ts`
// sets out why an entry that is not in the change's own transaction is the wrong
// trade; a trigger is the strongest form of what that argument asks for. The
// five call sites were removed rather than kept beside it, because the enum
// carries no semantic action name — the trigger's entry and the service's were
// the same fact, and the log has to hold exactly one row per change or the
// viewer shows every price change twice.
//
// **No đồng amount passes through a JavaScript `number` on either side.** On
// the way in the figure is copied from a `bigint` column into a `jsonb` one by
// Postgres, both arbitrary precision, with the driver nowhere on the path. This
// file keeps the same promise on the way out: nothing below ever selects
// `before` or `after` as a column, because the driver parses `jsonb` with
// `JSON.parse` and would take every amount in a snapshot through a `number` —
// undoing on the read what the write is careful never to do.
// `schema/pricing.ts` is explicit that parsing a đồng amount to a `number` is
// the one conversion that would make a rate unrepresentable. So the list does
// not select the snapshots at all, and the one method that needs them has
// Postgres split them into text with `->>` before the driver ever sees them. A
// value that was never a number in this process cannot have lost a digit while
// being one.
//
// **Nothing here decides who may read what.** `financial-tables.ts` holds the
// tables the matrix's "ACC: financial entries only" admits, and
// `audit.controller.ts` resolves which of the two scopes a caller is in off the
// grant. This file takes the answer as an argument, for the reason
// `shift.service.ts` gives about the same split: a service that also decided
// would be the matrix written twice, and the wider read — a manager looking at
// the whole log — is a call it could not tell apart from the narrower one.

import { Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import {
  type SQL,
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  lt,
  sql,
} from "drizzle-orm";
import type { DbExecutor } from "../../database/database.module.js";
import { auditEntry } from "../../database/schema/audit.js";
import { staffUser } from "../../database/schema/identity.js";
import { FINANCIAL_TABLES } from "./financial-tables.js";

/** What happened to the row — the `audit_action` enum, as callers name it. */
export type AuditAction = "INSERT" | "UPDATE" | "DELETE";

/** Whether the change had a person behind it — the `audit_actor_kind` enum. */
export type AuditActorKind = "staff" | "system";

/**
 * Which changes to read back, and how much of the log the reader may see.
 *
 * `financialOnly` is the matrix's conditional grant on the *Audit log viewer*
 * row, resolved by the controller and handed over as a fact. It is not optional
 * and has no default: a scoping flag that could be left off is a scoping flag a
 * new caller forgets, and the direction that mistake fails in would be an
 * accountant reading the whole log.
 *
 * The window is half-open — `from` inclusive, `to` exclusive — which is
 * `contract/audit.ts`'s promise and the reason a reader stepping day by day does
 * not see midnight's entries twice.
 */
export interface AuditEntryQuery {
  readonly tableName?: string;
  /** Only ever alongside `tableName`; the contract refuses the half-address. */
  readonly rowId?: string;
  readonly actorId?: string;
  readonly action?: AuditAction;
  readonly from?: Date;
  readonly to?: Date;
  readonly limit: number;
  readonly offset: number;
  readonly financialOnly: boolean;
}

/**
 * One change as the list shows it — everything except what changed.
 *
 * The snapshots are absent by design rather than by omission: the header says
 * why they may not be selected as columns, and a page of fifty whole rows of an
 * arbitrary table is a page nobody asked for either way.
 *
 * `actorName` comes from `staff_user` and is null on exactly the rows `actorId`
 * is null on — the unattended writers, which `audit_entry_actor_check` is the
 * database's guarantee about.
 */
export interface LoggedChange {
  readonly id: string;
  readonly actorKind: AuditActorKind;
  readonly actorId: string | null;
  readonly actorName: string | null;
  readonly occurredAt: Date;
  readonly tableName: string;
  readonly rowId: string;
  readonly action: AuditAction;
}

/** A page of changes, and how many the filters matched behind it — counted
 *  under the reader's own scope, so a narrowed reader is never told the log
 *  holds more than they can reach. */
export interface LoggedChangePage {
  readonly entries: readonly LoggedChange[];
  readonly total: number;
}

/**
 * One column of the changed row, before and after, as the characters Postgres
 * holds.
 *
 * **Text, and it is the whole point.** `before` and `after` are `jsonb ->> key`,
 * evaluated by Postgres against its own arbitrary-precision value; `changed`
 * compares the two as `jsonb` instead, so a figure rendered two ways is not
 * reported as an edit and an absent column is not equal to a stored null.
 */
export interface ChangedField {
  readonly column: string;
  readonly before: string | null;
  readonly after: string | null;
  readonly changed: boolean;
}

/** One change in full: who made it, and every column of the row it landed on. */
export interface LoggedChangeDetail extends LoggedChange {
  readonly fields: readonly ChangedField[];
}

/**
 * {@link ChangedField} as the driver hands it back.
 *
 * Index-signed and mutable because that is what `execute` types a raw result as;
 * {@link ChangedField} is what leaves this file, and the two are the same four
 * columns.
 */
interface ChangedFieldRow extends Record<string, unknown> {
  column: string;
  before: string | null;
  after: string | null;
  changed: boolean;
}

/**
 * The columns a listed change is read from.
 *
 * Named rather than spread off the table, because the point is what is *not*
 * here: `before` and `after` are the two columns this select may never carry,
 * and a spread would pick them up the moment somebody reached for the shorter
 * spelling.
 *
 * `actorName` is a left join, because an unattended write names nobody — an
 * inner join would drop every change the property made to itself out of the log
 * silently.
 */
const listedColumns = {
  id: auditEntry.id,
  actorKind: auditEntry.actorKind,
  actorId: auditEntry.actorId,
  actorName: staffUser.fullName,
  occurredAt: auditEntry.occurredAt,
  tableName: auditEntry.tableName,
  rowId: auditEntry.rowId,
  action: auditEntry.action,
} as const;

/**
 * The filters and the scope as one predicate, so the page and the count behind
 * it cannot be cut differently.
 *
 * The scope goes in first and unconditionally, which is what makes it hard to
 * lose: every read in this file goes through here, and a caller that forgot a
 * filter gets a wider list where one that could forget the scope would get
 * somebody else's log.
 */
function matching(query: AuditEntryQuery): SQL | undefined {
  const narrowed: SQL[] = [];

  if (query.financialOnly) {
    narrowed.push(inArray(auditEntry.tableName, [...FINANCIAL_TABLES]));
  }

  if (query.tableName) {
    narrowed.push(eq(auditEntry.tableName, query.tableName));
  }

  if (query.rowId) {
    narrowed.push(eq(auditEntry.rowId, query.rowId));
  }

  if (query.actorId) {
    narrowed.push(eq(auditEntry.actorId, query.actorId));
  }

  if (query.action) {
    narrowed.push(eq(auditEntry.action, query.action));
  }

  if (query.from) {
    narrowed.push(gte(auditEntry.occurredAt, query.from));
  }

  if (query.to) {
    narrowed.push(lt(auditEntry.occurredAt, query.to));
  }

  return narrowed.length > 0 ? and(...narrowed) : undefined;
}

@Injectable()
export class AuditService {
  /**
   * The change log, filtered — `FR-AUD-02`'s list.
   *
   * Newest change first with the id breaking the tie, so the order is total: an
   * offset over a partial order is a page that shows one change twice and
   * another never, and `occurred_at` ties routinely here rather than rarely --
   * inside a transaction `now()` is the transaction's start, so a season
   * repriced across four hundred nights is four hundred rows sharing an instant
   * exactly.
   *
   * `total` is counted under the same predicate the page was cut from, so a
   * pager can offer a last page rather than only a next one, and so a narrowed
   * reader is never told the log holds more than they can reach.
   */
  async list(
    exec: DbExecutor,
    query: AuditEntryQuery,
  ): Promise<LoggedChangePage> {
    const where = matching(query);

    const entries = await exec
      .select(listedColumns)
      .from(auditEntry)
      .leftJoin(staffUser, eq(staffUser.id, auditEntry.actorId))
      .where(where)
      .orderBy(desc(auditEntry.occurredAt), desc(auditEntry.id))
      .limit(query.limit)
      .offset(query.offset);

    // No join here: the count is over `audit_entry` rows and the name is only
    // ever a column on the page above. The predicate is the same one.
    const [counted] = await exec
      .select({ total: count() })
      .from(auditEntry)
      .where(where);

    return { entries, total: counted?.total ?? 0 };
  }

  /**
   * One change and every column of the row it landed on — `FR-AUD-02`'s
   * detail.
   *
   * **The header is read under the same predicate the list uses**, scope
   * included, so an entry a narrowed reader may not see is answered as no such
   * entry. That is one rule rather than two: the scope is a filter, and a filter
   * that matches nothing has nothing to hand over. Saying instead that it exists
   * and is refused would be the viewer answering the question the matrix put out
   * of scope.
   *
   * **The snapshots are split by Postgres and arrive as text.** `->>` renders
   * the stored value as the characters it holds, so a `bigint` đồng amount
   * crosses into this process as digits and never as a `number` — the header
   * argues why that is the one crossing this module cannot make. `changed`
   * compares the two as `jsonb` rather than as that text, which is what keeps an
   * absent column and a stored null distinguishable and stops a figure rendered
   * two ways being reported as an edit.
   *
   * The key set is the union of the two snapshots, because a column added by a
   * later migration is in one and not the other. Ordered by name, which is the
   * only stable order available: `jsonb` stores keys by length and then
   * bytewise, so the table's own column order did not survive `to_jsonb` and
   * cannot be recovered here at any price.
   */
  async read(
    exec: DbExecutor,
    auditEntryId: string,
    financialOnly: boolean,
  ): Promise<LoggedChangeDetail> {
    const [change] = await exec
      .select(listedColumns)
      .from(auditEntry)
      .leftJoin(staffUser, eq(staffUser.id, auditEntry.actorId))
      .where(
        and(
          eq(auditEntry.id, auditEntryId),
          matching({ limit: 1, offset: 0, financialOnly }),
        ),
      )
      .limit(1);

    if (!change) {
      throw new ORPCError("NOT_FOUND", {
        message: "No such entry in this change log",
      });
    }

    const split = await exec.execute<ChangedFieldRow>(sql`
      select k.key as "column",
             e."before" ->> k.key as "before",
             e."after"  ->> k.key as "after",
             (e."before" -> k.key) is distinct from (e."after" -> k.key)
               as "changed"
        from audit_entry e
        cross join lateral (
               select b.key
                 from jsonb_object_keys(coalesce(e."before", '{}'::jsonb))
                   as b(key)
               union
               select a.key
                 from jsonb_object_keys(coalesce(e."after", '{}'::jsonb))
                   as a(key)
             ) k
       where e.id = ${auditEntryId}::uuid
       order by k.key
    `);

    return { ...change, fields: split.rows };
  }
}
