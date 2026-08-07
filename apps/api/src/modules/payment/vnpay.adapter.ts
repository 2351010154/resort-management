// The gateway `FR-PAY-02` names, behind the port `FR-PAY-01` declares.
//
// It sits at the module root rather than inside `ports/` because the two hold
// different things: `ports/` is the property's list of needs, written in the
// property's vocabulary, and this is one provider's answer to it, written in
// VNPay's. `modules/booking` is arranged the same way — its services sit beside
// `ports/` and `guards/` rather than inside them. A second gateway is a second
// file here and nothing else, which is the whole claim `FR-PAY-06` makes.
//
// **Nothing in this file computes a signature.** `FR-PAY-02` is explicit — "use
// the maintained `vnpay` package — never a hand-rolled HMAC-SHA512" — and
// `infrastructure.md` §Payments repeats it. Every checksum built or checked
// below is the library's, including the ones inside `queryDr` and `refund` that
// authenticate VNPay's *responses* rather than its callbacks. The one thing a
// caller here must not do is decide for itself that a callback looks right.
//
// **The two clocks are not the library's.** VNPay stamps `yyyyMMddHHmmss` in
// GMT+7, and `vnpay`'s own `dateFormat`/`parseDate` read and write those digits
// through the *host process's* local timezone — correct on a server running
// UTC, an hour-shifted payment date anywhere else. `paidAt` is the figure
// `FR-PAY-05` reconciles against the gateway's daily report, so it is converted
// here through `PROPERTY_TIME_ZONE` and `@internationalized/date`, the same way
// `BusinessDateService` reads an instant in the property's zone. That is
// formatting and not authentication: the digits it produces are then signed by
// the library like every other parameter.
//
// **Credentials are optional and the failure is deferred, not hidden.**
// `config/env.ts` explains who a mandatory terminal code would stop. Here it
// means the constructor cannot build a client, so the client is built on first
// use and a process without credentials fails at the call — naming both
// variables — rather than at the boot of an API that mostly does other things.

import {
  fromDate,
  parseDateTime,
} from "@internationalized/date";
import { PROPERTY_TIME_ZONE, type VndAmount } from "@mariva/shared";
import { Inject, Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import { randomUUID } from "node:crypto";
import {
  HashAlgorithm,
  RefundTransactionType,
  VNPAY_GATEWAY_SANDBOX_HOST,
  VNPay,
  ignoreLogger,
  type ReturnQueryFromVNPay,
} from "vnpay";
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
} from "./ports/payment-gateway.port.js";

/**
 * Where the live gateway answers — `pay.vnpay.vn`, whose paths are the sandbox's.
 *
 * Named rather than configured because it is VNPay's address and not the
 * property's opinion, and `prd-m6.md` scope decision 2 puts the switch to it at
 * `M7` behind gate `G2`. Until a terminal has been through merchant onboarding
 * there is nothing here to point at, and confirming the endpoint against the
 * onboarding pack is part of that flip.
 */
const VNPAY_GATEWAY_PRODUCTION_HOST = "https://pay.vnpay.vn";

/**
 * What VNPay calls "the IP address of the server calling the API", on the two
 * merchant calls that require one.
 *
 * The loopback address, and it is honest rather than a placeholder. The payer's
 * address at payment time is the caller's to supply — `CreatePaymentInput`
 * argues why an invented one would be a fraud signal meaning nothing — but a
 * query or a refund is this process talking about itself, over an outbound
 * connection whose source address it does not choose and VNPay does not screen.
 */
const CALLING_SERVER_ADDRESS = "127.0.0.1";

/** VNPay's "the request succeeded" and "the payment completed", both `00`. */
const VNPAY_OK = "00";

/** The transaction is still open at the gateway — the payer may yet finish. */
const VNPAY_PENDING = "01";

/**
 * Above this the đồng a payment carries cannot survive the conversion.
 *
 * The library counts in the gateway's unit, which is a hundredth of a đồng, and
 * it takes a `number` — so the ceiling is a hundredth of what a double can
 * represent exactly. `money.ts` forbids anything above this adapter to scale an
 * amount, and this is the boundary where the scaling happens, so this is where
 * an amount too large to scale is refused rather than silently rounded.
 */
const LARGEST_EXACT_AMOUNT = BigInt(Number.MAX_SAFE_INTEGER) / 100n;

@Injectable()
export class VnpayAdapter implements PaymentGateway {
  /** Built on first use; see the note on deferred failure at the top. */
  private client?: VNPay;

