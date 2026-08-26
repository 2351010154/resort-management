// The second of `FR-PAY-01`'s two implementations, and the first that cannot
// charge the property's own currency.
//
// It sits beside `vnpay.adapter.ts` at the module root for the reason that file
// gives: `ports/` is the property's list of needs written in the property's
// vocabulary, and this is one provider's answer to it written in PayPal's.
// `FR-PAY-06`'s whole claim is that a second gateway is a second file here and
// nothing else, and this file is the test of it — everything above the port kept
// compiling, and the additions to `payment-gateway.port.ts` were a currency an
// adapter may declare, the figure the property hands it to charge, and an
// optional answer about a window that a gateway without a reporting API simply
// does not implement.
//
// **Dollars, because there is no arrangement in which PayPal takes đồng.** VND
// is absent from PayPal's transaction currencies, so the payer approves a second
// figure and the property has to keep a record of it — `money.ts` sets out why
// that record is a `Presentment` and never a `VndAmount`, and why the ledger
// nonetheless stays in đồng. Every amount this file hands back across the port
// is `VndAmount`; `USD`, order ids, capture ids, link relations and event names
// do not leave it.
//
// **The rate is the property's and it is frozen before this file is called.**
// `payment.service.ts` reads `system_config.rate_vnd_per_usd` in the transaction
// that writes the row and hands the result down as `CreatePaymentInput.
// presentment`, so what is charged here and what is recorded there are one value
// rather than two that agree while an adapter reports honestly. Nothing below
// reads a rate feed, and nothing below decides what to charge.
//
// **The frozen rate travels to PayPal and comes back, which is what makes a
// webhook readable at all.** PayPal has no lookup by a merchant's own reference
// and no memory of the property's configuration, so an event arriving hours
// later carries dollars and nothing else. The attempt's terms therefore ride on
// `custom_id` — the one field the property sets that PayPal echoes on the order,
// on the capture and in the reporting API — and every đồng figure reported back
// is `convertPresentmentToVnd` at *that* rate rather than at today's. A callback
// is then self-describing, and this adapter never reads the property's database,
// which is what `FR-PAY-01` asks of one.
//
// **Nothing in this file computes a signature, and the SDK ships no verifier.**
// `FR-PAY-02` forbids a hand-rolled check and PayPal's server SDK has no
// equivalent of `vnpay`'s `verifyReturnUrl`, so verification is a call to
// PayPal's own `/v1/notifications/verify-webhook-signature`: the property posts
// the transmission headers and the event exactly as delivered and PayPal answers
// `SUCCESS` or `FAILURE`. No HMAC, no certificate is fetched, and no chain is
// walked here. The event is forwarded exactly as it was parsed, because PayPal
// re-serialises it to check the signature and a body reshaped in transit
// verifies against nothing.
//
// **Credentials are optional and the failure is deferred, not hidden**, exactly
// as `vnpay.adapter.ts` argues: the constructor cannot build a client, so the
// client is built on first use and a process without credentials boots and fails
// at the payment — naming the variables — rather than at the boot of an API that
// mostly does other things. `ports/gateway-registry.ts` reads that same decision
// from the other end.

