// Asking a gateway to collect — `FR-PAY-02` — and reading back where the
// gateway's report and this property's ledger disagreed, which is `FR-PAY-05`.
// Between them, the acts in the payment module that have a caller on this side
// of the wire.
//
// **Three routes, and the two beside them are deliberately not here.** The IPN
// and the payer's return are VNPay's own addresses: their paths, their methods
// and the shapes they answer with belong to a specification this property does
// not own, and `payment.controller.ts` argues at length why a contract written
// over them would be a promise made on somebody else's behalf. They are plain
// Nest routes for that reason. These are the property's own — the desk asks, the
// accountant reads, and the desk's web app is what calls both — so they are
// declared here like every other route the two sides have to agree on.
//
// **Addressed by the stay, because that is what is being collected for.**
// `/bookings/{bookingId}/payment-attempts` sits beside `folio.ts`'s
// `/bookings/{bookingId}/folio/payments`, and the two are not the same act. The
// folio route files money the property has *already* received, as a line on the
// ledger. This one files an intention: a row saying money is outstanding, and an
// address to send the payer to. Nothing is on the account until the gateway
// reports back, which is `FR-PAY-03`'s callback and not this route's answer.
//
// A collection and a `POST`, because an attempt is a thing a stay may have more
// than one of — a payer who abandoned checkout, a card that was declined, a
// deposit followed by a balance. `PaymentAttempt` in
// `ports/payment-gateway.port.ts` says the same thing from the gateway's side,
// and it is why the reference below names the attempt rather than the stay.
//
// **The realm is staff, and there is no guest variant of this yet.** The matrix
// row `payment.open-attempt` denies the guest realm outright: a guest cannot
// name a booking as theirs today — `schema/guest.ts` puts the join between a
// guest account and a stay at M7 — so a guest-realm route would take a booking
// id from a caller who has no way to prove it is theirs, which is a payment page
// opened against a stranger's stay. The funnel that closes that gap arrives with
// M7 and calls the same service.
//
// **The two reconciliation routes are reads and nothing else.** `FR-PAY-05`'s
// nightly sweep already writes `payment_discrepancy` and
// `payment_reconciliation_run`, and until these routes existed nobody could look
// at either: `ops-alert.service.ts` pages a phone about a disagreement, and the
// accountant it wakes had no address to go to. So the matrix row "Gateway
// reconciliation" — `payment.reconcile`, `ACCOUNTANT` and up — governs a list of
// the days that were looked at and the detail of one of them, and governs
// nothing that changes a row. There is no route here that resolves, acknowledges
// or re-runs a discrepancy: `schema/reconciliation.ts` states that the table is
// append-only because a row is an observation of what a day looked like when it
// was looked at, and re-running a night is `jobs.ts`'s trigger under the
// capability that already governs a sweep.
//
// **Addressed by the business date, because that is what a run is about.** Not
// by the run's own id — it has none, the date is its primary key — and not by a
// discrepancy's id either: a person handed a page asks "what happened on the
// 14th", and the answer is the whole day rather than the one row that woke them.

import { oc } from "@orpc/contract";
import { z } from "zod";
import { vndAmountInputSchema, vndAmountSchema } from "../money.js";
import { isoStayDateSchema, stayDateSchema } from "../stay-date.js";

/**
 * What the payer will see printed on the gateway's own checkout page.
 *
 * Shorter than a folio line's 500 characters, and it is a different field doing
 * a different job. A posting's description is stored on this property's ledger
 * and read back by this property; this sentence is handed to a gateway and laid
 * out in somebody else's form, whose width is theirs to choose. Bounding it here
 * makes an over-long sentence a 400 the desk can shorten, rather than a payment
 * page with the explanation cut off halfway.
 */
const descriptionSchema = z.string().trim().min(1).max(255);

