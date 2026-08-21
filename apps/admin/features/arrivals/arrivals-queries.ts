/* The arrivals screen's reads and its five writes.
 *
 * **Two requests draw the whole queue.** The housekeeping board answers the
 * property's day *and* the rooms a guest can be walked into, and the operational
 * search answers the stays arriving on that day — so the assignment control
 * costs no request of its own, and the day is the API's answer rather than the
 * browser's. The criteria are `features/dashboard`'s own builder, not a second
 * copy: the dashboard's arrivals card and this queue ask exactly the same
 * question, and sharing the builder means they share the cache entry too — a
 * receptionist pressing the card lands on a list that is already there.
 *
 * **The account is read only while a sequence is open.** A queue of forty
 * arrivals does not need forty folios; what needs one is the stay being worked,
 * because whether a deposit is due is a fact about its balance. `skipToken` is
 * how that is held back — no booking, no request, and no placeholder id sitting
 * in the cache key of a call that never ran.
 *
 * Nothing here reports its own failure: `lib/query-client.ts` raises the toast
 * centrally. What these hooks owe the screen is the honest state of the queue,
 * which is {@link useArrivalQueue}'s reading. The single exception is the
 * account read, whose absence is a normal fact about a stay nobody has checked
 * in yet — see {@link useBookingFolio}.
 */

"use client";

import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { arrivalCriteria } from "@/features/dashboard";
import type { BoardRoom } from "@/features/housekeeping";
import { useHousekeepingBoard } from "@/features/housekeeping";
import { orpc } from "@/lib/api-query";
import type { ConsoleMeta } from "@/lib/query-client";

import {
  type ArrivalQueue,
  type GuestHit,
  todaysArrivals,
} from "./arrival-queue";

/** What the screen knows about the queue it is drawing. */
export type QueueReading =
  | { readonly status: "pending" }
  | { readonly status: "failed" }
  | ({ readonly status: "ready" } & ArrivalQueue);

/** The whole screen's data layer: the property's day, the queue, the rooms. */
export interface ArrivalsData {
  /** The day the queue was cut against, once the board has said. */
  readonly businessDate: string | null;
  readonly queue: QueueReading;
  /**
   * Every room on the board, empty until it lands.
   *
   * There is no separate "the rooms could not be read" state, because a board
   * that failed has already failed the queue above: the day it resolves is what
   * the arrivals search is keyed to, so there is no row to assign a room from.
   */
  readonly rooms: readonly BoardRoom[];
}

/**
 * Today's arrivals, and the rooms they can be put in.
 *
 * A board that did not load fails the queue rather than leaving it spinning:
 * the search is keyed to the day the board resolves, so a query held on
 * `skipToken` for a date that will never arrive is `pending` forever, and a list
 * that never finishes loading is the silent failure `lib/query-client.ts` exists
 * to prevent.
 */
export function useArrivalQueue(): ArrivalsData {
  const board = useHousekeepingBoard();
  const businessDate = board.data?.businessDate;

  const arrivals = useQuery(
    orpc.search.operational.queryOptions({
      input:
        businessDate === undefined ? skipToken : arrivalCriteria(businessDate),
      meta: {
        errorMessage: "Today's arrivals could not be loaded.",
      } satisfies ConsoleMeta,
    }),
  );

  // Memoized on the answer rather than recomputed per render, because the queue
  // is the table's `data`: a fresh array on every render is a row model rebuilt
  // on every render, and the rows are what the operator is arrowing through.
  // The date is re-checked inside rather than asserted — it is present whenever
  // there is an answer to cut, because without it no request was made, and a
  // `!` here would be that reasoning written where the compiler cannot hold
  // anybody to it.
  const cut = useMemo(
    () =>
      arrivals.data === undefined || businessDate === undefined
        ? undefined
        : todaysArrivals(arrivals.data, businessDate),
    [arrivals.data, businessDate],
  );

  return {
    businessDate: businessDate ?? null,
    queue: queueReading(board.isError || arrivals.isError, cut),
    rooms: board.data?.rooms ?? [],
  };
}

/** The queue's three states, folded out of one answer and its dependency. */
function queueReading(
  failed: boolean,
  queue: ArrivalQueue | null | undefined,
): QueueReading {
  if (failed) {
    return { status: "failed" };
  }

  if (queue === undefined) {
    return { status: "pending" };
  }

  // `null` is a narrowed search answer — a grant covering rooms only, which has
  // no stays in it to list. "Nobody is arriving" would be a different and false
  // statement, so it reads as a failure the screen names.
  return queue === null ? { status: "failed" } : { status: "ready", ...queue };
}

/**
 * The stay's account, while its sequence is open.
 *
 * Read rather than assumed, because whether a deposit is due is a property of
 * the ledger: a stay booked through the funnel arrives paid in full and one the
 * desk took by telephone does not, and a sequence that offered the step either
 * way would ask a receptionist for money the guest has already handed over.
 *
 * **The one read in the console that is not toasted when it fails.** A stay
 * that has not checked in has no account yet — the folio is opened by the
 * transition this sequence is working towards — so `folio.read` answering that
 * there is none is the ordinary case here and not a fault, and it would put a
 * red toast in front of the desk on every check-in. The sequence draws the
 * consequence itself, on the step where it matters: no deposit is offered and
 * the review says the account could not be read. That line covers a folio that
 * failed for any other reason too, which is why the whole read opts out rather
 * than one status of it.
 */