import {
  CheckoutPaymentIntent,
  Client,
  Environment,
  OrdersController,
  PaymentsController,
  TransactionSearchController,
} from "@paypal/paypal-server-sdk";
import {
  convertPresentmentToVnd,
  convertVndToPresentment,
  type FxRate,
  fxRateSchema,
  type Presentment,
  type PresentmentCurrency,
  type PresentmentMinorUnits,
} from "@mariva/shared";
import { Inject, Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import { ENV, type Env } from "../../config/env.js";
import type {
  CallbackVerification,
  CreatePaymentInput,
  CreatePaymentResult,
  GatewayTransaction,
  PaymentAttempt,
  PaymentGateway,
  RefundInput,
  RefundResult,
  SettlementWindow,
} from "./ports/payment-gateway.port.js";

/**
 * Where PayPal's REST API answers. Its addresses, not the property's opinion.
 *
 * Two hosts and one flag, the way `vnpay.adapter.ts` sets both of its hosts from
 * one: the SDK's `Environment` decides where the orders and payments calls go,
 * and the verification call below is a `fetch` this file makes itself, so the
 * host has to be named here as well. A deployment that pointed one at production
 * and the other at the sandbox would verify live events against a sandbox
 * webhook and answer `FAILURE` to every real payment.
 */
const PAYPAL_API_SANDBOX_HOST = "https://api-m.sandbox.paypal.com";

const PAYPAL_API_PRODUCTION_HOST = "https://api-m.paypal.com";

/**
 * PayPal's own answer to "is this event yours", and the whole of `FR-PAY-02`'s
 * compliance for this gateway.
 *
 * The SDK covers Orders, Payments, Vault, Subscriptions and Transaction Search
 * and stops there — it has no webhook verifier at all. The requirement forbids
 * writing one, so what remains is asking the issuer. This path takes the five
 * transmission headers, the configured webhook id and the event body, and
 * answers with a verification status; the certificate it was signed with is
 * PayPal's to fetch and PayPal's to trust.
 */
const VERIFY_WEBHOOK_SIGNATURE = "/v1/notifications/verify-webhook-signature";

/** The only answer that means the event is PayPal's. Anything else is not. */
const VERIFIED = "SUCCESS";

/**
 * The currency this gateway collects in — `money.ts`'s only presentment member.
 *
 * A constant rather than a parameter because it is a fact about PayPal and about
 * this property's arrangement with it, not a per-attempt choice: the payer is
 * quoted dollars because đồng cannot be quoted, and a gateway that could take
 * either would be a different conversation with the guest.
 */
const SETTLEMENT_CURRENCY: PresentmentCurrency = "USD";

/** Cents in a dollar. The scaling `money.ts` allows only inside an adapter. */
const MINOR_UNITS_PER_MAJOR = 100n;

/**
 * The HATEOAS relation naming the page the payer approves the order on.
 *
 * PayPal returns a list of links rather than a payment url, and their order is
 * not part of the contract — the property looks for the relation and never for a
 * position. `self` and `update` sit in the same list, and sending a payer to
 * either would be sending them to a JSON document.
 */
const APPROVE_LINK = "approve";

/**
 * The events this property acts on, and what each one means about the money.
 *
 * Capture events and not order events, because a capture is the money moving:
 * an order may be created, approved and abandoned without a đồng of it ever
 * being taken. `FR-PAY-03` keys idempotency on the gateway transaction id, and
 * on this gateway that id is the capture's — an order id names an intention.
 */
const CAPTURE_COMPLETED = "PAYMENT.CAPTURE.COMPLETED";

const CAPTURE_DENIED = "PAYMENT.CAPTURE.DENIED";

const CAPTURE_REVERSED = "PAYMENT.CAPTURE.REVERSED";

/**
 * The five headers PayPal delivers an event under, lowercased.
 *
 * Lowercased because HTTP header names are case-insensitive and every server
 * this property runs behind normalises them that way before a handler sees one;
 * comparing against PayPal's documented capitals would be a verification that
 * worked in the documentation and refused every real delivery.
 */
const TRANSMISSION_HEADERS = {
  auth_algo: "paypal-auth-algo",
  cert_url: "paypal-cert-url",
  transmission_id: "paypal-transmission-id",
  transmission_sig: "paypal-transmission-sig",
  transmission_time: "paypal-transmission-time",
} as const;

/**
 * What separates the attempt's reference from the rate it was opened at inside
 * `custom_id`.
 *
 * `@` because a reference is hexadecimal — `payment.service.ts` mints it from a
 * booking id and a nonce with the hyphens taken out — and a rate is decimal
 * digits with at most one point, so neither half can contain it and the split is
 * unambiguous without an escape rule. PayPal allows 255 characters in the field
 * and the pair uses well under half of that.
 */
const TERMS_SEPARATOR = "@";

/**
 * Whether this deployment holds the three variables a PayPal call needs.
 *
 * Exported because two places have to agree about it and only one of them can
 * find out by trying. {@link PaypalAdapter.paypal} refuses a call that cannot be
 * made, which is the right answer to a guest who chose PayPal; `payment.module
 * .ts` has to answer the *earlier* question — whether this property collects
 * through PayPal at all — before anything asks the adapter anything, because
 * `ports/gateway-registry.ts` says a method with no adapter is absent from the
 * map rather than present and failing.
 *
 * That distinction is what `reconciliation.job.ts` depends on. It asks every
 * bound gateway for its side of a night and deliberately catches nothing per
 * gateway, so a gateway that is bound and cannot answer takes the whole night
 * down with it — which is correct for a provider that is configured and
 * unreachable, and wrong for one this property has not onboarded. The same
 * three variables, read in one place, so the two answers cannot drift.
 */
export function paypalIsConfigured(env: Env): boolean {
  return Boolean(
    env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET && env.PAYPAL_WEBHOOK_ID,
  );
}

@Injectable()
export class PaypalAdapter implements PaymentGateway {
  /**
   * Declared, so `payment.service.ts` converts and freezes before it writes the
   * row this adapter's attempt will be resolved against.
   *
   * The port explains why the declaration is a currency rather than a rate or a
   * quoting method: the rate is the property's own configuration, and the only
   * part of the arrangement PayPal decides is which currencies it can take.
   */
  readonly settlementCurrency = SETTLEMENT_CURRENCY;

  /** Built on first use; see the note on deferred failure at the top. */
  private client?: Client;

  constructor(@Inject(ENV) private readonly env: Env) {}

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const presentment = input.presentment;

    // A `PAYPAL` attempt with nothing to charge is a caller that did not read
    // `settlementCurrency`, which is a mistake in this codebase rather than
    // anything a payer did — so it is reported as one. `INTERNAL_SERVER_ERROR`
    // and not a `400`: the guest supplied nothing wrong, and a message blaming
    // their request would send whoever reads it looking at the funnel instead of
    // at the service that skipped a conversion. Postgres refuses the same shape
    // one layer down through `payment_foreign_gateway_states_what_it_charged`,
    // which is what makes this a second line of defence rather than the rule.
    if (!presentment) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        status: 500,
        message:
          "A PayPal attempt reached the gateway without the dollars to charge, " +
          "so the property has not decided what the payer is being asked for",
      });
    }

    const { orders } = this.paypal();

    const opened = await orders.createOrder({
      body: {
        // Captured rather than authorised: the property takes the money when the
        // payer approves it. An authorisation would leave a hold PayPal expires
        // in three days and a folio owed money nobody has, which is a second
        // lifecycle for `payment_status` to learn and `FR-PAY-04`'s reversing
        // entry to answer for.
        intent: CheckoutPaymentIntent.Capture,
        purchaseUnits: [
          {
            amount: {
              currencyCode: SETTLEMENT_CURRENCY,
              // The frozen figure, in the major unit PayPal states amounts in.
              // The scaling is here because this is the boundary `money.ts`
              // permits one at, and the value scaled is the one already written
              // on the row — so nothing is rounded twice and nothing is rounded
              // out of sight of the record.
              value: majorUnits(presentment.minorUnits),
            },
            // Shown to the payer on PayPal's own page.
            description: input.description,
            // The attempt's terms, carried where PayPal will echo them: on this
            // order, on the capture it becomes, and in the reporting API the
            // query below reads. It is what lets a webhook arriving hours later
            // resolve the attempt *and* state the rate it was opened at, without
            // this adapter reading a row.
            customId: termsFor(input.reference, presentment.rate),
          },
        ],
        applicationContext: {
          returnUrl: input.returnUrl,
          // The same address for both, and the funnel is why: the payer's
          // browser comes back to a page that asks the property what became of
          // the attempt, and that page answers "paid", "still open" or
          // "cancelled" off the property's own row rather than off which url
          // PayPal chose. Two urls would be two pages telling the guest the same
          // thing from the same source.
          cancelUrl: input.returnUrl,
        },
      },
      // PayPal's idempotency key. The reference is minted once per attempt and
      // never reused — `PaymentAttempt` says why it is not the booking's — so a
      // retried call returns the order that already exists instead of opening a
      // second one against the same row, which would be two payer-facing pages
      // for one debt.
      paypalRequestId: input.reference,
    });

    const approval = opened.result.links?.find(
      (link) => link.rel === APPROVE_LINK,
    )?.href;

    // An order PayPal accepted and gave the payer no way to approve. There is
    // nothing to send a browser to, and returning the property's own page would
    // be showing a guest a payment they cannot make.
    if (!approval) {
      throw new ORPCError("BAD_GATEWAY", {
        status: 502,
        message:
          "PayPal opened the order without an address for the payer to approve " +
          "it at, so there is nowhere to send them",
      });
    }

    return { paymentUrl: approval };
  }

  async verifyCallback(
    callback: Record<string, unknown>,
  ): Promise<CallbackVerification> {
    const delivered = deliveryIn(callback);

    // No transmission headers, or nothing that reads as an event. `FR-PAY-03`
    // leaves the callback routes unguarded — the gateway arrives with no session
    // and the signature *is* the authentication — so an unsigned request is
    // ordinary traffic and not an exception the property has anything to do
    // about. Refused rather than thrown, exactly as `vnpay.adapter.ts` refuses a
    // payload the library cannot read as a callback at all.
    if (!delivered) {
      return { verified: false };
    }

    // Outside the request below on purpose, and for `vnpay.adapter.ts`'s reason:
    // a process with no credentials is a misconfiguration and has to be reported
    // as one. Folded into `{ verified: false }` it would read as a forged
    // callback and leave the property quietly refusing every payment it takes.
    const { apiHost, webhookId } = this.paypal();

    const asked = await this.ask(apiHost, VERIFY_WEBHOOK_SIGNATURE, {
      ...delivered.headers,
      webhook_id: webhookId,
      // The event exactly as it was parsed, and never rebuilt. PayPal
      // re-serialises this to check the signature over it, so a body that
      // dropped an unknown field or reordered a key verifies against nothing —
      // and the failure would look identical to a forgery.
      webhook_event: delivered.event,
    });

    if (verificationStatusIn(asked) !== VERIFIED) {
      return { verified: false };
    }

    return theTransactionIn(delivered.event);
  }

  // Implemented, tested, and deliberately called by nothing — the same standing
  // `vnpay.adapter.ts` gives its own, for the same reasons. `FR-PAY-01` puts
  // `refund` on the port for every implementation, so it is kept whole rather
  // than stubbed; what does not exist is a caller. Handing money back is a staff
  // act through `folio.refund-policy` or `folio.refund-override`, performed out
  // of band, and no cancellation, no-show or early-departure path reaches this
  // method.
  async refund(input: RefundInput): Promise<RefundResult> {
    const { payments } = this.paypal();

    // The capture, asked of PayPal rather than assumed — the same round trip
    // `vnpay.adapter.ts` spends before a refund, bought here for a different
    // answer. What is needed is the rate the guest was actually charged at, and
    // `RefundInput` carries đồng and a capture id but no terms: the port is the
    // property's vocabulary and "what dollars was this taken in" is a question
    // only the gateway's own record answers.
    const taken = await payments.getCapturedPayment({
      captureId: input.gatewayTransactionId,
    });

    const terms = termsIn(taken.result.customId);

    // A capture this property cannot read its own terms off, or one opened
    // against a different attempt. Either way there is no rate to compute the
    // refund at, and today's would send back a share of what the guest paid that
    // nobody agreed to — a rate the property edited last week would make the
    // refund and the charge disagree by the whole of the edit.
    if (!terms || terms.reference !== input.reference) {
      throw new ORPCError("BAD_GATEWAY", {
        status: 502,
        message:
          "PayPal's record of that payment does not carry this attempt's terms, " +
          "so there is no rate to send the money back at",
      });
    }

    // At the frozen rate and never at today's, which is what makes a partial
    // refund the share of what the guest actually paid. A full refund computed
    // at a rate that has since moved would return more or less than was taken,
    // in dollars, out of an account the property reconciles in đồng.
    const refunding = convertVndToPresentment(
      input.amount,
      SETTLEMENT_CURRENCY,
      terms.rate,
    );

    const sent = await payments.refundCapturedPayment({
      captureId: input.gatewayTransactionId,
      body: {
        amount: {
          currencyCode: SETTLEMENT_CURRENCY,
          value: majorUnits(refunding.minorUnits),
        },
        noteToPayer: input.reason,
        // The staff account answering for this refund, on PayPal's own record of
        // it. `rbac-matrix.md` §Folio and money splits refunding within policy
        // from refunding outside it, and `FR-PAY-05` compares the property's
        // record of who asked against the gateway's — so both have to name the
        // same person. This is the refund's own `custom_id` and not the
        // capture's: the terms above belong to the attempt, and a reversal is a
        // different object with a different question to answer.
        customId: input.requestedBy,
      },
    });

    const { status, id } = sent.result;

    // `PENDING` is accepted beside `COMPLETED` because PayPal genuinely settles
    // some reversals asynchronously, and both are refunds the gateway agreed to.
    // `CANCELLED` and `FAILED` are refusals, and the port says a refund the
    // gateway refuses throws: unlike a forged callback it is a staff action that
    // failed, and there is nothing to post.
    if (status !== "COMPLETED" && status !== "PENDING") {
      throw new ORPCError("BAD_GATEWAY", {
        status: 502,
        message: `PayPal refused the refund: it reports the reversal as ${status ?? "nothing at all"}`,
      });
    }

    if (!id) {
      throw new ORPCError("BAD_GATEWAY", {
        status: 502,
        message:
          "PayPal accepted the refund without naming it, so there is nothing to " +
          "record against it",
      });
    }

    // PayPal's id for the reversal, which is not the capture's — a refund is its
    // own object here, exactly as it is a separate transaction at VNPay.
    return { gatewayRefundId: id };
  }

  async queryTransaction(attempt: PaymentAttempt): Promise<GatewayTransaction> {
    // **Reporting and not Orders, because PayPal has no lookup by the
    // property's own reference.** VNPay's `queryDr` takes `vnp_TxnRef` and
    // answers; Orders v2 answers only to an order id PayPal minted, and the
    // property never sees one after the payer's browser leaves — `PaymentAttempt`
    // carries the reference and the instant, which is all a caller can
    // reproduce. Transaction Search is the one API keyed on a window this
    // property can reconstruct, and it hands back the `custom_id` the attempt
    // was opened with, so the search is exact rather than approximate.
    //
    // The window opens at the instant the attempt was opened and closes now,
    // because a payer approves after the property asks and never before. It is
    // capped at PayPal's own limit for a single search rather than extended past
    // it — a range the API refuses returns nothing at all, which would read as
    // money that never arrived.
    const { transactions } = this.paypal();

    const found = await transactions.searchTransactions({
      startDate: attempt.createdAt.toISOString(),
      endDate: searchWindowEnd(attempt.createdAt).toISOString(),
      // Everything the port needs is in this one block — the amount, the status,
      // the capture id, the time and the `custom_id` the terms ride on — and
      // asking for the payer, the cart and the shipping would be reading a
      // guest's details to answer a question about money.
      fields: "transaction_info",
      pageSize: SEARCH_PAGE_SIZE,
      page: 1,
    });

    const reported = found.result.transactionDetails?.find((detail) => {
      const terms = termsIn(detail.transactionInfo?.customField);

      // Matched on the reference the property minted, not on the amount and not
      // on the date. A day may hold several PayPal transactions for one stay —
      // a capture and its later reversal share the window — and only the
      // reference names the attempt this caller asked about.
      return terms?.reference === attempt.reference && isACapture(detail.transactionInfo);
    })?.transactionInfo;

    // PayPal has no record of the attempt in the window it was opened in. Not
    // an error: an attempt the payer abandoned was never a transaction, and
    // `FR-PAY-05` needs to be able to tell that apart from one that failed.
    if (!reported) {
      return {
        reference: attempt.reference,
        amount: 0n,
        status: "PENDING",
      };
    }

    // What PayPal says now, whatever a callback claimed earlier — which is the
    // whole point of this method existing beside `verifyCallback`.
    const settlement = settlementIn(reported);

    // Read back and still not something this property can act on. A transaction
    // carrying no readable amount or no terms is one nobody can convert, and a
    // đồng figure invented for it would be the first place money in this
    // codebase stopped being derived from what was actually charged. Refused
    // here and merely skipped in {@link PaypalAdapter.settledBetween}, and the
    // asymmetry is the question each is answering: this one was asked about a
    // named attempt and has to say something true about *it*, where a day's
    // report is a list and an entry it cannot read is one that does not belong
    // in the list.
    if (!settlement) {
      throw new ORPCError("BAD_GATEWAY", {
        status: 502,
        message:
          "PayPal reported that transaction without an amount this property can " +
          "read as the dollars it was charged in",
      });
    }

    return settlement;
  }

  /**
   * Everything PayPal settled for this property inside a window, in one answer.
   *
   * **`FR-PAY-05`'s report, and PayPal is the first gateway this property has
   * that can actually produce one.** `reconciliation.job.ts` reconstructs VNPay's
   * night out of the attempts this property minted, because VNPay's merchant API
   * answers about one attempt at a time; Transaction Search is keyed on a window
   * instead, so the whole night arrives in a single call and — the part the
   * reconstruction can never reach — it includes a settlement against a
   * reference no row here names. That case is a guest charged with their folio
   * still showing the balance, and it is found only by asking the gateway what
   * it did rather than by asking it about what this property already knows.
   *
   * **The window is asked for exactly as it was handed over, and the trading day
   * is not this file's to decide.** `property-and-tariff.md` §2 rolls the
   * property's day at a configured hour that an `ADMIN` edits, and the sweep
   * reads that hour once for a whole run precisely so both sides of its
   * comparison are drawn on one boundary. A range this adapter narrowed on its
   * own would be a second reading of that rule, sitting where nothing could see
   * it disagree.
   *
   * **What is not this property's is left out rather than reported.** A merchant
   * account carries whatever else it is used for, and a refund carries the very
   * `custom_id` its capture did — so an entry with no readable terms, or one
   * stated as money going back, is not part of this report. Reporting either
   * would file a discrepancy against money that was never this night's.
   */
  async settledBetween(
    window: SettlementWindow,
  ): Promise<readonly GatewayTransaction[]> {
    const { transactions } = this.paypal();

    // Nothing can have settled in a window that has not happened yet, and
    // PayPal's reporting will not draw a range ending in the future. The
    // sweep's range deliberately runs a day past the business date — a coarse
    // bound around a rollover hour it will apply itself — so the ordinary
    // nightly call has an end this trims.
    const until = new Date(Math.min(window.until.getTime(), Date.now()));

    if (until.getTime() <= window.from.getTime()) {
      return [];
    }

    const found = await transactions.searchTransactions({
      startDate: window.from.toISOString(),
      endDate: until.toISOString(),
      // The same one block `queryTransaction` asks for, and for its reason:
      // everything the port needs is in it, and the payer, the cart and the
      // shipping are a guest's details being read to answer a question about
      // money.
      fields: "transaction_info",
      pageSize: SEARCH_PAGE_SIZE,
      page: 1,
    });

    const details = found.result.transactionDetails ?? [];

    // A full page is a report this property cannot prove is the whole night, and
    // an incomplete report is worse than none: every settlement past the ceiling
    // reads at the comparison as a payment the gateway does not account for, so
    // the property would be paged about money that is sitting safely at PayPal.
    // Refused instead, which leaves the day with no run row and outstanding —
    // the same standing the sweep gives a gateway it could not reach, and the
    // next tick tries again. `SEARCH_PAGE_SIZE` is PayPal's own ceiling for one
    // page and a property of this size settles a few dozen a day; a property
    // that outgrows it needs this call to page, and will find out here rather
    // than by quietly reconciling three quarters of a night.
    if (details.length >= SEARCH_PAGE_SIZE) {
      throw new ORPCError("BAD_GATEWAY", {
        status: 502,
        message:
          `PayPal filled a whole page of ${SEARCH_PAGE_SIZE} transactions for ` +
          "that window, so what came back cannot be read as the whole of it",
      });
    }

    return details.flatMap((detail) => {
      const info = detail.transactionInfo;

      // Money going back, which shares its capture's terms and would otherwise
      // be matched as the payment. PayPal states a refund as a negative figure,
      // which is what tells the two apart without this file learning an
      // event-code table.
      if (!isACapture(info)) {
        return [];
      }

      const settlement = settlementIn(info);

      return settlement ? [settlement] : [];
    });
  }

  /**
   * PayPal's own answer to a question this property asks over plain HTTP.
   *
   * One call and one shape, because there is exactly one such question: the SDK
   * has no webhook verifier, and `FR-PAY-02` forbids writing one. The bearer
   * token is minted by the SDK's own credentials manager rather than by a Basic
   * header assembled here — the client already holds the pair and already knows
   * when a token has expired, and a second implementation of that would be a
   * second place credentials are handled.
   *
   * A transport failure throws rather than answering `{ verified: false }`, and
   * the difference matters: PayPal redelivers an event it did not get a `2xx`
   * for, so a `502` while PayPal is unreachable is a payment that arrives on the
   * retry. Answered as unverified, the same outage would discard real money
   * silently and PayPal would consider the event delivered.
   */
  private async ask(
    apiHost: string,
    path: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    let answer: Response;

    try {
      answer = await fetch(`${apiHost}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${await this.accessToken()}`,
        },
        body: JSON.stringify(body),
      });
    } catch (cause) {
      throw new ORPCError("BAD_GATEWAY", {
        status: 502,
        message: "PayPal could not be reached to say whether that event is its own",
        cause,
      });
    }

    if (!answer.ok) {
      throw new ORPCError("BAD_GATEWAY", {
        status: 502,
        message: `PayPal refused to say whether that event is its own: ${answer.status}`,
      });
    }

    return await answer.json();
  }

  /** A bearer token, minted and refreshed by the SDK's credentials manager. */
  private async accessToken(): Promise<string> {
    const { client } = this.paypal();

    return (await client.clientCredentialsAuthManager.fetchToken()).accessToken;
  }

  /**
   * The configured client and the controllers over it, built once.
   *
   * All three variables are required together, and the webhook id is one of
   * them: a deployment that could open an order but not verify what PayPal said
   * about it would take payments it then refused to believe in. `config/env.ts`
   * explains who a mandatory credential would stop and why the refusal is
   * deferred to here instead of raised at the boot.
   */
  private paypal(): {
    readonly client: Client;
    readonly orders: OrdersController;
    readonly payments: PaymentsController;
    readonly transactions: TransactionSearchController;
    readonly apiHost: string;
    readonly webhookId: string;
  } {
    const oAuthClientId = this.env.PAYPAL_CLIENT_ID;
    const oAuthClientSecret = this.env.PAYPAL_CLIENT_SECRET;
    const webhookId = this.env.PAYPAL_WEBHOOK_ID;

    // The same three variables {@link paypalIsConfigured} answers over, read one
    // at a time here because each has to narrow to a string for the client
    // below — which is the one thing a boolean cannot do, and the whole reason
    // this is a second expression over the same rule rather than a call.
    if (!oAuthClientId || !oAuthClientSecret || !webhookId) {
      throw new ORPCError("SERVICE_UNAVAILABLE", {
        status: 503,
        message:
          "PayPal is not configured — set PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET " +
          "and PAYPAL_WEBHOOK_ID",
      });
    }

    const sandbox = this.env.PAYPAL_SANDBOX;

    this.client ??= new Client({
      clientCredentialsAuthCredentials: { oAuthClientId, oAuthClientSecret },
      environment: sandbox ? Environment.Sandbox : Environment.Production,
    });

    return {
      client: this.client,
      // Rebuilt per call rather than cached beside the client, and they cost
      // nothing to build: a controller is a thin binding over the client's
      // request factory with no connection and no state of its own. What is
      // cached is the thing that holds the credentials and the access token,
      // which is the client.
      orders: new OrdersController(this.client),
      payments: new PaymentsController(this.client),
      transactions: new TransactionSearchController(this.client),
      apiHost: sandbox ? PAYPAL_API_SANDBOX_HOST : PAYPAL_API_PRODUCTION_HOST,
      webhookId,
    };
  }
}

