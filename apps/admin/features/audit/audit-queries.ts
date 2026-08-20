/* The audit screen's two reads, and nothing else.
 *
 * **Two, because a page of changes and one change in full are different
 * questions.** `GET /audit-entries` answers who changed what and when; `GET
 * /audit-entries/{id}` answers what the row actually looked like on either side
 * of it. They are separate routes for the reason `contract/audit.ts` gives — the
 * snapshots are two whole rows of an arbitrary table, and fifty of them on a
 * list would be a page measured in megabytes for a table that draws four
 * columns — and they are separate hooks here because the second is asked only
 * when a reader opens a row.
 *
 * **No writes.** `schema/audit.ts` has no update path and `rbac-matrix.md`
 * grants this row a viewer rather than an editor, so there is no mutation hook
 * and nothing to invalidate: a screen that only reads has nothing to stale.
 *
 * **The property's day comes from `GET /system/business-date`.** Every staff
 * role may read it, and the day filter is counted from it rather than from the
 * browser's calendar date, which is the wrong day at 01:30.
 *
 * Nothing here reports its own failure: `lib/query-client.ts` raises the toast
 * for every read centrally.
 */

"use client";

import { AUDIT_PAGE_SIZE } from "@mariva/shared";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

/* The pager's arithmetic, taken from the module that already owns it rather
 * than written a second time: a page cut from a counted total is the same
 * question here as it is on Folios and Payments, down to the offsets the two
 * presses ask for. Reached past that family's barrel, which re-exports a client
 * component, for the reason `payments-queries.ts` gives about doing the same. */
import { type PageWindow, pageWindow } from "@/features/folios/folio-ledger";
import { orpc } from "@/lib/api-query";
import type { ConsoleMeta } from "@/lib/query-client";

import type {
  ChangeQuestion,
  LoggedChange,
  LoggedChangeDetail,
  LogScope,
} from "./change-log";

/**
 * The property's day, which the day filter is counted from.
 *
 * The bookings screen's own hook, re-exported rather than written again: one
 * route asked through the same `orpc` utils is one cache entry, so the day this
 * screen resolves `today` against is the day the rest of the console is working
 * — without a second request and without a second opinion about what "the
 * property's day could not be read" says.
 */
export { useBusinessDate } from "@/features/bookings/bookings-queries";

/** What the screen knows about the page of changes it is drawing. */
export type PageReading =
  /** No question has been built yet — the property's day has not arrived, or
   *  this operator is not offered the screen. */
  | { readonly status: "idle" }
  | { readonly status: "pending" }
  | { readonly status: "failed" }
  | {
      readonly status: "ready";
      readonly entries: readonly LoggedChange[];
      readonly window: PageWindow;
      /** How much of the log this reader is being shown — the matrix's ⚠,
       *  answered by the API rather than guessed at from the role. */
      readonly scope: LogScope;
    };

/**
 * One page of the change log.
 *
 * The query is keyed by the whole input, offset included, so paging back to a
 * page already seen is a cache hit rather than a second request — and so two
 * different sets of filters cannot overwrite each other's answer.
 *
 * `question` is null before the property's day has been read and for an operator
 * the screen is not offered to, and the read is held on `skipToken` until it is
 * not: the matrix denies this row to the receptionist and the housekeeper, so a
 * screen that fired unconditionally would spend its first request on a 403 and a
 * toast.
 *
 * The offset travels beside the question as well as inside it. Inside because
 * the API is what pages; beside because the pager has arithmetic to do with it,
 * and the route coerces that field out of a query string — so the number this
 * screen chose is not a number that can be read back off the input it built.
 */
export function useChangeLog(
  question: ChangeQuestion | null,
  offset: number,
): PageReading {
  const page = useQuery(
    orpc.audit.list.queryOptions({
      input: question === null ? skipToken : question.input,
      meta: {
        errorMessage: "The change log could not be read.",
      } satisfies ConsoleMeta,
    }),
  );

  const answer = page.data;

  // Memoized on the answer rather than recomputed per render: the reading is
  // what the table and the pager are both drawn from, and a fresh object every
  // render is a table rebuilt under the operator.
  return useMemo<PageReading>(() => {
    if (question === null) {
      return { status: "idle" };
    }

    if (page.isError) {
      return { status: "failed" };
    }

    if (answer === undefined) {
      return { status: "pending" };
    }

    return {
      status: "ready",
      entries: answer.entries,
      scope: answer.scope,
      // `total` is the API's count under the same predicate the page was cut
      // from — and under the reader's own scope, so a narrowed reader is never
      // told the log holds more than they can reach.
      window: pageWindow(
        answer.total,
        answer.entries.length,
        offset,
        AUDIT_PAGE_SIZE,
      ),
    };
  }, [question, page.isError, answer, offset]);
}

/** What the screen knows about the one change a reader opened. */
export type ChangeReading =
  /** Nothing is open. The ordinary state of the screen. */
  | { readonly status: "closed" }
  | { readonly status: "pending" }
  /** The entry could not be read. An entry outside a narrowed reader's scope
   *  answers as no such entry, which lands here — `contract/audit.ts` says why
   *  that is a 404 rather than a refusal. */
  | { readonly status: "failed" }
  | { readonly status: "ready"; readonly change: LoggedChangeDetail };

/**
 * One change in full, when a reader has opened one.
 *
 * Held on `skipToken` until then, which is what makes this a second route
 * without being a second request per row: the snapshots are only fetched for the
 * entry somebody is actually looking at.
 *
 * The failure is drawn where the reader is already looking — beside the row they
 * pressed — so it declares `rendersFailureInline` and says nothing centrally.
 * That is the arrangement `payments-queries.ts` uses for a night nobody has
 * swept, and for the same reason: a red toast over a state the screen already
 * explains is how a property learns to read past its own toasts.
 */
export function useChange(auditEntryId: string | null): ChangeReading {
  const change = useQuery(
    orpc.audit.read.queryOptions({
      input: auditEntryId === null ? skipToken : { auditEntryId },
      meta: { rendersFailureInline: true } satisfies ConsoleMeta,
    }),
  );

  const answer = change.data;

  return useMemo<ChangeReading>(() => {
    if (auditEntryId === null) {
      return { status: "closed" };
    }

    if (change.isError) {
      return { status: "failed" };
    }

    if (answer === undefined) {
      return { status: "pending" };
    }

    return { status: "ready", change: answer };
  }, [auditEntryId, change.isError, answer]);
}
