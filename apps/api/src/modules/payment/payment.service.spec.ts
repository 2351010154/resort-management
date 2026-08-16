// The three answers that are settled before a database is involved.
//
// A callback arrives on a route anyone may post to, and most of what arrives
// there is not a payment. This file is about the part of the handler that has to
// establish that *without* touching anything: an unsigned callback, a signed one
// naming a reference this property never issued, and a signed one about an
// attempt the payer has not finished. All three must post nothing, and "nothing"
// is a stronger claim than "no rows afterwards" — a handler that opened a
// transaction, looked, and closed it again would satisfy the second and would
// still be spending a connection on traffic.
//
// So the transaction boundary here refuses to open. It is not a stand-in for
// Postgres and holds no rows; it fails the case if the service reaches it at
// all, which is exactly the assertion. What the service does once it is past
// this point — the payment, the posting, the index that refuses a replay — is
// `test/payment-service.e2e-spec.ts`'s, against a real database, because none of
// it can be proven anywhere else.
//
// The gateway is stood in for and that is legitimate: `FR-PAY-02` puts signature
// verification inside the maintained library behind the port, `vnpay.adapter.ts`
// is what implements it and `vnpay.adapter.spec.ts` is what checks it against
// signatures computed from VNPay's specification. What this file asserts is that
// the service believes the port's answer and acts on nothing else.

import "reflect-metadata";

import { ORPCError } from "@orpc/nest";
import type { PinoLogger } from "nestjs-pino";
import { describe, expect, it } from "vitest";
import type { Env } from "../../config/env.js";
import type { Database } from "../../database/database.module.js";
import { TransactionRunner } from "../../database/transaction-runner.js";
import type { BookingService } from "../booking/booking.service.js";
import type { BusinessDateService } from "../booking/business-date.service.js";
import type { FolioService } from "../folio/folio.service.js";
import { OpsAlertService } from "../notification/ops-alert.service.js";
import { PaymentService } from "./payment.service.js";
import type {
  CallbackVerification,
  PaymentGateway,
} from "./ports/payment-gateway.port.js";

/** A stay, and the same id as the first half of the reference below. */
const A_BOOKING = "7f1c4d2a-9b60-4e18-8a35-2c6d0f9e1b47";

/**
 * A reference in the shape this service mints: the booking's id with its
 * hyphens taken out, then a nonce of the same width.
 *
 * Written out here rather than produced by the service, so that a change to the
 * format has to be made in two places by somebody who has read both. The
 * correlation this encodes is the only thing tying a callback to a stay and to
 * the attempt on it — `payment.attempt_reference` stores this same string, and
 * a format that quietly changed would be callbacks that stop resolving to
 * anything and attempts that stay `PENDING` forever.
 */
const OUR_REFERENCE = `7f1c4d2a9b604e188a352c6d0f9e1b47${"0123456789abcdef".repeat(2)}`;

/** What a gateway that is not this property's would echo back. */
const A_FOREIGN_REFERENCE = "PAY-7QX2";

/** Whatever a callback carries. Nothing here reads it — the port does. */
const A_CALLBACK = { vnp_TxnRef: OUR_REFERENCE } as const;

describe("a callback that carries no signature", () => {
  it("is refused, and never reaches the database", async () => {
    // Refused rather than filed as a failed payment. `FR-PAY-03` leaves the
    // callback routes unguarded — the gateway arrives with no session and the
    // signature *is* the authentication — so anything at all may be posted to
    // them, and a `FAILED` row per crawler is a table nobody can read.
    const refusal = await refused(
      serviceTold({ verified: false }).handleIpn(A_CALLBACK),
    );

    expect(refusal.code).toBe("UNAUTHORIZED");
  });
});

describe("a signed callback about a reference this property never issued", () => {
  it("is refused, and never reaches the database", async () => {
    // Only reachable from a gateway holding the merchant secret, so this is not
    // the forgery case above — it is a terminal answering for somebody else's
    // orders, or this property's own reference format having been changed under
    // attempts that were already open. Either way there is no stay it names,
    // and inventing one is worse than refusing.
    const refusal = await refused(
      serviceTold({
        verified: true,
        transaction: {
          status: "SUCCESS",
          reference: A_FOREIGN_REFERENCE,
          amount: 1_200_000n,
          gatewayTransactionId: "14528901",
          paidAt: new Date("2027-11-02T09:12:00Z"),
        },
      }).handleIpn(A_CALLBACK),
    );

    expect(refusal.code).toBe("NOT_FOUND");
  });
});

