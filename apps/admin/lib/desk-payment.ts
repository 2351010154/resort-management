// Money the desk takes, as the two steps that take it both have to describe it.
//
// The arrivals sequence collects a deposit and the departures sequence settles a
// balance, and those are two words for one movement: a figure, how it arrived,
// and the line the guest reads. Both steps ask for it the same way, refuse it in
// the same order, and hand `folio.postPayment` the same body — so the vocabulary
// and the reading of the form live here rather than once per feature, where the
// two copies agreed only for as long as somebody remembered to edit both.
//
// `lib/` and not one of the features, for the reason `business-date.ts` and
// `date-parser.ts` are here: a feature importing another feature makes the
// arrivals queue a dependency of the departures queue over a handful of strings
// neither of them owns.

import { postPaymentInput } from "@mariva/shared";

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
 * What the console actually offers today, which is not yet the whole list.
 *
 * `CASH` is a method the contract takes and the API refuses: a cash payment
 * belongs to the drawer it was counted into, and `folio.postPayment` has no
 * shift to resolve until the shift open/close route lands, so it answers every
 * cash posting with a `400`. Offering it anyway would put the property's most
 * ordinary settlement behind a control that cannot work — the operator picks
 * the first radio, presses Enter, and is told the desk has no drawer.
 *
 * So the console offers what the API can take. Delete this narrowing when
 * `folio.postPayment` reads the operator's open shift; the contract already
 * carries `CASH` and {@link METHOD_LABELS} already names it, so restoring it is
 * this constant and nothing else.
 */
export const OFFERED_PAYMENT_METHODS = DESK_PAYMENT_METHODS.filter(
  (method) => method !== "CASH",
);

/**
 * What each way of paying is called on screen.
 *
 * A `Record` over the union rather than a lookup with a fallback: a fourth
 * counter method added to the contract stops this file compiling, where a
 * `?? method` would quietly print a database enum at a guest.
 *
 * `CASH` keeps its label while {@link OFFERED_PAYMENT_METHODS} withholds it.
 * The label is what the method is called and stays true whether or not a radio
 * offers it — a payment already taken in cash is still rendered from here.
 */
export const METHOD_LABELS: Record<DeskPaymentMethod, string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank transfer",
};

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
 * What the operator typed into the money step, before any of it is read.
 *
 * `method` is one value or none. None is a real state of this form and the one
 * the step opens in: how the money arrived is a fact only the person at the
 * counter holds, so the field starts unanswered and stays that way until they
 * answer it.
 */
export interface DeskPaymentFields {
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

/** Either money the API will take, or the sentence that says why it is not that
 *  yet. */
export type DeskPaymentAttempt =
  | { readonly payment: DeskPayment }
  | { readonly problem: string };

/**
 * The money as the contract takes it, or the first thing wrong with it.
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
 *
 * `nothingHandedOver` is the caller's, because it is the one sentence the two
 * steps do not share: a deposit is money handed over and a settlement is money
 * received, and an operator told the wrong noun has to work out which form they
 * are standing in. Everything the two steps say identically is said here once.
 */
export function deskPaymentAttempt(
  bookingId: string,
  fields: DeskPaymentFields,
  nothingHandedOver: string,
): DeskPaymentAttempt {
  const amount = parseAmount(fields.amount);

  if (amount === null) {
    return { problem: nothingHandedOver };
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
