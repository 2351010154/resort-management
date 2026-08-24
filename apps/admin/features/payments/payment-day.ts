/* The payments screen's decisions: which payments the property asked the API
 * for, which night they are being held against, and how a disagreement filed
 * against a row is shown as the disagreement it is rather than as a figure this
 * screen worked out for itself.
 *
 * Pure, and separate from the hooks and the markup beside it, for the reason
 * `features/folios/folio-ledger.ts` and `features/guests/guest-record.ts` both
 * give: everything below is a judgement the API does not make for the console —
 * whether what an operator typed is a query the contract will take, which
 * trading day the two reads are both about, which payment a night's
 * disagreement was filed against, and which operator is offered the screen at
 * all.
 *
 * Four rules hold throughout, and `payment-day.spec.ts` holds this file to
 * them:
 *
 * 1. **No figure of a disagreement is restated here.** A payment row carries a
 *    disagreement's *id* and never its money — `contract/payment.ts` is explicit
 *    that the two amounts, the classification and the instant belong to the
 *    reconciliation read, because a second copy of them beside a payment would
 *    be a row that could disagree with the night it came from. So
 *    {@link paymentRows} joins a row to the observation by id and hands the
 *    observation over whole; nothing in this file computes a difference,
 *    a total or a variance.
 * 2. **The payments and the night are one question about one day.** The
 *    trading day is derived once, in {@link paymentFilters}, and both reads take
 *    it from there. A screen that let the list and the comparison drift onto
 *    different days would draw disagreements beside rows they are not about,
 *    which is worse than drawing neither.
 * 3. **Money is đồng and stays `bigint`.** Nothing here adds, divides, rounds
 *    or reformats an amount: what a payment or a discrepancy was reported for is
 *    printed through `money.ts`'s own formatter and by nothing else. `null` is
 *    the side that reported nothing at all, which is not the same claim as
 *    reporting zero, and {@link reportedAmount} keeps the two tellable apart.
 * 4. **An order that cannot move under the reader.** The route promises a total
 *    order — newest row first, the id breaking a tie — and {@link paymentRows}
 *    only ever partitions it, so the rows a reader is part-way down do not
 *    re-shuffle on the next refetch.
 *
 * The screen is read-only, and that is a property of this module too: nothing
 * here builds a refund, a reversal or a re-run. `rbac-matrix.md` puts refunds on
 * the folio routes and a re-run under the sweep's own capability, and
 * `schema/reconciliation.ts` states that a discrepancy is append-only because it
 * records what a night looked like when it was looked at. A helper here that
 * shaped one of those requests would be this family growing an act that lives
 * somewhere else.
 */

import type { ApiClient } from "@mariva/api-client";
import {
  listPaymentsInput as filterSchema,
  formatVnd,
  PAYMENT_PAGE_SIZE,
  paymentMethodSchema,
  paymentStatusSchema,
  type StaffRole,
} from "@mariva/shared";
/* The console's one rendering of an instant in the property's zone, and of a
 * calendar day, taken from the modules that already own them rather than a
 * fourth `Intl.DateTimeFormat` beside them. An instant is when the payer's side
 * says the money moved; a trading day is a date the property agrees on, and
 * `business-date.ts` formats it from UTC midnight for that reason. */
import { formatInstant } from "@/features/guests/guest-record";
import { formatShortDate } from "@/lib/business-date";
import { parseLiberalDate } from "@/lib/date-parser";

/* The wire's shapes, read off the client rather than restated — the same
 * argument every other feature makes: `@mariva/shared` types the client from the
 * contract's own schemas, so a field renamed there breaks this file in the pull
 * request that renamed it, where a hand-written interface would compile until it
 * was wrong. */

/** A page of payments, and how many the filters matched behind it. */
export type PaymentPage = Awaited<ReturnType<ApiClient["payment"]["list"]>>;

/** The policy-refund-safe projection available without reconciliation access. */
export type RefundCandidatesPage = Awaited<
  ReturnType<ApiClient["payment"]["listRefundCandidates"]>
>;

export type RefundCandidate = RefundCandidatesPage["payments"][number];

export type RefundCandidateQuery = Parameters<
  ApiClient["payment"]["listRefundCandidates"]
>[0];

/** What `GET /payments` takes. */
export type PaymentListQuery = Parameters<ApiClient["payment"]["list"]>[0];

/** One movement of money as the payer's side reported it. */
export type ListedPayment = PaymentPage["payments"][number];

