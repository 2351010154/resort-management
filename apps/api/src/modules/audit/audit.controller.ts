// The change log over HTTP — `FR-AUD-02`'s two routes, and the second handler
// in this tree that has to finish a decision the guard could not.
//
// **One row of the matrix and no key invented.** `audit.read` — "Audit log
// viewer" — governs both routes, and both are declared reads, because the row
// hands `ACCOUNTANT` a `⚠` rather than a `✅` and there is nothing here that
// changes a row: `schema/audit.ts` has no update path, and a log with a
// correction route is not a log. Two routes under one key is what
// `rbac-matrix.md` §2 permits and `payment.controller.ts` already does — what §2
// forbids is a single route whose authority turns on its body, and neither of
// these carries one.
//
// **The narrowing is read off the grant, never off the role.** This is
// `search.controller.ts`'s arrangement and its reason: a branch on
// `principal.role === "ACCOUNTANT"` is the matrix copied into a handler, and the
// day a sixth role is added `⚠` to this row it would silently receive the whole
// log. What the matrix's note "ACC: financial entries only" means by
// *financial* is `financial-tables.ts`'s decision and is not restated here; what
// this file decides is only which of the two scopes the caller is in.
//
// **It fails closed.** {@link readsTheWholeLog} is written as "only a grant that
// is unambiguously unnarrowed opens the rest" rather than as "conditional is
// narrow", so a grant this file has not heard of — or a decision the guard never
// left — takes the narrow path instead of the wide one. A decision that never
// arrived is a guard that did not run, and the honest answer to that is the
// smaller log rather than every change the property has ever made.
//
// **The scope travels back on the page.** A reader handed a short list has no
// way to tell a quiet fortnight from a narrowed one, which is the same problem
// `searchResultsSchema` carries its own scope to solve. It is not on the detail:
// there, the narrowing is the difference between an entry and no entry, and that
// answer says itself.
//
// **The transaction is opened here**, as every other controller in the tree does
// and `database.module.ts` requires. The list takes one for the reason
// `shift.controller.ts` gives about its own: a page and the count printed beside
// it are two statements, and on two connections they are two different moments —
// a list of nineteen changes under a heading that says twenty. The detail takes
// one for a sharper version of the same thing: the header and the two snapshots
// it is split from are read by two statements about one row, and read on two
// connections the second could answer about a row the first did not describe.

import { contract } from "@mariva/shared";
import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import {
  Access,
  RequiresCapability,
} from "../../common/auth/access.decorators.js";
import type { AccessDecision } from "../../common/auth/principal.js";
import { TransactionRunner } from "../../database/transaction-runner.js";
import type { LoggedChange } from "./audit.service.js";
import { AuditService } from "./audit.service.js";

@Controller()
export class AuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly transactions: TransactionRunner,
  ) {}

  /**
   * Who changed what, and when — the standalone screen, and the history link
   * every record carries.
   *
   * They are one route because they are one list narrowed two ways.
   * `screens.md` puts a history link on every booking, folio, invoice and guest
   * record and keeps "the standalone screen with actor, action and date filters
   * for sweeps" beside it; the first names a record and the second does not, and
   * nothing else about the question differs.
   *
   * **A narrowed caller's filters are not refused, they are intersected.** An
   * accountant asking for `stay_restriction` gets an empty page rather than a
   * 403, because the scope is applied as a predicate alongside what they typed
   * rather than as a second gate in front of it — which is `shift.controller.ts`
   * overwriting a receptionist's operator filter rather than refusing it, for
   * the reason it gives: answering with a 403 would be telling somebody they may
   * not ask a question this route is about to answer anyway.
   */
  @RequiresCapability("audit.read", "read")
  @Implement(contract.audit.list)
  list(@Access() access: AccessDecision | undefined) {
    return implement(contract.audit.list).handler(async ({ input }) => {
      const financialOnly = !readsTheWholeLog(access);

      const page = await this.transactions.run((exec) =>
        this.audit.list(exec, {
          tableName: input.tableName,
          rowId: input.rowId,
          actorId: input.actorId,
          action: input.action,
          // The window arrives as two ISO instants and the column is a
          // `timestamptz`, so the crossing happens once, here, rather than in
          // the service where it would be made again by every other caller.
          from: input.from === undefined ? undefined : new Date(input.from),
          to: input.to === undefined ? undefined : new Date(input.to),
          limit: input.limit,
          offset: input.offset,
          financialOnly,
        }),
      );

      return {
        entries: page.entries.map(onWire),
        total: page.total,
        scope: financialOnly ? ("financial" as const) : ("everything" as const),
      };
    });
  }

  /**
   * One change, and every column of the row it landed on.
   *
   * The snapshots are the whole reason this is a second route: they are two
   * complete rows of an arbitrary table, and fifty of them on a list would be a
   * page measured in megabytes for a screen that draws eight columns.
   *
   * An entry outside a narrowed reader's scope is a 404 rather than a 403, and
   * `audit.service.ts` argues why: the scope is a filter applied to this read
   * exactly as it is to the list, and a filter that matches nothing has nothing
   * to hand over.
   */
  @RequiresCapability("audit.read", "read")
  @Implement(contract.audit.read)
  read(@Access() access: AccessDecision | undefined) {
    return implement(contract.audit.read).handler(async ({ input }) => {
      const change = await this.transactions.run((exec) =>
        this.audit.read(
          exec,
          input.auditEntryId,
          !readsTheWholeLog(access),
        ),
      );

      return {
        ...onWire(change),
        // Copied rather than passed through, for the reason
        // `search.controller.ts` gives: the service holds these `readonly`
        // because nothing downstream may edit them, and a serialiser handed the
        // caller's own array could sort it.
        fields: [...change.fields],
      };
    });
  }
}

/**
 * Whether this caller reads the whole log rather than the money in it.
 *
 * `full` is the matrix's `✅` on this row and `read` is a `👁` — nobody holds
 * one here today, and it is admitted because the route declares itself a read
 * and a read-only grant on a read-only row is not a narrower claim. Everything
 * else narrows, `conditional` included, which is the matrix's `⚠` and the whole
 * of the `ACCOUNTANT`'s note.
 *
 * Written as "only a grant that is unambiguously unnarrowed opens the rest"
 * rather than as "conditional is narrow", which is `search.controller.ts`'s
 * arrangement and its reason: a grant this file has not heard of takes the
 * narrow path, and so does a decision the guard never left.
 */
function readsTheWholeLog(access: AccessDecision | undefined): boolean {
  return access?.grant === "full" || access?.grant === "read";
}

/** A change as the wire carries it — the instant into ISO-8601. Everything else
 *  on the row is already text, and the two snapshots were never on it. */
function onWire(change: LoggedChange) {
  return { ...change, occurredAt: change.occurredAt.toISOString() };
}
