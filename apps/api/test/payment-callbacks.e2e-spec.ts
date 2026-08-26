// The two routes VNPay calls, over HTTP, against the whole application —
// `FR-PAY-03`.
//
// `payment-service.e2e-spec.ts` proves what a verified callback does to the
// tables, and `payment.controller.spec.ts` proves which pair each outcome is
// answered with. Neither can prove the things that only exist once the routes
// are mounted in the real application, and those are what this file is for:
//
// 1. **Both are reachable with no session at all**, which is the one claim
//    `@Unguarded` makes and the one that cannot be checked from metadata. The
//    guard is global — `AuthModule` installs it over every route in the
//    process — so a control case asks a route that *does* declare a capability
//    and is refused, which is what makes the two answers below mean something.
// 2. **A real signature is verified by the real adapter.** The callbacks are
//    signed here the way VNPay's specification describes — sorted, form-encoded,
//    HMAC-SHA512 — and not by the library that checks them, for the reason
//    `vnpay.adapter.spec.ts` gives at length: a payload signed by its own
//    verifier proves only that the library agrees with itself.
// 3. **The query string survives the crossing.** Express parses it, Nest hands
//    it to the handler, the handler hands it to the service and the library
//    hashes it — four steps, any of which could rename, drop or coerce a field
//    and turn a genuine callback into a forged one. Only an end-to-end call
//    exercises that.
// 4. **The money lands, once.** A signed callback becomes a payment and a folio
//    line; its redelivery becomes neither, and is told so in the protocol's own
//    word rather than as a failure.
//
// The terminal is this file's own and is not a credential: `TERMINAL` and
// `HASH_SECRET` name a merchant that does not exist. The registry the service
// resolves through is rebound to one carrying them, because a suite that ran
// only where a real VNPay account is configured would run nowhere — and the adapter, the
// library, the service, the guard and the database are otherwise all the real
// ones. Nothing here reaches the network: building a payment url and verifying a
// callback are both local computation.
//
// The ledger is truncated on the way in and on the way out, the way
// `payment-service.e2e-spec.ts` does it and for the same reason — a posting
// cannot be deleted, and a folio left standing holds a booking the next file's
// fixtures cannot clear.

import "reflect-metadata";

