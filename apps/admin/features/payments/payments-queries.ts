/* The payments screen's three reads, and nothing else.
 *
 * **Three, because a day's money and a night's comparison are different
 * questions.** `GET /payments` answers what the property has been paid, as the
 * payer's side reported it; `GET /payments/reconciliations/{businessDate}`
 * answers what the sweep found when it held that report against the ledger; and
 * `GET /payments/reconciliations` answers which nights have been looked at at
 * all. The first two are asked about one trading day at once — `payment-day.ts`
 * derives that day once so the list and the comparison cannot drift onto
 * different days — and the third is the strip that keeps the nights already
 * compared in view, which is what `screens.md` means by opening on today with
 * the reconciliation status beside it.
 *
 * **No writes.** `rbac-matrix.md` puts refunds on the folio routes and a re-run
 * of a night under the sweep's own capability, and `schema/reconciliation.ts`
 * states that a discrepancy is append-only because it records what a night
 * looked like when it was looked at. There is no route to resolve or acknowledge
 * one, so there is no mutation hook here — and nothing to invalidate either: a
 * screen that only reads has nothing to stale.
 *
 * **A night nobody has compared is not a failure.** The detail route answers 404
 * for a date with no run, which is the ordinary state of the day in progress: the
 * sweep runs after a trading day closes. So that read declares
 * `rendersFailureInline` and the screen says which of the two it is — the same
 * arrangement `arrivals-queries.ts` uses for the folio of a stay that has not
 * checked in, and for the same reason. A red toast over a state the screen
 * already explains is how a property learns to read past its own toasts.
 *
 * **The property's day comes from `GET /system/business-date`.** Every staff
 * role may read it, and both this screen's day filter and the night beside it
 * are counted from it rather than from the browser's calendar date, which is the
 * wrong day at 01:30.
 *
 * Except for the night's own 404, nothing here reports its own failure:
 * `lib/query-client.ts` raises the toast for every read centrally.
 */

"use client";

import { PAYMENT_PAGE_SIZE } from "@mariva/shared";
import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useMemo } from "react";

/* The pager's arithmetic, taken from the module that already owns it rather
 * than written a second time: a page cut from a counted total is the same
 * question here as it is on Folios, down to the offsets the two presses ask
 * for. Reached past that family's barrel, which re-exports a client component,
 * for the reason `folios-queries.ts` gives about doing the same to
 * `features/departures`. */
import { type PageWindow, pageWindow } from "@/features/folios/folio-ledger";
import { apiStatus } from "@/lib/api";
import { orpc } from "@/lib/api-query";
import type { ConsoleMeta } from "@/lib/query-client";

import {
  type ListedPayment,
  type NightReading,
  nightReading,
  type PaymentQuestion,
  type ReconciliationRun,
  type RefundCandidate,
  recentNights,
  refundCandidateInput,
} from "./payment-day";

export type RefundCandidatePageReading =
  | { readonly status: "idle" }
  | { readonly status: "pending" }
  | { readonly status: "failed" }
  | {
      readonly status: "ready";
      readonly payments: readonly RefundCandidate[];
      readonly window: PageWindow;
    };

/**
 * The property's day, which every question this screen asks is counted from.
 *
 * The bookings screen's own hook, re-exported rather than written again: one
 * route asked through the same `orpc` utils is one cache entry, so the day this
 * screen opens on is the day the rest of the console is working — without a
 * second request and without a second opinion about what "the property's day
 * could not be read" says. The same arrangement `folios-queries.ts` uses to
 * share one stay's folio with the checkout sequence.
 */
export { useBusinessDate } from "@/features/bookings/bookings-queries";

/** What the screen knows about the page of payments it is drawing. */
export type PageReading =
  /** No question has been built yet — the property's day has not arrived, or
   *  this operator is not offered the screen. */
  | { readonly status: "idle" }
  | { readonly status: "pending" }
  | { readonly status: "failed" }
  | {
      readonly status: "ready";
      readonly payments: readonly ListedPayment[];
      readonly window: PageWindow;
    };

/** The whole screen's payment layer: one page of payments, the night they are
 *  held against, and the nights already compared. */
export interface PaymentsData {
  readonly page: PageReading;
  readonly night: NightReading;
  /** The most recent nights that were compared, newest first. Empty while the
   *  read is in flight, and empty for good if it failed — which does not stop
   *  the screen, because the strip is a way to a night rather than the night
   *  itself. */
  readonly nights: readonly ReconciliationRun[];
}

