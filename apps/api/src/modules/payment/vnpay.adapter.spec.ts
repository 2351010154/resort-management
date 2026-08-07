// The adapter, against signatures computed here rather than by the library.
//
// **Why the checksums below are built with `node:crypto` and not with `vnpay`.**
// A callback signed by the same library that verifies it proves only that the
// library agrees with itself: a canonicalisation that sorted parameters wrongly,
// or hashed the raw query string instead of the encoded one, would round-trip
// perfectly and fail against the real VNPay. So the fixtures are signed the way
// VNPay's specification describes — parameters sorted by name, encoded as
// `application/x-www-form-urlencoded`, HMAC-SHA512, hex — and the adapter has to
// agree with *that*. `FR-PAY-02`'s prohibition is on the shipped path computing
// its own signature, and it does not: `vnpay.adapter.ts` never touches a hash.
//
// VNPay publishes no signed example with a disclosed hash secret — its
// documentation shows the algorithm and its sandbox issues each merchant their
// own key — so there is no official vector to check against and none is invented
// here. What is asserted instead is the scheme, against a secret this file owns.
//
// The credentials are this file's own and are not credentials: `TERMINAL` and
// `HASH_SECRET` name a merchant that does not exist, and nothing here reaches
// the network.
//
// **`queryDr` and `refund` are HTTP calls, and the transport is what is
// replaced — not the signing.** `ASM-05` records that sandbox refund access is
// granted at merchant onboarding, so there is no terminal to round-trip
// against; `fetch` is stubbed instead. Everything on either side of it is real.
// The request the adapter builds is signed by the library and checked here
// against VNPay's *merchant API* checksum, which is a fixed field order joined
// with `|` and not the sorted query string the callback path uses — a different
// scheme, and one an adapter can put a parameter in the wrong slot of without
// any local test noticing. Every answer the stub gives back is signed with the
// same secret, so a fixture carrying the wrong hash is refused by the library
// exactly as a forged answer from the network would be, and the tests below say
// what the adapter does when it is.

import { parseDateTime } from "@internationalized/date";
import { PROPERTY_TIME_ZONE } from "@mariva/shared";
import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Env, parseEnv } from "../../config/env.js";
import { VnpayAdapter } from "./vnpay.adapter.js";

const TERMINAL = "MRVTEST1";
const HASH_SECRET = "a-hash-secret-this-file-owns-and-vnpay-has-never-seen";

/** Everything a boot needs besides the variables under test. */
const BASE = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://mariva@localhost:5432/mariva",
  BETTER_AUTH_SECRET: "guest-realm-secret-of-quite-sufficient-length",
  STAFF_JWT_SECRET: "staff-realm-secret-that-differs-and-is-long",
} as const;

const ATTEMPT = {
  reference: "PAY-7QX2",
  // 09:10 in Ho Chi Minh City, written as the instant it is. Chosen seven hours
  // off UTC so an implementation reading the process clock cannot pass by
  // accident on a machine that happens to run on UTC.
  createdAt: new Date("2027-11-02T02:10:00Z"),
} as const;

function adapterWith(overrides: Record<string, string>): VnpayAdapter {
  return new VnpayAdapter(parseEnv({ ...BASE, ...overrides }) as Env);
}

/** Configured for the sandbox with a terminal of this file's own. */
function configuredAdapter(): VnpayAdapter {
  return adapterWith({
    VNPAY_TMN_CODE: TERMINAL,
    VNPAY_SECRET_KEY: HASH_SECRET,
  });
}

/**
 * VNPay's checksum, as its specification describes it and not as the library
 * happens to implement it: every parameter but the hash itself, sorted by name,
 * form-encoded, HMAC-SHA512 in hex.
 */
function sign(parameters: Fields): string {
  const encoded = new URLSearchParams();

  for (const name of Object.keys(parameters).sort()) {
    encoded.append(name, String(parameters[name]));
  }

  return createHmac("sha512", HASH_SECRET)
    .update(Buffer.from(encoded.toString(), "utf-8"))
    .digest("hex");
}

/**
 * A field a VNPay message carries, or `undefined` for one it leaves out.
 *
 * Absence is a value here rather than an omission, so a fixture can say "this
 * message arrived without a pay date" in the same breath as "this one arrived
 * with the wrong one" — and both are signed over the same field set VNPay would
 * have signed, which is what makes the adapter's answer to them meaningful.
 */
type Fields = Record<string, string | number | undefined>;

/** The fields actually present, since an absent one is not signed either. */
function present(fields: Fields): Fields {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );
}

