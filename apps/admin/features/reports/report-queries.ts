/* The Reports family's reads, in the feature that asks the questions.
 *
 * `lib/api-query.ts`'s instruction and `features/finance/finance-queries.ts`'s
 * worked shape. Nothing here is written per endpoint beyond the sentence an
 * operator reads when a call fails: the contract types the input and the answer,
 * and the toast is raised centrally by `lib/query-client.ts`.
 *
 * **Three hooks and no mutation, and the absence is the design.** Reports read
 * frozen snapshots, an append-only ledger and a live count; there is nothing on
 * any of the pages for somebody to write. `night_audit_snapshot` refuses an update at
 * the table — `MV008` — so a hook that offered one would be offering a refusal.
 *
 * **None of them is invalidated by anything in this console, and that is
 * deliberate too.** What moves a revenue figure is the night audit closing a day, which is
 * a job rather than a press; what moves a room count is a housekeeper tapping a
 * tile on a screen this one does not share a cache family with. So both are
 * ordinary queries and go stale the way the query client's defaults say —
 * refetching on focus, which is exactly right for a page somebody leaves open
 * on a second monitor. The performance read joins them on the same terms: its
 * ratios move when the audit closes a day and at no other time.
 */

"use client";

import { skipToken, useQuery } from "@tanstack/react-query";

import { orpc } from "@/lib/api-query";
import type { ConsoleMeta } from "@/lib/query-client";

import type { PerformanceQuery, RevenueQuery } from "./reports";

/**
 * What the property earned over a range, bucketed.
 *
 * Held on `skipToken` until there is a question, which is the state of the page
 * before the range has been read and the state of somebody who is not offered
 * the report at all. The matrix is read before the request is made rather than
 * after it is refused: a receptionist who typed the url would otherwise spend
 * the page's first request on a 403 and a toast they can do nothing about.
 *
 * Keyed by the whole query, bucket included, so switching between months and
 * quarters and back is a cache hit rather than a second request.
 */
export function useRevenueReport(query: RevenueQuery | null) {
  return useQuery(
    orpc.reporting.revenue.queryOptions({
      input: query === null ? skipToken : query,
      meta: {
        errorMessage: "The revenue report could not be read.",
      } satisfies ConsoleMeta,
    }),
  );
}

/**
 * Where every room stands, counted now.
 *
 * No input at all, because a live count has no range — `roomStatusReportQuery`
 * is empty for that reason and this passes the empty object it declares.
 * `skipToken` still guards it, for the same reason as above: the page is
 * offered from a different matrix row than the one beside it, and an accountant
 * reaching this url should not spend a request finding that out.
 */
export function useRoomStatusReport(asked: boolean) {
  return useQuery(
    orpc.reporting.roomStatus.queryOptions({
      input: asked ? {} : skipToken,
      meta: {
        errorMessage: "The room-status report could not be read.",
      } satisfies ConsoleMeta,
    }),
  );
}

/**
 * How full the property was over a range, what it sold a room for, and what
 * each sellable room earned.
 *
 * The revenue hook's twin, and every sentence above it applies unchanged: held
 * on `skipToken` until there is a question, the matrix read before the request
 * rather than after a refusal, and keyed by the whole query so switching the cut
 * and coming back is a cache hit.
 *
 * A separate hook rather than a parameter on the one above, because they are two
 * routes behind two capabilities — `reporting.performance` is its own row of
 * `rbac-matrix.md` — and one hook covering both would put an accountant's two
 * grants behind a single cache key.
 *
 * The figure a reader has selected is not in this key and must not be: all three
 * ratios travel on every row of the one answer, so switching between occupancy
 * and ADR is a redraw rather than a request.
 */
export function usePerformanceReport(query: PerformanceQuery | null) {
  return useQuery(
    orpc.reporting.performance.queryOptions({
      input: query === null ? skipToken : query,
      meta: {
        errorMessage: "The performance report could not be read.",
      } satisfies ConsoleMeta,
    }),
  );
}
