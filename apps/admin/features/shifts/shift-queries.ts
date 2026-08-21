/* The desk's day, read and written.
 *
 * Seven routes and seven hooks, in the feature that asks the questions —
 * `lib/api-query.ts`'s instruction and `features/housekeeping/board-queries.ts`'s
 * worked shape. Nothing here is written per endpoint beyond the sentence an
 * operator reads when a call fails: the contract types the input and the answer,
 * and the toast is raised centrally by `lib/query-client.ts`.
 *
 * **The current drawer and the history are two questions and two hooks**, which
 * is the division `contract/operations.ts` draws for the routes themselves. One
 * has no input at all and answers "am I on a drawer" for the bar that follows
 * the operator onto every screen; the other ranges over days and operators and
 * pages, and is only asked on the screen that reads history.
 *
 * **`null` is an answer.** A receptionist who has not opened a drawer is not a
 * failure and is not a pending read: `currentShift` answers null, the bar renders
 * "no drawer" from it, and the palette offers to open one. Nothing here treats
 * the absence as an error, and nothing retries it.
 *
 * **The count is re-asked before it is taken.** {@link useCurrentShift} hands its
 * refetch back for one caller: the panel that counts or closes a drawer asks
 * again as it opens, because what the till should hold is the opening float plus
 * every đồng of cash bound to the shift — and cash lands on it from the checkout
 * sequence, on a screen this bar is merely sitting above. A count taken against
 * an answer from four payments ago is a variance the property invented.
 *
 * **What a write invalidates is the whole family.** Opening, closing, raising and
 * clearing all move something another surface in this feature is drawing — the
 * bar, the history, the backlog — and the acts are rare enough that the wider
 * refetch costs nothing. `lib/api-query.ts` asks for the widest thing an act can
 * have changed rather than the narrowest thing it touched.
 */

"use client";

import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { orpc } from "@/lib/api-query";
import type { ConsoleMeta } from "@/lib/query-client";

import type { ShiftHistoryQuery } from "./shift-day";

/**
 * The drawer this operator is on, or null for somebody who is not on one.
 *
 * `offered` is the matrix read before the request is made rather than after it
 * is refused — a housekeeper holds neither row here, and a bar that fired this
 * on every one of their screens would spend the console's first request on a 403
 * and a toast the operator can do nothing about.
 *
 * The failure is drawn where the operator is already looking. Both readers of
 * this hook say which of the three states they are in — on a drawer, on none, or
 * unable to tell — and this is a read that sits on every screen at once, so a
 * central toast for it would be the same red sentence over whatever the operator
 * was doing, once per screen change. That is the narrow case `ConsoleMeta`
 * allows, and it is paid for by both surfaces drawing the failure in words.
 */
export function useCurrentShift(offered: boolean) {
  return useQuery(
    orpc.operations.currentShift.queryOptions({
      input: offered ? undefined : skipToken,
      meta: { rendersFailureInline: true } satisfies ConsoleMeta,
    }),
  );
}

/**
 * A page of the history — past shifts, their variances and their handover notes.
 *
 * Held on `skipToken` until there is a question, which is the state of the
 * screen before the filters have been read and the state of an operator who is
 * not offered the history at all.
 *
 * Keyed by the whole query, offset included, so paging back to a page already
 * seen is a cache hit rather than a second request — and so two different sets of
 * filters cannot overwrite each other's answer.
 */
export function useShiftHistory(query: ShiftHistoryQuery | null) {
  return useQuery(
    orpc.operations.listShiftHistory.queryOptions({
      input: query === null ? skipToken : query,
      meta: {
        errorMessage: "The shift history could not be read.",
      } satisfies ConsoleMeta,
    }),
  );
}

/**
 * The backlog the next shift inherits.
 *
 * Unscoped for every caller, and that is the table's point rather than a gap in
 * the narrowing: an item outlives the drawer that found it, so the question a
 * shift taking the desk over asks — "what is still outstanding" — names no shift
 * at all. The route's default state is `OUTSTANDING`, which is the only question
 * this console asks of it.
 */
export function usePendingItems(offered: boolean) {
  return useQuery(
    orpc.operations.listPendingItems.queryOptions({
      input: offered ? { state: "OUTSTANDING" } : skipToken,
      meta: {
        errorMessage: "The outstanding items could not be read.",
      } satisfies ConsoleMeta,
    }),
  );
}

/**
 * Opening a drawer in the caller's own name.
 *
 * A second open drawer is refused by `shift_one_open_per_operator` and reported
 * as a sentence about the drawer already open. Nothing optimistic: a shift is a
 * row the API creates with an id, an opening business date and a resolved
 * operator, and none of those is a guess a console could paint.
 */
export function useOpenDrawer() {
  const queryClient = useQueryClient();

  return useMutation(
    orpc.operations.openShift.mutationOptions({
      meta: {
        errorMessage: "The drawer could not be opened.",
      } satisfies ConsoleMeta,
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: orpc.operations.key() });
      },
    }),
  );
}

/**
 * Counting a drawer out, and telling the next person what they are inheriting.
 *
 * The answer carries the variance, which is the figure the whole act exists to
 * produce — so the caller reads it off this write rather than off the refetch
 * that follows. The invalidation is still made, because the shift has left the
 * bar's "am I on a drawer" and joined the history.
 */
export function useCloseDrawer() {
  const queryClient = useQueryClient();

  return useMutation(
    orpc.operations.closeShift.mutationOptions({
      meta: {
        errorMessage: "The drawer could not be closed.",
      } satisfies ConsoleMeta,
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: orpc.operations.key() });
      },
    }),
  );
}

/**
 * Recording something this shift could not finish.
 *
 * Two presses honestly make two items — an item is a finding rather than a
 * state, and the same thing noticed twice is the desk's to resolve twice — so
 * nothing here deduplicates on the words.
 */
export function useRaisePendingItem() {
  const queryClient = useQueryClient();

  return useMutation(
    orpc.operations.raisePendingItem.mutationOptions({
      meta: {
        errorMessage: "The item could not be recorded.",
      } satisfies ConsoleMeta,
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: orpc.operations.listPendingItems.key(),
        });
      },
    }),
  );
}

/**
 * Clearing an item, credited to the drawer that actually dealt with it.
 *
 * An item already resolved is refused rather than re-stamped, so a second press
 * on a row somebody else has just cleared reports a refusal instead of quietly
 * overwriting which shift dealt with it.
 */
export function useResolvePendingItem() {
  const queryClient = useQueryClient();

  return useMutation(
    orpc.operations.resolvePendingItem.mutationOptions({
      meta: {
        errorMessage: "The item could not be cleared.",
      } satisfies ConsoleMeta,
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: orpc.operations.listPendingItems.key(),
        });
      },
    }),
  );
}