/** A callback as VNPay sends one, signed. Overrides land before signing. */
function aCallback(overrides: Fields = {}): Record<string, unknown> {
  const parameters = present({
    vnp_Amount: 25_000_000,
    vnp_BankCode: "NCB",
    vnp_BankTranNo: "VNP14528901",
    vnp_CardType: "ATM",
    vnp_OrderInfo: "Thanh toan dat phong MRV-0001",
    vnp_PayDate: 20_271_102_091_200,
    vnp_ResponseCode: "00",
    vnp_TmnCode: TERMINAL,
    vnp_TransactionNo: "14528901",
    vnp_TransactionStatus: "00",
    vnp_TxnRef: ATTEMPT.reference,
    ...overrides,
  });

  return { ...parameters, vnp_SecureHash: sign(parameters) };
}

/**
 * VNPay's *other* checksum — the one `querydr` and `refund` carry.
 *
 * Not {@link sign}. The merchant API hashes a fixed field **order**, joined with
 * `|`, and a field the message has no value for contributes an empty slot rather
 * than disappearing. So the ordering is the entire scheme: a parameter placed in
 * the wrong slot still produces a well-formed hex string, and it verifies
 * against nothing. Written out from VNPay's specification for the reason the
 * header gives — a request the library both orders and hashes agrees with itself
 * whichever order it picked.
 */
function signMerchantCall(
  fields: readonly (string | number | undefined)[],
): string {
  return createHmac("sha512", HASH_SECRET)
    .update(fields.map((field) => field ?? "").join("|"))
    .digest("hex");
}

/** One outbound call to VNPay's merchant API, as it went out. */
interface MerchantCall {
  readonly url: string;
  readonly body: Record<string, unknown>;
}

/**
 * The network, replaced by a list of answers and a record of what was asked.
 *
 * Only `fetch` is stubbed. The library still builds and signs the request, and
 * still verifies the checksum on what comes back, so the answers below have to
 * be signed the way VNPay signs them or the adapter will refuse them — which is
 * the point of several of the tests that use this.
 *
 * A call the test did not provide an answer for fails loudly rather than
 * repeating the last one. `refund` makes two calls and `queryTransaction` makes
 * one, and a change that quietly made either of them chattier would otherwise
 * pass by reading somebody else's answer.
 */
