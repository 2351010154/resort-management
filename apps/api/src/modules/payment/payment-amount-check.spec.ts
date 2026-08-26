// The one comparison that decides whether a verified callback becomes money on
// an account — and the unit it is made in.
//
// `payment.service.spec.ts` is the file beside this one, and it stops where this
// one starts: everything it asserts is settled before a transaction opens, and
// its boundary fails the case if the service reaches a database at all. What is
// under test here is the other side of that line, so the boundary opens and
// hands the service a scripted executor. `database/transaction-runner.spec.ts`
// establishes that arrangement — a `DbExecutor` is an interface a stand-in can
// satisfy, and a test that only needs to know which statement was issued does
// not need a server to issue it against.
//
// **Why it is not proved against Postgres.** The claim is not about a `where`
// clause, an index or a constraint — those are `payment-revocation.spec.ts`'s
// and `schema/payment.spec.ts`'s, and both take a real server for exactly that
// reason. This claim is arithmetic over two integers and a branch on whether a
// row froze a presentment, and a database would answer none of it while
// requiring a booking, a room type, a folio and a rate to be seeded before the
// first assertion.
//
// **The defect it holds shut.** A gateway that cannot charge đồng is handed
// cents to collect and reports cents back; the đồng on its callback are this
// process's own conversion of those cents at the frozen rate. `money.ts` states
// outright that đồng → cents → đồng "can land a few hundred đồng away", so an
// equality over that figure compares the adapter with itself and calls its own
// rounding a discrepancy. The numbers below are the real ones: 1,200,000 ₫ at
// 26,150.5 is 4,589 cents, and 4,589 cents back is 1,200,046 ₫. Every payment
// such a gateway ever took would have been refused, and nothing posted.
//
// So three cases, and the third is the one that keeps the first two honest:
//
// 1. A capture whose cents are the cents the attempt froze **posts**, and posts
//    the đồng the property asked for rather than the đồng the callback carried.
// 2. A capture whose cents are not those cents is **refused**, which is what
//    stops the fix from being "stop checking".
// 3. A callback from a gateway that collects đồng, naming a figure the attempt
//    was not opened for, is refused exactly as it was before any of this — the
//    branch is on the row and not on the gateway, so an attempt that froze
//    nothing is compared the way it always was.

import "reflect-metadata";

import { convertPresentmentToVnd, type StayDate, type VndAmount } from "@mariva/shared";
import { ORPCError } from "@orpc/nest";
import type { PinoLogger } from "nestjs-pino";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env.js";
import type { Database, DbExecutor } from "../../database/database.module.js";
import { TransactionRunner } from "../../database/transaction-runner.js";
import type { BookingService, PaidStay } from "../booking/booking.service.js";
import type { BusinessDateService } from "../booking/business-date.service.js";
import type { FolioService } from "../folio/folio.service.js";
import { OpsAlertService } from "../notification/ops-alert.service.js";
import type { SystemConfigService } from "../system-config/system-config.service.js";
import { PaymentService } from "./payment.service.js";
import { GatewayRegistry } from "./ports/gateway-registry.js";
import type {
  CallbackVerification,
  GatewayTransaction,
  PaymentGateway,
} from "./ports/payment-gateway.port.js";

/** A stay, and the same id as the first half of the reference below. */
const A_BOOKING = "7f1c4d2a-9b60-4e18-8a35-2c6d0f9e1b47";

/** The account the money lands on. */
const A_FOLIO = "1b2c3d4e-5f60-4718-8a35-2c6d0f9e1b47";

/** A reference in the shape the service mints — the stay's hex, then a nonce. */
const OUR_REFERENCE = `7f1c4d2a9b604e188a352c6d0f9e1b47${"0123456789abcdef".repeat(2)}`;

/** Whatever a callback carries. Nothing here reads it — the port does. */
const A_CALLBACK = { anything: "the adapter's business" } as const;

/** What the property asked for, and therefore what belongs on the folio. */
const ASKED: VndAmount = 1_200_000n;

