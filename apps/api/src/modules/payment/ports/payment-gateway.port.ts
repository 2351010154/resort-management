// What the property is allowed to know about the gateway that moves the money.
//
// `FR-PAY-01` states the rule in one clause — no gateway type leaks past this
// interface — and `FR-PAY-06` is the reason it is worth a port at all: a second
// gateway must be a second adapter and not a second folio. The moment a gateway
// response code reaches a service, every caller downstream of it is a caller of
// that one gateway, and the change that adds another has to be made in each of
// them.
//
// So the vocabulary below is the property's. An amount is `VndAmount`; an
// attempt is named by the reference the property minted for it; an outcome is
// taken, refused, or still open. Signature schemes, response codes, parameter
// names, hosts and the unit a gateway happens to count in stay inside the
// adapter that speaks to it.
//
// **The one figure that is not in đồng is optional, and it is a record rather
// than an amount.** A gateway that cannot charge đồng has to charge something
// else — `money.ts` sets out why that is a fact about the world and not a
// choice, PayPal's transaction currencies simply not including VND — so what
// the payer approved abroad is a second figure the property has to keep. It
// travels as `Presentment` and never as `VndAmount`, which is the type system
// holding the line `money.ts` draws: presentment is never summed, never posted,
// never compared against a folio. A gateway that collects in đồng returns none
// of it and reads exactly as it did before this field existed.
//
// **It crosses in both directions, and the two crossings are different claims.**
// On {@link CreatePaymentInput} it is an instruction: the property converted at
// its own configured rate, wrote the row, and is telling the gateway exactly
// what to collect. On {@link GatewayTransaction} it is a report: what the
// gateway says it settled, which `FR-PAY-05` has to compare against the frozen
// figure rather than against the adapter's own conversion of it. Nothing hands
// a presentment back from opening an attempt — the property does not need told
// what it has just decided.
//
// The adapter is what declares that it needs one at all, through
// {@link PaymentGateway.settlementCurrency}. Optional on both shapes rather than
// nullable, because "this gateway charges what the property posts" is the
// ordinary case and neither side should have to write `presentment: null` to say
// so. `FR-PAY-01` is unbroken by any of it: a currency and a rate are the
// property's own vocabulary — they are on the invoice `FR-FOL-04` issues — and
// nothing about which gateway produced them crosses.
//
// `booking/ports/folio.port.ts` argues which way this dependency runs and the
// argument carries over unchanged: a port is the caller's list of needs, not
// the provider's list of capabilities.

import type {
  Presentment,
  PresentmentCurrency,
  VndAmount,
} from "@mariva/shared";

/**
 * One payment attempt, named the way a gateway will be asked about it later.
 *
 * Both fields come from the caller, and `createdAt` is the one that needs the
 * explanation. Gateways partition transactions by the day they were opened, so
 * a later query or refund identifies an attempt by its reference *and* the time
 * it was created — not by the reference alone. If the adapter stamped that time
 * itself, no caller could reproduce it afterwards and every query would be
 * asking about an attempt that, as far as the gateway is concerned, does not
 * exist. The caller mints the pair, stores it, and hands the same pair back.
 */
export interface PaymentAttempt {
  /**
   * The property's own id for this attempt — unique per attempt, and echoed
   * back in the gateway's callback.
   *
   * Not the booking reference. A booking may be paid more than once, and
   * `FR-PAY-03`'s replayed callback has to resolve to one attempt.
   */
  readonly reference: string;

  /** When the property opened the attempt. */
  readonly createdAt: Date;
}

/** What the gateway is being asked to collect, and where to send the payer. */
export interface CreatePaymentInput extends PaymentAttempt {
  /**
   * In đồng. Whatever unit the gateway counts in is the adapter's business —
   * `money.ts` says why nothing above the adapter is allowed to scale it.
   */
  readonly amount: VndAmount;

  /** Shown to the payer on the gateway's own page. */
  readonly description: string;

  /** Where the gateway sends the payer's browser when they are finished. */
  readonly returnUrl: string;

  /**
   * The payer's address, for the gateway's fraud screening.
   *
   * It is on the port because the caller is the only one who has it: the
   * adapter is a singleton with no request to read it from, and an address it
   * invented would be a fraud signal that means nothing.
   */
  readonly payerIpAddress: string;