/** How the money reached the property. */
export type PaymentMethod = ListedPayment["method"];

/** What became of it. */
export type PaymentStatus = ListedPayment["status"];

/** One trading day in full: when it was compared, and everything that
 *  disagreed. */
export type ReconciledNight = Awaited<
  ReturnType<ApiClient["payment"]["readReconciliation"]>
>;

/** One attempt the two reports described differently, as it was observed. */
export type PaymentDiscrepancy = ReconciledNight["discrepancies"][number];

/** The ways the two reports can fail to say the same thing. */
export type DiscrepancyKind = PaymentDiscrepancy["kind"];

/** A trading day that was compared, and how much of it disagreed. */
export type ReconciliationRun = Awaited<
  ReturnType<ApiClient["payment"]["listReconciliations"]>
>["runs"][number];

/**
 * Who is offered this screen — the matrix's *Gateway reconciliation* row, which
 * is `ACCOUNTANT`, `MANAGER` and `ADMIN`.
 *
 * The receptionist is the one role that reaches this family and is not offered
 * what is on it. `nav-inventory.ts` gives them the door because the family is
 * also where a refund is worked from, and every read this screen makes — the
 * payments, the nights, one night's detail — is governed by the single
 * `payment.reconcile` key. So a desk operator gets a sentence saying where their
 * money work happens instead of a table that would answer 403 three times over.
 *
 * Not a wall. The API's capability guard is the wall; what this decides is
 * whether a door is shown to somebody it would refuse, which is the console's
 * own rule for every other role-gated surface.
 */
export function mayReconcile(role: StaffRole): boolean {
  return role === "ACCOUNTANT" || role === "MANAGER" || role === "ADMIN";
}

/**
 * What each way of paying is called on screen.
 *
 * A `Record` over the union the client carries rather than a lookup with a
 * fallback: `FR-PAY-06`'s second gateway is a fourth member of the contract's
 * enum, and adding it there stops this file compiling — where a `?? method`
 * would quietly print a database enum at an accountant.
 */
export const METHOD_LABELS: Record<PaymentMethod, string> = {
  VNPAY: "VNPay",
  CASH: "Cash",
  BANK_TRANSFER: "Bank transfer",
};

/** What became of the money, in one word. */
export const STATUS_LABELS: Record<PaymentStatus, string> = {
  PENDING: "Awaiting the gateway",
  SUCCESS: "Paid",
  FAILED: "Refused",
  REFUNDED: "Refunded",
};

/**
 * What a disagreement *is*, said as the sentence somebody is being asked to
 * explain.
 *
 * The classification and not the money. Which of the two amounts is null is a
 * fact of the kind — the database's own check constraint makes it one — so
 * naming the kind tells a reader which side reported nothing before they look at
 * either figure.
 */
export const DISCREPANCY_LABELS: Record<DiscrepancyKind, string> = {
  MISSING_LOCALLY:
    "The gateway reported money this property has no payment for",
  MISSING_AT_GATEWAY:
    "This property has a payment the gateway's report does not",
  AMOUNT_MISMATCH: "The two reports name different amounts",
};

/* The filter options, taken from the contract's own enums rather than written
 * out beside them — the arrangement `folio-ledger.ts` uses for a posting's
 * types. A member added to `contract/payment.ts` is offered here the moment it
 * exists, and it stops this file compiling until the `Record`s above name it, so
 * the list the screen draws and the words it draws them with cannot come apart.
 * The order is the contract's too, which is the order each enum is declared in. */

/** Every way of paying, as the method filter offers them. */
export const PAYMENT_METHODS = paymentMethodSchema.options;

/** Every state a payment can be in, as the state filter offers them. */
export const PAYMENT_STATUSES = paymentStatusSchema.options;

/** How many recent nights the screen keeps in view beside the day it is on. */
export const NIGHTS_IN_VIEW = 7;

/** What the operator chose in the filters, before any of it is read. */
export interface PaymentFilterFields {
  /** A trading day, typed the way every other date on the console is. Empty is
   *  every day at once, which is the only way to reach a payment that has moved
   *  no money — an attempt still pending, one the gateway refused — because such
   *  a row belongs to no trading day and naming one excludes it. */
  day: string;
  /** One stay's payments. Empty is every stay. */
  bookingId: string;
  /** `ANY` is the absent filter — the route takes no method at all for it. */
  method: PaymentMethod | "ANY";
  status: PaymentStatus | "ANY";
}