/**
 * One trading day of the property's money: what was paid, and what the sweep
 * made of it.
 *
 * The page query is keyed by the whole input, offset included, so paging back to
 * a page already seen is a cache hit rather than a second request — and so two
 * different sets of filters cannot overwrite each other's answer.
 *
 * `question` is null before the property's day has been read and for an operator
 * the screen is not offered to, and every payment read is held on `skipToken`
 * until it is not. A question naming no day — the filters cleared to every day
 * at once — holds the night on `skipToken` too: there is no single night a list
 * spanning several days could be compared against, and the screen says so rather
 * than reading an arbitrary one.
 *
 * The offset travels beside the query as well as inside it. Inside because the
 * API is what pages; beside because the pager has arithmetic to do with it, and
 * the route coerces that field out of a query string — so the number this screen
 * chose is not a number that can be read back off the input it built.
 */
export function usePaymentDay(
  question: PaymentQuestion | null,
  offset: number,
  reconciles: boolean,
): PaymentsData {
  const page = useQuery(
    orpc.payment.list.queryOptions({
      input: question === null ? skipToken : question.input,
      meta: {
        errorMessage: "The property's payments could not be read.",
      } satisfies ConsoleMeta,
    }),
  );

  const night = useQuery(
    orpc.payment.readReconciliation.queryOptions({
      input:
        !reconciles || question === null || question.day === null
          ? skipToken
          : { businessDate: question.day },
      // The screen draws both of this read's outcomes where the operator is
      // already looking — a night nobody swept and a night that could not be
      // read are different sentences in the same place — so no sentence is said
      // centrally about it and none is named here.
      meta: { rendersFailureInline: true } satisfies ConsoleMeta,
    }),
  );

  const compared = useQuery(
    orpc.payment.listReconciliations.queryOptions({
      // Neither end of the range named, which the route answers with the most
      // recent days. A window would be this screen asking for a period nobody
      // chose; the strip wants the nights nearest to now.
      input: reconciles ? {} : skipToken,
      meta: {
        errorMessage: "The nights already compared could not be listed.",
      } satisfies ConsoleMeta,
    }),
  );

  const answer = page.data;

  // Memoized on the answer rather than recomputed per render: the reading is
  // what the table and the reconciliation panel are both drawn from, and a
  // fresh object on every render is a panel rebuilt under the operator.
  const reading = useMemo<PageReading>(() => {
    if (question === null) {
      return { status: "idle" };
    }

    if (page.isError) {
      return { status: "failed" };
    }

    if (answer === undefined) {
      return { status: "pending" };
    }

    return {
      status: "ready",
      payments: answer.payments,
      // `total` is the API's count under the same predicate the page was cut
      // from, so the pager names the whole set rather than the length of one
      // page dressed up as a figure.
      window: pageWindow(
        answer.total,
        answer.payments.length,
        offset,
        PAYMENT_PAGE_SIZE,
      ),
    };
  }, [question, page.isError, answer, offset]);

  const nights = useMemo(
    () => (compared.data === undefined ? [] : recentNights(compared.data.runs)),
    [compared.data],
  );

  return {
    page: reading,
    night: nightReading(
      night.data,
      night.isError ? apiStatus(night.error) : undefined,
    ),
    nights,
  };
}

/** The narrow, policy-refund-safe payment page used by non-reconciling staff. */
export function useRefundCandidatePage(
  question: PaymentQuestion | null,
  offset: number,
): RefundCandidatePageReading {
  const page = useQuery(
    orpc.payment.listRefundCandidates.queryOptions({
      input: question === null ? skipToken : refundCandidateInput(question),
      meta: {
        errorMessage: "The refundable payments could not be read.",
      } satisfies ConsoleMeta,
    }),
  );

  const answer = page.data;
  return useMemo<RefundCandidatePageReading>(() => {
    if (question === null) return { status: "idle" };
    if (page.isError) return { status: "failed" };
    if (answer === undefined) return { status: "pending" };
    return {
      status: "ready",
      payments: answer.payments,
      window: pageWindow(
        answer.total,
        answer.payments.length,
        offset,
        PAYMENT_PAGE_SIZE,
      ),
    };
  }, [question, page.isError, answer, offset]);
}

export function usePolicyRefund() {
  const qc = useQueryClient();
  return useMutation(
    orpc.folio.postPolicyRefund.mutationOptions({
      meta: {
        errorMessage: "The stay could not be refunded under policy.",
      } satisfies ConsoleMeta,
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: orpc.folio.key() });
        void qc.invalidateQueries({ queryKey: orpc.payment.key() });
      },
    }),
  );
}
export function useOverrideRefund() {
  const qc = useQueryClient();
  return useMutation(
    orpc.folio.postOverrideRefund.mutationOptions({
      meta: {
        errorMessage: "The stay's override refund could not be posted.",
      } satisfies ConsoleMeta,
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: orpc.folio.key() });
        void qc.invalidateQueries({ queryKey: orpc.payment.key() });
      },
    }),
  );
}