  constructor(@Inject(ENV) private readonly env: Env) {}

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const paymentUrl = this.gateway().buildPaymentUrl(
      {
        vnp_Amount: gatewayAmount(input.amount),
        vnp_OrderInfo: input.description,
        // The property's own reference for the attempt, which VNPay echoes back
        // in the callback. `PaymentAttempt.reference` says why it is not the
        // booking reference: a stay may be paid more than once.
        vnp_TxnRef: input.reference,
        vnp_IpAddr: input.payerIpAddress,
        vnp_ReturnUrl: input.returnUrl,
        // Supplied rather than left to the library, which would stamp it from
        // the process clock. The gateway partitions transactions by the day an
        // attempt was opened, so a later query has to name the same instant the
        // caller stored.
        vnp_CreateDate: vnpayTimestamp(input.createdAt),
      },
      { logger: { loggerFn: ignoreLogger } },
    );

    // Nothing else about the attempt is known yet — no transaction id exists
    // until the payer has finished and the gateway says so.
    return await Promise.resolve({ paymentUrl });
  }

  async verifyCallback(
    callback: Record<string, unknown>,
  ): Promise<CallbackVerification> {
    // Outside the `try` on purpose. A process with no credentials is a
    // misconfiguration and has to be reported as one; folding it into
    // `{ verified: false }` would report it as a forged callback and leave the
    // property quietly refusing every payment it takes.
    const gateway = this.gateway();

    let verified;

    try {
      verified = gateway.verifyReturnUrl(callback as ReturnQueryFromVNPay, {
        logger: { loggerFn: ignoreLogger },
      });
    } catch {
      // `FR-PAY-03` leaves the callback routes unguarded, so anything at all
      // may be posted to them and the library throws on a payload it cannot
      // read as a callback at all — an amount that is not a number, most
      // obviously. That is not an exception the property has anything to do
      // about; it is traffic.
      return { verified: false };
    }

    if (!verified.isVerified) {
      return { verified: false };
    }

    const reference = verified.vnp_TxnRef;
    const amount = wholeDong(verified.vnp_Amount);

    // Signed, and still not something this property can post. A callback whose
    // amount is not a whole đồng cannot become a folio line without a rounding
    // this codebase forbids at every other layer, and inventing one here would
    // be the first place money stopped being an integer.
    if (typeof reference !== "string" || amount === undefined) {
      return { verified: false };
    }

    // Both, and VNPay's own documentation is why: `vnp_ResponseCode` reports
    // the result of the *request* and `vnp_TransactionStatus` the state of the
    // *payment*, and only the pair reading `00` is money that moved. The
    // library's `isSuccess` reads the first alone.
    const paid =
      verified.isSuccess &&
      String(verified.vnp_TransactionStatus) === VNPAY_OK;

    if (!paid) {
      return {
        verified: true,
        transaction: {
          reference,
          amount,
          status:
            String(verified.vnp_TransactionStatus) === VNPAY_PENDING
              ? "PENDING"
              : "FAILED",
        },
      };
    }

    const gatewayTransactionId = identifier(verified.vnp_TransactionNo);
    const paidAt = instantFrom(verified.vnp_PayDate);

    // A payment VNPay says it took, without naming it or dating it. There is no
    // shape of `GatewayTransaction` for that and there should not be: `FR-PAY-03`
    // keys idempotency on the id, so a success with no id is a payment that
    // could be posted twice, and a success with no time is one this process
    // would have to date from its own clock. Neither is a claim about a
    // transaction, so it is not treated as one.
    if (!gatewayTransactionId || !paidAt) {
      return { verified: false };
    }

    return {
      verified: true,
      transaction: {
        status: "SUCCESS",
        reference,
        amount,
        gatewayTransactionId,
        paidAt,
      },
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const transactionNo = Number(input.gatewayTransactionId);

    if (!Number.isSafeInteger(transactionNo)) {
      throw new ORPCError("BAD_REQUEST", {
        status: 400,
        message:
          "That payment cannot be refunded: VNPay numbers its transactions and this one is not a number",
      });
    }

    // What was taken, asked of the gateway rather than assumed. VNPay wants to
    // be told whether this is a full reversal or a partial one, and `RefundInput`
    // carries the amount to hand back but not the amount that was collected —
    // deliberately, because the port is the property's vocabulary and "which of
    // VNPay's two refund codes applies" is not a question the folio has an
    // opinion about. One extra round trip buys the answer; guessing it would
    // buy a refund the gateway rejects on a guest who has been told it is done.
    const taken = await this.queryTransaction(input);

    if (taken.status !== "SUCCESS") {
      throw new ORPCError("BAD_GATEWAY", {
        status: 502,
        message: "VNPay has no completed payment under that reference to send back",
      });
    }

    const result = await this.gateway().refund(
      {
        vnp_RequestId: requestId(),
        vnp_TransactionType:
          input.amount === taken.amount
            ? RefundTransactionType.FULL_REFUND
            : RefundTransactionType.PARTIAL_REFUND,
        vnp_TxnRef: input.reference,
        vnp_Amount: gatewayAmount(input.amount),
        vnp_TransactionNo: transactionNo,
        // The instant the *attempt* was opened, which is how VNPay finds the
        // transaction — not the instant of this request, which is below.
        vnp_TransactionDate: vnpayTimestamp(input.createdAt),
        // `rbac-matrix.md` §Folio and money splits refunding within policy from
        // refunding outside it, and `FR-PAY-05` compares the property's record
        // of who asked against VNPay's. Both have to name the same person.
        vnp_CreateBy: input.requestedBy,
        vnp_CreateDate: vnpayTimestamp(new Date()),
        vnp_IpAddr: CALLING_SERVER_ADDRESS,
        vnp_OrderInfo: input.reason,
      },
      { logger: { loggerFn: ignoreLogger } },
    );

    // `isVerified` is the library checking VNPay's signature on the *response*.
    // Unverified, this is not VNPay answering, and a refund id taken from it
    // would be a number the property records against money it cannot prove
    // moved.
    if (!result.isVerified || !result.isSuccess) {
      throw new ORPCError("BAD_GATEWAY", {
        status: 502,
        message: `VNPay refused the refund: ${result.message}`,
      });
    }

    const gatewayRefundId = identifier(result.vnp_TransactionNo);

    if (!gatewayRefundId) {
      throw new ORPCError("BAD_GATEWAY", {
        status: 502,
        message:
          "VNPay accepted the refund without naming it, so there is nothing to record against it",
      });
    }

    // The gateway's id for the reversal, which is not the payment's — VNPay
    // opens a transaction of its own for a refund.
    return { gatewayRefundId };
  }

  async queryTransaction(attempt: PaymentAttempt): Promise<GatewayTransaction> {
    const result = await this.gateway().queryDr(
      {
        vnp_RequestId: requestId(),
        vnp_TxnRef: attempt.reference,
        vnp_OrderInfo: `Truy van giao dich ${attempt.reference}`,
        vnp_TransactionDate: vnpayTimestamp(attempt.createdAt),
        vnp_CreateDate: vnpayTimestamp(new Date()),
        vnp_IpAddr: CALLING_SERVER_ADDRESS,
        // Zero is VNPay's "I do not have your number for it", which is the
        // ordinary case: the property knows the reference it minted and asks
        // the gateway what became of it. The library uses the same value as its
        // own default where a refund omits one.
        vnp_TransactionNo: 0,
      },
      { logger: { loggerFn: ignoreLogger } },
    );

    if (!result.isVerified) {
      throw new ORPCError("BAD_GATEWAY", {
        status: 502,
        message:
          "The answer did not carry VNPay's signature, so it is not VNPay's answer",
      });
    }

    if (!result.isSuccess) {
      throw new ORPCError("BAD_GATEWAY", {
        status: 502,
        message: `VNPay could not answer for that transaction: ${result.message}`,
      });
    }

    // Divided here and not on the callback path, and the asymmetry is the
    // library's rather than a choice: `verifyReturnUrl` hands the amount back
    // already in đồng, and `queryDr` hands back the gateway's own unit.
    const amount = wholeDong(Number(result.vnp_Amount) / 100);

    if (amount === undefined) {
      throw new ORPCError("BAD_GATEWAY", {
        status: 502,
        message: "VNPay reported an amount that is not a whole đồng",
      });
    }

    const status = String(result.vnp_TransactionStatus);
    const gatewayTransactionId = identifier(result.vnp_TransactionNo);
    const paidAt = instantFrom(result.vnp_PayDate);

    if (status === VNPAY_OK && gatewayTransactionId && paidAt) {
      return {
        status: "SUCCESS",
        reference: result.vnp_TxnRef,
        amount,
        gatewayTransactionId,
        paidAt,
      };
    }

    return {
      reference: result.vnp_TxnRef,
      amount,
      // A completed payment the gateway could not name or date is reported as
      // still open rather than as taken, for the reason `verifyCallback` gives:
      // there is no successful transaction without an id to key idempotency on.
      status: status === VNPAY_OK || status === VNPAY_PENDING ? "PENDING" : "FAILED",
    };
  }

  /**
   * The configured client, built once.
   *
   * Both hosts are set from the same flag. `queryDrAndRefundHost` defaults to
   * the sandbox independently of `vnpayHost` in the library, so a production
   * deploy that set only the payment host would send its refunds to the sandbox
   * and be told the transaction does not exist.
   */
  private gateway(): VNPay {
    if (this.client) {
      return this.client;
    }

    const tmnCode = this.env.VNPAY_TMN_CODE;
    const secureSecret = this.env.VNPAY_SECRET_KEY;

    if (!tmnCode || !secureSecret) {
      throw new ORPCError("SERVICE_UNAVAILABLE", {
        status: 503,
        message:
          "Card payment is not configured — set VNPAY_TMN_CODE and VNPAY_SECRET_KEY",
      });
    }

    const host = this.env.VNPAY_SANDBOX
      ? VNPAY_GATEWAY_SANDBOX_HOST
      : VNPAY_GATEWAY_PRODUCTION_HOST;

    this.client = new VNPay({
      tmnCode,
      secureSecret,
      vnpayHost: host,
      queryDrAndRefundHost: host,
      hashAlgorithm: HashAlgorithm.SHA512,
      // The library logs whole payloads, secure hash included, and this process
      // logs through pino. Its own logger is switched off rather than pointed
      // somewhere, per call as well as here — `enableLog` alone leaves the
      // per-call default in place.
      enableLog: false,
      loggerFn: ignoreLogger,
    });

    return this.client;
  }
}

