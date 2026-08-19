/* The departures queue, and the shape of the checkout worked out of it.
 *
 * Pure, and separate from the hooks and the markup beside it, for the reason
 * `features/arrivals/arrival-queue.ts` gives about its own mirror: everything
 * below is a decision the API does not make for the console — which of today's
 * in-house stays are actually leaving, what the account is short, how many
 * steps this particular checkout has, and where focus goes when a row leaves.
 * These are the parts that can be wrong in a way nobody notices until a guest
 * is standing at the desk with a suitcase.
 *
 * Four rules hold throughout, and `departure-queue.spec.ts` holds this file to
 * them:
 *
 * 1. **The day is the property's, not the browser's.** Nothing here reads a
 *    clock. The business date arrives on the housekeeping board, resolved by
 *    the API against `system_config.business_date_rollover_hour`, and the queue
 *    is cut against that string.
 * 2. **A list nobody could compute is not an empty list.** {@link
 *    todaysDepartures} answers `null` rather than `[]` when the search came back
 *    narrowed to a scope with no stays in it. "Nobody is leaving" is a real and
 *    reassuring sentence and printing it over a refusal is the console lying
 *    about the property.
 * 3. **A capped answer says it was capped.** `search.operational` returns at
 *    most {@link SEARCH_RESULT_LIMIT} stays, so a queue cut from it can be
 *    short, and the screen has to say so.
 * 4. **An account that does not balance is a discrepancy, not a category.**
 *    {@link balanceDue} and {@link overpayment} are two readings of one signed
 *    figure and neither is rounded, waived or netted off against the other.
 *    `check-out.guard.ts` refuses on `balance !== 0n` in both directions, and a
 *    console that quietly treated an over-paid stay as settled would close a
 *    guest's stay on money the property is still holding.
 */

import type { ApiClient } from "@mariva/api-client";
import {
  CHECK_OUT_REFUSALS,
  type CheckOutRefusal,
  postPaymentInput,
  SEARCH_RESULT_LIMIT,
} from "@mariva/shared";

/* The shapes, read off the client rather than restated — the argument
 * `day-counts.ts` and `arrival-queue.ts` both make: `@mariva/shared` types the
 * client from the contract's own schemas, so a field renamed there breaks this
 * file in the pull request that renamed it, where a hand-written interface
 * would compile until it was wrong. */
export type SearchResults = Awaited<
  ReturnType<ApiClient["search"]["operational"]>
>;
type FullResults = Extract<SearchResults, { scope: "everything" }>;

/** One stay in the queue, as the search answers it. */
export type Departure = FullResults["bookings"][number];

/** The stay's account, as `folio.read` answers it. */
export type Folio = Awaited<ReturnType<ApiClient["folio"]["read"]>>;

/** One line of that account. */
export type FolioPosting = Folio["postings"][number];

/** The queue, and whether the answer it was cut from had been cut short. */
export interface DepartureQueue {
  readonly departures: Departure[];
  /**
   * True when the search hit its own ceiling, so there are departures this
   * queue does not contain. Measured against what came back rather than against
   * what survived the filter: the cap is applied by the API before this file
   * sees anything.
   */
  readonly truncated: boolean;
}

/**
 * Today's checked-in stays due out, in the order the desk works them.
 *
 * The state is filtered again here even though `departureCriteria` already asks
 * for `CHECKED_IN` only, for the reason the arrivals queue re-filters its own:
 * the cached answer is shared with the dashboard's count and re-read while a
 * refetch is in flight, and a stay a colleague checked out a minute ago must
 * not be offered to a second receptionist as still in the building.
 *
 * `checkOut === businessDate` is what separates a departure from an occupant.
 * The window the search runs over is `[yesterday, today)` — `day-counts.ts`
 * carries the reason, and it is the half-open convention rather than an
 * off-by-one: a stay leaving today owns nights up to but not including today,
 * so today's own window is exactly the one that excludes it. Every stay that
 * slept last night comes back from that search, and the ones leaving *today*
 * are the subset picked out here.
 *
 * Ordered by room, which is where this screen departs from arrivals and
 * deliberately: a departing guest arrives at the desk saying a room number,
 * where an arriving one has no room yet and is found by the reference they were
 * given. Numeric collation so 9 precedes 10, the reference breaking a tie, and
 * a stay somehow holding no room sorted last rather than dropped — it is still
 * leaving, and hiding it would be the console deciding a row does not exist.
 * The order does not depend on how the rows came back, because the queue is
 * walked with the arrow keys and re-rendered on every refetch: an order that
 * did would move under the operator between two presses.
 */
