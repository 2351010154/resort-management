/* The departures screen's reads and its three writes.
 *
 * **Two requests draw the whole queue.** The housekeeping board answers the
 * property's day and the operational search answers the stays leaving on it, so
 * the day is the API's answer rather than the browser's. The criteria are
 * `features/dashboard`'s own builder and not a second copy: the dashboard's
 * departures card and this queue ask exactly the same question, and sharing the
 * builder means they share the cache entry too — a receptionist pressing the
 * card lands on a list that is already there.
 *
 * **No room is read for its own sake.** The board is here for the business date
 * alone; a checkout puts a room back into housekeeping's hands rather than
 * taking one out of them, so there is nothing on this screen to pick from. The
 * board is invalidated after the check-out all the same, because the room the
 * guest left is now the housekeeper's problem and the board is where that is
 * read.
 *
 * **The account is read only while a sequence is open.** A queue of forty
 * departures does not need forty folios; what needs one is the stay being
 * worked, because the whole of a checkout turns on its balance. `skipToken` is
 * how that is held back — no booking, no request.
 *
 * Nothing here reports its own failure: `lib/query-client.ts` raises the toast
 * centrally. What these hooks owe the screen is the honest state of the queue,
 * which is {@link useDepartureQueue}'s reading.
 */

"use client";

import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useMemo } from "react";

import { departureCriteria } from "@/features/dashboard";
import { useHousekeepingBoard } from "@/features/housekeeping";
import { orpc } from "@/lib/api-query";
import type { ConsoleMeta } from "@/lib/query-client";

import { type DepartureQueue, todaysDepartures } from "./departure-queue";

/** What the screen knows about the queue it is drawing. */
export type QueueReading =
  | { readonly status: "pending" }
  | { readonly status: "failed" }
  | ({ readonly status: "ready" } & DepartureQueue);

/** The whole screen's data layer: the property's day and the queue. */
export interface DeparturesData {
  /** The day the queue was cut against, once the board has said. */
  readonly businessDate: string | null;
  readonly queue: QueueReading;
}

/**
 * Today's departures.
 *
 * A board that did not load fails the queue rather than leaving it spinning:
 * the search is keyed to the day the board resolves, so a query held on
 * `skipToken` for a date that will never arrive is `pending` forever, and a list
 * that never finishes loading is the silent failure `lib/query-client.ts` exists
 * to prevent.
 */
export function useDepartureQueue(): DeparturesData {
  const board = useHousekeepingBoard();
  const businessDate = board.data?.businessDate;

  const departures = useQuery(
    orpc.search.operational.queryOptions({
      input:
        businessDate === undefined
          ? skipToken
          : departureCriteria(businessDate),
      meta: {
        errorMessage: "Today's departures could not be loaded.",
      } satisfies ConsoleMeta,
    }),
  );

  // Memoized on the answer rather than recomputed per render, because the queue
  // is the table's `data`: a fresh array on every render is a row model rebuilt
  // on every render, and the rows are what the operator is arrowing through.
  const cut = useMemo(
    () =>
      departures.data === undefined || businessDate === undefined
        ? undefined
        : todaysDepartures(departures.data, businessDate),
    [departures.data, businessDate],
  );

  return {
    businessDate: businessDate ?? null,
    queue: queueReading(board.isError || departures.isError, cut),
  };
}

/** The queue's three states, folded out of one answer and its dependency. */
function queueReading(
  failed: boolean,
  queue: DepartureQueue | null | undefined,
): QueueReading {
  if (failed) {
    return { status: "failed" };
  }

  if (queue === undefined) {
    return { status: "pending" };
  }

  // `null` is a narrowed search answer — a grant covering rooms only, which has
  // no stays in it to list. "Nobody is leaving" would be a different and false
  // statement, so it reads as a failure the screen names.
  return queue === null ? { status: "failed" } : { status: "ready", ...queue };
}

/**
 * The stay's account, while its sequence is open.
 *
 * The lines as well as the balance, because the first thing a checkout does is
 * read the charges back to the guest — `screens.md` says so in as many words —
 * and `folio.read` answers both in one request.
 */
export function useBookingFolio(bookingId: string | null) {
  return useQuery(
    orpc.folio.read.queryOptions({
      input: bookingId === null ? skipToken : { bookingId },
      meta: {
        errorMessage: "The stay's account could not be read.",
      } satisfies ConsoleMeta,
    }),
  );
}

/**
 * The balance, as a payment on the stay's account.
 *
 * The receipt carries the account it landed on, which is why the sequence reads
 * the new balance off the mutation rather than waiting for the invalidated
 * query: a desk taking part of what is owed has not settled the stay, and the
 * only figure that can say so is the one the write itself came back with.
 */
export function usePostPayment() {
  const queryClient = useQueryClient();

  return useMutation(
    orpc.folio.postPayment.mutationOptions({
      meta: {
        errorMessage: "The payment could not be posted.",
      } satisfies ConsoleMeta,
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: orpc.folio.key() });
        // The drawer too, and not only the account — `usePostDeposit` in
        // `features/arrivals/arrivals-queries.ts` states the argument at
        // length. Cash taken here is counted into the operator's open shift, so
        // the figure the shell's bar is showing became wrong in the same commit
        // that wrote the line.
        void queryClient.invalidateQueries({ queryKey: orpc.operations.key() });
      },
    }),
  );
}

/**
 * Agreeing the account — and, in the same commit, the invoice.
 *
 * There is no e-invoice route to call after this one and there is not meant to
 * be. `apps/api/src/modules/folio/e-invoice.job.ts` states the arrangement:
 * `FR-FOL-04` asks that closing a folio enqueue an idempotent invoice job keyed
 * on the folio, and the strongest form of that enqueue is the close's own
 * commit — a folio standing at `CLOSED` with no invoice reference *is* the
 * queue, drained by a sweep. So this press is the initiation, a second call
 * would be a second home for a fact the ledger already states, and the console
 * has nothing to poll: the invoice is issued out of band and a provider failure
 * can never reach back into a checkout that has already committed.
 */
export function useCloseFolio() {
  const queryClient = useQueryClient();

  return useMutation(
    orpc.folio.close.mutationOptions({
      meta: {
        errorMessage: "The account could not be agreed.",
      } satisfies ConsoleMeta,
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: orpc.folio.key() });
      },
    }),
  );
}

/**
 * The transition itself — `CHECKED_IN → CHECKED_OUT`.
 *
 * Invalidates wider than the queue it was pressed from, which is
 * `lib/api-query.ts`'s instruction and is literally true here: the stay leaves
 * the departures list, the room the guest vacated becomes housekeeping's on the
 * board, and the account is the one the folio screens read. A screen that
 * invalidated only its own query would leave the other two showing a guest who
 * has driven away.
 */
export function useCheckOut() {
  const queryClient = useQueryClient();

  return useMutation(
    orpc.booking.checkOut.mutationOptions({
      meta: {
        errorMessage: "The guest could not be checked out.",
      } satisfies ConsoleMeta,
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: orpc.search.key() });
        void queryClient.invalidateQueries({
          queryKey: orpc.housekeeping.board.key(),
        });
        void queryClient.invalidateQueries({ queryKey: orpc.folio.key() });
      },
    }),
  );
}
