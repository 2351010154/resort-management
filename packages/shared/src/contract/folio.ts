// The stay's account over the wire — `FR-FOL-01`'s ledger, `FR-FOL-02`'s three
// lines, the corrections filed against them, and the moment the desk agrees the
// whole of it.
//
// Eight routes over seven rows of the RBAC matrix, and no route here that the
// matrix does not already govern: `folio.read`, `folio.post-charge`,
// `folio.post-payment`, `folio.reverse-posting`, `folio.close-invoice`,
// `folio.refund-policy` and `folio.refund-override`. Eight over seven because
// posting a room charge and posting a catalog item are two shapes under one
// authority — `matrix.ts` spells that row "Post charge (room, service,
// minibar)", so both were always this key's. The invoice adjustment
// exists in the matrix too and is deliberately not here — it has service work of
// its own, and a route declared before that work exists is a promise the client
// would be held to.
//
// **The two refunds are two routes, and that is `FR-PAY-04`.** `rbac-matrix.md`
// §2 states it as a prohibition — "not one endpoint with an amount check" — and
// the shapes below are what make the split real rather than declared: the policy
// route takes no amount at all, so the figure it posts cannot be influenced by
// the caller who reaches it, and the discretionary route takes one because
// departing from §4's grid is the whole of what a manager is doing there.
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
import { chargeBasisSchema } from "../policy-charge.js";
import { serviceCodeSchema } from "../service-catalog.js";
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
  /**
   * Which row of `property-and-tariff.md` §4's grid a policy charge is, and null
   * on every other type — `folio_posting_names_a_basis_exactly_when_a_policy_charge`
   * permits the column nowhere else. It travels because a penalty of nothing and
   * a penalty nobody applied are the same figure and not the same fact: `NONE`
   * is a row of the grid, so a reader shown only the amount cannot tell a free
   * cancellation from a waived one from a charge that was never levied.
   */
  chargeBasis: chargeBasisSchema.nullable(),
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
 * A catalog item sold to a stay — `FR-FOL-03`.
 *
 * **The item is named by `code`, and that is what separates this route from the
 * one above it.** {@link postChargeInput} takes a description somebody typed and
 * posts a `ROOM_CHARGE`; this names a row of `service_catalog`, and the line it
 * writes carries the key. The difference is not presentational: `schema/folio.ts`
 * makes `type = 'SERVICE_ITEM'` and a non-null `service_catalog_id` a
 * biconditional, so a service line that named nothing is a row the database
 * refuses — and it refuses it because a charge whose tax class is whatever the
 * poster believed is a charge `M8` cannot report on and an accountant cannot
 * check. `service.listCatalog` is where a code comes from.
 *
 * **`grossAmount` is optional, and which of the two it is depends on the item
 * rather than on the caller.** §6 prices two of the eight and leaves six unset,
 * and the two cases want opposite things:
 *
 * - A **priced** item is `unit_price_gross × quantity`, and an amount sent with
 *   it is *refused* rather than ignored. This is `postPolicyRefund`'s argument
 *   applied to a sale: the figure the property published cannot be influenced by
 *   whoever reached the route, and a request that quietly dropped a caller's
 *   number would leave them believing they had charged it.
 * - An **unpriced** item requires one. §6 says the six block nothing and names
 *   the reason they are unpriced — a minibar and a laundry bill are what was
 *   consumed, not a list price — so the figure is the desk's, and refusing to
 *   post one would make three-quarters of the catalog unsellable to protect a
 *   number that does not exist.
 *
 * Neither branch is expressible here, because only the catalog knows which an
 * item is. The service refuses, on the row it read, and says which of the two
 * mistakes was made.
 *
 * **The quantity is a count and never a multiplier on a typed figure.** Two
 * breakfasts is `quantity: 2`, and the amount posted is twice the published
 * price. On an unpriced item the amount is what the guest agreed to *in total* —
 * the count rides along because the invoice line says "3 × Minibar" and `M8`
 * counts items sold, not because it scales anything the caller sent. Sending
 * both a quantity and an amount on a priced item is the refusal above.
 */