/**
 * The stay to collect against, how much, and what to tell the payer it is for.
 *
 * **No refusal of a non-positive amount here, and that is the one asymmetry with
 * `postPaymentInput`.** That schema mirrors the folio service's refusal because
 * the alternative was the ledger's own `CHECK` reporting it as a fault. This one
 * has nothing to improve on: `PaymentService.createPaymentRequest` already
 * refuses a nothing-or-less amount with a sentence written for the person who
 * typed it, before a row is written or a payer is sent anywhere, and a second
 * copy of the rule here would be two sentences for one decision — drifting apart
 * the first time either is reworded.
 *
 * The stay is a `uuid` because it is a path parameter and every route hung off a
 * booking spells it the same way. That does make the service's *other* refusal —
 * an id it cannot mint a reference out of — unreachable through this route,
 * which is the correct order: the shape is caught at the edge, and the service
 * keeps the check for the callers that do not come through a contract.
 */
export const openPaymentAttemptInput = z.object({
  bookingId: z.uuid(),
  amount: vndAmountInputSchema,
  description: descriptionSchema,
});

/**
 * An open attempt: where to send the payer, and what this property will call it
 * afterwards.
 *
 * Both halves are needed and neither substitutes for the other. The url is the
 * gateway's, signed, and good for one attempt. The reference is the property's
 * own name for that attempt — it is echoed back in every callback about it, it
 * is what a support question about a payment starts from, and it is the string
 * an operator matches against the gateway's merchant screen.
 *
 * Nothing about money is asserted here. The attempt is `PENDING` at the instant
 * this answers, and it stays that way until the gateway reports what became of
 * it; a client that treated this response as a payment would be issuing a
 * receipt before anybody had paid.
 */
export const openedPaymentSchema = z.object({
  paymentUrl: z.url(),
  reference: z.string().min(1),
});

/**
 * The ways the two reports can fail to say the same thing, as the wire spells
 * them.
 *
 * The same three members `payment_discrepancy_kind` holds, stated here and built
 * into a Postgres enum in `schema/reconciliation.ts` from a tuple of its own —
 * the arrangement `folio.ts` uses for `posting_type` and for the same reason.
 * Nothing has to remember to keep the two level: the handler returns rows whose
 * `kind` is the database's union, and a member this schema lacks stops the API
 * compiling rather than failing output validation at run time.
 *
 * There is no `MATCHED`. An agreement is an outcome of the comparison and never
 * a row, so it is nothing this route could return.
 */
export const paymentDiscrepancyKindSchema = z.enum([
  "MISSING_LOCALLY",
  "MISSING_AT_GATEWAY",
  "AMOUNT_MISMATCH",
]);

export type PaymentDiscrepancyKind = z.infer<
  typeof paymentDiscrepancyKindSchema
>;

/**
 * One attempt the two reports described differently, as it was observed.
 *
 * **Both amounts travel and both are nullable**, because the disagreement is
 * asymmetric and the two figures are the whole of what somebody is being asked
 * to explain. Null is the side that reported nothing at all, which is not the
 * same claim as reporting zero — `payment_discrepancy_kind_matches_the_sides`
 * makes which of them is null a fact of the `kind`, so a reader may branch on
 * the classification without re-deriving it from the money.
 *
 * `paymentId` is null on exactly `MISSING_LOCALLY`, that being the case where
 * this property has no payment row for the money the gateway says it took.
 *
 * `observedAt` is when the two reports were held against each other, and it is
 * not the business date: a gap found at 04:05 the next morning and one found six
 * days late are different answers to how long it stood.
 */
export const paymentDiscrepancySchema = z.object({
  id: z.uuid(),
  /** The property's own name for the attempt — the only key both sides share. */
  attemptReference: z.string(),
  kind: paymentDiscrepancyKindSchema,
  gatewayAmount: vndAmountSchema.nullable(),
  ledgerAmount: vndAmountSchema.nullable(),
  paymentId: z.uuid().nullable(),
  observedAt: z.iso.datetime(),
});

