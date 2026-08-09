// Money arriving from a gateway and landing on a guest's account — `FR-PAY-01`
// and `FR-PAY-03`, against a real Postgres.
//
// `payment-storage.e2e-spec.ts` proves what the table will and will not hold,
// including that ten concurrent inserts of one gateway id become one row. This
// proves what the handler does with that: that a verified callback resolves the
// attempt it names into a payment *and* a folio line in a single commit, that a
// replay adds neither, that a refusal resolves the same row and never touches
// the account, and that a callback the gateway did not sign adds nothing at all.
//
// **An attempt is a row, and the reference is what finds it again.** The row is
// committed before the payer is sent anywhere, so every callback that can arrive
// has one to resolve — which is what makes the reference's whole job naming the
// attempt, so a `PENDING` row becomes the payment instead of sitting beside it.
// Two kinds of case read that row without resolving it and post nothing: an
// amount the attempt was not opened for, and a callback claiming an outcome the
// row already contradicts.
//
// **A real database is not optional here.** Three of the claims are the
// database's own answers read back — the unique index refusing a replay, the
// rollback that takes a payment with a posting that failed, and the foreign key
// that refuses a stay nobody has. Every one of them would pass against a stand-in
// that had been written to agree, which is the same as not being tested.
//
// **The rows are committed rather than rolled back.** `FolioPort.getBalance`
// reads on the pool with no executor, exactly as the check-out guard calls it,
// so fixtures written inside an open transaction would be invisible to the one
// method the account is actually read through. The cost is cleanup, and this
// file pays it the way `folio-service.e2e-spec.ts` does: a posting cannot be
// deleted, so the ledger is truncated on the way in and on the way out.
//
// **The replays are concurrent, and the pool is this file's own** — sized above
// the concurrency it drives, because the application's is ten wide by design and
// borrowing it would quietly serialise the race into batches.
//
// No Nest application is booted. Every dependency the service takes is a
// constructor argument, so the subject is reachable with a `new` and this file
// stays independent of where the module happens to be registered.
//
// The gateway is the one thing stood in for, and that is where the line is:
// `FR-PAY-02` puts signature verification inside the maintained library behind
// the port and `vnpay.adapter.spec.ts` checks it against signatures computed
// from VNPay's own specification. Reaching the sandbox from here would test
// VNPay's uptime. Nothing else below is imitated — the folio, the ledger, the
// index and the transaction are all the real ones.
//
// The rollover hour is deliberately unreal — 11:00, where the property runs
// 04:00 — so that a posting dated from the calendar rather than from the
// business date cannot pass by coincidence. It is written into `system_config`
// below, because that row is where `BusinessDateService` reads it from; a file
// that set it in an environment variable would be asserting against a value
// nothing consults.

import "reflect-metadata";