/** PayPal's reporting codes for money that moved, and money that may yet. */
const REPORTED_SUCCESS = "S";

const REPORTED_PENDING = "P";

/**
 * How many transactions one search asks for.
 *
 * PayPal's ceiling for a page, taken whole because the alternative is paging: a
 * busy day at a property this size is a few dozen PayPal transactions and a
 * single page covers it, while a loop over pages would spend several round trips
 * on every attempt `FR-PAY-05` reconciles in order to find one row.
 */
const SEARCH_PAGE_SIZE = 500;

/**
 * The far end of the window a transaction is looked for in.
 *
 * Now, unless the attempt is older than PayPal's own limit for one search — the
 * API refuses a wider range outright, and a refusal reads at the caller as an
 * attempt PayPal has no record of, which is money reported missing that is
 * sitting safely at the gateway.
 */
function searchWindowEnd(openedAt: Date): Date {
  const now = Date.now();
  const capped = openedAt.getTime() + LONGEST_SEARCH_WINDOW_MS;

  // A second past the start, for the attempt opened this instant: PayPal refuses
  // a window that ends where it began, and an empty range would report a payment
  // nobody has had time to make as one that failed.
  return new Date(Math.max(Math.min(now, capped), openedAt.getTime() + 1000));
}

/** Thirty-one days, which is the widest single search PayPal's reporting takes. */
const LONGEST_SEARCH_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;

