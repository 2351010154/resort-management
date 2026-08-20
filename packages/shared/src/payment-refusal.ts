// Why the desk could not take the money it is holding, in one place because
// three layers spell it: the handler that throws the code, the error `data` that
// carries it over the wire, and the palette that offers a way out of it.
//
// Here at the root and not in `contract/`, for the reason `booking-refusal.ts`
// is: a refusal code is vocabulary, not a route. The folio contract carries this
// in the `data` of the error its payment route declares, and `contract/folio.ts`
// is where that declaration sits — the route that throws it is the folio's while
// the drawer that refuses is the desk's, so a file under either contract would
// be the vocabulary living in one of the two places it is not about.
//
// Named for the money rather than for the drawer or the method. What refuses a
// payment is some fact about the payment being attempted, and the cash list
// below is one such fact; a refusal about a transfer the property cannot
// reconcile would be another, and it belongs beside this one rather than in a
// second file whose name is a method.
//
// Nothing parses a refusal off the wire — the API produces it and the client
// reads it — which is the condition `booking-refusal.ts` set for its own
// `z.enum`s. The enum below arrived with the `.errors()` on the payment route,
// and it is what types the code the desk branches on all the way to the client.

import { z } from "zod";

/**
 * Why the desk could not take cash.
 *
 * Thrown by the folio's payment route, and what refuses is the drawer:
 * `schema/payment.ts` binds every đồng of cash to an open shift, so a
 * receptionist on no shift is refused money that is already in their hand.
 * `screens.md` gives that refusal an action — the palette offers to open a
 * drawer in place — and the action is the whole reason a code travels at all.
 * The same route answers `BAD_REQUEST` for a body it cannot read and a figure it
 * will not take, and a console telling those apart from this one by their
 * wording would break the afternoon somebody rewrites a sentence.
 * `migrations/0040` gives the same argument for why each boundary in this system
 * raises a SQLSTATE of its own.
 *
 * A one-element tuple rather than a bare constant, for the reason
 * `CHECK_OUT_REFUSALS` is one: a desk switching over these is written the same
 * way as one switching over a check-in's refusals, and the second value —
 * whatever else the console one day has a different action behind — is a member
 * added rather than a change to what kind of thing this is.
 */
export const CASH_PAYMENT_REFUSALS = ["NO_OPEN_SHIFT"] as const;

export const cashPaymentRefusalSchema = z.enum(CASH_PAYMENT_REFUSALS);

export type CashPaymentRefusal = (typeof CASH_PAYMENT_REFUSALS)[number];