import type { VndAmount } from "@mariva/shared";
import { ORPCError } from "@orpc/nest";
import { eq, getTableColumns, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { booking } from "../src/database/schema/booking.js";
import { systemConfig } from "../src/database/schema/config.js";
import { folio, folioPosting } from "../src/database/schema/folio.js";
import * as schema from "../src/database/schema/index.js";
import { roomType } from "../src/database/schema/inventory.js";
import { payment } from "../src/database/schema/payment.js";
import { TransactionRunner } from "../src/database/transaction-runner.js";
import { BusinessDateService } from "../src/modules/booking/business-date.service.js";
import { FolioService } from "../src/modules/folio/folio.service.js";
import { PaymentService } from "../src/modules/payment/payment.service.js";
import type {
  CallbackVerification,
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentGateway,
} from "../src/modules/payment/ports/payment-gateway.port.js";
import { SystemConfigService } from "../src/modules/system-config/system-config.service.js";

/** `FR-PAY-03`'s number. */
const REPLAYS = 10;

/** Not the property's 04:00 — see the note at the top. */
const ROLLOVER_HOUR = 11;

/**
 * The one row, as this file needs it.
 *
 * Only the hour matters here — a payment posts one line and levies nothing — but
 * the row has no defaults and cannot exist half-supplied, so the tax figures are
 * given too. They are deliberately not a property's: §8 forbids the tree to
 * carry a rate, and a fixture that read like a real one would be that defect in
 * a test's clothes.
 */
const CONFIGURED = {
  vatRateBps: 1_234,
  reducedVatFrom: null,
  reducedVatTo: null,
  vatIncludesServiceCharge: true,
  serviceChargeRateBps: 321,
  businessDateRolloverHour: ROLLOVER_HOUR,
} satisfies typeof systemConfig.$inferInsert;

/**
 * When the gateway says it took the money: 09:10 in Ho Chi Minh City on
 * 2 November, which is seven hours off the instant below.
 *
 * Before an 11:00 rollover, so the trading day it belongs to is the *first* of
 * November. A posting dated from the calendar would read 2027-11-02, and a
 * posting dated from this process's clock would read whatever day the suite ran.
 */
const PAID_AT = new Date("2027-11-02T02:10:00Z");
const MONEY_MOVED_ON = "2027-11-01";

const AMOUNT: VndAmount = 1_200_000n;

const RETURN_URL = "https://mariva.test/stay/payment/return";
const PAYER_ADDRESS = "203.0.113.44";

const ARRIVAL_DATE = "2027-11-02";
const DEPARTURE_DATE = "2027-11-05";

/** A uuid no booking has. */
const ABSENT_ID = "00000000-0000-4000-8000-000000000000";

/**
 * Whatever a callback carries. Nothing in this file reads it — the port does,
 * and here the port has been told what to answer.
 */
const A_CALLBACK = { vnp_ResponseCode: "00" } as const;

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let gateway: GatewayUnderTest;
let payments: PaymentService;
let folios: FolioService;
let roomTypeId: string;

// References are unique and every case here opens a stay of its own. Counted
// rather than drawn, so a failing run reproduces.
let bookingOrdinal = 0;

beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is unset — vitest.config.ts loads .env.test");
  }

  pool = new pg.Pool({ connectionString, max: REPLAYS + 10 });
  db = drizzle({ client: pool, schema });

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  await clearTheLedger();
  await db.execute(
    sql`truncate room_assignment, booking_night, booking, type_inventory, room, room_type, staff_session, staff_user restart identity cascade`,
  );

  // Written here rather than left to whatever booted last: the business date
  // every posting below is dated by is read off this row, so the file that
  // asserts the date is the file that states the hour.
  await db.execute(sql`truncate system_config`);
  await db.insert(systemConfig).values(CONFIGURED);

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

  gateway = new GatewayUnderTest();
  folios = new FolioService(db, new SystemConfigService());
  payments = new PaymentService(
    gateway,
    folios,
    new BusinessDateService(new SystemConfigService()),
    new TransactionRunner(db),
  );
});

afterAll(async () => {
  // Left standing, a folio holds a booking the next file's fixtures cannot
  // clear, and the failure surfaces several files away from its cause.
  await clearTheLedger();
  await pool?.end();
});

