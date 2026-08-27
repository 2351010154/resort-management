// The adapter, against events and answers built the way PayPal builds them.
//
// **What is replaced here is different from what `vnpay.adapter.spec.ts`
// replaces, and the difference is the whole of `FR-PAY-02` for this gateway.**
// That file stubs the transport and lets the library sign, because VNPay's
// authentication is a checksum the library computes and an adapter can get
// wrong. PayPal's is not: the SDK ships no verifier at all, so the property asks
// PayPal itself over `/v1/notifications/verify-webhook-signature` and the answer
// is a word. There is no signature for this suite to compute, no secret for it
// to hold, and nothing for it to sign — which is precisely the claim the last
// case in this file makes by reading the shipped source.
//
// So the two boundaries stubbed are the two the adapter actually owns: the
// `fetch` that asks PayPal whether an event is its own, and the SDK's
// controllers, whose arguments are the request PayPal would receive. The SDK's
// serialisation and its transport are the maintained library's business, exactly
// as the checksum is on the other side of the module.
//
// **The credentials are this file's own and are not credentials.** They name a
// merchant that does not exist, no token is minted, and nothing here reaches the
// network — the credentials manager is stubbed for the same reason the
// controllers are.
//
// The rate below is not a mid-market figure anybody agreed to either. It carries
// a fraction on purpose: a rate with a decimal is what catches an implementation
// that rounded through a double, and `money.ts` puts a rate on text rather than
// on a number for that reason.

import "reflect-metadata";

import { ORPCError } from "@orpc/nest";
import {
  ClientCredentialsAuthManager,
  type OAuthToken,
  OrdersController,
  PaymentsController,
  TransactionSearchController,
} from "@paypal/paypal-server-sdk";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Env, parseEnv } from "../../config/env.js";
import { PaypalAdapter } from "./paypal.adapter.js";

/** Everything a boot needs besides the variables under test. */
const BASE = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://mariva@localhost:5432/mariva",
  BETTER_AUTH_SECRET: "guest-realm-secret-of-quite-sufficient-length",
  STAFF_JWT_SECRET: "staff-realm-secret-that-differs-and-is-long",
} as const;

const CLIENT_ID = "a-merchant-this-file-owns-and-paypal-has-never-issued";

const CLIENT_SECRET = "a-secret-of-the-same-standing";

const WEBHOOK_ID = "1JE4291016473214C";

/** A reference in the shape `payment.service.ts` mints: hex, and only hex. */
const REFERENCE = `7f1c4d2a9b604e188a352c6d0f9e1b47${"0123456789abcdef".repeat(2)}`;

/**
 * The rate the attempt was frozen at, and the only rate any figure below is
 * converted through.
 *
 * A fraction, because a whole number would let a conversion that went through a
 * double pass by luck. `money.ts` divides a rate into an exact numerator and
 * denominator precisely so that the tenth here survives.
 */
const RATE = "26150.5";

/**
 * What the property opened the attempt for, and what PayPal is therefore asked
 * to collect: 1,200,000 đồng ÷ 26,150.5 is 45.8858…, half-up to $45.89.
 *
 * Written out rather than computed by calling the same function the adapter
 * calls, which would only prove the adapter agrees with itself. These are the
 * figures a payer sees and the folio records, and they are held still here.
 */
const AMOUNT = 1_200_000n;

const CHARGED = "45.89";

/**
 * The same $45.89 read back into đồng, which is **not** the amount above.
 *
 * A cent is worth roughly 250 đồng, so converting out and back lands a little
 * away from where it started — `money.ts` says so outright and declines to
 * pretend otherwise. 4,589 × 26,150.5 ÷ 100 is 1,200,046.945, half-up to
 * 1,200,046. The gap is real money and it is the tolerance a comparison against
 * the row has to state; what must never happen is this file rounding it away to
 * make an assertion tidy.
 */
const REPORTED = 1_200_046n;

/** The terms as they ride on `custom_id` — the reference, then the rate. */
const TERMS = `${REFERENCE}@${RATE}`;

/** PayPal's id for the money it took, and the instant by PayPal's clock. */
const CAPTURE_ID = "3C679366HH908993F";

const CAPTURED_AT = "2027-11-02T09:12:41Z";

