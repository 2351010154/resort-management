/* The guests screen's two reads and its one write.
 *
 * **The search is the same query the bookings screen runs.** One route,
 * `search.operational`, asked through the same `orpc` utils and therefore keyed
 * into the same cache entry — a screen that wrote its own client for it would be
 * a second copy of one route's criteria and a cache the two could disagree
 * across.
 *
 * **The record is asked for one named person, and only once one is picked.** The
 * search answers a candidate list; `guest.readRecord` answers the record, and it
 * is held on `skipToken` until an operator has chosen somebody. Nothing on this
 * screen fetches a record because it happened to be in a list.
 *
 * **The reveal is a write that is deliberately kept out of the cache.**
 * `guest.unmaskCccd` is a mutation, so nothing about the number is stored under
 * a query key, invalidated into another screen, refetched on window focus or
 * served from memory to the next component that asks. `gcTime: 0` finishes the
 * job: the moment the record is left, the mutation is dropped from the mutation
 * cache with the number in it, so coming back to the same guest asks the API
 * again — which is what makes one audit entry mean "somebody looked once".
 * `FR-GST-03` counts readings per call, and a cached reading is a reading nobody
 * would have filed.
 *
 * Nothing here reports its own failure: `lib/query-client.ts` raises the toast
 * for every read and every write centrally.
 */

"use client";

import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { SearchCriteria } from "@/features/bookings/booking-search";
import { orpc } from "@/lib/api-query";
import type { ConsoleMeta } from "@/lib/query-client";

import { type GuestList, guestList } from "./guest-record";

/** What the screen knows about the list of people it is drawing. */
export type ListReading =
  | { readonly status: "idle" }
  | { readonly status: "pending" }
  | { readonly status: "failed" }
  | ({ readonly status: "ready" } & GuestList);

/**
 * The people matching what the desk searched for.
 *
 * `null` criteria is the screen before anybody has typed anything, and it is
 * `idle` rather than `pending`: there is no route that lists every guest the
 * property has, so an empty screen is waiting for a search rather than waiting
 * for an answer, and a spinner over it would promise a list that is never
 * coming.
 */
export function useGuestSearch(criteria: SearchCriteria | null): ListReading {
  const found = useQuery(
    orpc.search.operational.queryOptions({
      input: criteria ?? skipToken,
      meta: {
        errorMessage: "The guest search could not be run.",
      } satisfies ConsoleMeta,
    }),
  );

  // Memoized on the answer rather than recomputed per render, because the list
  // is what the roving group is drawn from: a fresh array on every render is a
  // list rebuilt underneath the operator's arrow keys.
  const cut = useMemo(
    () => (found.data === undefined ? undefined : guestList(found.data)),
    [found.data],
  );

  if (criteria === null) {
    return { status: "idle" };
  }

  if (found.isError) {
    return { status: "failed" };
  }

  if (cut === undefined) {
    return { status: "pending" };
  }

  // `null` is a narrowed search answer — a grant covering rooms only, which has
  // no people in it to list. "Nobody matches" would be a different and false
  // statement, so it reads as a failure the screen names.
  return cut === null ? { status: "failed" } : { status: "ready", ...cut };
}

/**
 * One person's record, with the identity number masked.
 *
 * The masked record is cacheable and is cached: it carries no number, which is
 * `guestRecordSchema`'s whole claim — there is no field on it a plain CCCD could
 * travel in — so nothing about holding it for the console's ordinary stale time
 * discloses anything the search did not already show.
 */
export function useGuestRecord(guestId: string | null) {
  return useQuery(
    orpc.guest.readRecord.queryOptions({
      input: guestId === null ? skipToken : { guestId },
      meta: {
        errorMessage: "The guest record could not be read.",
      } satisfies ConsoleMeta,
    }),
  );
}

/**
 * Reveals one identity number, once — `POST /guests/{guestId}/cccd-reveals`.
 *
 * Invalidates nothing. The reading changes no record the console holds: the
 * masked record is the same record afterwards, and the audit entry it wrote
 * belongs to a log this screen does not draw. An invalidation here would refetch
 * a record to show exactly what it already showed.
 *
 * `gcTime: 0` is the integrity choice and not a tuning one. TanStack keeps a
 * finished mutation — its variables and its result — in the mutation cache for
 * five minutes by default, which would leave a plain CCCD in memory long after
 * the operator moved on, and would let a remounted control show a number that
 * was read for a different visit. Dropped on unmount instead: leaving the record
 * and coming back is a second reading, filed as one.
 */
export function useRevealCccd() {
  return useMutation(
    orpc.guest.unmaskCccd.mutationOptions({
      gcTime: 0,
      meta: {
        errorMessage: "The identity number could not be revealed.",
      } satisfies ConsoleMeta,
    }),
  );
}
