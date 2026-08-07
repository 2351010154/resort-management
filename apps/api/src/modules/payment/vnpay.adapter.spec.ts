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
// the network. `queryDr` and `refund` are HTTP calls to VNPay and are therefore
// not exercised here — `ASM-05` records that sandbox refund access is granted at
// merchant onboarding, and until a terminal exists those two paths are covered
// by their configuration and their argument list rather than by a round trip.

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
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
function sign(parameters: Record<string, string | number>): string {
  const encoded = new URLSearchParams();

  for (const name of Object.keys(parameters).sort()) {
    encoded.append(name, String(parameters[name]));
  }

  return createHmac("sha512", HASH_SECRET)
    .update(Buffer.from(encoded.toString(), "utf-8"))
    .digest("hex");
}

/** A callback as VNPay sends one, signed. Overrides land before signing. */
function aCallback(
  overrides: Record<string, string | number> = {},
): Record<string, unknown> {
  const parameters = {
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
  };

  return { ...parameters, vnp_SecureHash: sign(parameters) };
}

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