/**
 * The property's configured rate at the moment the attempt opened, frozen onto
 * the row beside the cents it produced.
 *
 * A rate with a fraction on purpose. A whole number of đồng per dollar would
 * round trip cleanly for many amounts and the case would pass on arithmetic
 * rather than on the branch it is written for.
 */
const FROZEN_RATE = "26150.5";

/**
 * What the payer was actually charged: 1,200,000 ₫ ÷ 26,150.5, to the cent.
 *
 * Spelled out rather than computed by calling the converter the service also
 * calls. A test that derives its expectation from the code under test agrees
 * with it whatever either of them does.
 */
const FROZEN_CENTS = 4589n;

/** What the payer was told, one cent light — a settlement of something else. */
const OTHER_CENTS = 4588n;

/**
 * The đồng a PayPal callback carries, which is the adapter's conversion of
 * {@link FROZEN_CENTS} back at {@link FROZEN_RATE} — and 46 ₫ heavier than what
 * the property asked for.
 *
 * Computed here, because this figure's whole point is that it is whatever the
 * round trip produces rather than a number anybody chose. Asserted below to be
 * genuinely different from {@link ASKED}: the case proves nothing if the two
 * happen to agree.
 */
const ROUND_TRIPPED = convertPresentmentToVnd({
  currency: "USD",
  minorUnits: FROZEN_CENTS,
  rate: FROZEN_RATE,
});

const PAID_AT = new Date("2027-11-02T09:12:00Z");

describe("a capture from a gateway that collects in the payer's currency", () => {
  it("is checked in the cents the attempt froze, not in the đồng it converted back to", async () => {
    // The claim, and the reason this file exists. The đồng on this callback are
    // not the đồng on the row and never could be — `money.ts` says the round
    // trip loses — so a service comparing them would refuse a payment that is
    // exactly what the payer approved.
    expect(ROUND_TRIPPED).not.toBe(ASKED);

    const { service, postPayment } = serviceHolding({
      asked: ASKED,
      charged: FROZEN_CENTS,
    });

    // The verification itself is the adapter's and is earned in
    // `paypal.adapter.spec.ts`. What is asserted here is what the service makes
    // of an answer it believes.
    const outcome = await service.handleIpn(A_CALLBACK, "PAYPAL");

    expect(outcome).toBe("RECORDED");
    expect(postPayment).toHaveBeenCalledTimes(1);
  });

  it("posts the đồng the property asked for, never the đồng converted back from cents", async () => {
    // The second half of the rule and the one a guest would read. The folio is
    // the property's own ledger in the property's own currency; the callback's
    // đồng are an artefact of a conversion that happened in this process, and
    // posting them would put 46 ₫ on an invoice that no attempt accounts for.
    const { service, postPayment } = serviceHolding({
      asked: ASKED,
      charged: FROZEN_CENTS,
    });

    await service.handleIpn(A_CALLBACK, "PAYPAL");

    expect(postPayment.mock.calls[0]?.[1].amount).toBe(ASKED);
    expect(postPayment.mock.calls[0]?.[1].amount).not.toBe(ROUND_TRIPPED);
  });

  it("is refused when the cents are not the cents the payer approved", async () => {
    // What stops the rule above from being "stop checking". A settlement of one
    // cent less is a settlement of something else — a currency scale, a
    // merchant account or a terminal disagreeing with this property — and the
    // attempt stays outstanding for somebody to look at.
    const { service, postPayment } = serviceHolding(
      { asked: ASKED, charged: FROZEN_CENTS },
      { presentment: { currency: "USD", minorUnits: OTHER_CENTS, rate: FROZEN_RATE } },
    );

    const refusal = await refused(service.handleIpn(A_CALLBACK, "PAYPAL"));

    expect(refusal.code).toBe("CONFLICT");
    expect(refusal.data).toEqual({ disagreement: "AMOUNT" });
    expect(postPayment).not.toHaveBeenCalled();
  });

  it("is refused when the gateway reports no settlement at all", async () => {
    // The row exists only because the attempt was opened somewhere that cannot
    // charge đồng — `payment_foreign_gateway_states_what_it_charged` refused to
    // let it be written without saying what the payer would be charged. A report
    // that cannot say what it settled is a report about something else, and
    // dropping to the đồng here would be the check quietly returning to the
    // comparison it exists to avoid.
    const { service, postPayment } = serviceHolding(
      { asked: ASKED, charged: FROZEN_CENTS },
      { presentment: undefined, amount: ASKED },
    );

    const refusal = await refused(service.handleIpn(A_CALLBACK, "PAYPAL"));

    expect(refusal.code).toBe("CONFLICT");
    expect(postPayment).not.toHaveBeenCalled();
  });
});

