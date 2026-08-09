// Filing a change — the write half of `FR-AUD-01`.
//
// **It takes an executor, like every other write in the tree.** That single
// line is what makes the audit row and the change it describes one commit:
// `database.module.ts` makes the general argument for why a write is handed its
// executor rather than opening one, and here it has a sharper consequence than
// anywhere else. An audit row on a different connection would commit
// independently of the edit — an edit that then rolled back would leave a log
// entry for a price nobody ever charged, and an audit row that failed would
// leave a change nobody can see. Neither is reported by anything. Handed the
// caller's executor, both outcomes become impossible rather than unlikely.
//
// **The snapshots arrive as text and are cast back to `jsonb` here, and they
// are never parsed on the way.** Postgres renders a row with `to_jsonb` and
// hands it over as text; this sends that text back with a `::jsonb` cast. The
// alternative — letting the driver parse it into an object — takes every
// `bigint` column through a JavaScript `number` on the way in and out, and
// `schema/pricing.ts` is explicit that parsing a đồng amount to a `number` is
// the one conversion that would make a rate unrepresentable. A string that is
// never looked at cannot lose a digit. Postgres `jsonb` numbers are arbitrary
// precision, so what lands in the column is exactly what came out of the row.

import { Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import { sql } from "drizzle-orm";
import { currentAuditActor } from "../../common/audit/audit-actor.js";
import type { DbExecutor } from "../../database/database.module.js";

/** What happened to the row — the `audit_action` enum, as callers name it. */
export type AuditAction = "INSERT" | "UPDATE" | "DELETE";

/**
 * A whole row as Postgres rendered it: the text of `to_jsonb(<table>)`.
 *
 * Text and not an object, deliberately — see the header. A caller producing one
 * of these writes `to_jsonb(<table>)::text` into its own `returning` clause and
 * passes the value straight through without reading it.
 */
export type RowSnapshot = string;

/** One row's change, in the shape the log records it. */
export interface AuditEntryInput {
  readonly rowId: string;
  readonly action: AuditAction;
  /** Null exactly when the row did not exist yet. */
  readonly before: RowSnapshot | null;
  /** Null exactly when the row no longer exists. */
  readonly after: RowSnapshot | null;
}

@Injectable()
export class AuditService {
  /**
   * Files one row per change, against the acting member of staff.
   *
   * The actor is taken from the ambient scope the audit interceptor
   * established and is not a parameter, which is the point:
   * `common/audit/audit-actor.ts` argues that an actor a caller could pass is an
   * attribution a caller could choose. A write that reaches here with no actor
   * is refused rather than filed anonymously — `audit_entry.actor_id` is
   * `NOT NULL` and the schema says why, and the honest answer to an
   * unattributable change is that it does not happen.
   *
   * An empty list is a no-op and not an error. A manager clearing a fortnight
   * that carried no rules changed nothing, and a log that recorded the gesture
   * anyway would put edits that did not happen into the trail.
   */
  async record(
    exec: DbExecutor,
    tableName: string,
    entries: readonly AuditEntryInput[],
  ): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    const actor = currentAuditActor();

    if (!actor) {
      throw new ORPCError("UNAUTHORIZED", {
        message:
          "This change has no member of staff behind it, and a change that " +
          "cannot be attributed is not recorded",
      });
    }

    const values = entries.map(
      (entry) => sql`(
        ${actor.staffUserId}::uuid,
        ${tableName},
        ${entry.rowId}::uuid,
        ${entry.action}::audit_action,
        ${entry.before}::jsonb,
        ${entry.after}::jsonb
      )`,
    );

    // One statement for the whole set. A season repriced across four hundred
    // nights is four hundred rows, and a round trip each would cost more than
    // the edit it describes.
    await exec.execute(sql`
      insert into audit_entry
        (actor_id, table_name, row_id, action, "before", "after")
      values ${sql.join(values, sql`, `)}
    `);
  }
}
