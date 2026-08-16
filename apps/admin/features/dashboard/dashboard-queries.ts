/* The launchpad's reads.
 *
 * Four counts out of three routes, and none of them is a dashboard route: the
 * board answers what the property's day is and which rooms are not ready, the
 * operational search answers today's arrivals and departures, and the folio
 * collection answers how many accounts are still short. A `GET /dashboard`
 * would be a fourth description of facts those three already own, and the first
 * screen to disagree with it would be the one the desk actually works from.
 *
 * **The board is asked first, and the other two wait on it.** The business date
 * is the API's to resolve — `system_config.business_date_rollover_hour`, and
 * the board returns the day it answered against — so the two searches cannot be
 * built until it has landed. `skipToken` is how that is expressed: no input, no
 * request, no invented `enabled` flag, and no placeholder criteria sitting in
 * the cache key of a query that never ran. The cost is one round trip before
 * two of the four cards can start, and the alternative is a console computing
 * its own 04:00 and counting arrivals against a day the desk is not working.
 *
 * Nothing here reports its own failure. `lib/query-client.ts` raises the toast
 * centrally; what these hooks owe the screen is the honest state of each
 * number, which is {@link useDayCounts}'s four readings.
 */

"use client";

import { skipToken, useQuery } from "@tanstack/react-query";

import { useHousekeepingBoard } from "@/features/housekeeping";
import { orpc } from "@/lib/api-query";
import type { ConsoleMeta } from "@/lib/query-client";

import {
  arrivalCriteria,
  arrivalsAwaitingCheckIn,
  type CountReading,
  countReading,
  departureCriteria,
  departuresAwaitingCheckout,
  type FolioListQuery,
  roomsNotReady,
  unsettledFolios,
} from "./day-counts";

/**
 * Stays arriving today, as the search answers them.
 *
 * The day is passed in rather than read here, because it belongs to the board:
 * one query resolves the property's date and everything keyed to it uses that
 * answer, so the four cards cannot end up describing two different days.
 */
export function useArrivalsAwaitingCheckIn(businessDate: string | undefined) {
  return useQuery(
    orpc.search.operational.queryOptions({
      input:
        businessDate === undefined ? skipToken : arrivalCriteria(businessDate),
      meta: {
        errorMessage: "Today's arrivals could not be counted.",
      } satisfies ConsoleMeta,
    }),
  );
}

/** Stays due out today, as the search answers them. */
export function useDeparturesAwaitingCheckout(
  businessDate: string | undefined,
) {
  return useQuery(
    orpc.search.operational.queryOptions({
      input:
        businessDate === undefined
          ? skipToken
          : departureCriteria(businessDate),
      meta: {
        errorMessage: "Today's departures could not be counted.",
      } satisfies ConsoleMeta,
    }),
  );
}

/**
 * The one row it takes to learn how many accounts are still short.
 *
 * `total` on the response is counted under the filter rather than over the
 * page, so a `limit` of one is a complete answer to "how many" and pulls back a
 * single account instead of the fifty a default page would — a card that
 * transferred fifty ledgers to print one number would be a table nobody asked
 * for. `OUTSTANDING` is the contract's enum and not a boolean, and it means
 * `outstanding <> 0`: an over-paid stay is an account that does not balance and
 * is exactly what a desk chasing money at the end of a shift needs to see.
 *
 * No `state` filter. An account only closes once it settles, so a closed folio
 * with a balance is a discrepancy rather than a category to leave out.
 */
export function useUnsettledFolios() {
  return useQuery(
    orpc.folio.list.queryOptions({
      input: { balance: "OUTSTANDING", limit: 1 } satisfies FolioListQuery,
      meta: {
        errorMessage: "The unsettled folios could not be counted.",
      } satisfies ConsoleMeta,
    }),
  );
}

/** The screen's whole data layer: the property's day, and four honest numbers. */
export interface DayCounts {
  /** The day the counts were taken against, once the board has said. */
  readonly businessDate: string | null;
  readonly arrivals: CountReading;
  readonly departures: CountReading;
  readonly roomsNotReady: CountReading;
  readonly unsettledFolios: CountReading;
}

/**
 * Every count the dashboard draws, each carrying whether it is known.
 *
 * The board's failure is folded into the two searches that depend on it. A
 * dependent query that never ran is `pending` forever as far as TanStack is
 * concerned, and three cards spinning quietly because a fourth request failed
 * is precisely the silent-failure shape `lib/query-client.ts` exists to
 * prevent — so a board that did not load fails the cards keyed to its date
 * rather than leaving them mid-sentence.
 */
export function useDayCounts(): DayCounts {
  const board = useHousekeepingBoard();
  const businessDate = board.data?.businessDate;

  const arrivals = useArrivalsAwaitingCheckIn(businessDate);
  const departures = useDeparturesAwaitingCheckout(businessDate);
  const folios = useUnsettledFolios();

  return {
    businessDate: businessDate ?? null,

    arrivals: countReading(
      { failed: board.isError || arrivals.isError, data: arrivals.data },
      // The date is re-checked inside the closure rather than asserted: it is
      // present whenever there is an answer to derive from — no day, no
      // request — and a `!` here would be that reasoning written where the
      // compiler cannot hold anybody to it.
      (results) =>
        businessDate === undefined
          ? null
          : arrivalsAwaitingCheckIn(results, businessDate),
    ),

    departures: countReading(
      { failed: board.isError || departures.isError, data: departures.data },
      (results) =>
        businessDate === undefined
          ? null
          : departuresAwaitingCheckout(results, businessDate),
    ),

    roomsNotReady: countReading(
      { failed: board.isError, data: board.data },
      roomsNotReady,
    ),

    unsettledFolios: countReading(
      { failed: folios.isError, data: folios.data },
      unsettledFolios,
    ),
  };
}