describe("a callback from a gateway that collects the property's own currency", () => {
  it("is still refused when the đồng are not the đồng the attempt was opened for", async () => {
    // Unchanged, and that is the assertion. The branch is on what the row froze
    // rather than on which gateway is speaking, so an attempt that froze nothing
    // is compared exactly as it was before a second gateway existed — and this
    // is the bookkeeping check the service header argues for.
    const { service, postPayment } = serviceHolding(
      { asked: ASKED, charged: null },
      { amount: 1_200_046n, presentment: undefined },
    );

    const refusal = await refused(service.handleIpn(A_CALLBACK, "VNPAY"));

    expect(refusal.code).toBe("CONFLICT");
    expect(refusal.data).toEqual({ disagreement: "AMOUNT" });
    expect(postPayment).not.toHaveBeenCalled();
  });

  it("posts what the gateway and the row agree on", async () => {
    // The other half of leaving that gateway alone: a callback naming the figure
    // the attempt was opened for still becomes money, and the figure posted is
    // the same one under either branch — the row's.
    const { service, postPayment } = serviceHolding(
      { asked: ASKED, charged: null },
      { amount: ASKED, presentment: undefined },
    );

    expect(await service.handleIpn(A_CALLBACK, "VNPAY")).toBe("RECORDED");
    expect(postPayment.mock.calls[0]?.[1].amount).toBe(ASKED);
  });
});

/** The row the scripted `UPDATE` hands back — the two columns `take` reads. */
interface ClaimedRow {
  readonly asked: VndAmount;
  readonly charged: bigint | null;
}

/**
 * A service whose one attempt is `row`, and whose gateway reports `reported`
 * about it.
 *
 * Every collaborator that a successful posting reaches is a stand-in and every
 * one it does not is handed nothing at all, which is `payment.service.spec.ts`'s
 * arrangement and its argument: a case that wandered into an absent collaborator
 * fails loudly rather than quietly agreeing with a fake.
 *
 * The ledger is the one worth naming. `FolioService.postPayment` is the whole
 * observable of "the money landed", and it is a spy rather than the real service
 * because what these cases assert is the figure handed to the ledger — not what
 * the ledger does with it, which `folio-service.e2e-spec.ts` owns against real
 * rows.
 */