/**
 * The attempt's terms as one string, for the field PayPal echoes back.
 *
 * The rate travels with the reference because nothing else carries it. PayPal
 * holds no configuration of the property's and offers no lookup by a merchant's
 * reference, so an event arriving hours later would otherwise state dollars and
 * leave every đồng figure to be re-derived at whatever rate the property happens
 * to hold *then* — which is the drift `money.ts` freezes a rate onto the payment
 * to prevent, arriving through the one door the row does not cover.
 */
function termsFor(reference: string, rate: FxRate): string {
  return `${reference}${TERMS_SEPARATOR}${rate}`;
}

/** The same pair read back, or nothing if the field is not this property's. */
function termsIn(
  customId: string | undefined,
): { readonly reference: string; readonly rate: FxRate } | undefined {
  const [reference, quoted, ...rest] =
    customId?.split(TERMS_SEPARATOR) ?? [];

  // Validated through the schema `money.ts` declares rather than by a test
  // written here, so that what counts as a rate is decided in one place. A third
  // segment is not this property's format at all: the separator appears in
  // neither half by construction, so a string carrying two of them was written
  // by something else.
  const rate = fxRateSchema.safeParse(quoted);

  if (!reference || rest.length > 0 || !rate.success) {
    return undefined;
  }

  return { reference, rate: rate.data };
}

