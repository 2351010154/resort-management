/* The rates screen's reads and its three writes.
 *
 * **The grid is a fan-out, because the contract is one type per call.**
 * `pricingRangeQuery` names a single `roomType`, so a grid of five types over
 * one window is five calendar reads and five restriction reads — asked together
 * through `useQueries` rather than one after another, because ten sequential
 * round trips is ten times the latency for one screenful and `NFR-04` budgets
 * the whole interaction at 150 ms. There is no route that answers several types
 * at once and no room-type route to enumerate them from; the rows come from
 * `ROOM_TYPE_CODES`, which is the same tuple the Postgres enum is built from.
 *
 * **The grid reports its own failures, and that is the one exception this
 * screen takes to the central toast.** `lib/query-client.ts` makes the toast a
 * floor precisely so a screen that forgets its `onError` cannot fail silently,
 * and it names the single way through: {@link ConsoleMeta.rendersFailureInline},
 * declared by a call that draws its own failure where the operator is already
 * looking. Here that is literal — a type whose prices did not arrive is a row of
 * the grid saying so, under a line naming every such type. What the toast would
 * do instead is stack ten identical sentences over the work, because one outage
 * is ten refused reads of one question. `rate-grid.ts` owns both statements
 * ({@link RateRow.status} and {@link unreadTypes}) and is specified on them, so
 * the declaration below is paid for rather than assumed.
 *
 * The plan list keeps the toast: it is one call, and a failure there is one
 * sentence.
 *
 * **What each write can stale.** These are the three acts and the cache entries
 * behind them:
 *
 * - A price on `DELUXE` for a range of nights stales the *calendar* reads that
 *   asked about `DELUXE` and nothing else. Not the other four types, whose
 *   windows are exactly as correct as they were; not the restrictions, which a
 *   price does not touch; not the plans, which are priced *off* the calendar and
 *   whose own three rows are unchanged. {@link readsRoomType} is how the
 *   invalidation stays that narrow.
 * - A stay restriction stales the *restriction* reads for its type, on the same
 *   reasoning in the other direction: what the property will sell has moved and
 *   what it costs has not.
 * - A plan PATCH stales `listRatePlans`. It writes one of three rows in
 *   `rate_plan` and reads back the row it wrote, and nothing else in the console
 *   reads a plan.
 *
 * Every invalidation is in `onSettled` rather than `onSuccess`, and the fan-out
 * is why: five calls can half-succeed, so the refetch has to happen whether the
 * act as a whole reported success or not — otherwise a rejected edit would leave
 * the two types that did land showing their old prices.
 *
 * Neither range write is optimistic. `features/rooms/rooms-queries.ts` guesses
 * a tile because an operator presses it while on the telephone; a season priced
 * across five types is a considered act whose confirmation is the API's own
 * count of the nights it wrote, and guessing 140 cells to save one round trip
 * would put a figure on screen that no request had yet agreed to.
 */

"use client";