function serviceHolding(
  row: ClaimedRow,
  reported: Partial<Extract<GatewayTransaction, { status: "SUCCESS" }>> = {},
): {
  readonly service: PaymentService;
  readonly postPayment: ReturnType<typeof vi.fn<FolioService["postPayment"]>>;
} {
  const transaction: Extract<GatewayTransaction, { status: "SUCCESS" }> = {
    status: "SUCCESS",
    reference: OUR_REFERENCE,
    // The adapter's own conversion back from what it charged, which is exactly
    // the figure the check must not be made on.
    amount: ROUND_TRIPPED,
    presentment: {
      currency: "USD",
      minorUnits: FROZEN_CENTS,
      rate: FROZEN_RATE,
    },
    gatewayTransactionId: "8JK92831HS4471912",
    paidAt: PAID_AT,
    ...reported,
  };

  const postPayment = vi.fn<FolioService["postPayment"]>(async () => "posting");

  const service = new PaymentService(
    // Both methods bound to one stand-in, so a case names the gateway its
    // callback arrived through and the service resolves it the way it does in
    // production. Which adapter answers is not what these cases are about —
    // what the row froze is.
    new GatewayRegistry({
      VNPAY: new GatewayThatReports({ verified: true, transaction }),
      PAYPAL: new GatewayThatReports({ verified: true, transaction }),
    }),
    { postPayment } as unknown as FolioService,
    {
      // The trading day the money moved in. Fixed, because none of these cases
      // is about the rollover hour — `business-date-api.e2e-spec.ts` is.
      current: async (): Promise<StayDate> =>
        ({ year: 2027, month: 11, day: 2, toString: () => "2027-11-02" }) as unknown as StayDate,
    } as unknown as BusinessDateService,
    {
      // The stay the deposit confirms. `CONFIRMED` and not `CANCELLED`, so the
      // pager below stays untouched: a page is about money on a stay nobody can
      // honour, and none of these cases is that.
      confirmPaidHold: async (): Promise<PaidStay> => ({
        reference: "MRV-20271102-0001",
        state: "CONFIRMED",
      }),
    } as unknown as BookingService,
    new BoundaryOver(row),
    new AlerterThatIsNeverPaged(),
    // Never reached: the rate is read when an attempt *opens*, and every case
    // here is a callback arriving about an attempt somebody else opened.
    undefined as unknown as SystemConfigService,
  );

  return { service, postPayment };
}

/** The port's answer, fixed. `paypal.adapter.spec.ts` is where it is earned. */
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
 * A transaction boundary over one scripted row.
 *
 * The Drizzle client is never reached — `run` hands the work an executor of this
 * file's own — so the constructor is given nothing rather than an object
 * pretending to be a database. `transaction-runner.spec.ts` builds its executors
 * the same way and for the same reason: `DbExecutor` is an interface, and a case
 * about which figure a service compares does not need a server to compare it
 * against.
 *
 * A rollback is not modelled and does not need to be. Every refusal here throws
 * out through `run` before anything has been asked of the ledger, and the
 * assertion each case makes is that the ledger was never asked — which is a
 * stronger claim than a rollback undoing it afterwards.
 */
class BoundaryOver extends TransactionRunner {
  constructor(private readonly row: ClaimedRow) {
    super(undefined as unknown as Database);
  }

  override async run<T>(work: (exec: DbExecutor) => Promise<T>): Promise<T> {
    return await work(this.executor());
  }

  /**
   * The two statements `take` and the posting path issue, and nothing else.
   *
   * The `UPDATE` claims the attempt and hands back the row's columns; the
   * `SELECT` is the folio the account is read off. Neither predicate is
   * inspected, because what a predicate does is a question for a database —
   * `payment-revocation.spec.ts` asks it of a real one. A statement this file
   * did not script would arrive at a method that is not here and fail as the
   * missing thing it is.
   */
  private executor(): DbExecutor {
    const row = this.row;

    return {
      update: () => ({
        set: () => ({
          where: () => ({
            returning: async () => [
              { folioId: A_FOLIO, asked: row.asked, charged: row.charged },
            ],
          }),
        }),
      }),
      select: () => ({
        from: () => ({
          where: async () => [{ bookingId: A_BOOKING }],
        }),
      }),
    } as unknown as DbExecutor;
  }
}

/**
 * An alerter that fails the case if anything pages it.
 *
 * A page is raised only when money lands on a stay the property cannot honour,
 * and every stay here is `CONFIRMED`. Waking somebody about one of these would
 * be the pager crying about ordinary traffic.
 */
class AlerterThatIsNeverPaged extends OpsAlertService {
  constructor() {
    super(undefined as unknown as Env, undefined as unknown as PinoLogger);
  }

  override async page(): Promise<never> {
    throw new Error(
      "the service paged somebody about a payment that landed on a stay it could honour",
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
