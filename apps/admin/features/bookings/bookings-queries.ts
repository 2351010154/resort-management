/* The bookings screen's reads and its one write.
 *
 * **The day, the stays, and — only for an operator who may take a booking — the
 * rooms.** The day is the API's answer rather than the browser's, and it comes
 * from `GET /system/business-date`, which every staff role may read. The
 * housekeeping board is not that source here: the matrix denies
 * `housekeeping.board` to `ACCOUNTANT`, and `features/shell/nav-inventory.ts`
 * deliberately offers this family to them because they may read bookings — so a
 * screen that took its day off the board would open a door that 403s on its
 * first request. Both routes resolve through the same service on the server, so
 * this screen and the three that keep reading the board cannot disagree about
 * what day it is.
 *
 * The board is still what a walk-in is walked into a room from, and that is the
 * only thing it is asked for here: it is fetched when the operator may take a
 * booking, which is exactly the set of roles that hold the row. A board that
 * failed does not fail the list — the rooms feed the new-booking panel and
 * nothing on the table — and `lib/query-client.ts` has already said so.
 *
 * **The default window is `todaysCriteria`, and a search replaces it.** One
 * query with one key per set of criteria, so going back to today's list is a
 * cache hit rather than a second request, and a colleague's check-in landing in
 * the cache updates whichever of the two the operator is looking at.
 *
 * Nothing here reports its own failure: `lib/query-client.ts` raises the toast
 * centrally. What these hooks owe the screen is the honest state of the list,
 * which is {@link useBookingList}'s reading.
 */

"use client";

import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useMemo } from "react";

import type { BoardRoom } from "@/features/housekeeping";
import { useHousekeepingBoard } from "@/features/housekeeping";
import { orpc } from "@/lib/api-query";
import { useStaffSession } from "@/lib/auth";
import type { ConsoleMeta } from "@/lib/query-client";

import {
  mayTakeBookings,
  type SearchCriteria,
  type StayList,
  stayList,
  todaysCriteria,
} from "./booking-search";

/** What the screen knows about the list it is drawing. */
export type ListReading =
  | { readonly status: "pending" }
  | { readonly status: "failed" }
  | ({ readonly status: "ready" } & StayList);

/** The whole screen's data layer: the property's day, the stays, the rooms. */
export interface BookingsData {
  /** The day the default window was cut against, once the board has said. */
  readonly businessDate: string | null;
  readonly list: ListReading;
  /**
   * Every room on the board, empty until it lands — and empty for good for an
   * operator who may not take a booking, since nothing else on this screen
   * reads them and the board is not asked for.
   *
   * There is no separate "the rooms could not be read" state. The panel they
   * feed is opened deliberately, the failure has already been reported, and a
   * table of stays is not made wrong by a board that did not answer.
   */
  readonly rooms: readonly BoardRoom[];
}

/**
 * The property's day, as the API resolves it.
 *
 * Not derived in the browser: the rollover hour is `system_config`'s and a
 * console doing its own arithmetic at 01:30 would anchor on a day the property
 * is not working. Every staff role may read this, which is the point of its
 * being its own route.
 */
export function useBusinessDate() {
  return useQuery(
    orpc.businessDate.read.queryOptions({
      input: {},
      meta: {
        errorMessage: "The property's business date could not be read.",
      } satisfies ConsoleMeta,
    }),
  );
}

/** All staff stay writes, kept together so invalidation follows the affected fact. */
export function useBookingActions() {
  const queryClient = useQueryClient();
  const refreshSearch = () =>
    void queryClient.invalidateQueries({ queryKey: orpc.search.key() });
  const refreshOperational = () => {
    refreshSearch();
    void queryClient.invalidateQueries({ queryKey: orpc.folio.key() });
    void queryClient.invalidateQueries({
      queryKey: orpc.housekeeping.board.key(),
    });
  };
  return {
    confirm: useMutation(
      orpc.booking.confirm.mutationOptions({
        meta: {
          errorMessage: "The hold could not be confirmed.",
        } satisfies ConsoleMeta,
        onSuccess: refreshSearch,
      }),
    ),
    cancel: useMutation(
      orpc.booking.cancel.mutationOptions({
        meta: {
          errorMessage: "The booking could not be cancelled.",
        } satisfies ConsoleMeta,
        onSuccess: refreshOperational,
      }),
    ),
    cancelWithWaiver: useMutation(
      orpc.booking.cancelWithWaiver.mutationOptions({
        meta: {
          errorMessage: "The cancellation waiver could not be applied.",
        } satisfies ConsoleMeta,
        onSuccess: refreshOperational,
      }),
    ),
    markNoShow: useMutation(
      orpc.booking.markNoShow.mutationOptions({
        meta: {
          errorMessage: "The stay could not be marked no-show.",
        } satisfies ConsoleMeta,
        onSuccess: refreshOperational,
      }),
    ),
    reinstate: useMutation(
      orpc.booking.reinstate.mutationOptions({
        meta: {
          errorMessage: "The late arrival could not be reinstated.",
        } satisfies ConsoleMeta,
        onSuccess: refreshOperational,
      }),
    ),
    moveRoom: useMutation(
      orpc.booking.moveRoom.mutationOptions({
        meta: {
          errorMessage: "The room move was refused.",
        } satisfies ConsoleMeta,
        onSuccess: refreshOperational,
      }),
    ),
    changeRoomType: useMutation(
      orpc.booking.changeRoomType.mutationOptions({
        meta: {
          errorMessage: "The room type could not be changed.",
        } satisfies ConsoleMeta,
        onSuccess: refreshOperational,
      }),
    ),
    extendStay: useMutation(
      orpc.booking.extendStay.mutationOptions({
        meta: {
          errorMessage: "The stay could not be extended.",
        } satisfies ConsoleMeta,
        onSuccess: refreshOperational,
      }),
    ),
    shortenStay: useMutation(
      orpc.booking.shortenStay.mutationOptions({
        meta: {
          errorMessage: "The stay could not be shortened.",
        } satisfies ConsoleMeta,
        onSuccess: refreshOperational,
      }),
    ),
    resendAccountLink: useMutation(
      orpc.booking.resendAccountLink.mutationOptions({
        meta: {
          errorMessage: "The account link could not be resent.",
        } satisfies ConsoleMeta,
      }),
    ),
  };
}

