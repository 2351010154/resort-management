// Asking a gateway to collect — `FR-PAY-02` — and reading back where the
// gateway's report and this property's ledger disagreed, which is `FR-PAY-05`.
// Between them, the acts in the payment module that have a caller on this side
// of the wire.
//
// **Four routes, and the two beside them are deliberately not here.** The IPN
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
// **Both realms reach this route, on different terms.** The matrix row
// `payment.open-attempt` grants the four staff roles that hold it `full` and the
// guest realm `⚠`: the desk collects against any stay, including the walk-in
// that belongs to no account, and a guest only against the one they booked. The
// guest realm was denied outright while a booking had no owning account to be
// checked against — a route would then have taken a booking id from a caller
// with no way to show it was theirs, which is a payment page opened against a
// stranger's stay. `booking.user_id` supplies the account, so the condition is
// answerable, and `payment.service.ts` answers it in the query before a folio is
// opened. One route and one service method serve both realms; what differs is
// whether an account arrives with the request to scope it.
//
// **The amount is the guest's to send and not the guest's to choose.** On the
// guest door the service refuses any `amount` that is not the booking's
// `quoted_stay_total_gross` — the property collects the stay in full before
// arrival, so there is exactly one figure a guest may open an attempt for, and
// without the refusal a hostile client opens one for a thousand đồng and comes
// back holding a signed gateway success. The staff door keeps taking the amount
// its caller typed, because a desk collects deposits, part payments and
// balances, and those are a different operation performed by somebody the
// property has already trusted with the till.
//
// **No schema change carries that**, deliberately. {@link openPaymentAttemptInput}
// still takes an amount from both realms, because the refusal depends on the
// booking's frozen total and on which realm asked — two facts a schema cannot
// see. It is a service refusal for the same reason the non-positive amount is
// one, and this note is here so that a reader of the contract is not left
// inferring from the shape that any amount will do.
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
//
// **The fourth route is the payments themselves, and it is not a third
// reconciliation read.** The two above answer "what did last night's comparison
// find", and their subject is a trading day. This one answers "what has this
// property been paid", and its subject is the row — the money as the payer's
// side reported it, which `schema/payment.ts` keeps in a table of its own
// precisely because the ledger says the same thing in its own words and the two
// are compared rather than merged. Nothing could read that table until this
// route: the desk sees a folio's postings and the accountant sees the nights
// that disagreed, and neither of those is the payment, the gateway it moved
// through, or the transaction id an operator matches against a merchant screen.
//
// It is governed by `payment.reconcile` — the same row as the two above — and no
// key was added for it. That row is "Gateway reconciliation", `ACCOUNTANT` and
// up, and what it governs is this property's money as the payer's side reports
// it. A payment row is strictly less than what {@link reconciledDaySchema}
// already hands the same caller about the same attempt, so nothing is reachable
// here that the key did not already open. What `rbac-matrix.md` §2 forbids is a
// single route whose authority turns on its body, and a read with no body is
// not that.
//
// **It restates no discrepancy.** {@link listedPaymentSchema} carries a
// disagreement's *id* and never its figures: the two amounts, the
// classification and the instant it was observed are `readReconciliation`'s
// answer, and a second copy of them here would be a row that could disagree
// with the day it came from. The id is the whole of what a link needs.

import { oc } from "@orpc/contract";
import { z } from "zod";
import {
  presentmentSchema,
  vndAmountInputSchema,
  vndAmountSchema,
} from "../money.js";
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
 * How the money reached the property, as the wire spells it.
 *
 * A method and not a provider list, which is `schema/payment.ts`'s own word for
 * the column: cash and a bank transfer are ways of paying, and the two gateways
 * beside them are the two `FR-PAY-01` puts behind one port. `FR-PAY-06`'s second
 * gateway is `PAYPAL` — a member here and a second implementation behind the
 * port, never a gateway's own vocabulary, which is what `FR-PAY-01` keeps inside
 * the adapter. A member is a payment method the property accepts, and that is
 * all a reader of this list learns.
 *
 * The same four members `payment_method` holds, stated here and built into a
 * Postgres enum there from a tuple of its own — the arrangement
 * {@link paymentDiscrepancyKindSchema} uses, and nothing has to remember to keep
 * the two level: the handler returns rows whose `method` is the database's
 * union, so a member this schema lacks stops the API compiling rather than
 * failing output validation at run time.
 */
