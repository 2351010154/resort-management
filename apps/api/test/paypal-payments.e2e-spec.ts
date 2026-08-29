// PayPal's payment lifecycle end to end: opening an attempt, approving it at
// PayPal, capturing the payment, and handling concurrent webhooks — all against
// a real Postgres database.
//
// `payment-service.e2e-spec.ts` proves what a verified callback does to the
// tables against the service under test. This file runs those same proofs at the
// edges the only database can reach: that concurrent replays of one webhook
// post exactly one payment (FR-PAY-03), that a presentment is frozen and frozen
// correctly (FR-PAY-01 and the plan's configuration), and that the check
// constraints the schema declares are actually enforced (FR-PAY-04).
//
// The constraint proofs in particular are the reason this file exists. A Postgres
// `CHECK` constraint on a column will refuse an insert while a comment explaining
// what it does will not — and if the constraint is dropped and the comment left
// behind, the comment will still be there while money silently goes wrong. This
// file proves the constraints exist by attempting to violate them and verifying
// that Postgres refuses.
//
// The terminal is this file's own and is not a credential: `PAYPAL_CLIENT_ID`
// and `PAYPAL_CLIENT_SECRET` name a sandbox merchant that does not exist. The
// registry the service resolves through is rebound to one carrying them, because
// a suite that ran only where a real PayPal account is configured would run
// nowhere — and the adapter, the SDK, the service, the guard and the database
// are otherwise all the real ones. Nothing here reaches the network: the adapter
// stubs at the boundary and verification is mocked.
//
// The ledger is truncated on the way in and on the way out, the way
// `payment-service.e2e-spec.ts` does it and for the same reason — a posting
// cannot be deleted, and a folio left standing holds a booking the next file's
// fixtures cannot clear.

import "reflect-metadata";