describe("opening an attempt", () => {
  it("hands back an address for the payer and records that money is outstanding", async () => {
    const bookingId = await aBooking();

    const opened = await payments.createPaymentRequest({
      bookingId,
      amount: AMOUNT,
      description: "Deposit against the stay",
      returnUrl: RETURN_URL,
      payerIpAddress: PAYER_ADDRESS,
    });

    // The reference is in the url because the gateway was asked to open the
    // attempt under it, and it is the only thing that will identify the payment
    // when the callback comes back.
    expect(opened.paymentUrl).toContain(opened.reference);
    expect(gateway.opened.at(-1)).toMatchObject({
      reference: opened.reference,
      amount: AMOUNT,
      returnUrl: RETURN_URL,
      payerIpAddress: PAYER_ADDRESS,
    });

    const attempts = await paymentsOn(bookingId);

    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      method: "VNPAY",
      // The row carries the reference the gateway was handed, which is what a
      // later callback matches on. Without it the row is unresolvable and the
      // stay ends up holding it beside whatever the payment turns out to be.
      attemptReference: opened.reference,
      amount: AMOUNT,
      status: "PENDING",
      // Nobody has paid, so there is no gateway id and no moment to date.
      gatewayTransactionId: null,
      paidAt: null,
      postedBy: null,
    });

    // Nothing has reached the account. An attempt is not money.
    expect(await linesOf(bookingId)).toHaveLength(0);
    expect(await folios.getBalance(bookingId)).toBe(0n);
  });

  it("refuses something that is not a booking id, before the payer is sent anywhere", async () => {
    // The guest-facing reference, which is the plausible mistake: it is what a
    // confirmation email shows and what a caller reads down a phone. A
    // reference built out of it could not be read back, so the attempt would be
    // money taken and never posted.
    const refusal = await refused(
      payments.createPaymentRequest({
        bookingId: "K7QX-2M9P",
        amount: AMOUNT,
        description: "Deposit against a stay named the wrong way",
        returnUrl: RETURN_URL,
        payerIpAddress: PAYER_ADDRESS,
      }),
    );

    expect(refusal.code).toBe("BAD_REQUEST");
  });

  it("refuses a well-formed id that names no stay, before the payer is sent anywhere", async () => {
    const asked = gateway.opened.length;

    const refusal = await refused(
      payments.createPaymentRequest({
        bookingId: ABSENT_ID,
        amount: AMOUNT,
        description: "Deposit against nobody's stay",
        returnUrl: RETURN_URL,
        payerIpAddress: PAYER_ADDRESS,
      }),
    );

    expect(refusal.code).toBe("NOT_FOUND");

    // The row goes in first, so the foreign key answers before the gateway is
    // asked for anything. Nothing was opened and there is nothing to abandon.
    expect(gateway.opened).toHaveLength(asked);
  });

  it("refuses an amount that is not money, before the payer is sent anywhere", async () => {
    // `payment_amount_is_positive` would refuse this at the other end, but as a
    // fault rather than as an answer — and only after a payer had been handed a
    // page to look at.
    const bookingId = await aBooking();
    const asked = gateway.opened.length;

    const refusal = await refused(
      payments.createPaymentRequest({
        bookingId,
        amount: 0n as VndAmount,
        description: "Deposit against a stay, for nothing",
        returnUrl: RETURN_URL,
        payerIpAddress: PAYER_ADDRESS,
      }),
    );

    expect(refusal.code).toBe("BAD_REQUEST");

    expect(gateway.opened).toHaveLength(asked);
    expect(await paymentsOn(bookingId)).toHaveLength(0);
  });
});

describe("a callback the gateway signed", () => {
  it("becomes a payment and a line on the account, in one commit", async () => {
    const attempt = await anAttempt();

    gateway.verification = takenBy(attempt.reference, "14528901");

    expect(await payments.handleIpn(A_CALLBACK)).toBe("RECORDED");

    const taken = (await paymentsOn(attempt.bookingId)).filter(
      (row) => row.status === "SUCCESS",
    );

    expect(taken).toHaveLength(1);
    expect(taken[0]).toMatchObject({
      method: "VNPAY",
      gatewayTransactionId: "14528901",
      amount: AMOUNT,
      // The gateway's clock and never this process's.
      paidAt: PAID_AT,
      // Nobody authored it: the callback writes on no person's authority.
      postedBy: null,
    });

    const lines = await linesOf(attempt.bookingId);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      type: "PAYMENT",
      // The sign convention is the ledger's, applied in one place — the payment
      // row carries the magnitude and the posting carries the direction.
      amount: -AMOUNT,
      postedBy: null,
    });

    // The one string that ties the guest's invoice line to the gateway's own
    // daily report, which is the comparison `FR-PAY-05` makes.
    expect(lines[0]?.description).toContain("14528901");

    // Nothing has been charged to this account, so what the guest has paid is
    // the whole of its balance — an over-payment reads negative, as
    // `FolioPort.getBalance` says it does.
    expect(await folios.getBalance(attempt.bookingId)).toBe(-AMOUNT);
  });

  it("dates the line by the day the money moved, not the day it was told", async () => {
    // `property-and-tariff.md` §2. A callback redelivered the next morning, or
    // replayed by hand a week later, has to land on the trading day the payment
    // happened in — otherwise a figure moves between two dates the property has
    // already reconciled, depending only on when the gateway got through.
    const attempt = await anAttempt();

    gateway.verification = takenBy(attempt.reference, "14528902");

    await payments.handleIpn(A_CALLBACK);

    const [line] = await linesOf(attempt.bookingId);

    expect(line?.businessDate).toBe(MONEY_MOVED_ON);
  });

  it("posts to the stay the reference names and to no other", async () => {
    // The whole of the correlation. The reference is the only thing a callback
    // carries that says whose money this is — a handler that resolved it any
    // other way would credit the wrong guest and balance perfectly while doing
    // it.
    const mine = await anAttempt();
    const somebodyElses = await anAttempt();

    gateway.verification = takenBy(mine.reference, "14528903");

    await payments.handleIpn(A_CALLBACK);

    expect(await folios.getBalance(mine.bookingId)).toBe(-AMOUNT);
    expect(await folios.getBalance(somebodyElses.bookingId)).toBe(0n);
  });

  it("refuses a reference whose stay does not exist", async () => {
    // Only a terminal holding the merchant secret can produce this, so it is a
    // misdirected gateway rather than a forgery — and there is still no account
    // to credit. The foreign key answers it, and nothing is half-written behind
    // the refusal.
    gateway.verification = takenBy(referenceNaming(ABSENT_ID), "14528904");

    const refusal = await refused(payments.handleIpn(A_CALLBACK));

    expect(refusal.code).toBe("NOT_FOUND");
    expect(await paymentsUnder("14528904")).toHaveLength(0);
  });
});