  /**
   * Exactly what to charge, when the gateway cannot charge the đồng above.
   *
   * Present for a gateway that declared a {@link PaymentGateway.settlementCurrency}
   * and absent for every gateway that collects in the property's own currency,
   * so an adapter that never needed it reads as it always did.
   *
   * **The property decides what it charges and the gateway executes it**, which
   * is the way round this has to be. `payment_foreign_gateway_states_what_it_charged`
   * refuses the insert of a row that cannot say what the payer was charged, and
   * `payment.service.ts` commits that row *before* it asks for a payment url —
   * deliberately, so that every callback which can arrive has a row to resolve.
   * A figure quoted back afterwards could not be written onto a row that already
   * exists and already had to be complete.
   *
   * It is also the stronger guarantee. The figure the guest approves at the
   * gateway and the figure frozen on the property's row are one value handed in
   * one direction, rather than two values that agree only while an adapter
   * reports honestly.
   *
   * The rate inside it is the property's configuration read at the moment the
   * attempt opened — `system_config.rate_vnd_per_usd` — and it is frozen there
   * because a refund, `FR-PAY-05`'s reconciliation and the invoice `FR-FOL-04`
   * issues all have to quote the rate the guest was actually charged at.
   * Re-reading today's would make each of them disagree with the others the
   * first time the property edited it.
   */
  readonly presentment?: Presentment;
}

export interface CreatePaymentResult {
  /** Send the payer here. Nothing else about the attempt is known yet. */
  readonly paymentUrl: string;
}

/** The fields a gateway reports about an attempt whatever became of it. */
interface GatewayTransactionBase {
  /** The {@link PaymentAttempt.reference} the attempt was opened under. */
  readonly reference: string;

  /**
   * What the gateway says the amount is — never assumed to be what was asked
   * for. Comparing the two is the caller's, and a mismatch is not this port's
   * to resolve.
   *
   * **On a foreign-settled transaction this figure is advisory, and a caller
   * that treats it as authoritative reintroduces a defect that refuses every
   * payment the property takes.** A gateway that cannot charge đồng was handed
   * cents to collect and reports cents back; the đồng here are the adapter's own
   * conversion of those cents at the frozen rate, computed in this process and
   * never seen by the payer or the gateway. `money.ts` states outright that the
   * round trip is lossy — a cent is worth roughly 250 đồng, so converting out
   * and back "can land a few hundred đồng away" — which means comparing this
   * against what the property asked for is comparing the adapter with itself and
   * calling its own rounding a discrepancy. 1,200,000 ₫ at 26,150.5 returns as
   * 1,200,046 ₫, and nothing is wrong.
   *
   * {@link GatewayTransactionBase.presentment} is the authoritative figure for
   * such a gateway, and `payment.service.ts` is where that rule is applied: a
   * row that froze a presentment is checked in cents against
   * `payment.presentment_amount`, and only a row that froze none is checked in
   * đồng against this. What is posted to the folio either way is the row's own
   * `amount` — the đồng the property asked for — and never a figure converted
   * back from cents.
   *
   * Authoritative and exact for a gateway that collects đồng, which is every
   * gateway declaring no {@link PaymentGateway.settlementCurrency}: there the
   * number arrived from the gateway's own report and no conversion touched it.
   * It is spelled out here rather than left to be rediscovered because a field
   * that looks authoritative and is not is how the next reader writes the
   * comparison back the way it was.
   */
  readonly amount: VndAmount;

  /**
   * What the gateway says it settled in, when that is not đồng.
   *
   * The same block {@link CreatePaymentInput} carried when the attempt was
   * opened, reported back as the gateway currently sees it — which is what
   * makes it worth carrying twice. `FR-PAY-05` holds the gateway's own daily
   * report against this property's rows, and a settlement that arrived in
   * dollars can only be checked against the dollars that were frozen on the
   * attempt; the đồng above are already this adapter's conversion of it, so
   * comparing those alone would be comparing the adapter with itself.
   *
   * **This is therefore the authoritative figure whenever it is present**, and
   * not merely a second record beside one. `minorUnits` and
   * `payment.presentment_amount` are integers in the same unit, both fixed
   * before the payer saw the gateway, and the gateway reports back the very
   * field it was told to charge — so the two are equal or the settlement is not
   * the one this property opened. The đồng above cannot make that claim, for the
   * reason written on them.
   *
   * Optional for {@link CreatePaymentInput}'s reason, and on the base rather
   * than on the successful arm because a refusal is worth the same record: a
   * gateway that declined a charge declined it in a currency, and an attempt
   * whose presentment is unknown is one nobody can tell apart from an attempt
   * that never converted.
   */
  readonly presentment?: Presentment;
}

