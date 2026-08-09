// Asking a gateway to collect — `FR-PAY-02`, and the one act in the payment
// module that has a caller on this side of the wire.
//
// **One route, and the two beside it are deliberately not here.** The IPN and
// the payer's return are VNPay's own addresses: their paths, their methods and
// the shapes they answer with belong to a specification this property does not
// own, and `payment.controller.ts` argues at length why a contract written over
// them would be a promise made on somebody else's behalf. They are plain Nest
// routes for that reason. This one is the property's own — the desk asks, and
// the desk's web app is what calls it — so it is declared here like every other
// route the two sides have to agree on.
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

import { oc } from "@orpc/contract";
import { z } from "zod";
import { vndAmountInputSchema } from "../money.js";

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

export const payment = {
  openAttempt: oc
    .route({ method: "POST", path: "/bookings/{bookingId}/payment-attempts" })
    .input(openPaymentAttemptInput)
    .output(openedPaymentSchema),
};