const ATTEMPT = {
  reference: REFERENCE,
  createdAt: new Date("2027-11-02T02:10:00Z"),
} as const;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("an event arriving without PayPal's transmission headers", () => {
  it("is refused without asking PayPal anything about it", async () => {
    // `FR-PAY-03` leaves the callback routes unguarded — the gateway arrives
    // with no session and the signature *is* the authentication — so anything
    // at all may be posted to them and most of what does is not a payment.
    // Refused rather than thrown, and refused before a round trip: a crawler
    // must not be able to make this property call PayPal by posting an empty
    // body to a public route.
    const asked = paypalAnswering();

    const verification = await configuredAdapter().verifyCallback({
      headers: { "content-type": "application/json" },
      event: { event_type: "PAYMENT.CAPTURE.COMPLETED" },
    });

    expect(verification).toEqual({ verified: false });
    expect(asked).toHaveLength(0);
  });
});

describe("an event PayPal declines to vouch for", () => {
  it("is refused, on PayPal's word and never on a check made here", async () => {
    // The line `FR-PAY-02` draws, from the failing side. Nothing in the adapter
    // compares a signature; it hands PayPal the headers and the body and reads
    // back a word, and `FAILURE` is a word this property acts on by doing
    // nothing at all.
    const asked = paypalAnswering({ verification_status: "FAILURE" });

    const verification = await configuredAdapter().verifyCallback(
      aDeliveryOf(anEventOf("PAYMENT.CAPTURE.COMPLETED")),
    );

    expect(verification).toEqual({ verified: false });

    // Everything PayPal needs to answer, and the event exactly as it arrived.
    // PayPal re-serialises the body to check the signature over it, so a
    // payload this adapter rebuilt or reordered would verify against nothing —
    // and that failure is indistinguishable from a forgery.
    expect(asked[0]?.body).toMatchObject({
      auth_algo: "SHA256withRSA",
      cert_url: "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
      transmission_id: "6b2f1e00-b8e6-11f0-9f0e-1d0c1b2a3e4f",
      transmission_sig: "a-signature-this-file-never-checks",
      transmission_time: CAPTURED_AT,
      webhook_id: WEBHOOK_ID,
      webhook_event: anEventOf("PAYMENT.CAPTURE.COMPLETED"),
    });
  });
});

describe("a capture PayPal vouches for", () => {
  it("is the payment, named and dated by PayPal and posted in đồng", async () => {
    paypalAnswering({ verification_status: "SUCCESS" });

    const verification = await configuredAdapter().verifyCallback(
      aDeliveryOf(anEventOf("PAYMENT.CAPTURE.COMPLETED")),
    );

    expect(verification).toEqual({
      verified: true,
      transaction: {
        status: "SUCCESS",
        reference: REFERENCE,
        // Đồng, converted at the rate the attempt was frozen at rather than at
        // whatever the property holds today — the figure rides back on
        // `custom_id`, which is the only reason a webhook arriving hours later
        // can be read at all.
        amount: REPORTED,
        // And the dollars themselves, kept beside it. `FR-PAY-05` compares a
        // settlement that arrived in dollars against the dollars frozen on the
        // attempt; the đồng above are already this adapter's conversion, so
        // checking those alone would be checking the adapter against itself.
        presentment: { currency: "USD", minorUnits: 4589n, rate: RATE },
        // `FR-PAY-03` keys idempotency on this, so it is the capture's id and
        // never the order's: an order id names an intention, and a stay may be
        // paid more than once.
        gatewayTransactionId: CAPTURE_ID,
        // PayPal's clock and never this process's, which is the drift
        // `FR-PAY-05`'s reconciliation exists to catch.
        paidAt: new Date(CAPTURED_AT),
      },
    });
  });

  it("is not a payment when PayPal denies or reverses it", async () => {
    // Money the property does not have, reported as such rather than left
    // outstanding: a denial is final and a `PENDING` row for it would keep a
    // room off sale waiting for a payer who has already been refused.
    for (const event of ["PAYMENT.CAPTURE.DENIED", "PAYMENT.CAPTURE.REVERSED"]) {
      paypalAnswering({ verification_status: "SUCCESS" });

      const verification = await configuredAdapter().verifyCallback(
        aDeliveryOf(anEventOf(event)),
      );

      expect(verification).toEqual({
        verified: true,
        transaction: {
          status: "FAILED",
          reference: REFERENCE,
          amount: REPORTED,
          presentment: { currency: "USD", minorUnits: 4589n, rate: RATE },
        },
      });

      vi.unstubAllGlobals();
    }
  });

  it("is still open when the payer approved an order nobody captured", async () => {
    // The one order event worth reporting. An approval is a payer who said yes
    // and money that has not moved, so the attempt stays outstanding — and the
    // terms are read off the purchase unit here rather than off the top of the
    // resource, which is where an order carries them.
    paypalAnswering({ verification_status: "SUCCESS" });

    const verification = await configuredAdapter().verifyCallback(
      aDeliveryOf({
        event_type: "CHECKOUT.ORDER.APPROVED",
        resource: {
          id: "5O190127TN364715T",
          status: "APPROVED",
          purchase_units: [
            { custom_id: TERMS, amount: { currency_code: "USD", value: CHARGED } },
          ],
        },
      }),
    );

    expect(verification).toEqual({
      verified: true,
      transaction: {
        status: "PENDING",
        reference: REFERENCE,
        amount: REPORTED,
        presentment: { currency: "USD", minorUnits: 4589n, rate: RATE },
      },
    });
  });

  it("is refused when the event names no attempt of this property's", async () => {
    // Authentic, and still not something this property can post. A capture
    // whose `custom_id` carries no terms names no attempt here, and there is no
    // rate to convert it at — inventing one would be the first place money in
    // this codebase stopped being derived from what was actually charged.
    // `vnpay.adapter.ts` refuses a correctly signed callback the same way when
    // its amount is not a whole đồng.
    paypalAnswering({ verification_status: "SUCCESS" });

    const verification = await configuredAdapter().verifyCallback(
      aDeliveryOf({
        event_type: "PAYMENT.CAPTURE.COMPLETED",
        resource: {
          id: CAPTURE_ID,
          custom_id: "somebody-else's-order",
          amount: { currency_code: "USD", value: CHARGED },
          create_time: CAPTURED_AT,
        },
      }),
    );

    expect(verification).toEqual({ verified: false });
  });
});