export const paymentMethodSchema = z.enum([
  "VNPAY",
  "PAYPAL",
  "CASH",
  "BANK_TRANSFER",
]);

export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

/**
 * The subset a funnel may open an attempt with — the methods a gateway answers
 * for, and not the two the desk collects itself.
 *
 * Derived from the union above rather than written out again, so a third
 * gateway is one member in one place. `CASH` and `BANK_TRANSFER` are excluded
 * because there is nowhere to send a payer for either: they are money somebody
 * counted at the desk, and an attempt opened against one would be a payment
 * url for a transaction that happens in a room.
 */
export const gatewayPaymentMethodSchema = paymentMethodSchema.exclude([
  "CASH",
  "BANK_TRANSFER",
]);

export type GatewayPaymentMethod = z.infer<typeof gatewayPaymentMethodSchema>;

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
  /**
   * Which gateway to collect through — the caller's choice, and the one field
   * here that is genuinely the payer's.
   *
   * `FR-PAY-06` puts a second implementation behind the port, and two adapters
   * that both answer are only useful if something picks between them. The pick
   * is per attempt rather than per deployment because it is the guest's: one
   * stay may be paid twice on the same afternoon, and a card that works abroad
   * and a Vietnamese bank account are different answers to the same question.
   *
   * Narrowed to {@link gatewayPaymentMethodSchema} and not the whole method
   * list, so the two the desk counts itself are unrepresentable here — there is
   * nowhere to send a payer for cash, and an attempt opened against it would be
   * a payment url for a transaction that happens in a room.
   *
   * **Defaulted rather than required**, and the default is the gateway the
   * property already had. Every caller that predates the second one keeps
   * working unchanged, which is the same courtesy the port extends to
   * `VnpayAdapter`; a required field would have made a second gateway a
   * breaking change to a route that had nothing to do with it.
   *
   * Nothing here says the property can actually collect through the method
   * named. A deployment holds credentials for the gateways it has finished
   * onboarding, which is a fact about a server and not about a request, so a
   * method with no adapter behind it is a `503` from
   * `ports/gateway-registry.ts` rather than a member this schema withholds.
   */
  method: gatewayPaymentMethodSchema.default("VNPAY"),
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
  /**
   * What the payer will actually be charged, when the gateway just chosen
   * cannot take đồng — the same figure `payment.service.ts` froze onto the
   * row a moment before this answered.
   *
   * **Optional and not nullable**, `payment-gateway.port.ts`'s own
   * convention for the field this one restates on the wire: a VNPay attempt
   * settles in đồng and needs to say nothing about it, and `presentment:
   * null` would be a caller inventing an answer to a question a đồng
   * attempt was never asked.
   *
   * **This is the read the funnel is allowed to quote a payer from, and the
   * only one.** The property computes what a foreign gateway will charge at
   * the moment the attempt opens — `system_config.rate_vnd_per_usd`, read
   * once and frozen onto the row before anything is asked of PayPal — and
   * this is that same computation handed back rather than a second one. A
   * route that answered a quote before an attempt existed would be reading
   * the configured rate a second time, and an `ADMIN` editing it between the
   * two reads would quote the guest one figure and charge them another. So
   * there is no such route: a screen that wants to tell a payer what PayPal
   * will charge opens the attempt first and shows exactly what this answers,
   * never a figure it converted itself.
   */
  presentment: presentmentSchema.optional(),
});

/**
 * The gateways this deployment can actually collect through, as the wire
 * spells them.
 *
 * **A fact about a server and not about the property's price list.** Every
 * member of {@link gatewayPaymentMethodSchema} is a method this property
 * accepts; which of them a given deployment holds credentials for is a
 * different question, and one only the process that holds the bindings can
 * answer. `ports/gateway-registry.ts` is where that answer lives, and it is
 * partial on purpose: a property part-way through a merchant onboarding runs
 * the API and collects through whatever it has finished.
 *
 * Answered so that a funnel can draw the choice it actually has. Without it a
 * screen has to guess — hard-coding a provider as choosable, and turning the
 * registry's own refusal into the sentence a guest reads after they have typed
 * their name, chosen that provider and pressed the button.
 *
 * **It says nothing about an individual attempt.** A method listed here is one
 * the deployment has an adapter for, not a promise that the next attempt
 * opened at it will succeed — a gateway that is bound and unreachable is still
 * the `502` it always was, and that is the gateway's afternoon rather than
 * this deployment's configuration.
 */
