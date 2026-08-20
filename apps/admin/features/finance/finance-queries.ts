/* The property's own book, read and written.
 *
 * Three routes and three hooks, in the feature that asks the questions —
 * `lib/api-query.ts`'s instruction and `features/shifts/shift-queries.ts`'s
 * worked shape. Nothing here is written per endpoint beyond the sentence an
 * operator reads when a call fails: the contract types the input and the answer,
 * and the toast is raised centrally by `lib/query-client.ts`.
 *
 * **What a write invalidates is two families and not one.** Recording an entry
 * changes the book, which this feature draws — and, where the đồng moved through
 * a till, it changes what that drawer is expected to hold, which
 * `features/shifts` draws in the top bar of every screen at once. A receptionist
 * counting a drawer against a figure that has not caught up with the money a
 * manager just took out of it is the exact failure `contract/operations.ts`
 * builds `cashBookNet` to prevent, and it would be reintroduced here by
 * invalidating only what this screen shows. `lib/api-query.ts` asks for the
 * widest thing an act can have changed rather than the narrowest thing it
 * touched, and this act changes two.
 *
 * The invalidation is unconditional rather than made only for a cash entry. A
 * bank transfer moves no drawer and the extra refetch costs one request on an
 * act the property performs a handful of times a day — where a condition here
 * would be this file holding a second opinion about a rule the contract already
 * states, and being wrong about it silently.
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

import type { CashBookQuery } from "./cash-book";

/**
 * A page of the book — what the property took and spent, with both totals.
 *
 * Held on `skipToken` until there is a question, which is the state of the
 * screen before the filters have been read and the state of somebody who is not
 * offered the book at all. The matrix is read before the request is made rather
 * than after it is refused: a receptionist reaching `/finance` would otherwise
 * spend the screen's first request on a 403 and a toast they can do nothing
 * about.
 *
 * Keyed by the whole query, offset included, so paging back to a page already
 * seen is a cache hit rather than a second request — and so two different sets of
 * filters cannot overwrite each other's answer.
 */
export function useCashBook(query: CashBookQuery | null) {
  return useQuery(
    orpc.finance.listCashBookEntries.queryOptions({
      input: query === null ? skipToken : query,
      meta: {
        errorMessage: "The cash book could not be read.",
      } satisfies ConsoleMeta,
    }),
  );
}

/**
 * Recording a movement of the property's own money.
 *
 * Nothing optimistic: an entry is a row the API creates with an id, a resolved
 * trading day and a recorder taken off the session, and none of those is a guess
 * a console could paint. Two presses honestly make two entries — money moving
 * twice is two movements — so nothing here deduplicates on the words.
 */
export function useRecordCashBookEntry() {
  const queryClient = useQueryClient();

  return useMutation(
    orpc.finance.recordCashBookEntry.mutationOptions({
      meta: {
        errorMessage: "The entry could not be recorded.",
      } satisfies ConsoleMeta,
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: orpc.finance.key() });
        // The drawer's expected figure moved with it — the header says why this
        // is not conditional on the method.
        void queryClient.invalidateQueries({ queryKey: orpc.operations.key() });
      },
    }),
  );
}

/**
 * Undoing one by recording its opposite.
 *
 * The book is append-only, so this is the only correction it has: there is no
 * edit hook and no delete hook to sit beside it, and the absence is the design
 * rather than an omission. An entry somebody else corrected a moment ago is
 * refused rather than corrected twice, which would take the same money back out
 * of the book twice.
 */
export function useReverseCashBookEntry() {
  const queryClient = useQueryClient();

  return useMutation(
    orpc.finance.reverseCashBookEntry.mutationOptions({
      meta: {
        errorMessage: "The entry could not be corrected.",
      } satisfies ConsoleMeta,
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: orpc.finance.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.operations.key() });
      },
    }),
  );
}