/**
 * The transmission headers and the event, pulled out of the opaque record the
 * controller hands over.
 *
 * **Two keys and not one flattened map**, because the halves arrive from
 * different places and only one of them is the sender's. Headers come off the
 * request and the event is the body a stranger posted; merged into one record, a
 * body carrying a field named `paypal-transmission-sig` would be indistinguishable
 * from the header of the same name — the forger supplying the very value the
 * verification is meant to check. Nested, a body field named `headers` lands
 * inside `event` where it belongs and touches nothing.
 *
 * `payment-gateway.port.ts` argues why this record is untyped and why the route
 * rather than the port is what knows these headers exist: a callback route
 * speaks its own gateway's protocol, so the controller that receives a PayPal
 * delivery is the one that puts it where this adapter will look.
 *
 * A missing header is `undefined` here and `{ verified: false }` at the caller —
 * never a throw. `FR-PAY-03` leaves these routes unguarded, so a request with no
 * transmission headers is a crawler, not an incident.
 */
function deliveryIn(callback: Record<string, unknown>): {
  readonly headers: Record<string, string>;
  readonly event: Record<string, unknown>;
} | undefined {
  const delivered = asRecord(callback.headers);
  const event = asRecord(callback.event);

  if (!delivered || !event) {
    return undefined;
  }

  const headers: Record<string, string> = {};

  for (const [field, header] of Object.entries(TRANSMISSION_HEADERS)) {
    const value = delivered[header];

    if (typeof value !== "string" || value === "") {
      return undefined;
    }

    headers[field] = value;
  }

  return { headers, event };
}

