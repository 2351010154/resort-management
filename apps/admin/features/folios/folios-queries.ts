/* The folios screen's two reads, and nothing else.
 *
 * **Two, because the collection and the account are two different questions.**
 * `GET /folios` answers which accounts the property has and what each comes to;
 * `GET /bookings/{bookingId}/folio` answers the lines of one. The collection
 * deliberately carries no postings — a page of two hundred accounts with every
 * line on each would be the whole ledger fetched to draw a table — so the second
 * read is what opening an account costs, and it is not made until one is opened.
 *
 * **No writes.** `screens.md` gives this family one job: review the append-only
 * charges and the corrections filed against them. Posting, reversing, refunding
 * and closing are five routes under four capabilities, worked from the checkout
 * sequence and from Payments, and a mutation hook here would be this screen
 * growing an act the matrix puts elsewhere. It follows that nothing here
 * invalidates anything either: a screen that only reads has nothing to stale.
 *
 * **The single account is `features/departures`' own hook, reused.** One route,
 * asked through the same `orpc` utils and therefore keyed into the same cache
 * entry — so the folio a receptionist has just settled at checkout is the folio
 * this screen opens, without a second request and without a second opinion about
 * what "the stay's account could not be read" says. The same argument
 * `guests-queries.ts` makes about sharing `search.operational` with Bookings.
 * It is held on `skipToken` until an account is picked, so a page of fifty rows
 * costs fifty folio reads only if somebody opens fifty of them.
 *
 * **The property's day comes from `GET /system/business-date`.** Not from the
 * housekeeping board, which is where the desk queues read it: the matrix denies
 * `housekeeping.board` to `ACCOUNTANT`, and `nav-inventory.ts` offers this
 * family to them precisely because they may read a folio. A screen that took its
 * day off the board would 403 on its first request for one of the roles it was
 * built for. Both routes resolve through one service on the server, so no two
 * screens can disagree about what day it is.
 *
 * Nothing here reports its own failure: `lib/query-client.ts` raises the toast
 * for every read centrally.
 */

"use client";

import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useMemo } from "react";

import { useBusinessDate } from "@/features/bookings/bookings-queries";
import type { FolioListQuery } from "@/features/dashboard/day-counts";
import { orpc } from "@/lib/api-query";
import type { ConsoleMeta } from "@/lib/query-client";

import { type ListedFolio, type PageWindow, pageWindow } from "./folio-ledger";

/** One account's whole ledger — the same query the checkout sequence runs. */
export { useBookingFolio as useFolioLedger } from "@/features/departures/departures-queries";

/** What the screen knows about the page of accounts it is drawing. */
export type PageReading =
  | { readonly status: "pending" }
  | { readonly status: "failed" }
  | {
      readonly status: "ready";
      readonly folios: readonly ListedFolio[];
      readonly window: PageWindow;
    };

/** The whole screen's data layer: the property's day and one page of accounts. */
export interface FoliosData {
  /** The day a typed filter date is counted from, once the API has said. Null
   *  while it is in flight, and for good if that read failed — which does not
   *  fail the list, because the opening filters carry no dates in them. */
  readonly businessDate: string | null;
  readonly page: PageReading;
}

/**
 * One page of the property's accounts, under whatever the filters asked for.
 *
 * The query is keyed by the whole input, offset included, so paging back to a
 * page already seen is a cache hit rather than a second request — and so two
 * different sets of filters cannot overwrite each other's answer.
 *
 * There is always a query, which is why this hook takes no `skipToken` branch:
 * the screen opens on `openingQuery()` and every later one replaces it whole. A
 * folios screen with nothing to ask would be a screen with nothing to show, and
 * the collection needs no criteria to answer.
 *
 * The offset and the page size travel beside the query as well as inside it.
 * Inside because the API is what pages; beside because the pager has arithmetic
 * to do with both, and `listFoliosInput` coerces those two fields out of a query
 * string — so the numbers this screen chose are not numbers that can be read
 * back off the input it built.
 */
export function useFolioPage(
  query: FolioListQuery,
  offset: number,
  pageSize: number,
): FoliosData {
  const day = useBusinessDate();

  const page = useQuery(
    orpc.folio.list.queryOptions({
      input: query,
      meta: {
        errorMessage: "The property's accounts could not be read.",
      } satisfies ConsoleMeta,
    }),
  );

  const answer = page.data;

  // Memoized on the answer rather than recomputed per render, because the page
  // is what the roving list is drawn from: a fresh array on every render is a
  // list rebuilt underneath the operator's arrow keys.
  const reading = useMemo<PageReading>(() => {
    if (page.isError) {
      return { status: "failed" };
    }

    if (answer === undefined) {
      return { status: "pending" };
    }

    return {
      status: "ready",
      folios: answer.folios,
      // `total` is the API's count under the same predicate the page was cut
      // from, so the pager names the whole set rather than the length of one
      // page dressed up as a figure.
      window: pageWindow(answer.total, answer.folios.length, offset, pageSize),
    };
  }, [page.isError, answer, offset, pageSize]);

  return { businessDate: day.data?.businessDate ?? null, page: reading };
}

export function useServiceCatalog(offered: boolean) {
  return useQuery(
    orpc.service.listCatalog.queryOptions({
      input: offered ? undefined : skipToken,
      meta: {
        errorMessage: "The service catalog could not be read.",
      } satisfies ConsoleMeta,
    }),
  );
}
export function usePostCharge() {
  const qc = useQueryClient();
  return useMutation(
    orpc.folio.postCharge.mutationOptions({
      meta: {
        errorMessage: "The charge could not be posted.",
      } satisfies ConsoleMeta,
      onSuccess: () =>
        void qc.invalidateQueries({ queryKey: orpc.folio.key() }),
    }),
  );
}
export function usePostServiceItem() {
  const qc = useQueryClient();
  return useMutation(
    orpc.folio.postServiceItem.mutationOptions({
      meta: {
        errorMessage: "The service item could not be posted.",
      } satisfies ConsoleMeta,
      onSuccess: () =>
        void qc.invalidateQueries({ queryKey: orpc.folio.key() }),
    }),
  );
}
export function useReversePosting() {
  const qc = useQueryClient();
  return useMutation(
    orpc.folio.reversePosting.mutationOptions({
      meta: {
        errorMessage: "The posting could not be reversed.",
      } satisfies ConsoleMeta,
      onSuccess: () =>
        void qc.invalidateQueries({ queryKey: orpc.folio.key() }),
    }),
  );
}