export function todaysDepartures(
  results: SearchResults,
  businessDate: string,
): DepartureQueue | null {
  if (results.scope !== "everything") {
    return null;
  }

  const departures = results.bookings
    .filter(
      (stay) => stay.state === "CHECKED_IN" && stay.checkOut === businessDate,
    )
    .sort(byRoomThenReference);

  return {
    departures,
    truncated: results.bookings.length >= SEARCH_RESULT_LIMIT,
  };
}

function byRoomThenReference(left: Departure, right: Departure): number {
  if (left.roomNumber === null || right.roomNumber === null) {
    // Both unroomed, or one of them: the null goes last, and two nulls fall
    // through to the reference so the order is still total.
    if (left.roomNumber !== right.roomNumber) {
      return left.roomNumber === null ? 1 : -1;
    }
  } else {
    const byRoom = left.roomNumber.localeCompare(right.roomNumber, undefined, {
      numeric: true,
    });

    if (byRoom !== 0) {
      return byRoom;
    }
  }

  return left.reference.localeCompare(right.reference);
}

/**
 * The row focus should land on once this one has been checked out.
 *
 * The next departure, so a desk working the morning rush presses Enter,
 * finishes, and is already on the following stay. The one *before* it when the
 * finished row was last, because the alternative is focus landing nowhere at
 * the end of a queue — and null only when the queue is now empty, which is the
 * one case where there is honestly nothing to move to.
 *
 * Computed against the queue as it stood before the checkout, because that is
 * the only list that still contains the row being left.
 */
export function departureAfter(
  departures: readonly Departure[],
  bookingId: string,
): string | null {
  const at = departures.findIndex((stay) => stay.id === bookingId);

  if (at === -1) {
    return departures[0]?.id ?? null;
  }

  return departures[at + 1]?.id ?? departures[at - 1]?.id ?? null;
}

/**
 * What the guest still owes, or nothing.
 *
 * The figure is the account's own outstanding balance and never one this file
 * invents: `outstanding` is derived by the API from the postings on every read,
 * so this is a reading of the ledger rather than a second opinion about it. No
 * rounding — `money.ts` counts whole đồng and `property-and-tariff.md` §5
 * decomposes the service charge and the VAT out of a gross figure the guest
 * already agreed to, so there is no remainder here for a console to tidy away.
 */
export function balanceDue(folio: Folio): bigint {
  const { outstanding } = folio.summary;

  return outstanding > 0n ? outstanding : 0n;
}

/**
 * What the property is holding over and above the bill, or nothing.
 *
 * Read as a positive figure, and it is not the negation of {@link balanceDue}
 * being spent twice: an over-paid stay is refused by both `FolioService.close`
 * and `check-out.guard.ts`, and it is refused because money is owed *back*. The
 * refund routes are `folio.refund-policy` and `folio.refund-override`, each
 * with its own capability and its own record of why, so a checkout sequence
 * names the discrepancy and stops rather than picking one of them on the
 * operator's behalf.
 */
export function overpayment(folio: Folio): bigint {
  const { outstanding } = folio.summary;

  return outstanding < 0n ? -outstanding : 0n;
}

/** True when the account is agreed and the invoice is already the job's. */
export function isClosed(folio: Folio): boolean {
  return folio.state === "CLOSED";
}