describe("opening an attempt", () => {
  it("asks PayPal for exactly what the property decided to charge", async () => {
    const orders = ordersAnswering({
      id: "5O190127TN364715T",
      status: "CREATED",
      links: [
        { href: "https://api-m.sandbox.paypal.com/v2/checkout/orders/5O1", rel: "self" },
        { href: "https://www.sandbox.paypal.com/checkoutnow?token=5O1", rel: "approve" },
      ],
    });

    const opened = await configuredAdapter().createPayment({
      ...ATTEMPT,
      amount: AMOUNT,
      description: "Mariva Resort — booking MRV-2481",
      returnUrl: "https://mariva.example/booking/MRV-2481/paid",
      payerIpAddress: "203.0.113.42",
      presentment: { currency: "USD", minorUnits: 4589n, rate: RATE },
    });

    // The relation and never a position in the list. `self` sits in the same
    // array and sending a payer there would be sending them to a JSON document.
    expect(opened).toEqual({
      paymentUrl: "https://www.sandbox.paypal.com/checkoutnow?token=5O1",
    });

    const unit = orders[0]?.body?.purchaseUnits?.[0];

    // The dollars the property froze, not a conversion made here — and the
    // attempt's terms on `custom_id`, which is what lets the webhook above
    // resolve the attempt and state the rate without reading a row.
    expect(unit?.amount).toEqual({ currencyCode: "USD", value: CHARGED });
    expect(unit?.customId).toBe(TERMS);
    expect(orders[0]?.paypalRequestId).toBe(REFERENCE);
  });

  it("is refused when the property has not said what to charge", async () => {
    // A `PAYPAL` attempt with no dollars on it is a caller that did not read
    // `settlementCurrency` — a mistake in this codebase and not in the guest's
    // request, which is why it is reported as this server's fault. Postgres
    // refuses the same shape one layer down, through
    // `payment_foreign_gateway_states_what_it_charged`.
    const orders = ordersAnswering({ id: "unreachable" });

    const refusal = await refused(
      configuredAdapter().createPayment({
        ...ATTEMPT,
        amount: AMOUNT,
        description: "Mariva Resort — booking MRV-2481",
        returnUrl: "https://mariva.example/booking/MRV-2481/paid",
        payerIpAddress: "203.0.113.42",
      }),
    );

    expect(refusal.code).toBe("INTERNAL_SERVER_ERROR");
    expect(orders).toHaveLength(0);
  });
});