/** What PayPal answered about the signature. Anything unreadable is not `SUCCESS`. */
function verificationStatusIn(answer: unknown): string | undefined {
  const status = asRecord(answer)?.verification_status;

  return typeof status === "string" ? status : undefined;
}

/**
 * What a verified event says about the attempt it names.
 *
 * Reached only once PayPal has said the event is its own, so nothing here is
 * defending against a forgery — what it is defending against is an authentic
 * event this property has no attempt for, and an authentic one it cannot read
 * as money. Both are answered `{ verified: false }`, the way
 * `vnpay.adapter.ts` answers a correctly signed callback whose amount is not a
 * whole đồng: the signature held and the claim is still not one this property
 * can post.
 */
function theTransactionIn(event: Record<string, unknown>): CallbackVerification {
  const resource = asRecord(event.resource);
  const charged = chargeIn(resource);

  if (!charged) {
    return { verified: false };
  }

  const { reference, presentment } = charged;
  const amount = convertPresentmentToVnd(presentment);
  const eventType = event.event_type;

  if (eventType !== CAPTURE_COMPLETED) {
    return {
      verified: true,
      transaction: {
        reference,
        amount,
        presentment,
        // Everything that is not a completed capture is either money refused or
        // an attempt still in flight. A denial and a reversal are named, and the
        // remainder — an approved order the payer has not been charged for, an
        // event type PayPal added after this was written — is reported as still
        // open, because the payer may yet finish and a `FAILED` row would close
        // an attempt that is not over.
        status:
          eventType === CAPTURE_DENIED || eventType === CAPTURE_REVERSED
            ? "FAILED"
            : "PENDING",
      },
    };
  }

  const gatewayTransactionId = resource?.id;
  const paidAt = instantFrom(resource?.create_time);

  // A capture PayPal says completed, without naming it or dating it. There is no
  // shape of `GatewayTransaction` for that and there should not be: `FR-PAY-03`
  // keys idempotency on the id, so a success with no id is a payment that could
  // be posted twice, and one with no time would have to be dated from this
  // process's clock.
  if (typeof gatewayTransactionId !== "string" || !paidAt) {
    return { verified: false };
  }

  return {
    verified: true,
    transaction: {
      status: "SUCCESS",
      reference,
      amount,
      presentment,
      gatewayTransactionId,
      paidAt,
    },
  };
}