function gatewayAnswering(
  ...answers: readonly Record<string, unknown>[]
): MerchantCall[] {
  const calls: MerchantCall[] = [];

  vi.stubGlobal("fetch", (url: unknown, init: { body?: string } = {}) => {
    calls.push({
      url: String(url),
      body: JSON.parse(init.body ?? "{}") as Record<string, unknown>,
    });

    const answer = answers[calls.length - 1];

    if (!answer) {
      throw new Error(
        `the adapter made ${calls.length} gateway calls and this test supplied ${answers.length}`,
      );
    }

    return Promise.resolve(
      new Response(JSON.stringify(answer), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  return calls;
}

/** VNPay's fourteen digits, read back as the instant they name. */
function instantOf(digits: unknown): Date {
  const text = String(digits);
  const iso = `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T${text.slice(8, 10)}:${text.slice(10, 12)}:${text.slice(12, 14)}`;

  return parseDateTime(iso).toDate(PROPERTY_TIME_ZONE);
}

/** What VNPay says about a payment it took, before it is signed. */
const QUERY_ANSWER: Fields = {
  vnp_ResponseId: "9f2b7c1e4a6d48f0b3c5e7a9d1f30246",
  vnp_Command: "querydr",
  vnp_ResponseCode: "00",
  vnp_Message: "Success",
  vnp_TxnRef: ATTEMPT.reference,
  // The gateway's unit, unscaled. `queryDr` hands the amount back in hundredths
  // where `verifyReturnUrl` hands it back in đồng, and the adapter carries that
  // asymmetry so nothing above it has to.
  vnp_Amount: 25_000_000,
  vnp_BankCode: "NCB",
  vnp_PayDate: 20_271_102_091_200,
  vnp_TransactionNo: 14_528_901,
  vnp_TransactionType: "01",
  vnp_TransactionStatus: "00",
  vnp_OrderInfo: "Thanh toan dat phong MRV-0001",
};

/**
 * A `querydr` answer, signed the way VNPay signs one.
 *
 * The terminal code in the checksum is the *configured* one and never a field of
 * the answer — VNPay does not echo it here, so a merchant checking this hash is
 * checking it against the terminal it believes it is.
 */
function aQueryAnswer(overrides: Fields = {}): Record<string, unknown> {
  const answer = present({ ...QUERY_ANSWER, ...overrides });

  return {
    ...answer,
    vnp_SecureHash: signMerchantCall([
      answer.vnp_ResponseId,
      answer.vnp_Command,
      answer.vnp_ResponseCode,
      answer.vnp_Message,
      TERMINAL,
      answer.vnp_TxnRef,
      answer.vnp_Amount,
      answer.vnp_BankCode,
      answer.vnp_PayDate,
      answer.vnp_TransactionNo,
      answer.vnp_TransactionType,
      answer.vnp_TransactionStatus,
      answer.vnp_OrderInfo,
      answer.vnp_PromotionCode,
      answer.vnp_PromotionAmount,
    ]),
  };
}

/** What VNPay says about a reversal it accepted, before it is signed. */
const REFUND_ANSWER: Fields = {
  vnp_ResponseId: "1c8e5a3f7b294d60ae1f83c2b4d60597",
  vnp_Command: "refund",
  vnp_ResponseCode: "00",
  vnp_Message: "Success",
  vnp_TmnCode: TERMINAL,
  vnp_TxnRef: ATTEMPT.reference,
  vnp_Amount: 25_000_000,
  vnp_BankCode: "NCB",
  vnp_PayDate: 20_271_102_091_200,
  // Not the payment's number. VNPay opens a transaction of its own for a
  // reversal, and this is the one the property records against the money it
  // sent back.
  vnp_TransactionNo: 14_528_902,
  vnp_TransactionType: "02",
  vnp_TransactionStatus: "00",
  vnp_OrderInfo: "Cancelled within policy",
};

/**
 * A `refund` answer, signed the way `vnpay@2.5.0` checks one.
 *
 * **The amount is hashed in đồng and not in the hundredths on the wire**, which
 * is the library's canonicalisation and not VNPay's: it divides
 * `vnp_Amount` by a hundred *before* it builds the string to hash, while
 * `queryDr` beside it hashes what arrived. An answer signed the way VNPay's
 * specification reads would therefore be reported as `isVerified: false` here.
 * Signed the library's way rather than the specification's because the adapter
 * has no say in it — `FR-PAY-02` requires the maintained library do the
 * checking, and this file cannot assert a scheme the shipped path does not use.
 * The divergence is recorded against the dependency, not the adapter.
 */
function aRefundAnswer(overrides: Fields = {}): Record<string, unknown> {
  const answer = present({ ...REFUND_ANSWER, ...overrides });

  const hashedAmount =
    answer.vnp_Amount === undefined ? undefined : Number(answer.vnp_Amount) / 100;

  return {
    ...answer,
    vnp_SecureHash: signMerchantCall([
      answer.vnp_ResponseId,
      answer.vnp_Command,
      answer.vnp_ResponseCode,
      answer.vnp_Message,
      answer.vnp_TmnCode,
      answer.vnp_TxnRef,
      hashedAmount,
      answer.vnp_BankCode,
      answer.vnp_PayDate,
      answer.vnp_TransactionNo,
      answer.vnp_TransactionType,
      answer.vnp_TransactionStatus,
      answer.vnp_OrderInfo,
    ]),
  };
}

/** A whole reversal of the payment {@link QUERY_ANSWER} describes. */
const REFUND = {
  ...ATTEMPT,
  gatewayTransactionId: "14528901",
  amount: 250_000n,
  reason: "Cancelled within policy",
  requestedBy: "staff-1",
} as const;

/** Where both merchant calls go, whichever VNPay is configured. */
const MERCHANT_API_PATH = "/merchant_webapi/api/transaction";

describe("a process with no VNPay terminal", () => {
  // `config/env.ts` argues who a mandatory credential would stop: every
  // developer and every CI runner, for a suite that mostly has nothing to do
  // with taking money.
  const unconfigured = adapterWith({});

  it("boots", () => {
    expect(unconfigured).toBeInstanceOf(VnpayAdapter);
  });

  it("fails at the call, naming both variables", async () => {
    await expect(
      unconfigured.createPayment({
        ...ATTEMPT,
        amount: 250_000n,
        description: "Deposit",
        returnUrl: "https://mariva.invalid/payments/return",
        payerIpAddress: "203.0.113.4",
      }),
    ).rejects.toThrow(/VNPAY_TMN_CODE and VNPAY_SECRET_KEY/);

    await expect(unconfigured.verifyCallback(aCallback())).rejects.toThrow(
      /VNPAY_TMN_CODE and VNPAY_SECRET_KEY/,
    );

    await expect(unconfigured.queryTransaction(ATTEMPT)).rejects.toThrow(
      /VNPAY_TMN_CODE and VNPAY_SECRET_KEY/,
    );

    await expect(
      unconfigured.refund({
        ...ATTEMPT,
        gatewayTransactionId: "14528901",
        amount: 250_000n,
        reason: "Cancelled within policy",
        requestedBy: "staff-1",
      }),
    ).rejects.toThrow(/VNPAY_TMN_CODE and VNPAY_SECRET_KEY/);
  });

  it("does not answer an unconfigured callback as a forged one", async () => {
    // The distinction the `try` in `verifyCallback` is placed around. A missing
    // terminal reported as `{ verified: false }` would look exactly like a
    // forged callback, and the property would refuse every payment it took
    // while its logs said it was under attack.
    await expect(unconfigured.verifyCallback(aCallback())).rejects.toThrow();
  });
});

describe("which VNPay it talks to", () => {
  async function paymentUrlFrom(adapter: VnpayAdapter): Promise<URL> {
    const { paymentUrl } = await adapter.createPayment({
      ...ATTEMPT,
      amount: 250_000n,
      description: "Thanh toan dat phong MRV-0001",
      returnUrl: "https://mariva.invalid/payments/return",
      payerIpAddress: "203.0.113.4",
    });

    return new URL(paymentUrl);
  }

  it("sends the payer to the sandbox when configured for it", async () => {
    const url = await paymentUrlFrom(configuredAdapter());

    expect(url.origin).toBe("https://sandbox.vnpayment.vn");
    expect(url.pathname).toBe("/paymentv2/vpcpay.html");
  });

  it("sends the payer to the live gateway when it is not", async () => {
    const url = await paymentUrlFrom(
      adapterWith({
        VNPAY_TMN_CODE: TERMINAL,
        VNPAY_SECRET_KEY: HASH_SECRET,
        VNPAY_SANDBOX: "false",
      }),
    );

    expect(url.origin).toBe("https://pay.vnpay.vn");
  });

  it("defaults to the sandbox, which is the direction that takes no money", () => {
    expect(parseEnv({ ...BASE }).VNPAY_SANDBOX).toBe(true);
  });
});

describe("the address the payer is sent to", () => {
  let url: URL;

  it("is signed the way VNPay's specification describes", async () => {
    const { paymentUrl } = await configuredAdapter().createPayment({
      ...ATTEMPT,
      amount: 250_000n,
      description: "Thanh toan dat phong MRV-0001",
      returnUrl: "https://mariva.invalid/payments/return",
      payerIpAddress: "203.0.113.4",
    });

    url = new URL(paymentUrl);

    const signed: Record<string, string> = {};

    for (const [name, value] of url.searchParams) {
      if (name !== "vnp_SecureHash") {
        signed[name] = value;
      }
    }

    // Computed here, from the parameters as they arrived on the wire. A
    // signature the library both made and checked would agree with itself
    // whatever it did with the ordering or the encoding.
    expect(url.searchParams.get("vnp_SecureHash")).toBe(sign(signed));
  });

  it("carries the attempt the property will be asked about later", () => {
    expect(url.searchParams.get("vnp_TxnRef")).toBe(ATTEMPT.reference);
    expect(url.searchParams.get("vnp_TmnCode")).toBe(TERMINAL);
    expect(url.searchParams.get("vnp_ReturnUrl")).toBe(
      "https://mariva.invalid/payments/return",
    );
    expect(url.searchParams.get("vnp_IpAddr")).toBe("203.0.113.4");
  });

  it("counts in the gateway's unit, which is the adapter's business alone", () => {
    // `money.ts` forbids anything above this file to scale an amount. 250,000 ₫
    // reaches VNPay as 25,000,000 of its hundredths, and nothing outside this
    // adapter ever sees that number.
    expect(url.searchParams.get("vnp_Amount")).toBe("25000000");
  });

  it("dates the attempt in the property's zone and not the process's", () => {
    // 02:10 UTC is 09:10 in Ho Chi Minh City. A server running anywhere but UTC
    // and formatting through its own clock — which is what the library's own
    // helper does — would stamp a different hour here, and the query that later
    // asks VNPay about this attempt would name a day it has no record of.
    expect(url.searchParams.get("vnp_CreateDate")).toBe("20271102091000");
  });

  it("refuses an amount too large to reach the gateway intact", async () => {
    await expect(
      configuredAdapter().createPayment({
        ...ATTEMPT,
        amount: BigInt(Number.MAX_SAFE_INTEGER),
        description: "A figure that cannot be scaled",
        returnUrl: "https://mariva.invalid/payments/return",
        payerIpAddress: "203.0.113.4",
      }),
    ).rejects.toThrow(/losing đồng/);
  });

  it("refuses an amount that is not money to collect", async () => {
    // The other end of the same guard, and the one a caller reaches by
    // accident: a folio balance that has already been settled is zero, and a
    // credit on it is negative. Neither is a payment, and VNPay answers a
    // `vnp_Amount` of `0` with a checkout page nobody can pay — so it is
    // refused here, where the caller still has a message to act on.
    for (const amount of [0n, -1n, -250_000n]) {
      await expect(
        configuredAdapter().createPayment({
          ...ATTEMPT,
          amount,
          description: "Nothing to collect",
          returnUrl: "https://mariva.invalid/payments/return",
          payerIpAddress: "203.0.113.4",
        }),
      ).rejects.toThrow(/losing đồng/);
    }
  });
});

describe("a callback the gateway signed", () => {
  it("hands over the payment, named and dated by VNPay", async () => {
    const verification = await configuredAdapter().verifyCallback(aCallback());

    expect(verification.verified).toBe(true);

    if (!verification.verified) {
      throw new Error("the adapter refused a callback it signed itself");
    }

    const { transaction } = verification;

    expect(transaction.status).toBe("SUCCESS");
    expect(transaction.reference).toBe(ATTEMPT.reference);
    // In đồng, as a `bigint`. The 25,000,000 hundredths on the wire are the
    // gateway's unit and stop here.
    expect(transaction.amount).toBe(250_000n);

    if (transaction.status !== "SUCCESS") {
      return;
    }

    expect(transaction.gatewayTransactionId).toBe("14528901");
    // 09:12 GMT+7, which is the instant VNPay took the money and not the one
    // this process noticed.
    expect(transaction.paidAt.toISOString()).toBe("2027-11-02T02:12:00.000Z");
  });

  it("names nothing gateway-shaped past the port", async () => {
    // `FR-PAY-01`: a bank code, a card type or a response code reaching a
    // caller would make every reader downstream a reader of VNPay.
    const verification = await configuredAdapter().verifyCallback(aCallback());

    if (!verification.verified) {
      throw new Error("the adapter refused a callback it signed itself");
    }

    expect(Object.keys(verification.transaction).sort()).toEqual([
      "amount",
      "gatewayTransactionId",
      "paidAt",
      "reference",
      "status",
    ]);
  });

  it("reports a payment the gateway declined without naming one", async () => {
    // Response code 24: the payer cancelled. Verified — VNPay really said it —
    // and carrying no transaction id, because there is no payment to key
    // idempotency on and the port refuses to describe one.
    const verification = await configuredAdapter().verifyCallback(
      aCallback({ vnp_ResponseCode: "24", vnp_TransactionStatus: "02" }),
    );

    expect(verification).toEqual({
      verified: true,
      transaction: {
        status: "FAILED",
        reference: ATTEMPT.reference,
        amount: 250_000n,
      },
    });
  });

  it("reports one the payer has not finished as still open", async () => {
    const verification = await configuredAdapter().verifyCallback(
      aCallback({ vnp_ResponseCode: "00", vnp_TransactionStatus: "01" }),
    );

    expect(verification).toEqual({
      verified: true,
      transaction: {
        status: "PENDING",
        reference: ATTEMPT.reference,
        amount: 250_000n,
      },
    });
  });

  it("refuses a success the gateway did not name", async () => {
    // `FR-PAY-03` keys idempotency on the transaction id. A success without one
    // could be posted twice, so it is not treated as a success at all.
    const verification = await configuredAdapter().verifyCallback(
      aCallback({ vnp_TransactionNo: "0" }),
    );

    expect(verification).toEqual({ verified: false });
  });

  it("refuses a success the gateway did not date", async () => {
    // The other half of the same rule. A payment with no `vnp_PayDate` would
    // have to be dated from this process's clock, and `FR-PAY-05` reconciles
    // `paidAt` against VNPay's own daily report — so a stamp of our own is a
    // figure that disagrees with the gateway by however long the callback took
    // to arrive.
    for (const payDate of [
      // Absent altogether.
      undefined,
      // Thirteen digits: a stamp that lost one somewhere.
      2_027_110_209_120,
      // The right length and not a moment — there is no thirteenth month.
      "20271332091200",
      // The right length and not digits.
      "2027-11-02T09:",
    ]) {
      await expect(
        configuredAdapter().verifyCallback(aCallback({ vnp_PayDate: payDate })),
      ).resolves.toEqual({ verified: false });
    }
  });

  it("refuses a signed amount that is not a whole đồng", async () => {
    // 25,000,050 hundredths is 250,000.5 ₫. VNPay signed it, so it is not a
    // forgery — and it still cannot become a folio line without a rounding this
    // codebase forbids at every other layer. Refused here rather than made into
    // the first place money stopped being an integer.
    await expect(
      configuredAdapter().verifyCallback(aCallback({ vnp_Amount: 25_000_050 })),
    ).resolves.toEqual({ verified: false });
  });

  it("refuses a signed callback that names its attempt with a number", async () => {
    // `PaymentAttempt.reference` is the property's own id, minted as text and
    // looked up as text. A number here resolves to no attempt, and carrying it
    // past the port would turn that into a lookup that silently matched nothing
    // rather than a callback that was refused.
    await expect(
      configuredAdapter().verifyCallback(aCallback({ vnp_TxnRef: 7 })),
    ).resolves.toEqual({ verified: false });
  });
});

describe("a callback the gateway did not sign", () => {
  it("refuses one whose amount was edited after signing", async () => {
    // The attack the checksum exists for: pay 25,000 ₫ and have the property
    // credited 250,000 ₫. Every other field still matches its signature.
    const tampered = { ...aCallback(), vnp_Amount: 2_500_000 };

    await expect(
      configuredAdapter().verifyCallback(tampered),
    ).resolves.toEqual({ verified: false });
  });

  it("refuses one signed with somebody else's secret", async () => {
    const forged = {
      ...aCallback(),
      vnp_SecureHash: createHmac("sha512", "not-this-property's-secret")
        .update("vnp_Amount=25000000")
        .digest("hex"),
    };

    await expect(configuredAdapter().verifyCallback(forged)).resolves.toEqual({
      verified: false,
    });
  });

  it("refuses one with no signature at all", async () => {
    const { vnp_SecureHash: _dropped, ...unsigned } = aCallback();

    await expect(
      configuredAdapter().verifyCallback(unsigned),
    ).resolves.toEqual({ verified: false });
  });

  it("refuses whatever else was posted to an unguarded route", async () => {
    // `FR-PAY-03` leaves the callback routes open on purpose — the gateway
    // arrives with no session and the signature is the authentication — so
    // anyone may post anything. None of it may reach a caller as an exception:
    // a 500 on that route is the property telling VNPay to retry.
    for (const posted of [
      {},
      { vnp_Amount: "not a number" },
      { vnp_Amount: 1, vnp_TxnRef: 7 },
      { vnp_SecureHash: "" },
    ]) {
      await expect(
        configuredAdapter().verifyCallback(posted),
      ).resolves.toEqual({ verified: false });
    }
  });
});

describe("what the property asks VNPay about an attempt", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks the merchant API in the order VNPay signs", async () => {
    const calls = gatewayAnswering(aQueryAnswer());

    await configuredAdapter().queryTransaction(ATTEMPT);

    expect(calls).toHaveLength(1);

    const [{ url, body }] = calls;

    expect(url).toBe(`https://sandbox.vnpayment.vn${MERCHANT_API_PATH}`);

    // The attempt, named the way the caller minted it and dated the way the
    // gateway partitions it. `20271102091000` is 02:10 UTC read in Ho Chi Minh
    // City: a query stamped from the process clock on a server that is not on
    // UTC would name a day VNPay has no record of.
    expect(body.vnp_TxnRef).toBe(ATTEMPT.reference);
    expect(body.vnp_TransactionDate).toBe(20_271_102_091_000);

    // Zero is VNPay's "I do not have your number for it" — the ordinary case,
    // since the property is asking what became of a reference it minted.
    expect(body.vnp_TransactionNo).toBe(0);

    // This process talking about itself over a connection whose source address
    // it does not choose. The payer's address belongs on `createPayment` and
    // nowhere near here.
    expect(body.vnp_IpAddr).toBe("127.0.0.1");

    // Stamped now, in the property's zone. Seven hours is what a UTC stamp
    // would be out by, so a minute of tolerance separates the two without
    // making this test depend on how long the call took.
    expect(Math.abs(instantOf(body.vnp_CreateDate).getTime() - Date.now())).
      toBeLessThan(60_000);

    // And the checksum over exactly those fields, in VNPay's order, computed
    // here rather than by the library that built it.
    expect(body.vnp_SecureHash).toBe(
      signMerchantCall([
        body.vnp_RequestId as string,
        body.vnp_Version as string,
        "querydr",
        TERMINAL,
        body.vnp_TxnRef as string,
        body.vnp_TransactionDate as number,
        body.vnp_CreateDate as number,
        body.vnp_IpAddr as string,
        body.vnp_OrderInfo as string,
      ]),
    );
  });

  it("names each request once, within VNPay's thirty-two characters", async () => {
    const calls = gatewayAnswering(aQueryAnswer(), aQueryAnswer());
    const adapter = configuredAdapter();

    await adapter.queryTransaction(ATTEMPT);
    await adapter.queryTransaction(ATTEMPT);

    const [first, second] = calls.map((call) => String(call.body.vnp_RequestId));

    // VNPay requires the id be unique within a day and caps it at thirty-two
    // characters. A counter would have to survive restarts and second
    // instances; a uuid with its hyphens removed is exactly thirty-two and
    // needs neither.
    expect(first).toMatch(/^[\da-f]{32}$/);
    expect(second).toMatch(/^[\da-f]{32}$/);
    expect(first).not.toBe(second);
  });

  it("sends the merchant calls to the same VNPay as the payer", async () => {
    // The library defaults `queryDrAndRefundHost` to the sandbox independently
    // of `vnpayHost`, so a production deploy that set only the payment host
    // would take real money and then query the sandbox about it — and be told
    // the transaction does not exist.
    const calls = gatewayAnswering(aQueryAnswer());

    await adapterWith({
      VNPAY_TMN_CODE: TERMINAL,
      VNPAY_SECRET_KEY: HASH_SECRET,
      VNPAY_SANDBOX: "false",
    }).queryTransaction(ATTEMPT);

    expect(calls[0].url).toBe(`https://pay.vnpay.vn${MERCHANT_API_PATH}`);
  });

  it("reports a payment VNPay says it took, in đồng", async () => {
    gatewayAnswering(aQueryAnswer());

    await expect(
      configuredAdapter().queryTransaction(ATTEMPT),
    ).resolves.toEqual({
      status: "SUCCESS",
      reference: ATTEMPT.reference,
      // 25,000,000 hundredths, divided here because `queryDr` — unlike
      // `verifyReturnUrl` — hands back the gateway's own unit.
      amount: 250_000n,
      gatewayTransactionId: "14528901",
      paidAt: new Date("2027-11-02T02:12:00Z"),
    });
  });

  it("refuses an answer that did not carry VNPay's signature", async () => {
    // The reason this path exists: `queryDr` is an ordinary HTTPS POST to a
    // host named in configuration, and whatever answers it is only VNPay if the
    // checksum says so. An unverified answer taken at face value would be a
    // refund sent against a payment nobody made.
    gatewayAnswering({
      ...aQueryAnswer(),
      vnp_SecureHash: createHmac("sha512", "not-this-property's-secret")
        .update("vnp_ResponseCode=00")
        .digest("hex"),
    });

    await expect(
      configuredAdapter().queryTransaction(ATTEMPT),
    ).rejects.toThrow(/not VNPay's answer/);
  });

  it("refuses an answer VNPay declined to give", async () => {
    // `91` is VNPay's "no transaction found". Not a failed payment — a question
    // the gateway would not answer — so there is no `GatewayTransaction` to
    // return and the caller is told rather than handed a `FAILED` it would
    // record as a refusal.
    gatewayAnswering(aQueryAnswer({ vnp_ResponseCode: "91" }));

    await expect(
      configuredAdapter().queryTransaction(ATTEMPT),
    ).rejects.toThrow(/could not answer for that transaction/);
  });

  it("refuses an amount that is not a whole đồng", async () => {
    // 25,000,050 hundredths is 250,000.5 ₫. Signed by VNPay and still not
    // postable, for the reason the callback path gives.
    gatewayAnswering(aQueryAnswer({ vnp_Amount: 25_000_050 }));

    await expect(
      configuredAdapter().queryTransaction(ATTEMPT),
    ).rejects.toThrow(/not a whole đồng/);
  });

  it("reports a completed payment VNPay could not name as still open", async () => {
    // `FR-PAY-03` keys idempotency on the transaction id, so `00` without one
    // is not a payment this property can post. Reported as open rather than
    // taken — the same judgement `verifyCallback` makes, and the amount and the
    // reference still come back so a caller can say which attempt it is about.
    gatewayAnswering(aQueryAnswer({ vnp_TransactionNo: undefined }));

    await expect(
      configuredAdapter().queryTransaction(ATTEMPT),
    ).resolves.toEqual({
      status: "PENDING",
      reference: ATTEMPT.reference,
      amount: 250_000n,
    });
  });

  it("reports a payment the payer has not finished as still open", async () => {
    gatewayAnswering(aQueryAnswer({ vnp_TransactionStatus: "01" }));

    await expect(
      configuredAdapter().queryTransaction(ATTEMPT),
    ).resolves.toEqual({
      status: "PENDING",
      reference: ATTEMPT.reference,
      amount: 250_000n,
    });
  });

  it("reports a payment the gateway refused as failed", async () => {
    // `02` is VNPay's "transaction failed". The request succeeded — `queryDr`
    // answered `00` — and the payment did not, which is the pair the adapter
    // reads and the library's `isSuccess` alone does not.
    gatewayAnswering(aQueryAnswer({ vnp_TransactionStatus: "02" }));

    await expect(
      configuredAdapter().queryTransaction(ATTEMPT),
    ).resolves.toEqual({
      status: "FAILED",
      reference: ATTEMPT.reference,
      amount: 250_000n,
    });
  });
});

describe("sending a payment back", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refuses a payment VNPay never numbered, before asking anything", async () => {
    // VNPay numbers its transactions, and the field beside it in a callback —
    // `vnp_BankTranNo` — does not. A caller that stored the wrong one is a bug
    // in the caller, and it is refused here rather than sent to the gateway as
    // a `NaN` VNPay would answer with something unhelpful.
    const calls = gatewayAnswering();

    for (const gatewayTransactionId of [
      "VNP14528901",
      "14528901.5",
      // Past the exact range: VNPay's number would be truncated on the way in,
      // and the refund would name a transaction one off the one that was paid.
      "9007199254740993",
    ]) {
      await expect(
        configuredAdapter().refund({ ...REFUND, gatewayTransactionId }),
      ).rejects.toThrow(/VNPay numbers its transactions/);
    }

    expect(calls).toEqual([]);
  });

  it("asks what was taken before sending any of it back", async () => {
    // `RefundInput` carries what to hand back and not what was collected —
    // deliberately, since "which of VNPay's two refund codes applies" is not a
    // question the folio has an opinion about. One round trip buys the answer.
    const calls = gatewayAnswering(aQueryAnswer(), aRefundAnswer());

    await expect(configuredAdapter().refund(REFUND)).resolves.toEqual({
      gatewayRefundId: "14528902",
    });

    expect(calls).toHaveLength(2);
    expect(calls[0].body.vnp_Command).toBe("querydr");
    expect(calls[1].body.vnp_Command).toBe("refund");
  });

  it("asks for the whole payment back in the order VNPay signs", async () => {
    const calls = gatewayAnswering(aQueryAnswer(), aRefundAnswer());

    await configuredAdapter().refund(REFUND);

    const { body } = calls[1];

    // `02` is VNPay's full reversal. The amount asked for equals the amount the
    // query said was taken, and guessing that instead of asking would buy a
    // refund the gateway rejects on a guest who has been told it is done.
    expect(body.vnp_TransactionType).toBe("02");

    // The gateway's unit once more, and the only place in this codebase where
    // an amount is scaled at all: 250,000 ₫ leaves as 25,000,000.
    expect(body.vnp_Amount).toBe(25_000_000);

    // A number, because that is what VNPay's field is — the string the port
    // carries is the property's, and the conversion is this adapter's.
    expect(body.vnp_TransactionNo).toBe(14_528_901);

    // The instant the *attempt* was opened, which is how VNPay finds the
    // transaction — not the instant of this request, which is stamped
    // separately below it.
    expect(body.vnp_TransactionDate).toBe(20_271_102_091_000);
    expect(Math.abs(instantOf(body.vnp_CreateDate).getTime() - Date.now())).
      toBeLessThan(60_000);

    // `FR-PAY-05` compares the property's record of who asked with VNPay's, so
    // both have to name the same person.
    expect(body.vnp_CreateBy).toBe("staff-1");
    expect(body.vnp_OrderInfo).toBe("Cancelled within policy");
    expect(body.vnp_IpAddr).toBe("127.0.0.1");

    expect(body.vnp_SecureHash).toBe(
      signMerchantCall([
        body.vnp_RequestId as string,
        body.vnp_Version as string,
        "refund",
        TERMINAL,
        body.vnp_TransactionType as string,
        body.vnp_TxnRef as string,
        body.vnp_Amount as number,
        body.vnp_TransactionNo as number,
        body.vnp_TransactionDate as number,
        body.vnp_CreateBy as string,
        body.vnp_CreateDate as number,
        body.vnp_IpAddr as string,
        body.vnp_OrderInfo as string,
      ]),
    );
  });

  it("names a partial reversal when less than the whole is sent back", async () => {
    // `FR-PAY-04`: a refund may be less than was taken. VNPay wants to be told
    // which, and the answer is derived from what the gateway said was collected
    // rather than from anything the caller passed.
    const calls = gatewayAnswering(aQueryAnswer(), aRefundAnswer());

    await configuredAdapter().refund({ ...REFUND, amount: 100_000n });

    expect(calls[1].body.vnp_TransactionType).toBe("03");
    expect(calls[1].body.vnp_Amount).toBe(10_000_000);
  });

  it("refuses to reverse a payment the gateway never completed", async () => {
    // Nothing moved, so there is nothing to send back. Refused before the
    // refund call rather than after it, which is the difference between a
    // staff member being told and VNPay being asked to reverse a payment it
    // has no record of taking.
    const calls = gatewayAnswering(aQueryAnswer({ vnp_TransactionStatus: "02" }));

    await expect(configuredAdapter().refund(REFUND)).rejects.toThrow(
      /no completed payment under that reference/,
    );

    expect(calls).toHaveLength(1);
  });

  it("refuses a refund answer that did not carry VNPay's signature", async () => {
    // The sharpest of the three. A refund id taken from an unverified answer is
    // a number the property records against money it cannot prove moved, and
    // `FR-PAY-05` would surface that a day later as a reconciliation that does
    // not close.
    gatewayAnswering(aQueryAnswer(), {
      ...aRefundAnswer(),
      vnp_SecureHash: createHmac("sha512", "not-this-property's-secret")
        .update("vnp_ResponseCode=00")
        .digest("hex"),
    });

    await expect(configuredAdapter().refund(REFUND)).rejects.toThrow(
      /VNPay refused the refund/,
    );
  });

  it("refuses a refund VNPay declined", async () => {
    // `94` is VNPay's "a request for this transaction is already being
    // processed". Signed, and a refusal — so the staff action failed and there
    // is nothing to record.
    gatewayAnswering(aQueryAnswer(), aRefundAnswer({ vnp_ResponseCode: "94" }));

    await expect(configuredAdapter().refund(REFUND)).rejects.toThrow(
      /VNPay refused the refund/,
    );
  });

  it("refuses a refund VNPay accepted without naming", async () => {
    // The mirror of the callback rule: a reversal with no id of its own is one
    // the property cannot record against the money it sent, and cannot
    // recognise if the same refund is asked for twice.
    gatewayAnswering(aQueryAnswer(), aRefundAnswer({ vnp_TransactionNo: "0" }));

    await expect(configuredAdapter().refund(REFUND)).rejects.toThrow(
      /without naming it/,
    );
  });
});