describe("the attempt a callback names", () => {
  it("is resolved in place, so a paid stay holds one row and not two", async () => {
    // The defect this closes. A `PENDING` row nothing could find again meant a
    // stay that had been paid ended up holding both it and a `SUCCESS` row, and
    // no reader of the table could say which of the two was the money.
    const attempt = await anAttempt();

    gateway.verification = {
      verified: true,
      transaction: {
        status: "PENDING",
        reference: attempt.reference,
        amount: AMOUNT,
      },
    };

    expect(await payments.handleIpn(A_CALLBACK)).toBe("STILL_OPEN");

    gateway.verification = takenBy(attempt.reference, "14528930");

    expect(await payments.handleIpn(A_CALLBACK)).toBe("RECORDED");

    const rows = await paymentsOn(attempt.bookingId);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      attemptReference: attempt.reference,
      status: "SUCCESS",
      gatewayTransactionId: "14528930",
      paidAt: PAID_AT,
    });
    expect(await folios.getBalance(attempt.bookingId)).toBe(-AMOUNT);
  });

  it("stays outstanding when the payer abandons it, and still says which attempt it was", async () => {
    // Three attempts on one stay and one of them paid. The two left `PENDING`
    // are not a defect and never were: a guest who opened checkout three times
    // abandoned two of them, and that is what happened. What the reference buys
    // is that each one can be named, asked about and resolved later — not that
    // none of them exists.
    const bookingId = await aBooking();
    const abandoned = await anAttemptOn(bookingId);
    const alsoAbandoned = await anAttemptOn(bookingId);
    const paid = await anAttemptOn(bookingId);

    gateway.verification = takenBy(paid.reference, "14528931");

    expect(await payments.handleIpn(A_CALLBACK)).toBe("RECORDED");

    const byReference = new Map(
      (await paymentsOn(bookingId)).map((row) => [row.attemptReference, row]),
    );

    expect(byReference.size).toBe(3);
    expect(byReference.get(abandoned.reference)?.status).toBe("PENDING");
    expect(byReference.get(alsoAbandoned.reference)?.status).toBe("PENDING");
    expect(byReference.get(paid.reference)?.status).toBe("SUCCESS");

    // One payment on the account, and it is the one that was actually made.
    expect(await linesOf(bookingId)).toHaveLength(1);
    expect(await folios.getBalance(bookingId)).toBe(-AMOUNT);
  });

  it("posts nothing when this property has no record of the attempt", async () => {
    // `createPaymentRequest` commits the attempt's row before the payer is sent
    // anywhere, so a signed callback naming a reference with no row is not an
    // attempt whose write was lost — it is somebody else's order, or this
    // property's own reference format having been changed under attempts that
    // were already open. Inventing the payment from the callback would post a
    // figure nothing here can be held against.
    const attempt = await anAttempt();

    await db
      .delete(payment)
      .where(eq(payment.attemptReference, attempt.reference));

    gateway.verification = takenBy(attempt.reference, "14528932");

    const refusal = await refused(payments.handleIpn(A_CALLBACK));

    expect(refusal.code).toBe("NOT_FOUND");

    expect(await paymentsOn(attempt.bookingId)).toHaveLength(0);
    expect(await linesOf(attempt.bookingId)).toHaveLength(0);
    expect(await paymentsUnder("14528932")).toHaveLength(0);
  });
});