/**
 * An attempt as the gateway currently sees it.
 *
 * A union rather than a status beside two optional fields, because the two
 * fields are only meaningful together with `"SUCCESS"`. An attempt nobody paid
 * has no transaction id and no time of payment, and an interface that offered
 * both as optional would push a `?? new Date()` into the caller — a payment
 * dated by our clock instead of the gateway's, which is exactly the drift
 * `FR-PAY-05`'s reconciliation exists to catch.
 */
export type GatewayTransaction =
  | (GatewayTransactionBase & {
      readonly status: "SUCCESS";

      /**
       * The gateway's own id for the money it took. `FR-PAY-03` keys webhook
       * idempotency on it, which is why it is not optional here: there is no
       * successful payment without one.
       */
      readonly gatewayTransactionId: string;

      /** When the gateway took the money, by the gateway's clock. */
      readonly paidAt: Date;
    })
  | (GatewayTransactionBase & {
      /** Refused by the gateway, or still open — the payer may yet finish. */
      readonly status: "FAILED" | "PENDING";
    });

/**
 * What a callback turned out to be.
 *
 * A discriminated union and not an exception, because an unsigned or forged
 * callback is ordinary traffic: `FR-PAY-03` leaves the callback routes
 * unguarded on purpose — the gateway arrives with no session and the signature
 * *is* the authentication — so anyone may post to them. Shaped this way, a
 * caller that never checked cannot reach the transaction at all, which is a
 * stronger guarantee than remembering to catch.
 */
export type CallbackVerification =
  | { readonly verified: true; readonly transaction: GatewayTransaction }
  | { readonly verified: false };

/**
 * The stretch of time a gateway is asked to account for in one answer.
 *
 * Two instants and deliberately not a business date, because a trading day is
 * the property's rule and not the gateway's: `property-and-tariff.md` §2 rolls
 * the day at a configured hour in the property's own zone, and a gateway handed
 * a date would have to be told that hour as well and trusted to apply it. What
 * a gateway can answer honestly is "everything you settled between these two
 * moments", and the narrowing from that to one trading day stays with the caller
 * that read the hour — `reconciliation.job.ts` draws both sides of its
 * comparison through one reading of it, and its own header says what two
 * readings would file.
 *
 * Half-open, `from` included and `until` excluded, which is the convention every
 * range in this tree uses against a timestamp column. The caller sends a coarse
 * range — a day out on either side of the business date, so that the trading day
 * is inside it whatever hour the property rolls at — and the exact answer is a
 * filter it applies to what comes back.
 */
export interface SettlementWindow {
  readonly from: Date;

  readonly until: Date;
}

/** Which payment to send back, how much of it, and on whose authority. */
export interface RefundInput extends PaymentAttempt {
  /**
   * The gateway's id for the payment being reversed.
   *
   * Given alongside the inherited reference because gateways disagree about
   * which side of the pair keys a refund, and both are known by the time one is
   * possible — only a payment that succeeded can be sent back.
   */
  readonly gatewayTransactionId: string;

  /** How much to return. May be less than was taken — `FR-PAY-04`. */
  readonly amount: VndAmount;

  /** Why, for the gateway's own record of it. */
  readonly reason: string;

  /**
   * The staff account answering for this refund.
   *
   * `rbac-matrix.md` §Folio and money splits refunding within policy from
   * refunding outside it, and the gateway keeps its own list of who asked for
   * what. `FR-PAY-05` compares the two reports daily, so both have to name the
   * same person.
   */
  readonly requestedBy: string;
}

export interface RefundResult {
  /** The gateway's id for the reversal, which is not the payment's. */
  readonly gatewayRefundId: string;
}

/**
 * The four things the property asks of whoever moves its money, and one more it
 * takes where a gateway can give it.
 *
 * Every method is asynchronous, including the one that verifies a callback. A
 * maintained signature library may well answer without waiting — `FR-PAY-02`
 * requires that the library and not this codebase does the verifying — but
 * whether verification costs a round trip belongs to the gateway, and a
 * synchronous port would make the first gateway that needs one a rewrite of
 * every caller. `ports/folio-stub.service.ts` shows the other side of that
 * trade: an implementation with nothing to await satisfies an asynchronous
 * signature by returning a resolved promise, and pays nothing for it.
 */