/**
 * A `VndAmount` as the library wants it: đồng, in a `number`.
 *
 * The library multiplies by a hundred itself, which is the only place in this
 * codebase where an amount is scaled at all — `money.ts` forbids it everywhere
 * above the adapter. What cannot be scaled exactly is refused here rather than
 * rounded, because a payment that is silently a few đồng out is the failure
 * `NFR-02` would surface a month later as a folio that does not reconcile.
 */
function gatewayAmount(amount: VndAmount): number {
  if (amount <= 0n || amount > LARGEST_EXACT_AMOUNT) {
    throw new ORPCError("BAD_REQUEST", {
      status: 400,
      message: "That amount cannot be sent to VNPay without losing đồng",
    });
  }

  return Number(amount);
}

/** A figure the gateway reported, as whole đồng — or nothing, if it is not. */
function wholeDong(reported: unknown): VndAmount | undefined {
  return typeof reported === "number" && Number.isSafeInteger(reported)
    ? BigInt(reported)
    : undefined;
}

/** A gateway-issued identifier as text. Absent, empty and `0` are all "none". */
function identifier(reported: unknown): string | undefined {
  if (typeof reported !== "string" && typeof reported !== "number") {
    return undefined;
  }

  const named = String(reported).trim();

  return named === "" || named === "0" ? undefined : named;
}