describe("sending money back", () => {
  it("returns the share of what the guest actually paid, at the frozen rate", async () => {
    // Half of 1,200,000 đồng is 600,000, which at 26,150.5 is $22.94 — and the
    // rate is read off PayPal's own record of the capture rather than out of the
    // property's configuration. Today's rate would return a different number of
    // dollars from the ones the guest was charged, so a property that corrected
    // its rate on Tuesday would refund Monday's guest at Tuesday's terms.
    const refunds = paymentsAnswering(
      { id: CAPTURE_ID, status: "COMPLETED", customId: TERMS },
      { id: "1JU08902781691411", status: "COMPLETED" },
    );

    const sent = await configuredAdapter().refund({
      ...ATTEMPT,
      gatewayTransactionId: CAPTURE_ID,
      amount: 600_000n,
      reason: "Cancelled within policy",
      requestedBy: "receptionist@mariva.example",
    });

    // PayPal's id for the reversal, which is not the capture's — a refund is its
    // own object.
    expect(sent).toEqual({ gatewayRefundId: "1JU08902781691411" });

    expect(refunds[0]?.body?.amount).toEqual({
      currencyCode: "USD",
      value: "22.94",
    });

    // `rbac-matrix.md` §Folio and money splits refunding within policy from
    // refunding outside it, and `FR-PAY-05` compares the property's record of
    // who asked against PayPal's — so both have to name the same person.
    expect(refunds[0]?.body?.customId).toBe("receptionist@mariva.example");
  });

  it("refuses a capture whose terms are not this attempt's", async () => {
    // A capture id that belongs to some other attempt. There is no rate here
    // that the guest of *this* attempt was charged at, and refunding at a rate
    // read off somebody else's payment would send back an amount nobody agreed.
    const refunds = paymentsAnswering({
      id: CAPTURE_ID,
      status: "COMPLETED",
      customId: `${"ab".repeat(32)}@${RATE}`,
    });

    const refusal = await refused(
      configuredAdapter().refund({
        ...ATTEMPT,
        gatewayTransactionId: CAPTURE_ID,
        amount: 600_000n,
        reason: "Cancelled within policy",
        requestedBy: "receptionist@mariva.example",
      }),
    );

    expect(refusal.code).toBe("BAD_GATEWAY");
    // Refused before the reversal, not after it: the second call was never made.
    expect(refunds).toHaveLength(0);
  });
});

describe("asking PayPal what became of an attempt", () => {
  it("reports what PayPal says now, and finds it by the property's reference", async () => {
    // Reporting rather than Orders, because PayPal offers no lookup by a
    // merchant's own reference and the property never keeps the order id. The
    // search is still exact: the attempt's terms ride on `custom_id`, which
    // comes back on the transaction, so the match is on the reference this
    // property minted and never on an amount or a date that merely looks right.
    const searches = searchAnswering(
      { transactionInfo: { transactionId: "OTHER", customField: `${"cd".repeat(32)}@${RATE}`, transactionStatus: "S", transactionAmount: { currencyCode: "USD", value: "99.00" }, transactionInitiationDate: CAPTURED_AT } },
      // The reversal of this very attempt, sharing its `custom_id` and stated as
      // a negative figure. Money going back is not the payment, and a search
      // matched on the reference alone would answer with it.
      { transactionInfo: { transactionId: "REVERSAL", customField: TERMS, transactionStatus: "S", transactionAmount: { currencyCode: "USD", value: `-${CHARGED}` }, transactionInitiationDate: CAPTURED_AT } },
      { transactionInfo: { transactionId: CAPTURE_ID, customField: TERMS, transactionStatus: "S", transactionAmount: { currencyCode: "USD", value: CHARGED }, transactionInitiationDate: CAPTURED_AT } },
    );

    const reported = await configuredAdapter().queryTransaction(ATTEMPT);

    expect(reported).toEqual({
      status: "SUCCESS",
      reference: REFERENCE,
      amount: REPORTED,
      presentment: { currency: "USD", minorUnits: 4589n, rate: RATE },
      gatewayTransactionId: CAPTURE_ID,
      paidAt: new Date(CAPTURED_AT),
    });

    // The window opens where the attempt did, because a payer approves after
    // the property asks and never before.
    expect(searches[0]?.startDate).toBe(ATTEMPT.createdAt.toISOString());
  });

  it("reports an attempt PayPal has no record of as still open", async () => {
    // Not an error and not a failure. An attempt the payer abandoned was never
    // a transaction, and `FR-PAY-05` has to be able to tell that apart from one
    // the gateway refused.
    searchAnswering();

    const reported = await configuredAdapter().queryTransaction(ATTEMPT);

    expect(reported.status).toBe("PENDING");
    expect(reported.reference).toBe(REFERENCE);
  });

  it("refuses a window PayPal filled a whole page of rather than calling the attempt still open", async () => {
    // The window came back full, so it stopped somewhere and nobody can say
    // where. The attempt is not among what arrived, and the one thing that must
    // not follow from that is "still open": the payer may have been charged on
    // the page this property never asked for, and an attempt reported as open
    // is a folio still showing a balance the guest has already settled. Refused
    // for the same reason a night's report is, and the two searches are one call
    // so that they cannot drift apart on it.
    searchAnswering(
      ...Array.from({ length: 500 }, (_, index) => ({
        transactionInfo: {
          transactionId: `SOMEONE-ELSES-${index}`,
          customField: `${"cd".repeat(32)}@${RATE}`,
          transactionStatus: "S",
          transactionAmount: { currencyCode: "USD", value: "99.00" },
          transactionInitiationDate: CAPTURED_AT,
        },
      })),
    );

    const refusal = await refused(configuredAdapter().queryTransaction(ATTEMPT));

    expect(refusal.code).toBe("BAD_GATEWAY");
    expect(refusal.message).toContain("500");
  });
});