import { ROOM_TYPE_CODES, type RoomTypeCode } from "@mariva/shared";
import {
  skipToken,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

/* The range writes go through `lib/api.ts` directly rather than through this
 * route's `mutationOptions`, and `api.ts` sanctions exactly that for "a form's
 * own submit": one operator act here is one call per selected room type, so the
 * unit `useMutation` should track is the edit and not the request. A mutation
 * per type would give the panel five pending states and five results to
 * reconcile for one press of one button. */
import { api } from "@/lib/api";
import { orpc } from "@/lib/api-query";
import type { ConsoleMeta } from "@/lib/query-client";

import {
  type NightWindow,
  type RateGridView,
  type RatePlan,
  rateGrid,
  readsRoomType,
  type SetRateCalendarInput,
  type SetStayRestrictionsInput,
  type TypeAnswer,
} from "./rate-grid";

/**
 * The property's day, which the grid opens on.
 *
 * The bookings screen's own hook, re-exported rather than written again — the
 * arrangement `features/payments/payments-queries.ts` uses and argues for: one
 * route asked through the same `orpc` utils is one cache entry, so the first
 * night on this grid is the day the rest of the console is working, without a
 * second request and without a second opinion about what "the property's day
 * could not be read" says. It matters more here than elsewhere, because the
 * business date rolls at 04:00 and a manager pricing at 01:30 must not be shown
 * a grid starting tomorrow.
 */
export { useBusinessDate } from "@/features/bookings/bookings-queries";

/**
 * How long a window of the calendar is trusted without asking again.
 *
 * Five minutes rather than the console's thirty seconds, on the invitation
 * `lib/query-client.ts` writes into its own default: "a rate calendar is edited
 * by one manager and can be trusted for longer". It is the one screen in the
 * console that edits it, and every edit invalidates what it touched — so the
 * only thing a shorter window would catch is a second manager in a second
 * browser, at the cost of ten refetches every time this tab regains focus.
 */
const RATE_STALE_TIME_MS = 5 * 60_000;

/** Which of the two pricing rows of the matrix this operator holds a read on. */
export interface RatesOffered {
  /** `pricing.rate-plans` — the calendar and the three plans. */
  readonly prices: boolean;
  /** `pricing.stay-restrictions` — the narrower row, which the accountant has
   *  nothing on. */
  readonly rules: boolean;
}

/**
 * One window of the property's tariff: every type's prices, and its rules.
 *
 * The restriction reads are held on `skipToken` for an operator not offered
 * them, which is the difference between a grid that says "these are not yours
 * to see" and one that asks ten times a minute for a 403. What reaches
 * `rateGrid` in that case is `restrictions: null` — a permission — rather than a
 * failed answer, and the grid keeps the two apart.
 *
 * Not memoized, where `features/rooms/rooms-queries.ts` memoizes its groups.
 * The reason that hook gives does not hold here: the grid's members are
 * identified by their date, which survives a rebuilt array — `roving-focus.tsx`
 * tracks by value for exactly that reason — and every form on this screen holds
 * its own typed state, so a keystroke in the price box never reaches the grid.
 * What is left is a derivation that runs when a selection moves or an answer
 * lands, which is when the grid has actually changed.
 */
export function useRateWindow(
  window: NightWindow,
  offered: RatesOffered,
): RateGridView {
  const range = { from: window.from, to: window.to };

  const calendars = useQueries({
    queries: ROOM_TYPE_CODES.map((roomType) =>
      orpc.pricing.readRateCalendar.queryOptions({
        input: offered.prices ? { roomType, ...range } : skipToken,
        staleTime: RATE_STALE_TIME_MS,
        // The row says it, and the line above the grid names every type it
        // happened to — see this file's opening note.
        meta: { rendersFailureInline: true } satisfies ConsoleMeta,
      }),
    ),
  });

  const rules = useQueries({
    queries: ROOM_TYPE_CODES.map((roomType) =>
      orpc.pricing.readStayRestrictions.queryOptions({
        input: offered.rules ? { roomType, ...range } : skipToken,
        staleTime: RATE_STALE_TIME_MS,
        meta: { rendersFailureInline: true } satisfies ConsoleMeta,
      }),
    ),
  });

  const answers: TypeAnswer[] = ROOM_TYPE_CODES.map((roomType, index) => ({
    roomType,
    calendar: {
      failed: calendars[index].isError,
      nights: calendars[index].data?.nights,
    },
    restrictions: offered.rules
      ? {
          failed: rules[index].isError,
          restrictions: rules[index].data?.restrictions,
        }
      : null,
  }));

  return rateGrid(window, answers);
}

/** What the screen knows about the three plans. */
export type PlansReading =
  | { readonly status: "pending" }
  | { readonly status: "failed" }
  | { readonly status: "ready"; readonly plans: readonly RatePlan[] };

/**
 * The three plans priced off the calendar — `FR-PRC-01`.
 *
 * One call, so its failure is one sentence and the central toast says it. The
 * plans arrive in `displayOrder` from the API and are rendered in that order:
 * the column is read-only in the contract, so a second opinion about the order
 * here would be a sort nothing can act on.
 */
export function useRatePlans(offered: boolean): PlansReading {
  const plans = useQuery(
    orpc.pricing.listRatePlans.queryOptions({
      input: offered ? {} : skipToken,
      meta: {
        errorMessage: "The rate plans could not be read.",
      } satisfies ConsoleMeta,
    }),
  );

  if (plans.isError) {
    return { status: "failed" };
  }

  return plans.data === undefined
    ? { status: "pending" }
    : { status: "ready", plans: plans.data.plans };
}

/** What one range write actually touched, summed across the types it covered. */
export interface RangeWritten {
  readonly nights: number;
  readonly roomTypes: readonly RoomTypeCode[];
}

/** The same, plus which of `setStayRestrictions`' two outcomes happened. */
export interface RulesWritten extends RangeWritten {
  /** The rule written was "no rule", so `nights` counts rows removed. */
  readonly cleared: boolean;
}

/**
 * One price across a span — `setRateCalendar`, once per selected room type.
 *
 * `Promise.all` rather than `allSettled`: an edit that did not fully land is a
 * failure the operator has to be told about, and the count of what *did* land
 * would be a consolation figure they cannot act on. The refetch in `onSettled`
 * is what makes the grid the record of what happened rather than this response.
 */
export function useApplyPrice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      calls: readonly SetRateCalendarInput[],
    ): Promise<RangeWritten> => {
      const written = await Promise.all(
        calls.map((call) => api.pricing.setRateCalendar(call)),
      );

      return {
        nights: written.reduce((total, one) => total + one.nights, 0),
        roomTypes: written.map((one) => one.roomType),
      };
    },

    meta: {
      errorMessage: "The price could not be written to those nights.",
    } satisfies ConsoleMeta,

    onSettled: (_written, _error, calls) => {
      for (const call of calls) {
        void queryClient.invalidateQueries({
          queryKey: orpc.pricing.readRateCalendar.key(),
          predicate: (query) => readsRoomType(query.queryKey, call.roomType),
        });
      }
    },
  });
}