export const postServiceItemInput = z.object({
  ...bookingIdFields,
  code: serviceCodeSchema,
  /** How many. Whole, above nothing — half a breakfast is not a thing the desk
   *  sells, and a zero is a line that says nothing happened. */
  quantity: z.int().min(1).max(999),
  /** Required when the item has no published price, refused when it has one. */
  grossAmount: vndAmountInputSchema
    .refine(
      (amount) => amount > 0n,
      "a charge is money the guest owes, so it cannot be nothing or less",
    )
    .optional(),
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

/**
 * §4's grid, applied — `FR-PAY-04`, and the stay is the whole of the request.
 *
 * **No amount, and that absence is what separates this route from the one below
 * it.** `property-and-tariff.md` §4 says every charge in the grid is computed by
 * `folio.refund-policy`, so the figure is `cancellation-calculator.ts`'s over
 * the per-night prices the booking froze — never a total divided by a count,
 * and never a number that travelled here. A caller able to send one would be
 * exercising the override's authority under the cheaper capability, which is
 * exactly the collapse `rbac-matrix.md` §2 refuses.
 *
 * **No event either, and for the same reason one step further back.** Which row
 * of the grid fired is a fact the booking already records — it was cancelled, it
 * never arrived, or the guest is leaving early — and each row prices
 * differently. A caller naming the event would be choosing the row; a caller
 * naming the *instant* of a cancellation would be choosing whether the free
 * window closed, which is a penalty waived by a request body.
 */
export const postPolicyRefundInput = z.object({ ...bookingIdFields });

/**
 * Money handed back outside the grid — `FR-PAY-04`'s other half.
 *
 * The amount is the caller's here, because departing from §4 is the whole of
 * what this route is: `rbac-matrix.md` §2 puts waiving a cell at `MANAGER`+ and
 * gives it a declaration of its own.
 *
 * Positive, like every other figure a caller sends. `schema/folio.ts` holds the
 * sign convention and the service applies it in one place — a refund is stored
 * positive, because handing money back undoes a payment and returns the stay to
 * owing what it owed.
 *
 * The reason is required and has no default. A discretionary refund is somebody
 * departing from the property's own policy, and a credit on an invoice with no
 * account of why is one an accountant cannot answer for months later — the
 * ledger is append-only, so the explanation cannot be added afterwards either.
 */
export const postOverrideRefundInput = z.object({
  ...bookingIdFields,
  amount: vndAmountInputSchema.refine(
    (amount) => amount > 0n,
    "a refund is money handed back, so the amount is what the guest receives",
  ),
  reason: descriptionSchema,
});

/**
 * Agreeing the account — `FR-FOL-01`'s close, and the moment `FR-FOL-04` hangs
 * the invoice off.
 *
 * The stay, and nothing beside it. There is no amount to send: the close is the
 * desk agreeing what the lines already come to, and a figure travelling with it
 * would be a second opinion about a sum the ledger has already taken — the
 * service refuses an account that does not settle and names what is still
 * outstanding, which is the only figure anybody needs to see.
 *
 * There is no invoice reference either, in or out. The number does not exist at
 * the moment of the close and will not until whoever issues the property's
 * invoices has been asked; `e-invoice.job.ts` argues why the close's own commit
 * is the asking, and a field that was null on every close would read as a
 * document that failed to issue rather than one nobody has issued yet.
 */
export const closeFolioInput = z.object({ ...bookingIdFields });

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

  postServiceItem: oc
    // Its own collection under the same account, beside `/charges` rather than a
    // variant of it. The two write different `posting_type`s and one of them is
    // constrained to name a catalog row, so a single endpoint would be a handler
    // branching on whether a code arrived — which is the shape `rbac-matrix.md`
    // §2 refuses for the refunds, for a reason that holds here too: the branch
    // would decide what the line *is*, and nothing tests a branch against §6.
    //
    // The same capability as `/charges` — `folio.post-charge`, whose matrix row
    // reads "Post charge (room, service, minibar)" and already names this. Two
    // routes under one key is not the thing §2 forbids; posting a minibar is the
    // same authority as posting a room charge, and neither hands the caller a
    // figure the other could not have typed.
    .route({
      method: "POST",
      path: "/bookings/{bookingId}/folio/service-items",
    })
    .input(postServiceItemInput)
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

  postPolicyRefund: oc
    // Two collections rather than one with a modifier on it, because the two
    // are not one act performed with different authority: this one posts the
    // grid's own figure and the next posts a manager's. A single `/refunds`
    // taking an optional amount would put both behind whichever capability the
    // route declared, and the declaration is the guarantee.
    //
    // One or two lines come back, and both are the grid's: §4's charge, which
    // names which row it is, and — when the stay is over-paid once that charge
    // stands against it — the money going back. A stay that still owes after the
    // charge is answered with the charge alone, which is honest rather than
    // empty: `folio` on the response carries what is left outstanding.
    .route({
      method: "POST",
      path: "/bookings/{bookingId}/folio/policy-refunds",
    })
    .input(postPolicyRefundInput)
    .output(folioPostingReceiptSchema),

  postOverrideRefund: oc
    .route({
      method: "POST",
      path: "/bookings/{bookingId}/folio/override-refunds",
    })
    .input(postOverrideRefundInput)
    .output(folioPostingReceiptSchema),

  close: oc
    // A nominalised act rather than a collection, the way `booking.ts` spells
    // `/confirmation` and `/cancellation`. The five routes above append to the
    // ledger, and the same charge sent twice is honestly two lines; this one
    // happens to the account once and the second attempt is refused, so a plural
    // that invited a second posting would be the wrong shape for it.
    .route({ method: "POST", path: "/bookings/{bookingId}/folio/closure" })
    .input(closeFolioInput)
    // The account, not a receipt. Nothing was posted — the close writes state
    // and no line — so {@link folioPostingReceiptSchema} has no `posted` to
    // carry and its `min(1)` says as much. What the desk needs back is the
    // agreed account itself: the state, the instant it was agreed at, and the
    // lines the invoice will be drawn from, all as one read on the connection
    // that closed it.
    .output(folioSchema),
};
