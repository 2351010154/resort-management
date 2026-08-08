// The stay's account over the wire — `FR-FOL-01`'s ledger, `FR-FOL-02`'s three
// lines, and the corrections filed against them.
//
// Four routes, four rows of the RBAC matrix, and no route here that the matrix
// does not already govern: `folio.read`, `folio.post-charge`,
// `folio.post-payment` and `folio.reverse-posting`. The refund rows, the close
// and the invoice adjustment exist in the matrix too and are deliberately not
// here — each has service work of its own, and a route declared before that
// work exists is a promise the client would be held to.
//
// **Addressed by the stay, not by the folio's id.** There is exactly one account
// per booking — `schema/folio.ts` makes that a unique key — and nothing tells
// anyone the folio's own id, so `/bookings/{bookingId}/folio` is both the true
// relation and the path shape `booking.ts` already uses for everything hung off
// a stay.
//
// **The balance is derived and travels beside the lines.** {@link
// folioSummarySchema} is computed from the postings on every read; nothing
// stores it, and `schema/folio.ts` refuses to hold the column that would be the
// second place for it to live. The three figures are exact by construction
// rather than by classification — `charged` is every line that increased what is
// owed and `credited` every line that reduced it, so `charged - credited` is the
// plain sum `NFR-02` states, and a reversal lands on whichever side it actually
// moved the account.
//
// **One shape, and the guest realm reads none of it yet.** `matrix.ts` grants
// `folio.read` to the guest realm as `conditional` with the note "own, settled
// view", and `screens.md` draws the same line — staff see every posting, a guest
// sees the settled summary. No folio can be a guest's own today: `schema/guest.ts`
// says in as many words that the join between `guest_user` and a stay is M7's,
// and the funnel that would create an attributed booking is M7's too. So the
// ownership check the handler owes resolves to a refusal for every caller in
// that realm, and there is no second variant here for it to return — an
// unreturnable branch of a union is exactly the promise `index.ts` says nobody
// can keep. {@link folioSummarySchema} is a member in its own right so that the
// guest read, when it has a folio it can prove is theirs, reuses this figure
// rather than restating it.

import { oc } from "@orpc/contract";
import { z } from "zod";
import { vndAmountInputSchema, vndAmountSchema } from "../money.js";
import { isoStayDateSchema } from "../stay-date.js";

const bookingIdFields = { bookingId: z.uuid() };

/** What a guest reads on the line, and the bound every description takes. */
const descriptionSchema = z.string().trim().min(1).max(500);

/**
 * What a line is — the members `posting_type` holds, as the wire spells them.
 *
 * The list is stated here and built into a Postgres enum in `schema/folio.ts`
 * from a tuple of its own, which is one list in two places. Nothing has to
 * remember to keep them level: the handler returns rows whose `type` is the
 * database's union, and a member this schema lacks stops the API compiling
 * rather than failing output validation at run time.
 */
export const postingTypeSchema = z.enum([
  "ROOM_CHARGE",
  "SERVICE_ITEM",
  "SERVICE_CHARGE_FEE",
  "VAT",
  "POLICY_CHARGE",
  "PAYMENT",
  "REFUND",
  "REVERSAL",
]);

export type PostingType = z.infer<typeof postingTypeSchema>;

/** Open, then closed — `schema/folio.ts` says why there is no third. */
export const folioStateSchema = z.enum(["OPEN", "CLOSED"]);

export type FolioState = z.infer<typeof folioStateSchema>;

/**
 * One line of the account, as it was written and never since edited.
 *
 * `businessDate` and `postedAt` are different questions rather than two
 * spellings of one: the day the line belongs to, which §2's rollover decides,
 * and the instant it was written. A charge filed at 01:00 by the night audit
 * belongs to the day that has not rolled yet, and only the second of the two
 * says when the keystroke happened.
 *
 * `parentPostingId` is what ties `FR-FOL-02`'s three lines together — the
 * service charge and the VAT name the sale they were levied on — and it is the
 * column a renderer groups the sale on. The wire promises no order inside a
 * single instant, because the three are written by one statement and share one.
 *
 * `postedBy` is the member of staff, by name, the way the housekeeping board
 * carries `updatedBy`. Null for a line no person authored: the night audit's
 * sweep and the gateway's callback both write rows nobody decided on.
 */
export const folioPostingSchema = z.object({
  id: z.uuid(),
  type: postingTypeSchema,
  amount: vndAmountSchema,
  description: z.string(),
  businessDate: isoStayDateSchema,
  /** The line this one undoes. Non-null on a `REVERSAL` and on nothing else. */
  reversesPostingId: z.uuid().nullable(),
  /** The sale this line was levied on. Null on the sale itself. */
  parentPostingId: z.uuid().nullable(),
  postedAt: z.iso.datetime(),
  postedBy: z.string().nullable(),
});