describe("a callback contradicting what the attempt already says", () => {
  it("posts nothing when the gateway reports success over a refusal it filed", async () => {
    // A gateway reports more than once about one attempt and nothing orders
    // the deliveries, so this handler sees them in whatever order they land. A
    // refusal filed first and a success after is money the gateway says it took
    // against an attempt already closed the other way — and
    // `status = 'PENDING'` alone cannot tell that from a replay, which is the
    // reading that would answer "already recorded" and post nothing at all.
    const attempt = await anAttempt();

    gateway.verification = {
      verified: true,
      transaction: {
        status: "FAILED",
        reference: attempt.reference,
        amount: AMOUNT,
      },
    };

    expect(await payments.handleIpn(A_CALLBACK)).toBe("REFUSED");

    gateway.verification = takenBy(attempt.reference, "14528933");

    const refusal = await refused(payments.handleIpn(A_CALLBACK));

    expect(refusal.code).toBe("CONFLICT");

    // The refusal on file is left exactly as it was. Nothing here is entitled
    // to decide which of the two the gateway meant.
    const rows = await paymentsOn(attempt.bookingId);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "FAILED",
      gatewayTransactionId: null,
      paidAt: null,
    });

    expect(await linesOf(attempt.bookingId)).toHaveLength(0);
    expect(await folios.getBalance(attempt.bookingId)).toBe(0n);
  });

  it("leaves the account alone when a refusal arrives after the money did", async () => {
    // The same contradiction pointing the other way, and the more dangerous of
    // the two: read as a redelivered refusal, it would answer "refused" about a
    // payment that is on the guest's account and settled their balance.
    const attempt = await anAttempt();

    gateway.verification = takenBy(attempt.reference, "14528934");

    expect(await payments.handleIpn(A_CALLBACK)).toBe("RECORDED");

    gateway.verification = {
      verified: true,
      transaction: {
        status: "FAILED",
        reference: attempt.reference,
        amount: AMOUNT,
      },
    };

    const refusal = await refused(payments.handleIpn(A_CALLBACK));

    expect(refusal.code).toBe("CONFLICT");

    const rows = await paymentsOn(attempt.bookingId);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "SUCCESS",
      gatewayTransactionId: "14528934",
    });

    // The money the second callback says did not move is still on the account.
    expect(await linesOf(attempt.bookingId)).toHaveLength(1);
    expect(await folios.getBalance(attempt.bookingId)).toBe(-AMOUNT);
  });

  it("posts nothing when a second gateway transaction claims one attempt", async () => {
    // Not a replay — a replay names the same transaction, and this names
    // another. `payment_gateway_transaction_unique_key` is what refuses it, and
    // reading that refusal as idempotency would drop a real second payment on
    // the floor while telling the gateway it had been recorded.
    const first = await anAttempt();
    const second = await anAttemptOn(first.bookingId);

    gateway.verification = takenBy(first.reference, "14528935");

    expect(await payments.handleIpn(A_CALLBACK)).toBe("RECORDED");

    gateway.verification = takenBy(second.reference, "14528935");

    const refusal = await refused(payments.handleIpn(A_CALLBACK));

    expect(refusal.code).toBe("CONFLICT");

    // One payment, one line, and the second attempt still outstanding.
    expect(await paymentsUnder("14528935")).toHaveLength(1);
    expect(await linesOf(first.bookingId)).toHaveLength(1);

    const stillOpen = (await paymentsOn(first.bookingId)).filter(
      (row) => row.attemptReference === second.reference,
    );

    expect(stillOpen[0]).toMatchObject({ status: "PENDING" });
  });
});