/**
 * What the screen opens on: everything the property was paid today.
 *
 * Today rather than the night that was last compared, and that is
 * `screens.md`'s own sentence — the family "opens on today's gateway
 * transactions". The sweep runs after a day closes, so today's own comparison
 * will ordinarily not exist yet; the nights that have been compared stay in view
 * beside it and are one press away.
 *
 * No method and no status, because narrowing the opening day would be the screen
 * deciding which half of the property's money is worth looking at.
 */
export const DEFAULT_PAYMENT_FILTERS: PaymentFilterFields = {
  day: "today",
  bookingId: "",
  method: "ANY",
  status: "ANY",
};

/** One question, asked of both routes at once. */
export interface PaymentQuestion {
  /** The page of payments to read. */
  readonly input: PaymentListQuery;
  /**
   * The trading day the comparison beside them is read for — derived once here
   * so the two reads cannot end up on different days. Null when every day was
   * asked for, which is a list no single night is about.
   */
  readonly day: string | null;
}

/**
 * Narrows the shared filter question to the refund-candidate contract.
 *
 * The desk reuses the trading-day parser, method picker and pager, but never
 * leaks the reconciliation-only status or stay-UUID filters into its read.
 */
export function refundCandidateInput(
  question: PaymentQuestion,
): RefundCandidateQuery {
  const { businessDate, method, limit, offset } = question.input;
  return {
    ...(businessDate === undefined ? {} : { businessDate }),
    ...(method === undefined ? {} : { method }),
    limit,
    offset,
  };
}

/** Either a question the contract will take, or the sentence that says why not. */
export type PaymentFilterAttempt =
  | { readonly question: PaymentQuestion }
  | { readonly problem: string };

/**
 * The filters as `GET /payments` takes them, and the page being asked for.
 *
 * The day goes through `parseLiberalDate` against the property's business date
 * like every other date on the console — "today", "-1d", "15/3" — and an empty
 * field is an absent filter rather than a refusal. The business date is needed
 * whenever something was typed, which on this screen is almost always: the
 * opening filters carry "today", so the list waits for the property's own day
 * rather than counting from the browser's.
 *
 * `offset` is the screen's, not the operator's: it is rows to skip, and it is
 * reset by every change of filter, because a page four of one question is not a
 * page four of the next.
 */
export function paymentFilters(
  fields: PaymentFilterFields,
  businessDate: string | null,
  offset: number,
): PaymentFilterAttempt {
  const typedDay = fields.day.trim();
  const typedStay = fields.bookingId.trim();

  if (typedDay !== "" && businessDate === null) {
    return {
      problem:
        "The property's day has not been read yet, and a typed date is counted from it. Try again.",
    };
  }

  const day =
    typedDay === "" ? null : parseLiberalDate(typedDay, businessDate ?? "");

  if (typedDay !== "" && day === null) {
    return {
      problem:
        "That is not a day this screen can read. Type 15/3, 2026-03-15, today or -1d.",
    };
  }

  const input: PaymentListQuery = {
    ...(day === null ? {} : { businessDate: day }),
    ...(typedStay === "" ? {} : { bookingId: typedStay }),
    ...(fields.method === "ANY" ? {} : { method: fields.method }),
    ...(fields.status === "ANY" ? {} : { status: fields.status }),
    // Stated rather than left to the route's own default, even though the two
    // are the same figure. The pager steps by this number, and a page size the
    // request did not name is a step the screen would be guessing.
    limit: PAYMENT_PAGE_SIZE,
    offset,
  };

  // The contract's own schema run here rather than restated, so a rule changed
  // in `packages/shared/src/contract/payment.ts` cannot drift from what this
  // form enforces. What is *sent* is the typed input and never the parsed
  // output — a decoded `CalendarDate` is a shape for a service to hold, not one
  // to put on the wire.
  const checked = filterSchema.safeParse(input);

  if (!checked.success) {
    // The stay is the only field on this form the schema can refuse: the day
    // has already been through the parser, and the method, the state and the
    // page are the screen's own. So the refusal is reported against the id
    // somebody pasted, in words that say what to do about it — an id of the
    // right shape but not one this product mints is caught here rather than
    // answered with a 400 after the request.
    return {
      problem:
        typedStay === ""
          ? (checked.error.issues[0]?.message ??
            "That is not a set of filters the API takes.")
          : "That is not a stay's identifier. Copy the whole id printed on the stay's folio.",
    };
  }

  return { question: { input, day } };
}