/**
 * The account in three figures — `NFR-02`, derived on every read.
 *
 * Split by what each line did to the balance rather than by what type it is. A
 * reversal is a correction and carries whichever sign undoes the line it names,
 * so a summary that read "payments" off the negative lines would report an
 * undone room charge as money the guest handed over. `charged` is every line
 * that increased what is owed, `credited` every line that reduced it as a
 * positive figure, and `outstanding` is their difference — which is the plain
 * sum of the amounts, so the identity holds whatever a future posting type
 * turns out to mean.
 */
export const folioSummarySchema = z.object({
  charged: vndAmountSchema,
  credited: vndAmountSchema,
  /** Zero on a settled account. Negative when the property owes the guest. */
  outstanding: vndAmountSchema,
});

/** The whole account: what it is, what is on it, and what it comes to. */
export const folioSchema = z.object({
  id: z.uuid(),
  bookingId: z.uuid(),
  state: folioStateSchema,
  openedAt: z.iso.datetime(),
  /** Null while the account is still taking lines. */
  closedAt: z.iso.datetime().nullable(),
  summary: folioSummarySchema,
  postings: z.array(folioPostingSchema),
});

/**
 * What a write answers with: the lines it filed, and the account they landed on.
 *
 * The account comes back rather than an acknowledgement, because the next thing
 * the desk does with a posted charge is read the balance — and a second call to
 * do that would read it on another connection, after somebody else's payment.
 *
 * `posted` names the lines this call authored. A room charge answers with the
 * sale alone: `FR-FOL-02`'s service charge and VAT are written beside it and
 * name it as their parent, so the set is reachable from the id given and does
 * not need restating here.
 */
export const folioPostingReceiptSchema = z.object({
  posted: z.array(z.uuid()).min(1),
  folio: folioSchema,
});

export const readFolioInput = z.object({ ...bookingIdFields });

/**
 * A charge as the guest agreed to it — one gross figure, never three.
 *
 * `property-and-tariff.md` §5 quotes gross and shows the folio net, so the
 * service charge and the tax are decomposed out of this figure rather than added
 * on top of it. Adding them would bill the guest more than the price they said
 * yes to.
 *
 * Positive, mirroring the service's own refusal and `setRateCalendarInput`'s:
 * handing money back is a refund and taking a line off the account is a
 * reversal, and each of those is its own route with its own capability.
 */
export const postChargeInput = z.object({
  ...bookingIdFields,
  grossAmount: vndAmountInputSchema.refine(
    (amount) => amount > 0n,
    "a charge is money the guest owes, so it cannot be nothing or less",
  ),
  description: descriptionSchema,
});

/**
 * Money the property has received, as the guest handed it over.
 *
 * Positive here and stored negative, and the negation happens once, in the
 * service. A caller that had to remember to send a negative figure is a caller
 * that will one day forget, and the ledger's `CHECK` would refuse it as a fault
 * rather than as an answer the desk could act on.
 */
export const postPaymentInput = z.object({
  ...bookingIdFields,
  amount: vndAmountInputSchema.refine(
    (amount) => amount > 0n,
    "a payment is money received, so the amount is what the guest handed over",
  ),
  description: descriptionSchema,
});

/**
 * A correction — `FR-FOL-01`'s reversing entry.
 *
 * The stay is named as well as the line, and the handler refuses a pair that
 * does not belong together. A posting id alone would be enough for the service,
 * which resolves the folio from the row; naming both is what makes the
 * correction land on the account the caller believes they are looking at rather
 * than on whichever one the id happened to point at.
 *
 * No amount. The row being undone already holds the only correct figure, and a
 * reversal whose amount the caller supplied is a second chance to get it wrong.
 */
export const reversePostingInput = z.object({
  ...bookingIdFields,
  postingId: z.uuid(),
});

export const folio = {
  read: oc
    .route({ method: "GET", path: "/bookings/{bookingId}/folio" })
    .input(readFolioInput)
    .output(folioSchema),

  postCharge: oc
    // POST to a collection, because that is what a posting is: the ledger is
    // append-only, so the same charge sent twice is two lines and correcting one
    // of them is a reversal rather than a re-`PUT`.
    .route({ method: "POST", path: "/bookings/{bookingId}/folio/charges" })
    .input(postChargeInput)
    .output(folioPostingReceiptSchema),

  postPayment: oc
    .route({ method: "POST", path: "/bookings/{bookingId}/folio/payments" })
    .input(postPaymentInput)
    .output(folioPostingReceiptSchema),

  reversePosting: oc
    // A reversal is a line the account gains, so it posts to a collection like
    // the other two — `matrix.ts` says "never a delete", and there is no verb
    // here that could be mistaken for one.
    .route({ method: "POST", path: "/bookings/{bookingId}/folio/reversals" })
    .input(reversePostingInput)
    .output(folioPostingReceiptSchema),
};