/**
 * A trading day that was reconciled, and how much of it disagreed.
 *
 * `discrepancyCount` is counted on every read rather than stored.
 * `schema/reconciliation.ts` refuses the column outright and says why: a total
 * frozen at the moment of the sweep is a second copy of a figure that is a query
 * away, on the one table whose purpose is to notice that two copies of a fact
 * have stopped agreeing.
 *
 * Zero is the good day and it is still a row here. That asymmetry is the point
 * of the run table — a date with no discrepancies and a date nobody looked at
 * are opposite facts, and only a run says which one this is.
 */
export const reconciliationRunSchema = z.object({
  businessDate: isoStayDateSchema,
  reconciledAt: z.iso.datetime(),
  discrepancyCount: z.number().int().min(0),
});

/**
 * The days that were looked at, newest first.
 *
 * Newest first because the question is almost always about last night, and
 * bounded because a property accumulates one of these a day forever — the
 * ceiling is `reconciliation.service.ts`'s, and naming a range is how a day
 * older than it is reached.
 *
 * **`hasMore` is what keeps the ceiling from being a silent edit to the
 * question.** A range wider than it answers with the newest days inside that
 * range, and a full list is not evidence of anything on its own: a caller
 * counting the rows cannot tell a range that held exactly that many from one
 * that held a year more. True says the days before the oldest one here were
 * dropped, and the way to see them is a narrower range — there is no cursor,
 * because the range is already the address of any window a reader wants.
 */
export const reconciliationRunsPageSchema = z.object({
  runs: z.array(reconciliationRunSchema),
  hasMore: z.boolean(),
});

/**
 * Which days to list — both ends optional, and inclusive of both when given.
 *
 * Optional rather than defaulted to a window, because the honest default is "the
 * most recent days" and that is the answer with neither end named. A `from`
 * alone is every day since; a `to` alone is every day up to it.
 *
 * Inclusive at both ends, like `pricing.ts`'s `from`/`to` and unlike a stay's
 * half-open [checkIn, checkOut): these name the first and last *day reconciled*
 * that the reader wants, and half-open here would mean asking about a single
 * night by naming the one after it.
 */
export const listReconciliationRunsInput = z
  .object({
    from: stayDateSchema.optional(),
    to: stayDateSchema.optional(),
  })
  .refine(
    (range) => !range.from || !range.to || range.from.compare(range.to) <= 0,
    { message: "to must not fall before from", path: ["to"] },
  );

/**
 * One reconciled day in full: when it was looked at, and everything that
 * disagreed.
 *
 * The instant travels beside the rows and is the reason this is not simply an
 * array. An empty `discrepancies` on a day that was reconciled says the two
 * reports agreed; the same array on a day nobody swept would say the same thing
 * and be a lie, so a date with no run is a refusal rather than an empty list.
 *
 * Ordered by `attemptReference`, so two reads of one day list the same rows in
 * the same order.
 */
export const reconciledDaySchema = z.object({
  businessDate: isoStayDateSchema,
  reconciledAt: z.iso.datetime(),
  discrepancies: z.array(paymentDiscrepancySchema),
});

/** The one day being asked about. */
export const readReconciledDayInput = z.object({
  businessDate: stayDateSchema,
});

export const payment = {
  openAttempt: oc
    .route({ method: "POST", path: "/bookings/{bookingId}/payment-attempts" })
    .input(openPaymentAttemptInput)
    .output(openedPaymentSchema),

  listReconciliations: oc
    // A collection of the runs, under the same `/payments` root the gateway's
    // own two paths hang off. Nothing here is VNPay's, though: a run is about a
    // trading day rather than about a terminal, and `FR-PAY-06`'s second gateway
    // is reconciled by the same sweep into the same table and read back through
    // this same route.
    .route({ method: "GET", path: "/payments/reconciliations" })
    .input(listReconciliationRunsInput)
    .output(reconciliationRunsPageSchema),

  readReconciliation: oc
    // The member of that collection, keyed by the business date — which is
    // exactly the run table's primary key, so the address and the row are one
    // identifier rather than two that have to be kept level.
    .route({ method: "GET", path: "/payments/reconciliations/{businessDate}" })
    .input(readReconciledDayInput)
    .output(reconciledDaySchema),
};