describe("the token a verification is made with", () => {
  it("is held between events for as long as PayPal honours it", async () => {
    // A webhook is a payment arriving, and PayPal expects an answer inside a
    // few seconds. A token round trip in front of every one of them is a second
    // call on every payment this property takes, so the token the last event was
    // answered with is kept and handed back to the credentials manager, which
    // answers with it while it is still good.
    const asked = paypalAnswering(
      { verification_status: "SUCCESS" },
      { verification_status: "SUCCESS" },
    );
    const minted = tokensAnswering(aToken("an-hour-of-life-left", 3600));
    const adapter = configuredAdapter();

    await adapter.verifyCallback(
      aDeliveryOf(anEventOf("PAYMENT.CAPTURE.COMPLETED")),
    );
    await adapter.verifyCallback(
      aDeliveryOf(anEventOf("PAYMENT.CAPTURE.COMPLETED")),
    );

    expect(asked).toHaveLength(2);
    expect(minted).toHaveLength(1);
    expect(asked[1]?.bearer).toBe("Bearer an-hour-of-life-left");
  });

  it("is minted again when the one in hand has run out", async () => {
    // The other half of holding one, and the half that would fail silently: a
    // token kept past its expiry is a `401` from PayPal on the verification
    // call, which this adapter reports as a gateway that would not answer — so
    // every webhook would be retried and no capture would ever reach a folio.
    // What decides is the expiry the SDK stamped on the token, which is why the
    // token goes back to the manager rather than being judged here.
    const asked = paypalAnswering(
      { verification_status: "SUCCESS" },
      { verification_status: "SUCCESS" },
    );
    const minted = tokensAnswering(
      aToken("spent-before-the-second-event", -120),
      aToken("minted-in-its-place", 3600),
    );
    const adapter = configuredAdapter();

    await adapter.verifyCallback(
      aDeliveryOf(anEventOf("PAYMENT.CAPTURE.COMPLETED")),
    );
    await adapter.verifyCallback(
      aDeliveryOf(anEventOf("PAYMENT.CAPTURE.COMPLETED")),
    );

    expect(minted).toHaveLength(2);
    // The second event went out under the new token and not the stale one.
    expect(asked[1]?.bearer).toBe("Bearer minted-in-its-place");
  });
});

describe("a deployment with no PayPal credentials", () => {
  it("fails at the payment and names what is missing", async () => {
    // The deferred failure `vnpay.adapter.ts` argues for, from this side. The
    // client is built on first use, so an API that mostly does other things
    // boots without merchant onboarding having finished, and the one call that
    // needed credentials says which three variables to set.
    const refusal = await refused(
      adapterWith({}).queryTransaction(ATTEMPT),
    );

    expect(refusal.code).toBe("SERVICE_UNAVAILABLE");
    expect(refusal.message).toContain("PAYPAL_CLIENT_ID");
    expect(refusal.message).toContain("PAYPAL_CLIENT_SECRET");
    expect(refusal.message).toContain("PAYPAL_WEBHOOK_ID");
  });
});