/**
 * The question the screen opens on: {@link DEFAULT_PAYMENT_FILTERS}, first page.
 *
 * Derived from the same fields the form is drawn from rather than written out a
 * second time, so what the operator sees selected and what the first request
 * actually asked for cannot drift apart.
 *
 * Null until the property's day has been read, because the opening day is
 * "today" and there is no honest answer to that before the API has said what
 * today is. The screen holds both reads until then rather than opening on a day
 * the browser guessed.
 */
export function openingQuestion(
  businessDate: string | null,
): PaymentQuestion | null {
  if (businessDate === null) {
    return null;
  }

  const attempt = paymentFilters(DEFAULT_PAYMENT_FILTERS, businessDate, 0);

  if ("problem" in attempt) {
    // Unreachable, and thrown rather than quietly replaced by some other
    // question: the opening fields carry "today" and no stay, both of which are
    // answerable once a business date exists, and a screen that silently opened
    // on filters nobody chose would be lying about what it is showing.
    throw new Error(attempt.problem);
  }

  return attempt.question;
}

/** What the console knows about one night's comparison. */
export type NightReading =
  /** The read is in flight, or there is no day to read one for. */
  | { readonly status: "pending" }
  /** Nobody has compared this night. Not an error — the sweep runs after a
   *  trading day closes, so the day in progress has no run and never will until
   *  it does. */
  | { readonly status: "unswept" }
  | { readonly status: "failed" }
  | { readonly status: "ready"; readonly night: ReconciledNight };

/** What a route answers for a day it holds no run for. */
const NOT_FOUND = 404;

/**
 * Which of the four a night's read came back as.
 *
 * The 404 is pulled out of the failures and given a state of its own because it
 * is the ordinary case rather than a fault: `contract/payment.ts` makes a date
 * with no run a refusal precisely so that "the two reports agreed" and "nobody
 * has looked" stay tellable apart, and a console that drew the second as a
 * broken read would put an error in front of the accountant every time they
 * opened the screen on today.
 *
 * The status is passed in rather than read off the error here, so this stays a
 * module a spec can run with no API client behind it.
 */
export function nightReading(
  night: ReconciledNight | undefined,
  failedWith: number | null | undefined,
): NightReading {
  if (failedWith !== undefined) {
    return failedWith === NOT_FOUND
      ? { status: "unswept" }
      : { status: "failed" };
  }

  return night === undefined
    ? { status: "pending" }
    : { status: "ready", night };
}

/**
 * Where the figures behind a row's disagreement are, from where the reader is
 * standing.
 *
 * Four cases and each is a different sentence, which is why this is not a
 * boolean. A payment names a disagreement by id and carries none of its money,
 * so the only thing a row can honestly offer is the way to the night that holds
 * it.
 */
export type DiscrepancyRoute =
  /** Nothing was filed against this payment. */
  | { readonly kind: "none" }
  /** The night on screen holds it, so it is already beside the row. */
  | { readonly kind: "in-view"; readonly discrepancyId: string }
  /** It was filed on another trading day — the one this payment moved on. */
  | { readonly kind: "other-night"; readonly businessDate: string }
  /** The payment belongs to no trading day, so no night can be named for it. */
  | { readonly kind: "undated" };

/** One payment as the table draws it, with whatever a night said about it. */
export interface PaymentRow {
  readonly payment: ListedPayment;
  /** The observation itself, and only when the night on screen is the one that
   *  made it. Never rebuilt from the payment — the reconciliation read owns
   *  every figure on it. */
  readonly discrepancy: PaymentDiscrepancy | null;
  readonly route: DiscrepancyRoute;
}

/**
 * The page of payments as it is read down, disagreements first.
 *
 * **Every payment appears exactly once.** The list is a permutation of what came
 * back and nothing is filtered or folded away: a page is a window the API cut,
 * and a screen that dropped a row out of it would report a page shorter than the
 * count printed under it.
 *
 * **Disagreements first** is `screens.md`'s word for this family, and it is done
 * by partitioning rather than by sorting. The route promises a total order —
 * newest row first, the id breaking a tie — and moving a subset to the front
 * keeps that order inside each group, so nothing re-shuffles under a reader
 * between two refetches. A payment is counted as a disagreement by its own
 * `discrepancyId` and not by whether the night on screen resolved it, so a list
 * spanning several days still floats every unexplained row to the top.
 *
 * **A row is joined to an observation by id and by nothing else.** A night that
 * is not the one a payment belongs to holds none of its disagreements, and the
 * row then says which night does rather than borrowing figures from the night in
 * front of it.
 */