describe("a callback naming an amount the attempt was not opened for", () => {
  it("posts nothing, and leaves the attempt outstanding", async () => {
    // Not a forgery: `FR-PAY-02` has the gateway sign the amount, so a payer who
    // edits it produces a callback that fails verification and never reaches
    // here. This is the bookkeeping case — a terminal, a currency scale or a
    // merchant account disagreeing with the property — and posting it would put
    // a figure on a guest's invoice that no attempt of theirs accounts for.
    const attempt = await anAttempt();

    gateway.verification = {
      verified: true,
      transaction: {
        status: "SUCCESS",
        reference: attempt.reference,
        amount: AMOUNT + 100_000n,
        gatewayTransactionId: "14528950",
        paidAt: PAID_AT,
      },
    };

    const refusal = await refused(payments.handleIpn(A_CALLBACK));

    expect(refusal.code).toBe("CONFLICT");

    // The whole transaction is back. The attempt reads exactly what it read
    // before — money claimed and not yet confirmed — and somebody now has to
    // look at it.
    const rows = await paymentsOn(attempt.bookingId);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "PENDING",
      amount: AMOUNT,
      gatewayTransactionId: null,
      paidAt: null,
    });

    expect(await linesOf(attempt.bookingId)).toHaveLength(0);
    expect(await folios.getBalance(attempt.bookingId)).toBe(0n);
    expect(await paymentsUnder("14528950")).toHaveLength(0);
  });

  it("takes the payment once a callback names the amount that was asked for", async () => {
    // The refusal above is a reconciliation event and not a verdict on the
    // attempt. Nothing was written, so the row is still `PENDING` and still
    // resolvable — which is the difference between refusing to post and
    // inventing a fifth `payment_status` to park it in.
    const attempt = await anAttempt();

    gateway.verification = {
      verified: true,
      transaction: {
        status: "SUCCESS",
        reference: attempt.reference,
        amount: AMOUNT - 1n,
        gatewayTransactionId: "14528951",
        paidAt: PAID_AT,
      },
    };

    await refused(payments.handleIpn(A_CALLBACK));

    gateway.verification = takenBy(attempt.reference, "14528952");

    expect(await payments.handleIpn(A_CALLBACK)).toBe("RECORDED");
    expect(await paymentsOn(attempt.bookingId)).toHaveLength(1);
    expect(await folios.getBalance(attempt.bookingId)).toBe(-AMOUNT);
  });
});

describe("the same callback delivered again", () => {
  const GATEWAY_TRANSACTION_ID = "14528910";

  let replayed: Attempt;

  beforeAll(async () => {
    replayed = await anAttempt();
  });

  it("is one payment and one line when ten arrive at once", async () => {
    // Ten handlers, ten transactions, one gateway id. One of them reaches the
    // index first and the other nine are told `23505` — which this service
    // catches rather than pre-empting with a read, because between a read and
    // an insert there is nothing holding the key and both handlers find nothing.
    gateway.verification = takenBy(replayed.reference, GATEWAY_TRANSACTION_ID);

    const outcomes = await Promise.all(
      Array.from({ length: REPLAYS }, () => payments.handleIpn(A_CALLBACK)),
    );

    expect(outcomes.filter((each) => each === "RECORDED")).toHaveLength(1);
    expect(outcomes.filter((each) => each === "ALREADY_RECORDED")).toHaveLength(
      REPLAYS - 1,
    );

    // The assertions the requirement is actually about, read from the tables
    // rather than inferred from the answers.
    expect(await paymentsUnder(GATEWAY_TRANSACTION_ID)).toHaveLength(1);
    expect(await linesOf(replayed.bookingId)).toHaveLength(1);
    expect(await folios.getBalance(replayed.bookingId)).toBe(-AMOUNT);
  });

  it("is still one when the eleventh arrives an hour later", async () => {
    // The sequential replay, which is the delivery VNPay actually retries. It
    // is the easy half and it is here because an index built on the wrong
    // column could still pass the concurrent case by accident of ordering.
    gateway.verification = takenBy(replayed.reference, GATEWAY_TRANSACTION_ID);

    expect(await payments.handleIpn(A_CALLBACK)).toBe("ALREADY_RECORDED");

    expect(await paymentsUnder(GATEWAY_TRANSACTION_ID)).toHaveLength(1);
    expect(await linesOf(replayed.bookingId)).toHaveLength(1);
    expect(await folios.getBalance(replayed.bookingId)).toBe(-AMOUNT);
  });
});