describe("the shipped adapter", () => {
  it("computes no signature and checks no certificate", async () => {
    // The assertion `FR-PAY-02` is actually about, made against the file rather
    // than against behaviour, because "did not do something" has no observable
    // trace. PayPal's SDK ships no verifier, so the temptation this guards
    // against is real and specific: fetching the certificate named in
    // `PAYPAL-CERT-URL`, rebuilding the signed string and checking it here. The
    // property asks PayPal instead, which is the one line that must stay.
    const source = readFileSync(
      fileURLToPath(new URL("./paypal.adapter.ts", import.meta.url)),
      "utf8",
    );

    for (const forbidden of [
      "createHmac",
      "createHash",
      "createVerify",
      "createSign",
      "node:crypto",
      "crc32",
    ]) {
      expect(source).not.toContain(forbidden);
    }

    expect(source).toContain("/v1/notifications/verify-webhook-signature");
  });
});

/** Configured with a merchant of this file's own, pointed at the sandbox. */
function configuredAdapter(): PaypalAdapter {
  return adapterWith({
    PAYPAL_CLIENT_ID: CLIENT_ID,
    PAYPAL_CLIENT_SECRET: CLIENT_SECRET,
    PAYPAL_WEBHOOK_ID: WEBHOOK_ID,
  });
}

function adapterWith(overrides: Record<string, string>): PaypalAdapter {
  return new PaypalAdapter(parseEnv({ ...BASE, ...overrides }) as Env);
}

/** As much of `fetch`'s second argument as the adapter fills in. */
interface SentRequest {
  readonly body?: string;
  readonly headers?: Record<string, string>;
}

/** One question this property put to PayPal over plain HTTP. */
interface Asked {
  readonly url: string;
  /** The `Authorization` header it went out under, token and all. */
  readonly bearer: string;
  readonly body: Record<string, unknown>;
}

/**
 * PayPal's answer about a signature, and a record of what it was asked.
 *
 * The verification call is the one request this adapter makes itself rather than
 * through the SDK — `FR-PAY-02` forbids a hand-rolled check and the SDK has no
 * verifier — so `fetch` is what stands in for it. The token the call carries is
 * minted by the SDK's credentials manager, which is stubbed alongside so that
 * nothing here reaches PayPal for one.
 *
 * A call the test supplied no answer for fails loudly rather than repeating the
 * last one: the adapter asks PayPal exactly once per event, and a change that
 * quietly made it chattier would otherwise pass by reading somebody else's
 * answer.
 */
