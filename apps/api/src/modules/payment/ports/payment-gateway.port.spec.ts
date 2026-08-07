// The port's claims are mostly compile-time ones, and a compile-time claim is
// asserted the way `stay-date.spec.ts` asserts its own: this file is checked
// by `tsconfig.test.json`, so an `@ts-expect-error` below becomes an error the
// moment the line under it starts compiling. The runtime half exercises the
// shape through an implementation, because an interface nothing implements is a
// contract nothing has answered yet.

import { describe, expect, it } from "vitest";
import type {
  CallbackVerification,
  CreatePaymentInput,
  CreatePaymentResult,
  GatewayTransaction,
  PaymentAttempt,
  PaymentGateway,
  RefundInput,
  RefundResult,
} from "./payment-gateway.port.js";
import { PAYMENT_GATEWAY } from "./payment-gateway.port.js";

/**
 * Not a gateway, and not a step towards one — `FR-PAY-02`'s adapter is a
 * separate piece of work with a library and a signature scheme behind it. This
 * answers the four calls so the port can be exercised rather than only read,
 * and it is deliberately synchronous inside: an implementation with nothing to
 * await satisfies the asynchronous port by returning a resolved promise, which
 * is the property the port's doc comment claims and this class is the proof of.
 */
class StandInGateway implements PaymentGateway {
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    return Promise.resolve({
      paymentUrl: `https://gateway.invalid/pay?ref=${input.reference}`,
    });
  }

  // Authentic to this stand-in means "names an attempt and a transaction". The
  // real check is a signature, it belongs to the maintained library, and
  // nothing about it belongs here.
  verifyCallback(
    callback: Record<string, unknown>,
  ): Promise<CallbackVerification> {
    const { reference, transactionId } = callback;

    if (typeof reference !== "string" || typeof transactionId !== "string") {
      return Promise.resolve({ verified: false });
    }

    return Promise.resolve({
      verified: true,
      transaction: {
        status: "SUCCESS",
        reference,
        amount: 250_000n,
        gatewayTransactionId: transactionId,
        paidAt: new Date("2026-08-06T09:12:00Z"),
      },
    });
  }

  refund(input: RefundInput): Promise<RefundResult> {
    return Promise.resolve({
      gatewayRefundId: `refund-of-${input.gatewayTransactionId}`,
    });
  }

  queryTransaction(attempt: PaymentAttempt): Promise<GatewayTransaction> {
    return Promise.resolve({
      status: "PENDING",
      reference: attempt.reference,
      amount: 250_000n,
    });
  }
}

const attempt: PaymentAttempt = {
  reference: "PAY-7QX2",
  createdAt: new Date("2026-08-06T09:10:00Z"),
};

describe("the payment gateway port", () => {
  it("is satisfied by an implementation that awaits nothing", async () => {
    const gateway = new StandInGateway();

    await expect(
      gateway.createPayment({
        ...attempt,
        amount: 250_000n,
        description: "Deposit",
        returnUrl: "https://mariva.invalid/payments/return",
        payerIpAddress: "203.0.113.4",
      }),
    ).resolves.toEqual({
      paymentUrl: "https://gateway.invalid/pay?ref=PAY-7QX2",
    });

    await expect(gateway.queryTransaction(attempt)).resolves.toMatchObject({
      status: "PENDING",
      reference: "PAY-7QX2",
    });

    await expect(
      gateway.refund({
        ...attempt,
        gatewayTransactionId: "14528901",
        amount: 250_000n,
        reason: "Cancelled within policy",
        requestedBy: "staff-1",
      }),
    ).resolves.toEqual({ gatewayRefundId: "refund-of-14528901" });
  });

  // The narrowing is the point. A caller reaches the id it will key idempotency
  // on only after establishing that the callback was authentic and that the
  // money moved.
  it("hands over a transaction only once a callback is authentic", async () => {
    const verification = await new StandInGateway().verifyCallback({
      reference: "PAY-7QX2",
      transactionId: "14528901",
    });

    expect(verification.verified).toBe(true);

    if (
      verification.verified &&
      verification.transaction.status === "SUCCESS"
    ) {
      expect(verification.transaction.gatewayTransactionId).toBe("14528901");
      expect(verification.transaction.paidAt).toBeInstanceOf(Date);
    }
  });

  it("carries nothing to post when a callback is not authentic", async () => {
    const verification = await new StandInGateway().verifyCallback({
      reference: "PAY-7QX2",
    });

    // @ts-expect-error an unverified callback has no transaction behind it, so
    // a handler cannot post one without checking first.
    const smuggled = verification.transaction;

    expect(verification.verified).toBe(false);
    expect(smuggled).toBeUndefined();
  });

  // `NFR-12`: money is an integer count of đồng and `money.ts` argues why the
  // type is `bigint`. A `number` reaching the gateway would be an amount that
  // had already been through arithmetic this codebase forbids.
  it("refuses an amount that arrived as a number", () => {
    const input: CreatePaymentInput = {
      ...attempt,
      // @ts-expect-error đồng are counted in bigint
      amount: 250_000,
      description: "Deposit",
      returnUrl: "https://mariva.invalid/payments/return",
      payerIpAddress: "203.0.113.4",
    };

    expect(input.description).toBe("Deposit");
  });

  it("refuses a refund amount that arrived as a number", () => {
    const input: RefundInput = {
      ...attempt,
      gatewayTransactionId: "14528901",
      // @ts-expect-error đồng are counted in bigint
      amount: 250_000,
      reason: "Cancelled within policy",
      requestedBy: "staff-1",
    };

    expect(input.reason).toBe("Cancelled within policy");
  });

  // `FR-PAY-03` keys webhook idempotency on the gateway's transaction id, so a
  // payment that succeeded without one is not a state the port can describe.
  it("refuses a taken payment with no id to key idempotency on", () => {
    // @ts-expect-error a successful transaction carries an id and a time
    const taken: GatewayTransaction = {
      status: "SUCCESS",
      reference: "PAY-7QX2",
      amount: 250_000n,
    };

    expect(taken.status).toBe("SUCCESS");
  });

  it("binds by a token, since the interface itself erases", () => {
    expect(typeof PAYMENT_GATEWAY).toBe("symbol");
  });
});