import type { VndAmount } from "@mariva/shared";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createHmac } from "node:crypto";
import { eq, getTableColumns, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { ENV, type Env, parseEnv } from "../src/config/env.js";
import { type Database, DRIZZLE } from "../src/database/database.module.js";
import { booking } from "../src/database/schema/booking.js";
import { folio, folioPosting } from "../src/database/schema/folio.js";
import { roomType } from "../src/database/schema/inventory.js";
import { payment } from "../src/database/schema/payment.js";
import { PaymentService } from "../src/modules/payment/payment.service.js";
import { GatewayRegistry } from "../src/modules/payment/ports/gateway-registry.js";
import { VnpayAdapter } from "../src/modules/payment/vnpay.adapter.js";

const TERMINAL = "MRVTEST1";
const HASH_SECRET = "a-hash-secret-this-file-owns-and-vnpay-has-never-seen";

const IPN_PATH = "/payments/vnpay/ipn";
const RETURN_PATH = "/payments/vnpay/return";

/** A route that declares a capability, so the guard's presence is a fact here
 *  rather than an assumption behind the two answers below. */
const A_GUARDED_PATH = "/housekeeping/board";

const AMOUNT: VndAmount = 1_200_000n;

/** VNPay counts in hundredths of a đồng, which is what travels on the wire. */
const REPORTED_AMOUNT = String(AMOUNT * 100n);

/** 09:10 in Ho Chi Minh City on 2 November 2027, as VNPay stamps it. */
const PAID_AT = "20271102091000";

const ARRIVAL_DATE = "2027-11-02";
const DEPARTURE_DATE = "2027-11-05";

let app: INestApplication;
let db: Database;
let payments: PaymentService;
let webOrigin: string;
let roomTypeId: string;

// Every case opens a stay of its own, and the reference on it is unique.
// Counted rather than drawn, so a failing run reproduces.
let bookingOrdinal = 0;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(GatewayRegistry)
    .useValue(new GatewayRegistry({ VNPAY: new VnpayAdapter(merchantEnv()) }))
    .compile();

  app = moduleRef.createNestApplication();
  await app.init();

  db = app.get<Database>(DRIZZLE);
  payments = app.get(PaymentService);
  webOrigin = app.get<Env>(ENV).WEB_ORIGIN;

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  await clearTheLedger();
  await db.execute(
    sql`truncate room_assignment, booking_night, booking, type_inventory, room, room_type, staff_session, staff_user restart identity cascade`,
  );

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

describe("reaching the gateway's routes without a session", () => {
  it("refuses a route that declares a capability, so the guard is really here", async () => {
    // Without this, the two cases below would pass just as well in an
    // application that had forgotten to install `AccessGuard` — and the whole
    // claim `@Unguarded` makes is about a guard that is running.
    const response = await http().get(A_GUARDED_PATH);

    expect(response.status).toBe(401);
  });

  it("lets the gateway's IPN through, because the signature is the credential", async () => {
    const attempt = await anAttempt();

    const response = await http()
      .get(IPN_PATH)
      .query(aCallback({ vnp_TxnRef: attempt.reference }));

    // Not 401 and not 403. VNPay holds no account here and could not be given
    // one; `FR-PAY-02` puts the credential in the signature instead.
    expect(response.status).toBe(200);
    expect(response.body.RspCode).toBe("00");
  });

  it("lets the payer's return through, because a browser arrives with nobody's session", async () => {
    const attempt = await anAttempt();

    const response = await http()
      .get(RETURN_PATH)
      .query(aCallback({ vnp_TxnRef: attempt.reference }));

    expect(response.status).toBe(303);
  });
});

describe("a callback carrying the gateway's signature", () => {
  it("becomes a payment and a line on the account", async () => {
    const attempt = await anAttempt();

    const response = await http()
      .get(IPN_PATH)
      .query(
        aCallback({
          vnp_TxnRef: attempt.reference,
          vnp_TransactionNo: "94528910",
        }),
      );

    expect(response.body).toEqual({
      RspCode: "00",
      Message: "Confirm Success",
    });

    // Read from the tables rather than inferred from the answer. The signature
    // was built here to VNPay's specification and checked by the library, so
    // this is also the assertion that the query string survived Express, Nest,
    // the handler and the port without a field being renamed or coerced.
    const rows = await paymentsOn(attempt.bookingId);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "SUCCESS",
      gatewayTransactionId: "94528910",
      amount: AMOUNT,
    });

    expect(await linesOf(attempt.bookingId)).toHaveLength(1);
  });

  it("is one payment however many times it is delivered", async () => {
    // `FR-PAY-03`. The second delivery is answered `02` — the protocol's word
    // for a notification about an order already confirmed — and not `00`, and
    // not an error either: a gateway is entitled to keep asking until it is
    // told, and a redelivery is the protocol working.
    const attempt = await anAttempt();
    const callback = aCallback({
      vnp_TxnRef: attempt.reference,
      vnp_TransactionNo: "94528902",
    });

    expect((await http().get(IPN_PATH).query(callback)).body.RspCode).toBe("00");

    const again = await http().get(IPN_PATH).query(callback);

    expect(again.status).toBe(200);
    expect(again.body).toEqual({
      RspCode: "02",
      Message: "Order already confirmed",
    });

    expect(await paymentsOn(attempt.bookingId)).toHaveLength(1);
    expect(await linesOf(attempt.bookingId)).toHaveLength(1);
  });

  it("files a refusal and acknowledges having done so", async () => {
    // `RspCode` reports whether this property processed the notification, not
    // whether the money moved — so a payment VNPay refused is `00` just as one
    // it took is, and the `FAILED` row is what `FR-PAY-05` reconciles against.
    const attempt = await anAttempt();

    const response = await http()
      .get(IPN_PATH)
      .query(
        aCallback({
          vnp_TxnRef: attempt.reference,
          vnp_ResponseCode: "24",
          vnp_TransactionStatus: "02",
        }),
      );

    expect(response.body.RspCode).toBe("00");

    const rows = await paymentsOn(attempt.bookingId);

    expect(rows[0]).toMatchObject({ status: "FAILED" });
    expect(await linesOf(attempt.bookingId)).toHaveLength(0);
  });
});