/**
 * The reference and the dollars out of an event's resource, whichever of the two
 * shapes it arrived in.
 *
 * A capture states its amount and `custom_id` at the top; an order states them
 * on its first purchase unit. Both are read because the events worth acting on
 * are captures and the one worth reporting as still open — an order the payer
 * approved and nobody captured — is an order.
 *
 * The first purchase unit and not a search across them: this property opens one
 * unit per attempt, because a folio is one account and a payment is one debt
 * against it.
 */
function chargeIn(resource: Record<string, unknown> | undefined):
  | { readonly reference: string; readonly presentment: Presentment }
  | undefined {
  const unit = asRecord(asArray(resource?.purchase_units)?.[0]);
  const stated = unit ?? resource;
  const terms = termsIn(
    typeof stated?.custom_id === "string" ? stated.custom_id : undefined,
  );
  const presentment = presentmentOf(moneyIn(stated?.amount), terms?.rate);

  return terms && presentment
    ? { reference: terms.reference, presentment }
    : undefined;
}

/** PayPal's `{ currency_code, value }`, as the SDK's own camel-cased shape. */
function moneyIn(
  amount: unknown,
): { currencyCode?: string; value?: string } | undefined {
  const stated = asRecord(amount);

  return stated
    ? {
        currencyCode:
          typeof stated.currency_code === "string"
            ? stated.currency_code
            : undefined,
        value: typeof stated.value === "string" ? stated.value : undefined,
      }
    : undefined;
}

/**
 * A figure PayPal stated, as the record of a charge — or nothing, if it is not
 * one this property can hold to.
 *
 * The currency is checked rather than assumed, and the check is not ceremony: a
 * merchant account may take several, and a figure in euros converted at the đồng
 * rate for dollars would be a folio line wrong by a fifth with nothing anywhere
 * saying so.
 */
function presentmentOf(
  stated: { currencyCode?: string; value?: string } | undefined,
  rate: FxRate | undefined,
): Presentment | undefined {
  if (!rate || stated?.currencyCode !== SETTLEMENT_CURRENCY) {
    return undefined;
  }

  const minorUnits = minorUnitsIn(stated.value);

  return minorUnits === undefined
    ? undefined
    : { currency: SETTLEMENT_CURRENCY, minorUnits, rate };
}