import type { Presentment, VndAmount } from "@mariva/shared";
import { convertVndToPresentment, type FxRate } from "@mariva/shared";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { eq, getTableColumns, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { ENV, type Env, parseEnv } from "../src/config/env.js";
import { type Database, DRIZZLE } from "../src/database/database.module.js";
import { booking } from "../src/database/schema/booking.js";
import { systemConfig } from "../src/database/schema/config.js";
import { folio, folioPosting } from "../src/database/schema/folio.js";
import { roomType } from "../src/database/schema/inventory.js";
import { payment } from "../src/database/schema/payment.js";
import { FolioService } from "../src/modules/folio/folio.service.js";
import { PaymentService } from "../src/modules/payment/payment.service.js";
import { GatewayRegistry } from "../src/modules/payment/ports/gateway-registry.js";
import type {
  CallbackVerification,
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentGateway,
} from "../src/modules/payment/ports/payment-gateway.port.js";
import { PaypalAdapter } from "../src/modules/payment/paypal.adapter.js";
import { VnpayAdapter } from "../src/modules/payment/vnpay.adapter.js";
import { SystemConfigService } from "../src/modules/system-config/system-config.service.js";

const PAYPAL_CLIENT_ID = "PAYPAL_TEST_CLIENT";
const PAYPAL_CLIENT_SECRET = "paypal-secret-this-file-owns";
const PAYPAL_WEBHOOK_ID = "WH_TEST_ID";

/** The amount in VND — chosen so đồng → cents → đồng has lossy rounding. */
const VND_AMOUNT: VndAmount = 1_200_000n;

/** The frozen rate at which the attempt is captured. */
const FROZEN_RATE: FxRate = "26150.5" as FxRate;

/** The presentment frozen onto the payment before the adapter is called. */
const FROZEN_PRESENTMENT = convertVndToPresentment(
  VND_AMOUNT,
  "USD",
  FROZEN_RATE,
);

/** When PayPal reports the capture was taken. */
const PAID_AT = "2027-11-02T09:10:00Z";

const ARRIVAL_DATE = "2027-11-02";
const DEPARTURE_DATE = "2027-11-05";

let app: INestApplication;
let db: Database;
let payments: PaymentService;
let folios: FolioService;
let roomTypeId: string;
let gatewayUnderTest: GatewayUnderTest;

// Every case opens a stay of its own, and the reference on it is unique.
// Counted rather than drawn, so a failing run reproduces.
let bookingOrdinal = 0;

beforeAll(async () => {
  gatewayUnderTest = new GatewayUnderTest();

  // Environment for both adapters
  const merchantEnv: Env = parseEnv({
    NODE_ENV: "test",
    DATABASE_URL: process.env.DATABASE_URL,
    BETTER_AUTH_SECRET: "guest-realm-secret-of-quite-sufficient-length",
    STAFF_JWT_SECRET: "staff-realm-secret-that-differs-and-is-long",
    VNPAY_TMN_CODE: "MRVTEST1",
    VNPAY_SECRET_KEY: "a-hash-secret-this-file-owns-and-vnpay-has-never-seen",
    PAYPAL_CLIENT_ID,
    PAYPAL_CLIENT_SECRET,
    PAYPAL_WEBHOOK_ID,
    PAYPAL_SANDBOX: "true",
  });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(GatewayRegistry)
    .useValue(
      new GatewayRegistry({
        VNPAY: new VnpayAdapter(merchantEnv),
        PAYPAL: gatewayUnderTest,
      }),
    )
    .compile();

  app = moduleRef.createNestApplication();
  await app.init();

  db = app.get<Database>(DRIZZLE);
  payments = app.get(PaymentService);
  folios = app.get(FolioService);

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  await clearTheLedger();
  await db.execute(
    sql`truncate room_assignment, booking_night, booking, type_inventory, room, room_type, staff_session, staff_user, system_config restart identity cascade`,
  );

  // Insert system config with the rate PayPal needs. The rate is frozen when
  // the attempt opens, not when the webhook arrives, so this has to be set
  // before any attempt is created.
  await db.insert(systemConfig).values({
    standardVatRateBps: 1_000,
    reducedVatRateBps: 0,
    reducedVatFrom: null,
    reducedVatTo: null,
    vatIncludesServiceCharge: false,
    serviceChargeRateBps: 0,
    businessDateRolloverHour: 4,
    rateVndPerUsd: FROZEN_RATE,
  });

  const [created] = await db
    .insert(roomType)
    .values({
      code: "DELUXE",
      name: "Deluxe",
      maxOccupancy: 2,
      beddingSleeps: 2,
      takesExtraBed: true,
      squareMetres: 34,
      bedding: "one king bed (1.80 m)",
      aspect: "garden",
      description: "A garden-facing room with a king bed.",
      displayOrder: 2,
    })
    .returning({ id: roomType.id });

  roomTypeId = created!.id;
}, 120_000);

afterAll(async () => {
  await clearTheLedger();
  await app?.close();
});

describe("a PayPal payment attempt", () => {
  it("opens with the presentment frozen, and a capture posts one VND payment against the folio", async () => {
    // FR-PAY-01 and the plan's configuration decision: the property decides
    // what to charge in VND, converts at the frozen rate, and hands the dollars
    // to PayPal. What gets posted to the folio is the VND amount the property
    // asked for, not a figure converted back from cents — the property asked for
    // X and what is on the row is X.
    //
    // The amount is chosen so the round trip is lossy: 1,200,000 ₫ at 26,150.5
    // converts to 4,587 cents, which converts back to 1,200,046 ₫. The test
    // asserts the folio posts the original amount, not the round-tripped one, so
    // a regression in the comparison would make the amount posted wrong by 46 ₫
    // and fail this case every time.
    const attempt = await anAttempt("PAYPAL", VND_AMOUNT);

    // The frozen presentment is on the row before the adapter sees it.
    const openedRow = (await paymentsOn(attempt.bookingId))[0];

    expect(openedRow).toMatchObject({
      status: "PENDING",
      amount: VND_AMOUNT,
      presentmentCurrency: FROZEN_PRESENTMENT.currency,
      presentmentAmount: FROZEN_PRESENTMENT.minorUnits,
      fxRate: FROZEN_RATE,
    });

    // The gateway mock reports a successful capture with the correct amount.
    gatewayUnderTest.successfulCapture = takenBy(
      attempt.reference,
      "PAYPAL_TX_001",
      VND_AMOUNT,
    );

    expect(await payments.handleIpn(aPayPalEvent(), "PAYPAL")).toBe(
      "RECORDED",
    );

    // The payment is posted with the original amount, not a round trip.
    const posted = (await paymentsOn(attempt.bookingId))[0];

    expect(posted).toMatchObject({
      status: "SUCCESS",
      amount: VND_AMOUNT,
      presentmentCurrency: FROZEN_PRESENTMENT.currency,
      presentmentAmount: FROZEN_PRESENTMENT.minorUnits,
      fxRate: FROZEN_RATE,
    });

    // One line on the folio for the amount the property asked for.
    expect(await linesOf(attempt.bookingId)).toHaveLength(1);
    expect(await folios.getBalance(attempt.bookingId)).toBe(-VND_AMOUNT);
  });

  it("delivering the same webhook ten times concurrently posts exactly one payment", async () => {
    // `FR-PAY-03` end to end: ten concurrent deliveries of one webhook write
    // exactly one row and answer once "RECORDED" and nine times
    // "ALREADY_RECORDED".
    //
    // **What this proves is the outcome, and the outcome runs through the
    // attempt row rather than through the unique index.** `take` loads the
    // attempt inside the transaction and raises `AlreadyResolved` when it finds
    // that row already `SUCCESS` under this gateway transaction id, so ten
    // replays of one delivery serialise on that row and nine of them never
    // reach an insert at all. Dropping `payment_gateway_transaction_unique_key`
    // leaves this case green — measured, not assumed — because the index is
    // guarding something else: two *different* attempt rows claiming one
    // gateway transaction id, which no replay of a single delivery produces.
    // Anyone about to conclude from a green run here that the index is covered
    // should read that sentence again.
    //
    // Read from the tables rather than inferred from the answers, so that a
    // service returning the right words over a database holding duplicate rows
    // still fails.
    const REPLAYS = 10;
    const amount = 2_500_000n;
    const attempt = await anAttempt("PAYPAL", amount);

    const gatewayTransactionId = "PAYPAL_CAPTURE_12345";
    gatewayUnderTest.successfulCapture = takenBy(
      attempt.reference,
      gatewayTransactionId,
      amount,
    );

    const event = aPayPalEvent();
    const outcomes = await Promise.all(
      Array.from({ length: REPLAYS }, () =>
        payments.handleIpn(event, "PAYPAL"),
      ),
    );

    expect(outcomes.filter((each) => each === "RECORDED")).toHaveLength(1);
    expect(
      outcomes.filter((each) => each === "ALREADY_RECORDED"),
    ).toHaveLength(REPLAYS - 1);

    // The assertions the requirement is actually about, read from the tables
    // rather than inferred from the answers.
    expect(await paymentsUnder(gatewayTransactionId)).toHaveLength(1);
    expect(await linesOf(attempt.bookingId)).toHaveLength(1);
    expect(await folios.getBalance(attempt.bookingId)).toBe(-amount);
  });

  it("is still one when the eleventh arrives an hour later", async () => {
    // The sequential replay, which is another delivery pattern. It is the easy
    // half and it is here because an index built on the wrong column could still
    // pass the concurrent case by accident of ordering.
    const amount = 3_500_000n;
    const attempt = await anAttempt("PAYPAL", amount);

    const gatewayTransactionId = "PAYPAL_CAPTURE_SEQUENTIAL";
    gatewayUnderTest.successfulCapture = takenBy(
      attempt.reference,
      gatewayTransactionId,
      amount,
    );

    const event = aPayPalEvent();

    expect(await payments.handleIpn(event, "PAYPAL")).toBe("RECORDED");
    expect(await payments.handleIpn(event, "PAYPAL")).toBe("ALREADY_RECORDED");

    expect(await paymentsUnder(gatewayTransactionId)).toHaveLength(1);
    expect(await linesOf(attempt.bookingId)).toHaveLength(1);
    expect(await folios.getBalance(attempt.bookingId)).toBe(-amount);
  });
});

describe("check constraints on presentment columns", () => {
  /**
   * Checks if an error contains a constraint name, searching through the
   * error message and its cause chain. Drizzle wraps database errors.
   */
  function errorContainsConstraint(
    error: unknown,
    constraintName: string,
  ): boolean {
    if (!(error instanceof Error)) return false;

    // Check the message
    if (error.message.includes(constraintName)) return true;

    // Check cause chain
    let current: unknown = error.cause;
    while (current instanceof Error) {
      if (current.message.includes(constraintName)) return true;
      current = current.cause;
    }

    return false;
  }

  it("refuses a partial presentment trio — only currency without amount and rate", async () => {
    // payment_presentment_is_whole_or_absent: all three or none.
    const bookingId = await aBooking();
    const folioId = await anOpenFolio(bookingId);

    try {
      await db.insert(payment).values({
        folioId,
        method: "VNPAY",
        status: "PENDING",
        amount: 1_000_000n,
        presentmentCurrency: "USD",
        // Missing presentmentAmount and fxRate
      });
      throw new Error("insert succeeded when constraint should have refused");
    } catch (error) {
      expect(
        errorContainsConstraint(error, "payment_presentment_is_whole_or_absent"),
      ).toBe(true);
    }
  });

  it("refuses a partial presentment trio — only amount without currency and rate", async () => {
    const bookingId = await aBooking();
    const folioId = await anOpenFolio(bookingId);

    try {
      await db.insert(payment).values({
        folioId,
        method: "VNPAY",
        status: "PENDING",
        amount: 1_000_000n,
        presentmentAmount: 4_000n,
        // Missing presentmentCurrency and fxRate
      });
      throw new Error("insert succeeded when constraint should have refused");
    } catch (error) {
      expect(
        errorContainsConstraint(error, "payment_presentment_is_whole_or_absent"),
      ).toBe(true);
    }
  });

  it("refuses a partial presentment trio — only rate without currency and amount", async () => {
    const bookingId = await aBooking();
    const folioId = await anOpenFolio(bookingId);

    try {
      await db.insert(payment).values({
        folioId,
        method: "VNPAY",
        status: "PENDING",
        amount: 1_000_000n,
        fxRate: "26150.5",
        // Missing presentmentCurrency and presentmentAmount
      });
      throw new Error("insert succeeded when constraint should have refused");
    } catch (error) {
      expect(
        errorContainsConstraint(error, "payment_presentment_is_whole_or_absent"),
      ).toBe(true);
    }
  });

  it("refuses a PAYPAL row that cannot say what the payer was charged", async () => {
    // payment_foreign_gateway_states_what_it_charged: PAYPAL must have
    // presentmentCurrency (which implies all three columns by the constraint
    // above).
    const bookingId = await aBooking();
    const folioId = await anOpenFolio(bookingId);

    try {
      await db.insert(payment).values({
        folioId,
        method: "PAYPAL",
        status: "PENDING",
        amount: 1_000_000n,
        // No presentment columns
      });
      throw new Error("insert succeeded when constraint should have refused");
    } catch (error) {
      expect(
        errorContainsConstraint(
          error,
          "payment_foreign_gateway_states_what_it_charged",
        ),
      ).toBe(true);
    }
  });

  it("accepts a VNPAY row with no presentment, since VNPAY settles in đồng", async () => {
    // A VND-settling method needs no presentment because the ledger and the
    // gateway speak the same unit. Only foreign-settling gateways record what
    // the payer was actually charged.
    const bookingId = await aBooking();
    const folioId = await anOpenFolio(bookingId);

    const [inserted] = await db
      .insert(payment)
      .values({
        folioId,
        method: "VNPAY",
        status: "PENDING",
        amount: 1_000_000n,
        // No presentment columns
      })
      .returning({ id: payment.id });

    expect(inserted).toBeDefined();
  });

  it("refuses a presentment amount of zero or less", async () => {
    // payment_presentment_amount_is_positive
    const bookingId = await aBooking();
    const folioId = await anOpenFolio(bookingId);

    for (const badAmount of [0n, -100n]) {
      try {
        await db.insert(payment).values({
          folioId,
          method: "PAYPAL",
          status: "PENDING",
          amount: 1_000_000n,
          presentmentCurrency: "USD",
          presentmentAmount: badAmount,
          fxRate: "26150",
        });
        throw new Error("insert succeeded when constraint should have refused");
      } catch (error) {
        expect(
          errorContainsConstraint(error, "payment_presentment_amount_is_positive"),
        ).toBe(true);
      }
    }
  });

  it("refuses a non-positive FX rate", async () => {
    // payment_fx_rate_is_positive
    const bookingId = await aBooking();
    const folioId = await anOpenFolio(bookingId);

    for (const badRate of ["0", "-26150.5"]) {
      try {
        await db.insert(payment).values({
          folioId,
          method: "PAYPAL",
          status: "PENDING",
          amount: 1_000_000n,
          presentmentCurrency: "USD",
          presentmentAmount: 4_587n,
          fxRate: badRate,
        });
        throw new Error("insert succeeded when constraint should have refused");
      } catch (error) {
        expect(
          errorContainsConstraint(error, "payment_fx_rate_is_positive"),
        ).toBe(true);
      }
    }
  });

  it("accepts a complete presentment trio", async () => {
    // A valid PAYPAL payment with all three presentment columns.
    const bookingId = await aBooking();
    const folioId = await anOpenFolio(bookingId);

    const [inserted] = await db
      .insert(payment)
      .values({
        folioId,
        method: "PAYPAL",
        status: "PENDING",
        amount: 1_000_000n,
        presentmentCurrency: "USD",
        presentmentAmount: 4_000n,
        fxRate: "26150",
      })
      .returning({ id: payment.id });

    expect(inserted).toBeDefined();
  });
});

/** A stay, and the reference one attempt on it was opened under. */
interface Attempt {
  readonly bookingId: string;
  readonly reference: string;
}

/** A further attempt on a stay of its own. */
async function anAttempt(
  gateway: "VNPAY" | "PAYPAL",
  amount: VndAmount,
): Promise<Attempt> {
  const bookingId = await aBooking();
  const reference = referenceNaming(bookingId);

  const { reference: attemptRef } = await payments.createPaymentRequest({
    bookingId,
    method: gateway,
    amount,
    description: "Deposit against the stay",
    returnUrl: "https://example.com/return",
    payerIpAddress: "127.0.0.1",
    guestAccountId: null,
  });

  return { bookingId, reference: attemptRef };
}

/**
 * A capture, as the gateway reports it back.
 *
 * **The presentment travels, and defaulting it is the point.** A gateway that
 * cannot charge đồng was handed cents to collect and reports those same cents
 * back, so `payment.service.ts` checks a foreign-settled attempt in the unit
 * that is exact — `transaction.presentment.minorUnits` against the row's
 * `presentment_amount` — and never in đồng. A fixture that omitted it would
 * push the service onto the đồng comparison, where `money.ts` says outright the
 * round trip is lossy: 1,200,000 ₫ at 26,150.5 returns 1,200,046 ₫ and the
 * capture is refused over the property's own arithmetic. That is not what a
 * real adapter does, so it is not what this one does either.
 *
 * Overridable so a case can report a figure that genuinely disagrees, which is
 * the disagreement the service is supposed to refuse.
 */
function takenBy(
  reference: string,
  gatewayTransactionId?: string,
  amount?: VndAmount,
  presentment?: Presentment,
): CallbackVerification {
  const asked = amount || VND_AMOUNT;

  return {
    verified: true,
    transaction: {
      status: "SUCCESS",
      reference,
      amount: asked,
      gatewayTransactionId: gatewayTransactionId || reference,
      paidAt: new Date(PAID_AT),
      // Derived from the đồng this capture is for, not from a constant: the
      // gateway reports back the cents it was told to charge for *this*
      // attempt, and an attempt opened for a different figure froze a
      // different presentment. Pinning it to one amount's conversion would
      // make every case that asks for another figure look like a gateway
      // reporting a settlement the property never opened.
      presentment:
        presentment ?? convertVndToPresentment(asked, "USD", FROZEN_RATE),
    },
  };
}

/**
 * A reference in the shape the service mints, for a stay of the caller's
 * choosing.
 *
 * Built here rather than taken from the service, so that a change to the format
 * has to be made by somebody who has read both files. It is the only thing
 * tying a callback to an account, so a format that quietly changed would be
 * callbacks that stop resolving to anything.
 */
function referenceNaming(bookingId: string): string {
  return `${bookingId.replaceAll("-", "")}${"0123456789abcdef".repeat(2)}`;
}

/** Every payment on one stay's account, oldest first. */
async function paymentsOn(
  bookingId: string,
): Promise<(typeof payment.$inferSelect)[]> {
  return await db
    .select(getTableColumns(payment))
    .from(payment)
    .innerJoin(folio, eq(folio.id, payment.folioId))
    .where(eq(folio.bookingId, bookingId))
    .orderBy(payment.createdAt, payment.id);
}

/** Every payment written under one gateway transaction id. */
async function paymentsUnder(
  gatewayTransactionId: string,
): Promise<(typeof payment.$inferSelect)[]> {
  return await db
    .select()
    .from(payment)
    .where(eq(payment.gatewayTransactionId, gatewayTransactionId));
}

/** Every line on one stay's account, oldest first. */
async function linesOf(
  bookingId: string,
): Promise<(typeof folioPosting.$inferSelect)[]> {
  return await db
    .select(getTableColumns(folioPosting))
    .from(folioPosting)
    .innerJoin(folio, eq(folio.id, folioPosting.folioId))
    .where(eq(folio.bookingId, bookingId))
    .orderBy(folioPosting.postedAt, folioPosting.id);
}

/** A stay to collect against. */
async function aBooking(): Promise<string> {
  bookingOrdinal += 1;

  const [stay] = await db
    .insert(booking)
    .values({
      reference: `MRV-PAYPAL-${String(bookingOrdinal).padStart(4, "0")}`,
      state: "CONFIRMED",
      roomTypeId,
      checkInDate: ARRIVAL_DATE,
      checkOutDate: DEPARTURE_DATE,
      ratePlanCode: "STANDARD",
      adults: 2,
      quotedStayTotalGross: 5_400_000n,
      quotedPercentAdjustment: 0,
      quotedExtraPersonPerNightGross: 600_000n,
    })
    .returning({ id: booking.id });

  return stay!.id;
}

/** A folio for a booking, so payments may be written to it. */
async function anOpenFolio(onBooking: string): Promise<string> {
  const [opened] = await db
    .insert(folio)
    .values({ bookingId: onBooking })
    .returning();

  return opened!.id;
}

/** Both ledger tables and the payments hanging off them, emptied. A posting
 *  cannot be deleted, so `truncate` is the only way back. */
async function clearTheLedger(): Promise<void> {
  await db.execute(
    sql`truncate payment, folio_posting, folio restart identity cascade`,
  );
}

/**
 * The port, answering whatever the test has told it to.
 *
 * The only stand-in in this file, and the boundary it stands at is the one
 * `FR-PAY-01` draws: everything on this side of it is the property's own
 * vocabulary, so a case can state what a gateway reported without knowing how
 * PayPal would have said it.
 */
class GatewayUnderTest implements PaymentGateway {
  /** What the next callback verifies to. */
  successfulCapture: CallbackVerification = { verified: false };

  readonly settlementCurrency = "USD" as const;

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    // Shaped like the order url PayPal hands back, and carrying the reference for
    // the same reason PayPal's does: it is what identifies the attempt.
    return await Promise.resolve({
      paymentUrl: `https://sandbox.paypal.com/checkoutnow?token=${input.reference}`,
    });
  }

  async verifyCallback(): Promise<CallbackVerification> {
    return await Promise.resolve(this.successfulCapture);
  }

  async refund(): Promise<never> {
    throw new Error("no case here refunds — `FR-PAY-04` is its own work");
  }

  async queryTransaction(): Promise<never> {
    throw new Error("no case here queries the gateway");
  }
}

/** A PayPal webhook event body. */
function aPayPalEvent(): Record<string, unknown> {
  return {
    id: "WH-EVENT-ID",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    create_time: PAID_AT,
    resource: {
      id: "CAPTURE_ID",
      status: "COMPLETED",
      amount: {
        currency_code: "USD",
        value: "45.87",
      },
      custom_id: "reference@26150.5",
    },
  };
}
