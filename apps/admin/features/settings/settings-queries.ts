/* The settings screen's two reads and its two writes, and they come from two
 * different places on purpose.
 *
 * **The configuration half goes through the contract.** `systemConfig.read` and
 * `systemConfig.update` are oRPC procedures, so they arrive here with keys and
 * options already typed from `@mariva/shared` and need nothing written per
 * endpoint.
 *
 * **The staff half cannot.** `identity.controller.ts` is a plain Nest controller
 * and `packages/shared/src/contract/` has no identity module, so there is no
 * procedure to reach and no generated key to invalidate.
 * `staff-account-requests.ts` is the thin `fetch` that reaches those two routes;
 * the hooks below put them in the same cache as everything else, with the same
 * session wrapper and the same central failure reporting, so the console keeps
 * one error channel rather than two.
 *
 * Nothing here reports its own failure. `lib/query-client.ts` raises the toast
 * for every read and every write centrally, and both halves supply the
 * `ConsoleMeta` sentence it reads.
 *
 * ## What a configuration change can stale, and what it cannot
 *
 * This is the unusual part of this feature's cache, and it is worth stating
 * rather than guessing at, because the figures on this screen are read by
 * *posting* code on the API and not by any query the console holds.
 *
 * **The row itself.** The `PATCH` answers with the whole configuration as it
 * committed — the contract says so, and says why: the caller has just changed one
 * figure and must now show every figure a posting will read, from the row that
 * actually landed rather than from an optimistic copy. So the answer is written
 * straight into the read's cache entry. No invalidation and no second round trip.
 *
 * **The property's day, but only when the rollover hour moved.**
 * `BusinessDateService` resolves the day from `business_date_rollover_hour` on
 * every question, so moving that hour can change what day the property is having
 * on the very next request — and two queries in this console carry the answer:
 * `businessDate.read`, and `housekeeping.board`, which stamps the day it drew
 * against. Both are invalidated, and only when the edit named that field. An
 * edit to a VAT rate that refetched the housekeeping board would be refetching
 * every desk screen in the console over a figure no board displays.
 *
 * **Nothing else, and each absence is a decision.** The tax figures are read at
 * the moment a folio posting splits a gross amount, so they change what the
 * *next* posting computes and change nothing about a posting already written —
 * an invoice is a legal document a third party issued, which is the whole reason
 * these figures are a row rather than a constant. The loyalty and tier figures
 * are read by the accrual at folio close and by the tier derivation at
 * business-date rollover, neither of which the console holds a query over. So a
 * folio, a payment or a guest record already in the cache is not made wrong by
 * this edit, and invalidating them would refetch half the console to show the
 * same answers back.
 */

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useBusinessDate } from "@/features/bookings/bookings-queries";
import { orpc } from "@/lib/api-query";
import { withStaffSession } from "@/lib/auth";
import type { ConsoleMeta } from "@/lib/query-client";

import type { NewStaffAccount, SystemConfiguration } from "./settings-form";
import {
  requestNewStaffAccount,
  requestStaffAccounts,
} from "./staff-account-requests";

/**
 * Where the staff-account list lives in the cache.
 *
 * Written by hand because these routes have no contract to derive a key from,
 * and shaped like the ones that do — the resource, then the collection — so a
 * later route under `identity` can be invalidated beside it rather than around
 * it.
 */
export const STAFF_ACCOUNTS_KEY = ["identity", "staff-accounts"] as const;

/** What the configuration half knows about the row it is drawing. */
export type ConfigReading =
  | { readonly status: "pending" }
  | { readonly status: "failed" }
  | { readonly status: "ready"; readonly config: SystemConfiguration };

/** The configuration half's data layer: the row, and the property's own day. */
export interface ConfigurationData {
  /**
   * The day every relative date typed into the relief-period fields is counted
   * from, once the API has answered it.
   *
   * Read from the API rather than derived here for the reason
   * `contract/business-date.ts` states outright: the rollover hour is this very
   * row's, and a console doing its own arithmetic at 01:30 anchors on a day the
   * property is not working. It is also the query a rollover-hour edit
   * invalidates, so the screen that changed the hour reads the new day back.
   */
  readonly businessDate: string | null;
  readonly reading: ConfigReading;
}