describe("a callback the property will not act on", () => {
  it("answers 97 when the signature is not the gateway's", async () => {
    const attempt = await anAttempt();

    const forged = {
      ...aCallback({ vnp_TxnRef: attempt.reference }),
      vnp_Amount: "1",
    };

    const response = await http().get(IPN_PATH).query(forged);

    // 200 carrying VNPay's refusal code, never a 500 and never a stack: the
    // route is unguarded, so anything at all may be sent to it and most of what
    // fails here is traffic rather than money.
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ RspCode: "97", Message: "Fail checksum" });

    expect(await paymentsOn(attempt.bookingId)).toHaveLength(1);
    expect(await linesOf(attempt.bookingId)).toHaveLength(0);
  });

  it("answers 01 when the reference names no attempt this property opened", async () => {
    const response = await http()
      .get(IPN_PATH)
      .query(aCallback({ vnp_TxnRef: "f".repeat(64) }));

    expect(response.body).toEqual({ RspCode: "01", Message: "Order not found" });
  });

  it("answers 04 when the amount is not the amount the attempt was opened for", async () => {
    // Not a forgery — the figure below is signed, so it is a terminal, a
    // currency scale or a merchant account disagreeing with this property.
    // Posting it would put a number on a guest's invoice that no attempt of
    // theirs accounts for, so nothing is posted and VNPay is told which of the
    // disagreements this was.
    const attempt = await anAttempt();

    const response = await http()
      .get(IPN_PATH)
      .query(
        aCallback({
          vnp_TxnRef: attempt.reference,
          vnp_Amount: String(AMOUNT * 100n + 10_000_000n),
          vnp_TransactionNo: "94528903",
        }),
      );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ RspCode: "04", Message: "Invalid amount" });

    // The whole transaction is back. The attempt reads what it read before —
    // money claimed and not yet confirmed — and somebody now has to look.
    const rows = await paymentsOn(attempt.bookingId);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "PENDING",
      amount: AMOUNT,
      gatewayTransactionId: null,
    });

    expect(await linesOf(attempt.bookingId)).toHaveLength(0);
  });
});

describe("the payer coming back from the gateway", () => {
  it("is handed to the site with a caption, and nothing about it is decided", async () => {
    const attempt = await anAttempt();

    const response = await http()
      .get(RETURN_PATH)
      .query(
        aCallback({
          vnp_TxnRef: attempt.reference,
          vnp_TransactionNo: "94528904",
        }),
      );

    expect(response.status).toBe(303);

    const location = new URL(response.headers.location);

    expect(location.origin).toBe(new URL(webOrigin).origin);
    // `confirming`, because the browser can beat the IPN here and this property
    // has not agreed yet. The IPN is the authority and it has not arrived.
    expect(location.searchParams.get("payment")).toBe("confirming");
    expect(location.searchParams.get("reference")).toBe(attempt.reference);

    // The claim that matters: a redirect carrying a perfectly good signature
    // for a completed payment still wrote nothing. The attempt is outstanding
    // and the account is untouched until the gateway's own delivery says so.
    const rows = await paymentsOn(attempt.bookingId);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "PENDING" });
    expect(await linesOf(attempt.bookingId)).toHaveLength(0);
  });

  it("carries nothing onward from a redirect the gateway did not sign", async () => {
    const attempt = await anAttempt();

    const response = await http()
      .get(RETURN_PATH)
      .query({
        ...aCallback({ vnp_TxnRef: attempt.reference }),
        vnp_SecureHash: "0".repeat(128),
      });

    expect(response.status).toBe(303);

    const location = new URL(response.headers.location);

    expect(location.searchParams.get("payment")).toBe("unverified");
    expect(location.searchParams.has("reference")).toBe(false);
  });
});