describe("a callback the gateway did not sign", () => {
  it("posts nothing and refuses", async () => {
    // The route it arrives on is unguarded on purpose — the gateway has no
    // session and the signature *is* the authentication — so anyone may post to
    // it. Recorded as a failed payment, this would be a `FAILED` row per
    // crawler on a table a guest's question is answered from.
    const attempt = await anAttempt();

    gateway.verification = { verified: false };

    const refusal = await refused(payments.handleIpn(A_CALLBACK));

    expect(refusal.code).toBe("UNAUTHORIZED");

    // The attempt's own pending row and nothing else.
    expect(await paymentsOn(attempt.bookingId)).toHaveLength(1);
    expect(await linesOf(attempt.bookingId)).toHaveLength(0);
  });
});

describe("a payment the gateway refused", () => {
  it("is kept, and the account is left alone", async () => {
    // `schema/payment.ts`: a refused payment is what a guest asking "why was I
    // not charged" is asking about, and `FR-PAY-05` reconciles two reports
    // rather than one report and an absence.
    const attempt = await anAttempt();

    gateway.verification = {
      verified: true,
      transaction: {
        status: "FAILED",
        reference: attempt.reference,
        amount: AMOUNT,
      },
    };

    expect(await payments.handleIpn(A_CALLBACK)).toBe("REFUSED");

    const kept = (await paymentsOn(attempt.bookingId)).filter(
      (row) => row.status === "FAILED",
    );

    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({
      // No money moved, so there is no transaction to name and no moment to
      // date — both directions of `payment_paid_at_exactly_when_money_moved`.
      gatewayTransactionId: null,
      paidAt: null,
    });

    expect(await linesOf(attempt.bookingId)).toHaveLength(0);
    expect(await folios.getBalance(attempt.bookingId)).toBe(0n);
  });

  it("is one row however many times the gateway delivers the refusal", async () => {
    // A refusal carries no gateway transaction id and cannot —
    // `GatewayTransaction` will not name a transaction nobody paid — so the
    // index that makes a success idempotent does not reach it. The reference is
    // what does: the attempt's own row is resolved, and the second and third
    // deliveries find it already terminal and write nothing.
    const attempt = await anAttempt();

    gateway.verification = {
      verified: true,
      transaction: {
        status: "FAILED",
        reference: attempt.reference,
        amount: AMOUNT,
      },
    };

    expect(await payments.handleIpn(A_CALLBACK)).toBe("REFUSED");
    expect(await payments.handleIpn(A_CALLBACK)).toBe("REFUSED");
    expect(await payments.handleIpn(A_CALLBACK)).toBe("REFUSED");

    const rows = await paymentsOn(attempt.bookingId);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      attemptReference: attempt.reference,
      status: "FAILED",
      gatewayTransactionId: null,
      paidAt: null,
    });

    expect(await linesOf(attempt.bookingId)).toHaveLength(0);
    expect(await folios.getBalance(attempt.bookingId)).toBe(0n);
  });

  it("writes nothing at all while the payer may still finish", async () => {
    const attempt = await anAttempt();

    gateway.verification = {
      verified: true,
      transaction: {
        status: "PENDING",
        reference: attempt.reference,
        amount: AMOUNT,
      },
    };

    expect(await payments.handleIpn(A_CALLBACK)).toBe("STILL_OPEN");

    // Only the row the request that opened the attempt wrote.
    expect(await paymentsOn(attempt.bookingId)).toHaveLength(1);
    expect(await linesOf(attempt.bookingId)).toHaveLength(0);
  });
});