export function paymentRows(
  payments: readonly ListedPayment[],
  night: ReconciledNight | null,
): readonly PaymentRow[] {
  const filed = new Map(
    (night?.discrepancies ?? []).map((discrepancy) => [
      discrepancy.id,
      discrepancy,
    ]),
  );

  const rows = payments.map((payment): PaymentRow => {
    const id = payment.discrepancyId;

    if (id === null) {
      return { payment, discrepancy: null, route: { kind: "none" } };
    }

    const observed = filed.get(id);

    if (observed !== undefined) {
      return {
        payment,
        discrepancy: observed,
        route: { kind: "in-view", discrepancyId: id },
      };
    }

    return {
      payment,
      discrepancy: null,
      route:
        payment.businessDate === null
          ? { kind: "undated" }
          : { kind: "other-night", businessDate: payment.businessDate },
    };
  });

  return [
    ...rows.filter((row) => row.payment.discrepancyId !== null),
    ...rows.filter((row) => row.payment.discrepancyId === null),
  ];
}

/** One of a night's disagreements, and whether its payment is on screen. */
export interface DiscrepancyEntry {
  readonly discrepancy: PaymentDiscrepancy;
  /**
   * True when the payment it names is one of the rows the list is showing.
   *
   * False is two different situations and both are worth the reader knowing: a
   * `MISSING_LOCALLY` names money this property has no payment row for at all —
   * so no filter could ever bring it into the table — and any other kind reading
   * false is a row the current filters have narrowed away.
   */
  readonly onScreen: boolean;
}

/**
 * A night's disagreements, in the order the route answered them.
 *
 * Ordered by `attemptReference` by the API, which is a total order over the
 * night, so two reads of one day list the same rows the same way and nothing
 * here has to impose one.
 */
export function discrepancyEntries(
  night: ReconciledNight,
  payments: readonly ListedPayment[],
): readonly DiscrepancyEntry[] {
  const shown = new Set(payments.map((payment) => payment.id));

  return night.discrepancies.map((discrepancy) => ({
    discrepancy,
    onScreen:
      discrepancy.paymentId !== null && shown.has(discrepancy.paymentId),
  }));
}

/**
 * The nights kept in view beside the day being read, newest first.
 *
 * The route already answers newest first, and this sorts anyway for
 * `folio-ledger.ts`'s reason: the strip is re-rendered on every refetch, and an
 * order that depends on how the rows came back is an order that can move under
 * somebody about to press one of them. The business date is `YYYY-MM-DD`, so
 * comparing it as text is exact and needs no calendar.
 */
export function recentNights(
  runs: readonly ReconciliationRun[],
): readonly ReconciliationRun[] {
  return [...runs]
    .sort((left, right) => right.businessDate.localeCompare(left.businessDate))
    .slice(0, NIGHTS_IN_VIEW);
}

/**
 * One side's figure, or the fact that it reported nothing.
 *
 * Null is not zero and must not print as it. A gateway that reported no money
 * for an attempt and a gateway that reported a payment of nothing are different
 * claims, and the classification beside this figure is only readable if the two
 * stay apart.
 */
export function reportedAmount(
  amount: PaymentDiscrepancy["gatewayAmount"],
): string {
  return amount === null ? "Nothing reported" : formatVnd(amount);
}

/**
 * When the payer's side says the money moved.
 *
 * The payer's clock and never this property's — it is what the gateway reported
 * — rendered in the property's zone so it can be read against everything else on
 * the console. A row with no instant has not moved money, which is a state and
 * not a gap in the data.
 */
export function paidLabel(payment: ListedPayment): string {
  return payment.paidAt === null
    ? "No money has moved"
    : formatInstant(payment.paidAt);
}

/**
 * The trading day the money moved on.
 *
 * Derived by the API from the instant above and the property's rollover hour,
 * which is why it travels beside the instant rather than being sliced out of it:
 * 01:00 belongs to the day that has not rolled yet. It is null on exactly the
 * rows that have no instant, and that is the sentence — an unresolved attempt
 * belongs to no day rather than to the day its row was written on.
 */
export function tradingDayLabel(payment: ListedPayment): string {
  return payment.businessDate === null
    ? "No trading day"
    : formatShortDate(payment.businessDate);
}
