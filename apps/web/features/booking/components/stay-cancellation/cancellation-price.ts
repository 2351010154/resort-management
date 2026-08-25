// What the API's cancellation quote says, in the words a guest reads it in.
//
// **Keyed on `basis` and never on the amount.** `policy-charge.ts` exists for
// exactly this: a free cancellation and a charge of nothing are the same number
// and different facts, and a panel that read "free" off a zero would say it of
// a stay whose first night happened to cost nothing. The row of
// `property-and-tariff.md` §4 that fired is what the property decided, and the
// figure is only how much that decision comes to.
//
// **No figure is derived here, and no money is promised back.** The charge is
// the API's, and this panel is never told what has been paid — a stay still
// `HELD` has paid nothing and a confirmed one has paid in full, and one sentence
// has to be true of both. Nor does any code path return money: a refund is a
// staff act taken out of band, so the rows say what cancelling costs and leave
// the guest's own money alone. The single exception is the rate that gives none
// of it back, which is a warning rather than a promise and waits on nobody. The
// stay's own total is on the screen directly above, where the API put it.
//
// The rows are exhaustive over the basis the contract can send, so a row added
// to the grid fails the build here rather than falling through to a sentence
// written for a different one.

import type { CancellationQuote } from "./cancellation";

/** What one row of §4's grid says to the person deciding. */
export interface CancellationPrice {
  /** What cancelling costs, as a claim rather than as a number. */
  readonly cost: string;
  /** What that comes to, or `null` when it comes to nothing — a figure of zero
   *  beside "this cancellation is free" is the same fact said twice. */
  readonly amount: bigint | null;
  /** What happens to money already handed over, or `null` — which is every row
   *  but one. Refunds are staff-initiated and taken out of band, so no row here
   *  promises money back; the only sentence that still speaks is the one saying
   *  none of it comes back, which asks nobody to act on it. */
  readonly refund: string | null;
}

type Basis = CancellationQuote["basis"];

/**
 * The grid's rows, as sentences.
 *
 * The last two belong to an early departure rather than to a cancellation —
 * §4 gives them their own row and `booking.service.ts` never prices a
 * cancellation onto one. They are written out anyway because the contract's
 * enum is what this reads, and they have a second reason to stay silent about
 * money already paid: an early departure has had its slept nights posted, so a
 * sentence about the rest returning would be false for the one guest who ever
 * saw it.
 */
const ROWS: Readonly<Record<Basis, Omit<CancellationPrice, "amount">>> = {
  NONE: {
    cost: "Cancelling this stay costs nothing.",
    refund: null,
  },
  FIRST_NIGHT: {
    cost: "Cancelling now costs the first night.",
    refund: null,
  },
  FULL_STAY: {
    cost: "This rate does not refund a cancellation. Cancelling costs the whole stay.",
    refund: "Nothing you have paid comes back.",
  },
  REMAINING_NIGHTS_HALF: {
    cost: "This costs half of the nights that are left.",
    refund: null,
  },
  REMAINING_NIGHTS_FULL: {
    cost: "This costs the nights that are left.",
    refund: null,
  },
};

/**
 * The quote, read.
 *
 * **The amount is normalised rather than trusted**, for `stay-funnel.ts`'s
 * reason: `money.ts` holds đồng as `bigint` inside both processes and crosses
 * them as decimal text, because JSON has no integer wide enough for money.
 * `BigInt` accepts either, so this reads the same figure whichever arrives.
 */
export function priceOfCancelling(quote: CancellationQuote): CancellationPrice {
  const amount = BigInt(quote.amount);

  return { ...ROWS[quote.basis], amount: amount > 0n ? amount : null };
}