/**
 * The stays on screen — today's, or whatever was searched for.
 *
 * A day that did not load fails the list rather than leaving it spinning: the
 * default window is keyed to it, so a query held on `skipToken` for a date that
 * will never arrive is `pending` forever, and a list that never finishes loading
 * is the silent failure `lib/query-client.ts` exists to prevent. A search
 * carries its own criteria and does not wait on the day, so a desk with a
 * reference in its hand is not stopped by a read that failed.
 */
export function useBookingList(criteria: SearchCriteria | null): BookingsData {
  const session = useStaffSession();
  const day = useBusinessDate();
  const businessDate = day.data?.businessDate;

  // The board is the walk-in's room list and nothing else here, so it is asked
  // for only by an operator who may take one. That set is precisely the roles
  // the matrix grants `housekeeping.board`, which is what keeps this screen
  // free of a request its own operator would be refused.
  const board = useHousekeepingBoard(
    session.status === "authenticated" && mayTakeBookings(session.user.role)
      ? {}
      : skipToken,
  );

  const asked =
    criteria ??
    (businessDate === undefined ? null : todaysCriteria(businessDate));

  const stays = useQuery(
    orpc.search.operational.queryOptions({
      input: asked ?? skipToken,
      meta: {
        errorMessage: "The booking search could not be run.",
      } satisfies ConsoleMeta,
    }),
  );

  // Memoized on the answer rather than recomputed per render, because the list
  // is the table's `data`: a fresh array on every render is a row model rebuilt
  // on every render, and the rows are what the operator is arrowing through.
  const cut = useMemo(
    () => (stays.data === undefined ? undefined : stayList(stays.data)),
    [stays.data],
  );

  // The day only fails the list while the list is the day's window. A search
  // stands on its own criteria.
  const failed = stays.isError || (criteria === null && day.isError);

  return {
    businessDate: businessDate ?? null,
    list: listReading(failed, cut),
    rooms: board.data?.rooms ?? [],
  };
}

/** The list's three states, folded out of one answer and its dependency. */
function listReading(
  failed: boolean,
  list: StayList | null | undefined,
): ListReading {
  if (failed) {
    return { status: "failed" };
  }

  if (list === undefined) {
    return { status: "pending" };
  }

  // `null` is a narrowed search answer — a grant covering rooms only, which has
  // no stays in it to list. "No stay matches" would be a different and false
  // statement, so it reads as a failure the screen names.
  return list === null ? { status: "failed" } : { status: "ready", ...list };
}

/**
 * The stay the desk takes at the counter or over the telephone — *(new)* →
 * `CONFIRMED`, in one request.
 *
 * `booking.createConfirmed` and not a hold followed by a confirmation: `POST
 * /bookings` is the desk's own door and it lands at `CONFIRMED` with no TTL,
 * because the person taking the booking is the one confirming it.
 * `POST /bookings/{id}/confirmation` moves a *hold* — the funnel's shape, which
 * has a payment between the two — and firing it against a stay already
 * `CONFIRMED` would be a second opinion about a transition that has happened.
 *
 * Invalidates the search wholesale rather than one window: the new stay belongs
 * to whichever lists cover its dates, which is at least the arrivals queue when
 * it starts today, and a screen that invalidated only its own criteria would
 * leave the desk's other surfaces without a booking it just took.
 */
export function useCreateBooking() {
  const queryClient = useQueryClient();

  return useMutation(
    orpc.booking.createConfirmed.mutationOptions({
      meta: {
        errorMessage: "The booking could not be taken.",
      } satisfies ConsoleMeta,
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: orpc.search.key() });
      },
    }),
  );
}