/** A stay, and the reference one attempt on it was opened under. */
interface Attempt {
  readonly bookingId: string;
  readonly reference: string;
}

/** A stay of its own with one attempt open on it, where every case starts. */
async function anAttempt(): Promise<Attempt> {
  const bookingId = await aBooking();

  const { reference } = await payments.createPaymentRequest({
    bookingId,
    // The gateway whose two routes this file drives. The service resolves its
    // verifier from the method a callback arrives under and may only claim an
    // attempt opened at that same gateway, so the attempt and the callbacks
    // below have to name one thing.
    method: "VNPAY",
    amount: AMOUNT,
    description: "Deposit against the stay",
    returnUrl: `http://localhost:3001${RETURN_PATH}`,
    payerIpAddress: "203.0.113.44",
    // The desk's attempt, so there is no account to scope it to. What this file
    // is about is the callback that resolves one, and a gateway reporting on an
    // attempt names the reference rather than a stay — the ownership condition
    // lives on the request that opens it.
    guestAccountId: null,
  });

  return { bookingId, reference };
}

function http(): request.Agent {
  return request(app.getHttpServer());
}

/**
 * VNPay's checksum, as its specification describes it and not as the library
 * happens to implement it: every parameter but the hash itself, sorted by name,
 * form-encoded, HMAC-SHA512 in hex.
 *
 * The same computation `vnpay.adapter.spec.ts` writes out, and repeated here
 * rather than shared for the reason that file gives — a fixture signed by the
 * code under test proves only that it agrees with itself, and a helper the
 * adapter's tests could quietly change would be the same thing one import away.
 */
function sign(parameters: Record<string, string>): string {
  const encoded = new URLSearchParams();

  for (const name of Object.keys(parameters).sort()) {
    encoded.append(name, parameters[name]!);
  }

  return createHmac("sha512", HASH_SECRET)
    .update(Buffer.from(encoded.toString(), "utf-8"))
    .digest("hex");
}

/** A callback as VNPay sends one — every value a string, and signed last. */
function aCallback(
  overrides: Record<string, string> = {},
): Record<string, string> {
  const parameters: Record<string, string> = {
    vnp_Amount: REPORTED_AMOUNT,
    vnp_BankCode: "NCB",
    vnp_BankTranNo: "VNP94528901",
    vnp_CardType: "ATM",
    vnp_OrderInfo: "Thanh toan dat phong",
    vnp_PayDate: PAID_AT,
    vnp_ResponseCode: "00",
    vnp_TmnCode: TERMINAL,
    // Overridden by every case that expects a payment to be written.
    // `payment_gateway_transaction_unique_key` makes one gateway transaction one
    // payment across the whole table, so two cases sharing this number would
    // collide with each other rather than with what they are testing.
    vnp_TransactionNo: "94528900",
    vnp_TransactionStatus: "00",
    vnp_TxnRef: "",
    ...overrides,
  };

  return { ...parameters, vnp_SecureHash: sign(parameters) };
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
      reference: `MRV-PAYIPN-${String(bookingOrdinal).padStart(4, "0")}`,
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

/** A terminal this file owns, for an adapter that signs and verifies for real. */
function merchantEnv(): Env {
  return parseEnv({
    NODE_ENV: "test",
    DATABASE_URL: process.env.DATABASE_URL,
    BETTER_AUTH_SECRET: "guest-realm-secret-of-quite-sufficient-length",
    STAFF_JWT_SECRET: "staff-realm-secret-that-differs-and-is-long",
    VNPAY_TMN_CODE: TERMINAL,
    VNPAY_SECRET_KEY: HASH_SECRET,
  });
}

/** Both ledger tables and the payments hanging off them, emptied. A posting
 *  cannot be deleted, so `truncate` is the only way back. */
async function clearTheLedger(): Promise<void> {
  await db.execute(
    sql`truncate payment, folio_posting, folio restart identity cascade`,
  );
}