/**
 * Every figure a posting will read, together — `system.config` at 👁, which the
 * matrix grants `MANAGER` as well as `ADMIN`.
 *
 * One call and one answer, which is the contract's own shape: a screen that read
 * the rate in one request and the window in another could render half of one
 * configuration beside half of another. The caller is expected to have decided
 * the operator may read it — the hook is called from inside the panel that is
 * only mounted for those roles, so a receptionist's console never spends a
 * request on a 403.
 */
export function useConfiguration(): ConfigurationData {
  const day = useBusinessDate();
  const configured = useQuery(
    orpc.systemConfig.read.queryOptions({
      input: {},
      meta: {
        errorMessage: "The property's configuration could not be read.",
      } satisfies ConsoleMeta,
    }),
  );

  return {
    businessDate: day.data?.businessDate ?? null,
    reading: reading(configured.isError, configured.data),
  };
}

function reading(
  failed: boolean,
  config: SystemConfiguration | undefined,
): ConfigReading {
  if (failed) {
    return { status: "failed" };
  }

  return config === undefined
    ? { status: "pending" }
    : { status: "ready", config };
}

/**
 * Changes the figures the edit names — `system.config` at ✅, which is `ADMIN`
 * alone.
 *
 * Not optimistic, and deliberately so. Every other write in this console paints
 * before the server answers because the operator is mid-conversation with a
 * guest; this one is an administrator changing what every future invoice is
 * computed from, and the honest thing to show is the row the database committed.
 * The two invariants that span columns are refused by the service holding the
 * stored row under a lock, so a guess here could be a tax configuration shown as
 * accepted and then withdrawn.
 */
export function useUpdateConfiguration() {
  const queryClient = useQueryClient();

  return useMutation(
    orpc.systemConfig.update.mutationOptions({
      meta: {
        errorMessage: "The configuration could not be changed.",
      } satisfies ConsoleMeta,

      onSuccess: (configured, edit) => {
        queryClient.setQueryData(
          orpc.systemConfig.read.queryKey({ input: {} }),
          configured,
        );

        // Only the hour moves the property's day. See the header for why every
        // other figure on this screen invalidates nothing at all.
        if (edit.businessDateRolloverHour === undefined) {
          return;
        }

        void queryClient.invalidateQueries({
          queryKey: orpc.businessDate.read.key(),
        });
        void queryClient.invalidateQueries({
          queryKey: orpc.housekeeping.board.key(),
        });
      },
    }),
  );
}

/**
 * Every staff account the property has — `identity.staff-accounts`, `ADMIN`
 * alone.
 *
 * Called from inside the panel that only an `ADMIN` mounts, which is what keeps
 * a manager's console from spending its first request on a 403 and a toast. The
 * list includes deactivated accounts because the API returns them: an
 * administrator's first question about an account is usually whether it still
 * exists.
 */
export function useStaffAccounts() {
  return useQuery({
    queryKey: STAFF_ACCOUNTS_KEY,
    // Wrapped like every contract call is: the token is replaced before the
    // request if it is inside its expiry margin, and a 401 is retried once
    // behind a fresh one. `lib/api.ts` does this for the generated client; these
    // routes are not on it, so the wrapper is applied here by hand.
    queryFn: () => withStaffSession(requestStaffAccounts),
    meta: {
      errorMessage: "The staff accounts could not be read.",
    } satisfies ConsoleMeta,
  });
}

/**
 * Creates one staff account, with the one role it was given — `FR-IDN-02`.
 *
 * One invalidation, and it is the list this screen draws. A new account holds no
 * booking, no folio and no room, so nothing else in the cache is made wrong by
 * its existing; the account's holder signs in on their own session and this
 * console's session is not touched.
 */
export function useCreateStaffAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (account: NewStaffAccount) =>
      withStaffSession(() => requestNewStaffAccount(account)),
    meta: {
      errorMessage: "The staff account could not be created.",
    } satisfies ConsoleMeta,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STAFF_ACCOUNTS_KEY });
    },
  });
}