/**
 * One rule across a span — `setStayRestrictions`, once per selected room type.
 *
 * `cleared` is read off the first response rather than computed here: every call
 * of one edit carries the same rule, so the API's own answer about which of its
 * two outcomes happened is the same for all of them — and taking the API's word
 * for it is what keeps the sentence the operator reads from being this screen's
 * guess about `isUnrestricted`.
 */
export function useApplyRules() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      calls: readonly SetStayRestrictionsInput[],
    ): Promise<RulesWritten> => {
      const written = await Promise.all(
        calls.map((call) => api.pricing.setStayRestrictions(call)),
      );

      return {
        nights: written.reduce((total, one) => total + one.nights, 0),
        roomTypes: written.map((one) => one.roomType),
        cleared: written[0]?.cleared === true,
      };
    },

    meta: {
      errorMessage: "The restriction could not be written to those nights.",
    } satisfies ConsoleMeta,

    onSettled: (_written, _error, calls) => {
      for (const call of calls) {
        void queryClient.invalidateQueries({
          queryKey: orpc.pricing.readStayRestrictions.key(),
          predicate: (query) => readsRoomType(query.queryKey, call.roomType),
        });
      }
    },
  });
}

/**
 * A change to one plan — `updateRatePlan`, which is a PATCH.
 *
 * Through this route's own `mutationOptions`, unlike the two above: it is one
 * call for one act, so there is nothing to fan out.
 *
 * One invalidation, and it is the list. A plan's percentage and its breakfast
 * are applied to the calendar rather than stored in it, so the calendar's rows
 * are the same rows afterwards — invalidating the grid here would refetch ten
 * windows to redraw figures this act cannot have moved.
 */
export function useUpdateRatePlan() {
  const queryClient = useQueryClient();

  return useMutation(
    orpc.pricing.updateRatePlan.mutationOptions({
      meta: {
        errorMessage: "The plan could not be changed.",
      } satisfies ConsoleMeta,

      onSettled: () => {
        void queryClient.invalidateQueries({
          queryKey: orpc.pricing.listRatePlans.key(),
        });
      },
    }),
  );
}