/**
 * PayPal's decimal text as cents.
 *
 * Parsed digit by digit and never through a `Number`, which is the same refusal
 * `money.ts` makes about rates: `72.45` is a value a double cannot hold exactly,
 * and a hundredth of a dollar lost per payment is the discrepancy `FR-PAY-05`
 * surfaces a month later as a day that will not reconcile.
 */
function minorUnitsIn(value: string | undefined): PresentmentMinorUnits | undefined {
  if (value === undefined || !/^\d+(\.\d{1,2})?$/.test(value)) {
    return undefined;
  }

  const [major, minor = ""] = value.split(".");

  return (
    BigInt(major as string) * MINOR_UNITS_PER_MAJOR +
    BigInt(minor.padEnd(2, "0"))
  );
}

/** The reverse: cents as the major-unit decimal PayPal states amounts in. */
function majorUnits(minorUnits: PresentmentMinorUnits): string {
  const major = minorUnits / MINOR_UNITS_PER_MAJOR;
  const minor = minorUnits % MINOR_UNITS_PER_MAJOR;

  return `${major}.${String(minor).padStart(2, "0")}`;
}

/**
 * An instant PayPal stamped, by PayPal's clock and never by this process's.
 *
 * PayPal writes RFC 3339 with an explicit zone, so unlike VNPay's bare fourteen
 * digits there is nothing to interpret through the property's timezone — the
 * string names a moment on its own. What is checked is that it names one at all:
 * `Date` answers `Invalid Date` rather than throwing, and an unchecked one would
 * become a `NaN` timestamp on a payment row.
 */
function instantFrom(reported: unknown): Date | undefined {
  if (typeof reported !== "string") {
    return undefined;
  }

  const instant = new Date(reported);

  return Number.isNaN(instant.getTime()) ? undefined : instant;
}

/**
 * One transaction PayPal's reporting stated, as the port describes such a thing
 * — or nothing at all, where it is not one this property can hold to.
 *
 * One function for both callers, because "what did PayPal say about this money"
 * is one question however it was asked: `queryTransaction` reaches it through a
 * search for a named attempt and {@link PaypalAdapter.settledBetween} reaches it
 * through a window, and a second copy of this mapping would be a second answer
 * to the đồng a settlement is worth. What differs between them is only what an
 * unreadable entry means, which is why the refusal is at each caller and not
 * here.
 *
 * **The reference comes off the terms and never off the caller's question.** The
 * window's caller has no attempt in hand to name — the whole point of asking for
 * a day is the settlements this property has no row for — and `custom_id` is the
 * one field carrying a reference this property minted. The rate rides beside it
 * for the reason the header gives: PayPal holds no configuration of the
 * property's, so a report read at any other rate would be read at whatever the
 * property happens to hold now rather than at what the guest was charged at.
 *
 * A success still needs an id and a time, and `FR-PAY-03` and `FR-PAY-05` are
 * why: idempotency is keyed on the id, and a payment dated from this process's
 * clock is exactly the drift the nightly comparison exists to catch. `P` is
 * PayPal's pending; `D` and `V` are a denial and a reversal, and both are money
 * the property does not have.
 */
function settlementIn(
  info:
    | {
        customField?: string;
        transactionAmount?: { currencyCode?: string; value?: string };
        transactionStatus?: string;
        transactionId?: string;
        transactionInitiationDate?: unknown;
      }
    | undefined,
): GatewayTransaction | undefined {
  const terms = termsIn(info?.customField);
  const presentment = presentmentOf(info?.transactionAmount, terms?.rate);

  if (!terms || !presentment) {
    return undefined;
  }

  const paidAt = instantFrom(info?.transactionInitiationDate);
  const status = info?.transactionStatus;
  // Advisory đồng, as the port says at length: this is the adapter converting
  // its own cents at the frozen rate, and `FR-PAY-05` compares the cents.
  const amount = convertPresentmentToVnd(presentment);

  if (status === REPORTED_SUCCESS && info?.transactionId && paidAt) {
    return {
      status: "SUCCESS",
      reference: terms.reference,
      amount,
      presentment,
      gatewayTransactionId: info.transactionId,
      paidAt,
    };
  }

  return {
    reference: terms.reference,
    amount,
    presentment,
    // A completed transaction PayPal could not name or date is reported as still
    // open rather than as taken, for the reason above.
    status:
      status === REPORTED_SUCCESS || status === REPORTED_PENDING
        ? "PENDING"
        : "FAILED",
  };
}

/**
 * Whether a reported transaction is money coming in rather than going back.
 *
 * A refund shares the attempt's `custom_id` — it is the same purchase seen from
 * the other side — so a search matched on the reference alone would sometimes
 * answer with the reversal and report a payment as a negative amount. PayPal
 * states a refund as a negative figure, which is the one field that tells them
 * apart without this file learning its event-code table.
 */
function isACapture(
  info: { transactionAmount?: { value?: string } } | undefined,
): boolean {
  return !info?.transactionAmount?.value?.startsWith("-");
}

/** A value that is an object, for reading a payload nobody has validated. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** The same, for a list. */
function asArray(value: unknown): readonly unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}