describe("a signed callback about an attempt nobody has finished", () => {
  it("writes nothing, because the payer may still pay", async () => {
    // The attempt's row already says what is true — money claimed and not yet
    // confirmed — so there is nothing to resolve it to. Rewriting it to what it
    // already reads would spend a transaction to change nothing, and the
    // account would still be owed the same amount.
    const outcome = await serviceTold({
      verified: true,
      transaction: {
        status: "PENDING",
        reference: OUR_REFERENCE,
        amount: 1_200_000n,
      },
    }).handleIpn(A_CALLBACK);

    expect(outcome).toBe("STILL_OPEN");
  });
});

/** A service whose gateway reports exactly this about whatever it is handed. */
function serviceTold(verification: CallbackVerification): PaymentService {
  return new PaymentService(
    new GatewayThatReports(verification),
    // Never reached: every case here is settled before the folio is asked for
    // anything, which is the claim. Handed nothing rather than a stand-in that
    // would have to imitate a ledger it is not allowed to imitate.
    undefined as unknown as FolioService,
    undefined as unknown as BusinessDateService,
    // Never reached, for the same reason as the two above rather than for one
    // of its own: a callback does reach this service — it confirms the stay the
    // money was held for — but only once it is past the boundary below, and no
    // case in this file gets there. The ownership half is never a callback's
    // question at all: a gateway reporting on an attempt is not a guest naming
    // a stay, and `handleIpn` resolves the account off the row rather than off
    // anything the caller said.
    //
    // Both halves are proven where they can be. `payment-service.e2e-spec.ts`
    // builds the real service and drives the transition against real rows;
    // `guest-account-link.e2e-spec.ts` puts `isOwner` to the same.
    undefined as unknown as BookingService,
    new ClosedBoundary(),
    new AlerterThatIsNeverPaged(),
  );
}

/** The port's answer, fixed. `vnpay.adapter.spec.ts` is where it is earned. */
class GatewayThatReports implements PaymentGateway {
  constructor(private readonly verification: CallbackVerification) {}

  async createPayment(): Promise<never> {
    throw new Error("no case here opens an attempt");
  }

  async verifyCallback(): Promise<CallbackVerification> {
    return await Promise.resolve(this.verification);
  }

  async refund(): Promise<never> {
    throw new Error("no case here refunds");
  }

  async queryTransaction(): Promise<never> {
    throw new Error("no case here queries the gateway");
  }
}

/**
 * A transaction boundary that fails the case if anything opens it.
 *
 * The Drizzle client is never reached, because `run` throws before it could be
 * — so the constructor is handed nothing rather than an object pretending to be
 * a database. The failure that matters is the one this raises: a handler that
 * opened a transaction to decide a question it had already answered.
 */
class ClosedBoundary extends TransactionRunner {
  constructor() {
    super(undefined as unknown as Database);
  }

  override async run<T>(): Promise<T> {
    throw new Error(
      "the service opened a transaction for a callback it had already settled",
    );
  }
}

/**
 * An alerter that fails the case if anything pages it.
 *
 * A page is raised only when money has landed on a stay the property cannot
 * honour, and none of the three cases here is money at all: two are refused
 * before the database, and the third is an attempt the payer may still finish.
 * Waking somebody about one of those would be the pager crying about ordinary
 * traffic, which is how a pager stops being one.
 */
class AlerterThatIsNeverPaged extends OpsAlertService {
  constructor() {
    super(undefined as unknown as Env, undefined as unknown as PinoLogger);
  }

  override async page(): Promise<never> {
    throw new Error(
      "the service paged somebody about a callback that moved no money",
    );
  }
}

/** The refusal a call provoked. Fails the case if the service accepted it. */
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

  throw new Error("the service accepted a callback it should have refused");
}
