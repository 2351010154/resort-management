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
// `booking/ports/folio.port.ts` argues which way this dependency runs and the
// argument carries over unchanged: a port is the caller's list of needs, not
// the provider's list of capabilities.

import type { VndAmount } from "@mariva/shared";

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
   */
  readonly amount: VndAmount;
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
 * The four things the property asks of whoever moves its money.
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
  /** Open an attempt and get the address to send the payer to. */
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;

  /**
   * Authenticate whatever the gateway just posted, and say what it means.
   *
   * The raw callback arrives as it was received. One method covers both the
   * webhook and the payer's return, because they are the same claim over the
   * same signature; which of them the property *acts* on is policy, and it
   * belongs to the caller rather than to the gateway.
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
}

/** DI token. An interface is a type and erases; the binding needs a value. */
export const PAYMENT_GATEWAY = Symbol("PAYMENT_GATEWAY");