/**
 * An instant as `yyyyMMddHHmmss` in the property's zone, which is VNPay's.
 *
 * Written here rather than taken from the library because the library reads the
 * host process's clock fields — a server on UTC produces the right digits and a
 * server anywhere else produces digits seven hours out, silently.
 */
function vnpayTimestamp(instant: Date): number {
  const local = fromDate(instant, PROPERTY_TIME_ZONE);

  const digits = [
    String(local.year).padStart(4, "0"),
    String(local.month).padStart(2, "0"),
    String(local.day).padStart(2, "0"),
    String(local.hour).padStart(2, "0"),
    String(local.minute).padStart(2, "0"),
    String(local.second).padStart(2, "0"),
  ].join("");

  return Number(digits);
}

/** The reverse: VNPay's fourteen digits, read in the property's zone. */
function instantFrom(reported: unknown): Date | undefined {
  if (typeof reported !== "string" && typeof reported !== "number") {
    return undefined;
  }

  const digits = String(reported);

  if (!/^\d{14}$/.test(digits)) {
    return undefined;
  }

  const iso = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}T${digits.slice(8, 10)}:${digits.slice(10, 12)}:${digits.slice(12, 14)}`;

  try {
    return parseDateTime(iso).toDate(PROPERTY_TIME_ZONE);
  } catch {
    // Fourteen digits that are not a date — `20261332000000`. Signed or not, it
    // names no moment.
    return undefined;
  }
}

/**
 * VNPay's id for one merchant request, which it requires be unique within a day.
 *
 * A uuid without its hyphens: thirty-two characters, which is VNPay's limit for
 * the field, and unique without a counter this process would have to keep
 * across restarts and instances.
 */
function requestId(): string {
  return randomUUID().replaceAll("-", "");
}