function paypalAnswering(...answers: readonly Record<string, unknown>[]): Asked[] {
  const asked: Asked[] = [];

  vi.spyOn(
    ClientCredentialsAuthManager.prototype,
    "fetchToken",
  ).mockResolvedValue({
    accessToken: "a-token-this-file-invented",
    tokenType: "Bearer",
  });

  vi.stubGlobal("fetch", (url: unknown, init: SentRequest = {}) => {
    asked.push({
      url: String(url),
      bearer: init.headers?.authorization ?? "",
      body: JSON.parse(init.body ?? "{}") as Record<string, unknown>,
    });

    const answer = answers[asked.length - 1];

    if (!answer) {
      throw new Error(
        `the adapter asked PayPal ${asked.length} questions and this test supplied ${answers.length}`,
      );
    }

    return Promise.resolve(
      new Response(JSON.stringify(answer), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });

  return asked;
}

/** What the adapter asked the Orders controller for, and what it was told. */
type OrderCall = Parameters<OrdersController["createOrder"]>[0];

function ordersAnswering(order: Record<string, unknown>): OrderCall[] {
  const calls: OrderCall[] = [];

  vi.spyOn(OrdersController.prototype, "createOrder").mockImplementation(
    async (asked) => {
      calls.push(asked);

      return await Promise.resolve({ result: order } as never);
    },
  );

  return calls;
}

/** The same for the Payments controller, which a refund makes two calls to. */
type RefundCall = Parameters<PaymentsController["refundCapturedPayment"]>[0];

function paymentsAnswering(
  capture: Record<string, unknown>,
  refund?: Record<string, unknown>,
): RefundCall[] {
  const calls: RefundCall[] = [];

  vi.spyOn(PaymentsController.prototype, "getCapturedPayment").mockResolvedValue(
    { result: capture } as never,
  );

  vi.spyOn(
    PaymentsController.prototype,
    "refundCapturedPayment",
  ).mockImplementation(async (asked) => {
    calls.push(asked);

    if (!refund) {
      throw new Error(
        "the adapter reversed a capture in a case that never gets that far",
      );
    }

    return await Promise.resolve({ result: refund } as never);
  });

  return calls;
}

/** What the adapter asked the reporting API for, and what it was told. */
type SearchCall = Parameters<
  TransactionSearchController["searchTransactions"]
>[0];

function searchAnswering(
  ...found: readonly Record<string, unknown>[]
): SearchCall[] {
  const calls: SearchCall[] = [];

  vi.spyOn(
    TransactionSearchController.prototype,
    "searchTransactions",
  ).mockImplementation(async (asked) => {
    calls.push(asked);

    return await Promise.resolve({
      result: { transactionDetails: found },
    } as never);
  });

  return calls;
}

/**
 * The tokens the SDK's credentials manager mints, in order, and a record of how
 * many it was asked for.
 *
 * Installed over the stub {@link paypalAnswering} already puts on `fetchToken`,
 * because that one answers with the same token forever and these two cases turn
 * on which token came back and when. Nothing else about the manager is replaced:
 * `updateToken` is the shipped implementation, and whether it hands back the
 * held token or fetches another is exactly what is under test — a future SDK
 * that changed its mind about that would fail here rather than in production.
 *
 * A call the test supplied no token for fails loudly, for the reason the answer
 * list above gives: a run that quietly reused the last one would pass while
 * proving nothing.
 */
function tokensAnswering(...tokens: readonly OAuthToken[]): OAuthToken[] {
  const minted: OAuthToken[] = [];

  vi.spyOn(
    ClientCredentialsAuthManager.prototype,
    "fetchToken",
  ).mockImplementation(async () => {
    const token = tokens[minted.length];

    if (!token) {
      throw new Error(
        `the adapter asked for ${minted.length + 1} tokens and this test supplied ${tokens.length}`,
      );
    }

    minted.push(token);

    return await Promise.resolve(token);
  });

  return minted;
}

/**
 * A token as the credentials manager hands one over, alive for a stated number
 * of seconds.
 *
 * `expiry` is the SDK's own stamp — it writes `now + expires_in` onto the token
 * the moment it fetches one — and the SDK is what reads it back, minus the
 * clock skew the client was built with. A negative life is a token that has
 * already run out, which is the only way to hold an expired one without
 * waiting an hour for it.
 */
function aToken(accessToken: string, lasts: number): OAuthToken {
  return {
    accessToken,
    tokenType: "Bearer",
    expiresIn: BigInt(lasts),
    expiry: BigInt(Math.round(Date.now() / 1000) + lasts),
  };
}

/** A webhook event of this property's, in the shape PayPal delivers one. */
function anEventOf(eventType: string): Record<string, unknown> {
  return {
    id: "WH-2WR32451HC0233532-67976317FL4543714",
    event_type: eventType,
    resource_type: "capture",
    resource: {
      id: CAPTURE_ID,
      status: eventType === "PAYMENT.CAPTURE.COMPLETED" ? "COMPLETED" : "DECLINED",
      custom_id: TERMS,
      amount: { currency_code: "USD", value: CHARGED },
      create_time: CAPTURED_AT,
    },
  };
}

/**
 * The delivery as a controller hands it over: the headers on one side, the body
 * on the other.
 *
 * Two keys rather than one flattened map, and the adapter argues why at length —
 * merged, a body field named `paypal-transmission-sig` would be indistinguishable
 * from the header of that name, which is the forger supplying the very value the
 * verification is meant to check.
 */
function aDeliveryOf(event: Record<string, unknown>): Record<string, unknown> {
  return {
    headers: {
      "content-type": "application/json",
      "paypal-auth-algo": "SHA256withRSA",
      "paypal-cert-url":
        "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
      "paypal-transmission-id": "6b2f1e00-b8e6-11f0-9f0e-1d0c1b2a3e4f",
      "paypal-transmission-sig": "a-signature-this-file-never-checks",
      "paypal-transmission-time": CAPTURED_AT,
    },
    event,
  };
}

/** The refusal a call provoked. Fails the case if the adapter accepted it. */
async function refused(
  work: Promise<unknown>,
): Promise<ORPCError<string, unknown>> {
  try {
    await work;
  } catch (error) {
    if (error instanceof ORPCError) {
      return error;
    }

    throw error;
  }

  throw new Error("the adapter accepted a call it should have refused");
}