export function useBookingFolio(bookingId: string | null) {
  return useQuery(
    orpc.folio.read.queryOptions({
      input: bookingId === null ? skipToken : { bookingId },
      // No `errorMessage` beside it: nothing is said centrally about this read,
      // so a sentence here would be one that can never be shown.
      meta: { rendersFailureInline: true } satisfies ConsoleMeta,
    }),
  );
}

/** How long the guest lookup waits after the last keystroke. */
const GUEST_SEARCH_DEBOUNCE_MS = 200;

/** The shortest name fragment worth asking the API about. */
const SHORTEST_GUEST_QUERY = 2;

/**
 * People the property has met before, matched on the name being typed.
 *
 * This is what keeps a returning guest from becoming a second record: the CCCD
 * is unique, so registering somebody the property already knows is refused by
 * the API in the middle of a check-in — the desk would meet a conflict it can
 * do nothing about with a guest standing in front of it. Picking the existing
 * record instead is one keystroke, and it is also what makes `FR-GST-01`'s stay
 * history a history rather than a row per visit.
 *
 * Debounced, because this runs on every keystroke of a name. One request per
 * letter of "Nguyễn Thị Hương" is fourteen searches to answer one question.
 */
export function useGuestMatches(typed: string): readonly GuestHit[] {
  const guestName = useDebounced(typed.trim(), GUEST_SEARCH_DEBOUNCE_MS);

  const matches = useQuery(
    orpc.search.operational.queryOptions({
      input:
        guestName.length < SHORTEST_GUEST_QUERY ? skipToken : { guestName },
      meta: {
        errorMessage: "The guest lookup could not be run.",
      } satisfies ConsoleMeta,
    }),
  );

  return matches.data?.scope === "everything" ? matches.data.guests : [];
}

/** A value that settles rather than one that follows every keystroke. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(value);
    }, delayMs);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);

  return settled;
}

/**
 * The room the stay will be walked into.
 *
 * A `PUT`, so a desk that picks 204 twice leaves the booking holding 204. What
 * it changes beyond the booking is the board — the room is now spoken for — so
 * both the board and the search are invalidated after it.
 */
export function useAssignRoom() {
  const queryClient = useQueryClient();

  return useMutation(
    orpc.booking.assignRoom.mutationOptions({
      meta: {
        errorMessage: "The room could not be assigned.",
      } satisfies ConsoleMeta,
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: orpc.housekeeping.board.key(),
        });
        void queryClient.invalidateQueries({ queryKey: orpc.search.key() });
      },
    }),
  );
}

/**
 * The deposit, as a payment on the stay's account.
 *
 * `folio.postPayment` and not a route of its own: a deposit is money the guest
 * handed over against what they owe, which is what that route posts, and the
 * ledger is append-only so the same figure sent twice is honestly two lines.
 */
export function usePostDeposit() {
  const queryClient = useQueryClient();

  return useMutation(
    orpc.folio.postPayment.mutationOptions({
      meta: {
        errorMessage: "The deposit could not be posted.",
      } satisfies ConsoleMeta,
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: orpc.folio.key() });
        // The drawer too, and not only the account. A deposit taken in cash is
        // counted into the operator's open shift by the API, so the figure the
        // shell's bar is showing became wrong in the same commit that wrote the
        // line — and a bar that is only right until the next payment is worse
        // than no bar, because it is trusted. Invalidated for every method
        // rather than only for cash: whether a shift moved is the API's reading
        // of the posting, not one this hook should keep a second opinion about.
        void queryClient.invalidateQueries({ queryKey: orpc.operations.key() });
      },
    }),
  );
}

/**
 * The particulars the desk read off a returning guest's document — `FR-GST-02`.
 *
 * The other half of the lookup above. Picking the record the property already
 * has is what stops a second one being created, and it is also what leaves the
 * typed particulars nowhere to go: check-in names a known guest by id and
 * carries nothing else about them. This is where they go instead, and it is a
 * write onto the guest rather than onto the stay — which is why it is not the
 * check-in's business and does not wait for it.
 *
 * Sending the same three facts again writes the same record, so the retry a
 * desk performs after a connection it never saw answer costs nothing.
 *
 * The search is invalidated after it, because the search is what the lookup
 * draws its masked number from: a desk that transcribed a number and then
 * opened the next arrival for the same guest would otherwise be told the
 * property still has nothing on file.
 */
export function useTranscribeDocument() {
  const queryClient = useQueryClient();

  return useMutation(
    orpc.guest.transcribeDocument.mutationOptions({
      meta: {
        errorMessage: "The document particulars could not be recorded.",
      } satisfies ConsoleMeta,
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: orpc.search.key() });
      },
    }),
  );
}

/**
 * The transition itself — `CONFIRMED → CHECKED_IN`.
 *
 * Invalidates wider than the queue it was pressed from, which is
 * `lib/api-query.ts`'s instruction and is literally true here: the stay leaves
 * the arrivals list, the room becomes occupied on the housekeeping board, and
 * the account gains a registration the folio screens read against. A screen
 * that invalidated only its own query would leave the other two showing a guest
 * still waiting at the counter.
 */
export function useCheckIn() {
  const queryClient = useQueryClient();

  return useMutation(
    orpc.booking.checkIn.mutationOptions({
      meta: {
        errorMessage: "The guest could not be checked in.",
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