/** The steps a checkout can have, in the order they are worked. */
export const CHECKOUT_STEPS = ["account", "payment", "settlement"] as const;

export type CheckoutStep = (typeof CHECKOUT_STEPS)[number];

/** What decides how many steps this particular checkout has. */
export interface SequenceFacts {
  /** True when the account is short — see {@link balanceDue}. */
  readonly balanceDue: boolean;
}

/**
 * The steps this checkout actually has.
 *
 * The payment step is dropped on a settled account, which is the ordinary case
 * for a stay booked through the funnel: it arrived paid in full and nothing was
 * added to it, so asking a receptionist to confirm a payment of nothing is a
 * press spent on nothing with a guest waiting. The account step and the
 * settlement step are always there — the charges are read to the guest whatever
 * they come to, and the stay does not end without the press that ends it.
 */
export function sequenceSteps(facts: SequenceFacts): CheckoutStep[] {
  return CHECKOUT_STEPS.filter(
    (step) => step !== "payment" || facts.balanceDue,
  );
}

/**
 * The step after this one, or null at the end of the sequence.
 *
 * Found by the declared order rather than by the answered step's position in
 * the list, because answering a step is what can remove it: a balance paid
 * settles the account, so the sequence the operator is routed against no longer
 * has a payment step in it. Reading a position in that list would find nothing
 * and send them back to the charges they have already agreed.
 */
export function stepAfter(
  steps: readonly CheckoutStep[],
  step: CheckoutStep,
): CheckoutStep | null {
  const answered = CHECKOUT_STEPS.indexOf(step);

  return steps.find((one) => CHECKOUT_STEPS.indexOf(one) > answered) ?? null;
}

/**
 * The refusal code behind a rejected check-out, or null.
 *
 * Read structurally off `data.code` and checked against the contract's own
 * list, which is what `contract/booking.ts` declares and what
 * `booking-refusal.ts` exists for. An error carrying no code — an illegal
 * transition, a network that was not there — answers null and is left to the
 * central toast.
 */
export function checkOutRefusal(error: unknown): CheckOutRefusal | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  const data = (error as { data?: unknown }).data;

  if (typeof data !== "object" || data === null) {
    return null;
  }

  const code = (data as { code?: unknown }).code;

  return CHECK_OUT_REFUSALS.includes(code as CheckOutRefusal)
    ? (code as CheckOutRefusal)
    : null;
}

/**
 * Where the sequence goes when the API refuses the check-out.
 *
 * The account step, and not straight to the payment field, because reaching a
 * refusal at all means the balance this sequence was holding is stale: the
 * press only fires on an account the console had read as settled, so somebody
 * posted to it in between. The account step is the one that re-reads the ledger
 * and re-derives whether there is a payment step to have — landing on a payment
 * field prefilled from the figure that was just proved wrong would be the
 * console asking for the wrong money.
 */
export function refusalStep(code: CheckOutRefusal): CheckoutStep {
  switch (code) {
    case "FOLIO_NOT_SETTLED":
      return "account";
  }
}

/** What the desk is told, per refusal, in words that name the next act. */
export function refusalSentence(code: CheckOutRefusal): string {
  switch (code) {
    case "FOLIO_NOT_SETTLED":
      return "The account moved while this checkout was open. Read the charges again — what is outstanding now is below.";
  }
}

/**
 * A whole number of đồng typed by an operator, or null.
 *
 * `bigint`, because that is what the ledger is counted in and what the contract
 * takes — `money.ts` chose it precisely so an amount cannot be added to a night
 * or a percentage by accident.
 *
 * Spaces and full stops are dropped and a comma is not, which is the vi-VN
 * grouping mark and the vi-VN decimal mark respectively: a receptionist reading
 * "1.500.000 ₫" off the screen types the stops they can see, while a comma in a
 * đồng figure is somebody typing a minor unit the currency does not have — and
 * silently reading it as a grouping mark would post a hundredfold of what was
 * meant.
 *
 * Zero and less are refused, which is `postPaymentInput`'s own refusal applied
 * where the operator can still fix it rather than as a `400` after the press.
 */