export interface PaymentGateway {
  /**
   * The currency this gateway collects in, when it cannot collect đồng.
   *
   * The one thing an adapter *declares* rather than does, and it is here
   * because the caller has to know before it writes anything: the row is
   * committed before the gateway is asked, `payment_foreign_gateway_states_what
   * _it_charged` refuses one that cannot say what the payer was charged, and so
   * the conversion has to happen at a moment when no adapter has been called
   * yet. A property that had to open the attempt to find out what currency it
   * was in could never write a complete row.
   *
   * A currency and not a rate, and not a quoting method either. The rate is the
   * property's own configuration — `system_config.rate_vnd_per_usd`, edited by
   * an `ADMIN` — so a gateway asked to supply one would be answering a question
   * about the property rather than about itself. What only the gateway knows is
   * which of `money.ts`'s presentment currencies it is able to take.
   *
   * Absent is the ordinary case and means đồng: `VnpayAdapter` declares nothing,
   * is handed no presentment, and none of it is visible from inside it.
   */
  readonly settlementCurrency?: PresentmentCurrency;

  /** Open an attempt and get the address to send the payer to. */
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;

  /**
   * Authenticate whatever the gateway just posted, and say what it means.
   *
   * The raw callback arrives as it was received. One method covers both the
   * webhook and the payer's return, because they are the same claim over the
   * same signature; which of them the property *acts* on is policy, and it
   * belongs to the caller rather than to the gateway.
   *
   * **One opaque record and deliberately not a second parameter for headers.**
   * A gateway that authenticates over transmission headers rather than over the
   * query string — PayPal verifies an event against the headers it was
   * delivered under — needs them, and the honest place to put them is inside
   * this record: `payment.controller.ts` already establishes that a callback
   * route speaks its gateway's own protocol, so the route that receives those
   * headers is the one that knows they exist and puts them where its adapter
   * will look. A `headers` parameter on the port would be the opposite trade —
   * every caller and every adapter learning that some gateway somewhere
   * authenticates that way, and `VnpayAdapter` growing an argument it would
   * only ever ignore. The record is untyped precisely so that what a callback
   * consists of stays the adapter's business.
   */
  verifyCallback(
    callback: Record<string, unknown>,
  ): Promise<CallbackVerification>;

  /**
   * Send money back.
   *
   * A refund the gateway refuses throws — unlike a forged callback, it is a
   * staff action that failed, and there is nothing to post. Nothing in this
   * signature depends on how a particular gateway numbers or stages its
   * refunds, which is what keeps `ASM-05` an adapter problem: if the sandbox
   * grants no refund access, the adapter's tests are what stall.
   */
  refund(input: RefundInput): Promise<RefundResult>;

  /** Ask the gateway what became of an attempt, whatever it told us before. */
  queryTransaction(attempt: PaymentAttempt): Promise<GatewayTransaction>;

  /**
   * Everything the gateway settled in a window, where it will say so in one
   * answer.
   *
   * `FR-PAY-05` holds a night's money against the gateway's own report, and the
   * two gateways this property has answer that question in two different ways.
   * VNPay has no "everything you took on the 14th" at all — its merchant API
   * answers about one attempt at a time and the day's totals live in a file
   * drawn from a portal by hand — so `reconciliation.job.ts` reconstructs the
   * report from the attempts this property minted, which works because every
   * attempt that could exist at a gateway has a row here naming it. A gateway
   * with a reporting API answers directly, and the difference between the two is
   * this method being present or absent.
   *
   * **Optional, and that is the whole of how the difference is expressed.** An
   * adapter that cannot answer a window omits it and is asked attempt by attempt
   * exactly as it always was; `VnpayAdapter` declares nothing and reads as it
   * did before this existed. A capability the port made mandatory would be a
   * method every adapter had to implement and one of them could only implement
   * by lying — a day report assembled inside the adapter out of attempts it does
   * not know about.
   *
   * **A direct report is not merely cheaper, it sees money the reconstruction
   * cannot.** Asking about known attempts can only ever find the ones this
   * property already recorded; a settlement against a reference no row here
   * names — `MISSING_LOCALLY`, the direction that leaves a guest charged with
   * their folio still showing the balance — is in the window's answer and
   * outside the reconstruction's reach.
   *
   * What comes back is in the port's own vocabulary, like everything else here:
   * `GatewayTransaction`, with the đồng on a foreign-settled one carrying the
   * standing written on {@link GatewayTransactionBase.amount}. Transactions the
   * gateway settled that are not this property's attempts do not belong in it —
   * a merchant account may carry other traffic, and reporting it here would file
   * a discrepancy against money that was never this property's to reconcile.
   */
  settledBetween?(
    window: SettlementWindow,
  ): Promise<readonly GatewayTransaction[]>;
}

/** DI token. An interface is a type and erases; the binding needs a value. */
export const PAYMENT_GATEWAY = Symbol("PAYMENT_GATEWAY");