describe("a posting the ledger refuses", () => {
  it("leaves no payment committed behind it", async () => {
    // `NFR-02` reconciles the payment against the posting nightly, so a payment
    // committed without its line fails that identity every night after — and in
    // the meantime shows a receptionist a balance the guest has already
    // settled. The two go in one transaction, and this is the half that proves
    // it: the ledger refuses *after* the payment row has been written, and both
    // have to be gone.
    const attempt = await anAttempt();
    const gatewayTransactionId = "14528920";

    gateway.verification = takenBy(attempt.reference, gatewayTransactionId);

    const refusal = await refused(
      new PaymentService(
        gateway,
        new LedgerThatRefuses(db, new SystemConfigService()),
        new BusinessDateService(new SystemConfigService()),
        new TransactionRunner(db),
      ).handleIpn(A_CALLBACK),
    );

    expect(refusal.code).toBe("CONFLICT");
    expect(await paymentsUnder(gatewayTransactionId)).toHaveLength(0);
    expect(await linesOf(attempt.bookingId)).toHaveLength(0);

    // And the gateway's next delivery of the same callback still posts, because
    // the rollback left nothing holding the key. A handler that had committed
    // the payment would answer this one "already recorded" and never write the
    // line at all.
    expect(await payments.handleIpn(A_CALLBACK)).toBe("RECORDED");
    expect(await folios.getBalance(attempt.bookingId)).toBe(-AMOUNT);
  });
});

/** A stay, and the reference one attempt on it was opened under. */
interface Attempt {
  readonly bookingId: string;
  readonly reference: string;
}

/** A stay of its own with one attempt open on it, where most cases start. */
async function anAttempt(): Promise<Attempt> {
  return await anAttemptOn(await aBooking());
}

/** A further attempt on a stay that already has one — a guest who opened
 *  checkout again rather than a second stay. */
async function anAttemptOn(bookingId: string): Promise<Attempt> {
  const { reference } = await payments.createPaymentRequest({
    bookingId,
    amount: AMOUNT,
    description: "Deposit against the stay",
    returnUrl: RETURN_URL,
    payerIpAddress: PAYER_ADDRESS,
  });

  return { bookingId, reference };
}

/** What the gateway reports about an attempt it says it collected on. */
function takenBy(reference: string, gatewayTransactionId: string): CallbackVerification {
  return {
    verified: true,
    transaction: {
      status: "SUCCESS",
      reference,
      amount: AMOUNT,
      gatewayTransactionId,
      paidAt: PAID_AT,
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
      reference: `MRV-PAYSVC-${String(bookingOrdinal).padStart(4, "0")}`,
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

/** Both ledger tables and the payments hanging off them, emptied. A posting
 *  cannot be deleted, so `truncate` is the only way back. */
async function clearTheLedger(): Promise<void> {
  await db.execute(
    sql`truncate payment, folio_posting, folio restart identity cascade`,
  );
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

/**
 * The port, answering whatever the case has told it to.
 *
 * The only stand-in in this file, and the boundary it stands at is the one
 * `FR-PAY-01` draws: everything on this side of it is the property's own
 * vocabulary, so a case can state what a gateway reported without knowing how
 * VNPay would have said it.
 */
class GatewayUnderTest implements PaymentGateway {
  /** What the next callback verifies to. */
  verification: CallbackVerification = { verified: false };

  /** Every attempt it has been asked to open, in order. */
  readonly opened: CreatePaymentInput[] = [];

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    this.opened.push(input);

    // Shaped like the address VNPay hands back, and carrying the reference for
    // the same reason VNPay's does: it is what identifies the attempt.
    return await Promise.resolve({
      paymentUrl: `https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?vnp_TxnRef=${input.reference}`,
    });
  }

  async verifyCallback(): Promise<CallbackVerification> {
    return await Promise.resolve(this.verification);
  }

  async refund(): Promise<never> {
    throw new Error("no case here refunds — `FR-PAY-04` is its own work");
  }

  async queryTransaction(): Promise<never> {
    throw new Error("no case here queries the gateway");
  }
}

/**
 * The real ledger, refusing to post.
 *
 * Injected at the collaborator boundary rather than provoked from the database,
 * and deliberately so: nothing among `folio_posting`'s own constraints can
 * refuse a payment line that the `payment` table has already accepted, which is
 * exactly why the atomicity of the pair needs a test rather than a constraint.
 * Everything else about this ledger is the real one — the folio it opens, the
 * executor it takes, and the rollback it participates in.
 */
class LedgerThatRefuses extends FolioService {
  override async postPayment(): Promise<string> {
    throw new ORPCError("CONFLICT", {
      message: "the account would not take the line",
    });
  }
}