export function parseAmount(typed: string): bigint | null {
  const digits = typed.replaceAll(/[\s.]/g, "");

  if (!/^\d+$/.test(digits)) {
    return null;
  }

  const amount = BigInt(digits);

  return amount > 0n ? amount : null;
}

/**
 * The ways a desk may say the money arrived — `postPaymentInput`'s own list.
 *
 * Read off the contract rather than written out beside it, which is the
 * arrangement `features/payments/payment-day.ts` uses for the filter's version
 * of the same question. What is derived here is the *desk's* list, and the
 * gateway's absence from it is the point rather than an omission: a `VNPAY` row
 * exists because the gateway confirmed it to the IPN handler, so a console able
 * to construct one would credit the property with money nobody confirmed. There
 * is no third string to type here, because there is no string typed here at all.
 */
export const DESK_PAYMENT_METHODS = postPaymentInput.shape.method.options;

/** One way the desk was paid, as the contract spells it. */
export type DeskPaymentMethod = (typeof DESK_PAYMENT_METHODS)[number];

/**
 * What each way of paying is called on screen.
 *
 * A `Record` over the union rather than a lookup with a fallback: a fourth
 * counter method added to the contract stops this file compiling, where a
 * `?? method` would quietly print a database enum at a guest.
 */
export const METHOD_LABELS: Record<DeskPaymentMethod, string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank transfer",
};

/**
 * What the operator typed into the payment step, before any of it is read.
 *
 * `method` is one value or none. None is a real state of this form and the one
 * the step opens in: how the money arrived is a fact only the person at the
 * counter holds, so the field starts unanswered and stays that way until they
 * answer it.
 */
export interface PaymentFields {
  amount: string;
  method: DeskPaymentMethod | null;
  description: string;
}

/** The body `folio.postPayment` takes — a stay, a figure, how it arrived, and
 *  the line the guest reads. */
export interface DeskPayment {
  readonly bookingId: string;
  readonly amount: string;
  readonly method: DeskPaymentMethod;
  readonly description: string;
}

/** Either a payment the API will take, or the sentence that says why it is not
 *  one yet. */
export type PaymentAttempt =
  | { readonly payment: DeskPayment }
  | { readonly problem: string };

/**
 * The payment as the contract takes it, or the first thing wrong with it.
 *
 * The amount travels as text, per `money.ts`: the contract decodes it back into
 * the `bigint` the ledger is counted in, and a number on the way would round a
 * figure in đồng that has no minor unit to round into.
 *
 * The method has no default here and none anywhere above. The ledger is
 * append-only, so a line posted without one cannot be told later which it was —
 * and the drawer the day's report asks about is counted from exactly that
 * distinction. Guessing "cash" because a desk usually takes cash would put a
 * transfer in the till on the one day somebody actually knew the difference.
 *
 * One refusal at a time, in the order the step reads, like every other form in
 * this console: a form with one message beside it is one thing to fix.
 */
export function paymentAttempt(
  bookingId: string,
  fields: PaymentFields,
): PaymentAttempt {
  const amount = parseAmount(fields.amount);

  if (amount === null) {
    return {
      problem: "A payment is money received, so it is a figure above nothing.",
    };
  }

  const description = fields.description.trim();

  if (description === "") {
    return {
      problem: "The line needs a description — it is what the guest reads.",
    };
  }

  if (fields.method === null) {
    return {
      problem:
        "Say how the money arrived. Cash counted at the desk and a transfer that landed in the bank are the same figure and not the same fact, and an append-only ledger cannot be told afterwards which one this was.",
    };
  }

  return {
    payment: {
      bookingId,
      amount: amount.toString(),
      method: fields.method,
      description,
    },
  };
}