export const collectableGatewaysSchema = z.object({
  methods: z.array(gatewayPaymentMethodSchema),
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

/**
 * What became of the money — the four states `payment_status` holds.
 *
 * `PENDING` is an attempt opened and not yet resolved, `FAILED` one the gateway
 * refused, and both are kept rather than deleted: a guest asking why they were
 * not charged is asking about a `FAILED` row, and a comparison against the
 * gateway's report needs two reports rather than one report and an absence.
 * `REFUNDED` is money that was taken and later handed back — what was handed
 * back, when, and on whose authority is a posting on the ledger and not this
 * row.
 */
export const paymentStatusSchema = z.enum([
  "PENDING",
  "SUCCESS",
  "FAILED",
  "REFUNDED",
]);

export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

/**
 * The most payments one page of the collection will answer with.
 *
 * The same figure and the same argument as `folio.ts`'s ceiling on its own list:
 * this is a worklist rather than a search, so the tail is reached by `offset`
 * instead of being dropped and the caller told to ask a narrower question. Two
 * hundred because a screen that paints more rows than this in one go is an
 * export wearing a table's clothes.
 */
export const LONGEST_PAYMENT_PAGE = 200;

/** The page a caller gets for not naming one. Enough to fill a screen. */
export const PAYMENT_PAGE_SIZE = 50;

/**
 * Which payments to list — the four dimensions somebody chasing a payment
 * actually has.
 *
 * **The stay and not the folio**, because a booking is what a person holds when
 * they ask. There is exactly one account per stay — `schema/folio.ts` makes that
 * a unique key — so the two narrow to the same rows, and only one of them is an
 * id anybody outside this API has ever seen.
 *
 * **`businessDate` is a single day and not a range**, and it is the day the
 * money moved on rather than the day the row was written. §2's rollover decides
 * which trading day an instant belongs to, so the day is derived from the
 * gateway's own `paidAt` through the property's configured hour — the same rule
 * `FR-PAY-05`'s sweep partitions on, which is what makes a day's payments here
 * and that day's reconciliation the same set of money. A single day rather than
 * a range because the question this filter answers is the one a reconciliation
 * raises, and that is always about one night; a wider window is the folio list's
 * question about accounts rather than about payments.
 *
 * A payment that never moved money — an attempt still `PENDING`, one the gateway
 * refused — belongs to no trading day at all, so naming a date excludes it. That
 * is not a filter dropping rows it should have kept: an unresolved attempt has
 * no instant of payment to be dated by, and dating it by the moment the row was
 * written would put it on a day the property was never paid on.
 *
 * **`method` and `status` are separate dimensions**, because they answer
 * different questions and one does not imply the other. "Everything that came
 * through the gateway" and "everything that failed" are two lists, and their
 * intersection — the gateway's failures — is the one a person triaging a payment
 * asks for.
 */
export const listPaymentsInput = z.object({
  bookingId: z.uuid().optional(),
  businessDate: stayDateSchema.optional(),
  method: paymentMethodSchema.optional(),
  status: paymentStatusSchema.optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(LONGEST_PAYMENT_PAGE)
    .default(PAYMENT_PAGE_SIZE),
  // Rows to skip, not a page number — `folio.ts` says why, and the order this
  // route promises is total for the same reason: newest row first with the id
  // breaking a tie, so a caller stepping by `limit` sees each payment once.
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * One movement of money as the payer's side reported it.
 *
 * **The amount is a magnitude and carries no sign.** `schema/payment.ts` keeps
 * the sign convention on the ledger, where a payment is stored negative so a
 * balance is a plain sum; repeating it here would be one convention in two
 * places, on the two tables whose whole purpose is to be compared. Đồng and
 * whole — decimal text on the wire, which `money.ts` argues is the only crossing
 * that cannot quietly lose the last digits of a figure.
 *
 * **Both gateway columns are nullable and null means the same thing on each:**
 * the property collected this money itself. Cash counted at the desk and a bank
 * transfer moved no gateway, so there is no transaction id for one — the row's
 * `method` is what says which case it is.
 *
 * `businessDate` is derived on every read from `paidAt` and the property's
 * rollover hour, and it is null on exactly the rows that have no `paidAt`:
 * money that has not moved belongs to no trading day. It travels because a
 * screen filtering on a day has to be able to show which day a row is on, and
 * because the instant alone does not answer that — 01:00 belongs to the day that
 * has not rolled yet.
 *
 * `discrepancyId` points at the disagreement `FR-PAY-05`'s sweep filed against
 * this payment, and null is the ordinary case of money nobody has had to
 * explain. A reference and not the row: `readReconciliation` serves the figures,
 * and restating them beside a payment would be a second copy of an observation
 * that is supposed to be the record of what a night looked like.
 */
export const listedPaymentSchema = z.object({
  id: z.uuid(),
  /** The stay the money was collected for. */
  bookingId: z.uuid(),
  /** The account it was posted to — one per stay. */
  folioId: z.uuid(),
  method: paymentMethodSchema,
  status: paymentStatusSchema,
  amount: vndAmountSchema,
  /** The gateway's own id for the money it took. Null on what the desk took. */
  gatewayTransactionId: z.string().nullable(),
  /** The payer's clock, never this property's. Null until money has moved. */
  paidAt: z.iso.datetime().nullable(),
  /** The trading day the money moved on. Null while none has. */
  businessDate: isoStayDateSchema.nullable(),
  /** The disagreement filed against this payment, if a night found one. */
  discrepancyId: z.uuid().nullable(),
});

/**
 * A page of payments, and how many the filters matched behind it.
 *
 * `total` is counted under the same predicate the page was cut from, on every
 * read — the figure a count card is asking for, and the one a pager needs to
 * offer a last page at all. A page shorter than its limit says nothing once an
 * offset was given, and a full page says nothing ever.
 */
export const paymentPageSchema = z.object({
  payments: z.array(listedPaymentSchema),
  total: z.number().int().min(0),
});

/**
 * The desk's deliberately narrow question: which successful payments can still
 * anchor a policy refund. Status is not caller-selectable because anything but
 * `SUCCESS` is ineligible by definition.
 */
export const listRefundCandidatesInput = listPaymentsInput.omit({
  status: true,
});

/**
 * A safe navigational row for the refund action. Gateway, folio,
 * reconciliation and discrepancy identifiers intentionally do not cross this
 * capability boundary.
 */
export const refundCandidateSchema = z.object({
  paymentId: z.uuid(),
  bookingId: z.uuid(),
  bookingReference: z.string().min(1).max(32),
  method: paymentMethodSchema,
  amount: vndAmountSchema,
  paidAt: z.iso.datetime(),
  businessDate: isoStayDateSchema,
});

export const refundCandidatesPageSchema = z.object({
  payments: z.array(refundCandidateSchema),
  total: z.number().int().min(0),
});

export const payment = {
  gateways: oc
    // A read with no subject, under the same `/payments` root the rest of the
    // module hangs off. No input at all: the answer is the same for every
    // caller, because what it reports is which adapters this process has
    // bound and not anything about who asked or what they are paying for.
    .route({ method: "GET", path: "/payments/gateways" })
    .output(collectableGatewaysSchema),

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

  list: oc
    // The root itself, because the payments are what `/payments` is a
    // collection of — the two routes above are a sub-collection of the nights
    // somebody held them against, and `/payments/vnpay/…` is the gateway's own
    // half of the conversation under the same root. Nothing here is addressed
    // by a stay: a booking is one of the filters, and the question this answers
    // is what the property has been paid across all of them.
    //
    // GET with the narrowing in the query string, so a person triaging a
    // payment has a link rather than a procedure — and so that the reads a
    // screen makes repeatedly are cacheable and safe to retry.
    .route({ method: "GET", path: "/payments" })
    .input(listPaymentsInput)
    .output(paymentPageSchema),

  listRefundCandidates: oc
    .route({ method: "GET", path: "/payments/refund-candidates" })
    .input(listRefundCandidatesInput)
    .output(refundCandidatesPageSchema),
};
