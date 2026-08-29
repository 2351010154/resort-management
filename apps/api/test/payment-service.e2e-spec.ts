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
// **Opening that attempt also buys the stay time**, when the stay is one the
// funnel is still holding: the hold's expiry is pushed out to cover the round
// trip the payer is about to make, and never pulled in. Proved here because the
// interesting half is the database's — a stay that is no longer held must come
// back as nothing written rather than as the check constraint aborting the
// transaction the attempt is in. `hold-expiry.e2e-spec.ts` proves the other end
// of it, that the sweep then leaves the stay alone.
//
// **Money landing on a stay nobody can honour pages somebody, and the page is
// the last thing that happens.** A stay the sweep cancelled while the payer was
// at the gateway keeps the payment and stays cancelled — that much was already
// true and is proved below — and now says so to whoever is on call, because
// somebody has to refund it by hand. Three things about that page are the
// property rather than the message: it goes out once however many times the
// gateway redelivers, it does not go out at all when the transaction rolled
// back, and it goes out *after* the commit. The last is proved by having the
// alerter read the payment table on this file's own pool at the moment it is
// called: a page sent from inside the handler's transaction would see nothing
// there.
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

import { noAccrual } from "./accrual.js";
import "reflect-metadata";

import type { VndAmount } from "@mariva/shared";
import { ORPCError } from "@orpc/nest";
import { eq, getTableColumns, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { PinoLogger } from "nestjs-pino";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Env } from "../src/config/env.js";
import { booking } from "../src/database/schema/booking.js";
import { systemConfig } from "../src/database/schema/config.js";
import { folio, folioPosting } from "../src/database/schema/folio.js";
import * as schema from "../src/database/schema/index.js";
import { roomType } from "../src/database/schema/inventory.js";
import { payment } from "../src/database/schema/payment.js";
import { TransactionRunner } from "../src/database/transaction-runner.js";
import { BookingTokenService } from "../src/modules/auth/booking-token/booking-token.service.js";
import { AssignmentService } from "../src/modules/booking/assignment.service.js";
import { BookingService } from "../src/modules/booking/booking.service.js";
import { BusinessDateService } from "../src/modules/booking/business-date.service.js";
import { FolioStubService } from "../src/modules/booking/ports/folio-stub.service.js";
import { StayQuoteService } from "../src/modules/booking/stay-quote.service.js";
import { FolioService } from "../src/modules/folio/folio.service.js";
import { GuestService } from "../src/modules/guest/guest.service.js";
import { HousekeepingService } from "../src/modules/housekeeping/housekeeping.service.js";
import { InventoryService } from "../src/modules/inventory/inventory.service.js";
import { BookingConfirmationService } from "../src/modules/notification/booking-confirmation.service.js";
import type { MailQueue } from "../src/modules/notification/mail-queue.service.js";
import type {
  MailerService,
  OutgoingEmail,
} from "../src/modules/notification/mailer.service.js";
import {
  type OpsAlert,
  OpsAlertService,
} from "../src/modules/notification/ops-alert.service.js";
import { GatewayRegistry } from "../src/modules/payment/ports/gateway-registry.js";
import { PaymentService } from "../src/modules/payment/payment.service.js";
import type {
  CallbackVerification,
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentGateway,
} from "../src/modules/payment/ports/payment-gateway.port.js";
import { SystemConfigService } from "../src/modules/system-config/system-config.service.js";
import { noCancellations } from "./no-announcement.js";
import { tiersAt } from "./tiers.js";

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
  standardVatRateBps: 1_234,
  reducedVatRateBps: 2_468,
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

const MS_PER_MINUTE = 60_000;

/**
 * How long an attempt buys the hold it is opened against, in this suite.
 *
 * Neither the shipped fifteen nor the hour this file's TTL is set to, so a case
 * that passed against either rather than against the extension would fail.
 */
const PAYMENT_WINDOW_MINUTES = 30;

/**
 * How far a deadline written by Postgres may sit from one computed here — the
 * extension is `now()` on the database's clock, and every assertion measures
 * from this process's.
 */
const CLOCK_SLACK_MINUTES = 1;

/**
 * Whatever a callback carries. Nothing in this file reads it — the port does,
 * and here the port has been told what to answer.
 */
const A_CALLBACK = { vnp_ResponseCode: "00" } as const;

/**
 * The gateway every attempt here is opened at and every callback arrives
 * through, named the property's way.
 *
 * One constant rather than a literal per call, because the two sides of it are
 * an invariant this file now depends on: an attempt is claimable only through
 * the gateway it was opened at, so a case that named different methods on the
 * two would be asserting the refusal instead of the payment.
 */
const THE_GATEWAY = "VNPAY";

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let gateway: GatewayUnderTest;
let gateways: GatewayRegistry;
let payments: PaymentService;
let folios: FolioService;
let bookings: BookingService;
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
  // Bound under the method every attempt and every callback below names. The
  // service resolves its adapter per attempt and may only claim an attempt
  // opened at the gateway a callback arrived through, so the two have to agree
  // and this is the one place that is stated.
  gateways = new GatewayRegistry({ [THE_GATEWAY]: gateway });
  folios = new FolioService(db, new SystemConfigService(), noAccrual);
  bookings = realBookings();
  payments = new PaymentService(
    gateways,
    folios,
    new BusinessDateService(new SystemConfigService()),
    // Real, and it has to be. A callback that takes money confirms the stay it
    // was held for in the same commit, so a stand-in here would let this file
    // pass while the transition it is now responsible for never happened. The
    // ownership half of this dependency is still never reached — every attempt
    // opened below is the desk's, with a null `guestAccountId` — and that half
    // is proven in `guest-account-link.e2e-spec.ts` and `payment-api.e2e-spec.ts`.
    bookings,
    new TransactionRunner(db),
    // Real in shape and recording rather than dispatching: what a page says is
    // part of what this file proves, and *when* it is sent is the rest of it —
    // see {@link AlerterUnderTest}.
    new AlerterUnderTest(),
    // Real, like the business date beside it. Every attempt opened here is
    // through a gateway that collects đồng, so the rate is never read — and a
    // cast would fail the day one of them was opened through a gateway that
    // cannot.
    new SystemConfigService(),
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
      method: THE_GATEWAY,
      amount: AMOUNT,
      description: "Deposit against the stay",
      returnUrl: RETURN_URL,
      payerIpAddress: PAYER_ADDRESS,
      guestAccountId: null,
    });

    // The reference is in the url because the gateway was asked to open the
    // attempt under it, and it is the only thing that will identify the payment
    // when the callback comes back.
    expect(opened.paymentUrl).toContain(opened.reference);
    // No account travels in this, and the port's own shape is what guarantees
    // it: whose stay it is decides whether the attempt may be opened at all, and
    // it is settled here rather than being something a gateway is told.
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
        method: THE_GATEWAY,
        amount: AMOUNT,
        description: "Deposit against a stay named the wrong way",
        returnUrl: RETURN_URL,
        payerIpAddress: PAYER_ADDRESS,
        guestAccountId: null,
      }),
    );

    expect(refusal.code).toBe("BAD_REQUEST");
  });

  it("refuses a well-formed id that names no stay, before the payer is sent anywhere", async () => {
    const asked = gateway.opened.length;

    const refusal = await refused(
      payments.createPaymentRequest({
        bookingId: ABSENT_ID,
        method: THE_GATEWAY,
        amount: AMOUNT,
        description: "Deposit against nobody's stay",
        returnUrl: RETURN_URL,
        payerIpAddress: PAYER_ADDRESS,
        guestAccountId: null,
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
        method: THE_GATEWAY,
        amount: 0n as VndAmount,
        description: "Deposit against a stay, for nothing",
        returnUrl: RETURN_URL,
        payerIpAddress: PAYER_ADDRESS,
        guestAccountId: null,
      }),
    );

    expect(refusal.code).toBe("BAD_REQUEST");

    expect(gateway.opened).toHaveLength(asked);
    expect(await paymentsOn(bookingId)).toHaveLength(0);
  });
});

describe("the hold an attempt is opened against", () => {
  it("is given long enough to survive the round trip that is about to start", async () => {
    // The defect this closes. The TTL starts running when a room is picked and
    // paying is the last thing that happens under it, so a guest who reaches the
    // payment page with a minute left has `hold-expiry-sweep.ts` cancel their
    // stay while the bank app is still open — and the callback then finds a
    // booking that is no longer `HELD`, posts the money, and confirms nothing.
    const held = await aHold(1);

    await anAttemptOn(held);

    const left = await minutesLeftOn(held);

    expect(left).toBeGreaterThan(PAYMENT_WINDOW_MINUTES - CLOCK_SLACK_MINUTES);
    expect(left).toBeLessThan(PAYMENT_WINDOW_MINUTES + CLOCK_SLACK_MINUTES);
  });

  it("keeps the longer deadline it already had", async () => {
    // The extension may only ever lengthen a hold. A stay with an hour on it —
    // the desk's own, or one whose guest opened checkout twice — must not have
    // pressing pay shorten the room it is holding.
    const held = await aHold(60);
    const before = (await stayOf(held)).holdExpiresAt;

    await anAttemptOn(held);

    expect((await stayOf(held)).holdExpiresAt).toEqual(before);
  });

  it("is the desk's hold too, since a gateway is no faster for a receptionist", async () => {
    // Every attempt in this file is opened with a null `guestAccountId`, which is
    // the desk. The window is sized for the payer's round trip and nothing about
    // who pressed the button changes how long a bank takes — a hold cancelled
    // under a payment link the desk sent loses the property the same room.
    const held = await aHold(1);

    await anAttemptOn(held);

    expect(await minutesLeftOn(held)).toBeGreaterThan(
      PAYMENT_WINDOW_MINUTES - CLOCK_SLACK_MINUTES,
    );
  });

  it("is not invented for a stay that is no longer being held", async () => {
    // `booking_hold_expiry_exactly_when_held` refuses an expiry on any row that
    // is not `HELD`, and the extension runs inside the transaction that writes
    // the attempt — so a balance collected against a stay that is not a hold has
    // to leave the row alone rather than roll the attempt back on a constraint.
    const settled = await aBooking();

    const opened = await anAttemptOn(settled);

    // The attempt was committed, which is the half a violation would have taken.
    const attempts = await paymentsOn(settled);

    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      attemptReference: opened.reference,
      status: "PENDING",
    });

    const stay = await stayOf(settled);

    expect(stay.state).toBe("CONFIRMED");
    expect(stay.holdExpiresAt).toBeNull();
  });
});

describe("a callback the gateway signed", () => {
  it("becomes a payment and a line on the account, in one commit", async () => {
    const attempt = await anAttempt();

    gateway.verification = takenBy(attempt.reference, "14528901");

    expect(await payments.handleIpn(A_CALLBACK, THE_GATEWAY)).toBe("RECORDED");

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

    await payments.handleIpn(A_CALLBACK, THE_GATEWAY);

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

    await payments.handleIpn(A_CALLBACK, THE_GATEWAY);

    expect(await folios.getBalance(mine.bookingId)).toBe(-AMOUNT);
    expect(await folios.getBalance(somebodyElses.bookingId)).toBe(0n);
  });

  it("refuses a reference whose stay does not exist", async () => {
    // Only a terminal holding the merchant secret can produce this, so it is a
    // misdirected gateway rather than a forgery — and there is still no account
    // to credit. The foreign key answers it, and nothing is half-written behind
    // the refusal.
    gateway.verification = takenBy(referenceNaming(ABSENT_ID), "14528904");

    const refusal = await refused(payments.handleIpn(A_CALLBACK, THE_GATEWAY));

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

    expect(await payments.handleIpn(A_CALLBACK, THE_GATEWAY)).toBe("STILL_OPEN");

    gateway.verification = takenBy(attempt.reference, "14528930");

    expect(await payments.handleIpn(A_CALLBACK, THE_GATEWAY)).toBe("RECORDED");

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

    expect(await payments.handleIpn(A_CALLBACK, THE_GATEWAY)).toBe("RECORDED");

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

    const refusal = await refused(payments.handleIpn(A_CALLBACK, THE_GATEWAY));

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

    expect(await payments.handleIpn(A_CALLBACK, THE_GATEWAY)).toBe("REFUSED");

    gateway.verification = takenBy(attempt.reference, "14528933");

    const refusal = await refused(payments.handleIpn(A_CALLBACK, THE_GATEWAY));

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

    expect(await payments.handleIpn(A_CALLBACK, THE_GATEWAY)).toBe("RECORDED");

    gateway.verification = {
      verified: true,
      transaction: {
        status: "FAILED",
        reference: attempt.reference,
        amount: AMOUNT,
      },
    };

    const refusal = await refused(payments.handleIpn(A_CALLBACK, THE_GATEWAY));

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

    expect(await payments.handleIpn(A_CALLBACK, THE_GATEWAY)).toBe("RECORDED");

    gateway.verification = takenBy(second.reference, "14528935");

    const refusal = await refused(payments.handleIpn(A_CALLBACK, THE_GATEWAY));

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

    const refusal = await refused(payments.handleIpn(A_CALLBACK, THE_GATEWAY));

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

    await refused(payments.handleIpn(A_CALLBACK, THE_GATEWAY));

    gateway.verification = takenBy(attempt.reference, "14528952");

    expect(await payments.handleIpn(A_CALLBACK, THE_GATEWAY)).toBe("RECORDED");
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
      Array.from({ length: REPLAYS }, () => payments.handleIpn(A_CALLBACK, THE_GATEWAY)),
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

    expect(await payments.handleIpn(A_CALLBACK, THE_GATEWAY)).toBe("ALREADY_RECORDED");

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

    const refusal = await refused(payments.handleIpn(A_CALLBACK, THE_GATEWAY));

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

    expect(await payments.handleIpn(A_CALLBACK, THE_GATEWAY)).toBe("REFUSED");

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

    expect(await payments.handleIpn(A_CALLBACK, THE_GATEWAY)).toBe("REFUSED");
    expect(await payments.handleIpn(A_CALLBACK, THE_GATEWAY)).toBe("REFUSED");
    expect(await payments.handleIpn(A_CALLBACK, THE_GATEWAY)).toBe("REFUSED");

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

    expect(await payments.handleIpn(A_CALLBACK, THE_GATEWAY)).toBe("STILL_OPEN");

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
        gateways,
        new LedgerThatRefuses(db, new SystemConfigService(), noAccrual),
        new BusinessDateService(new SystemConfigService()),
        bookings,
        new TransactionRunner(db),
        new AlerterUnderTest(),
        new SystemConfigService(),
      ).handleIpn(A_CALLBACK, THE_GATEWAY),
    );

    expect(refusal.code).toBe("CONFLICT");
    expect(await paymentsUnder(gatewayTransactionId)).toHaveLength(0);
    expect(await linesOf(attempt.bookingId)).toHaveLength(0);

    // And the gateway's next delivery of the same callback still posts, because
    // the rollback left nothing holding the key. A handler that had committed
    // the payment would answer this one "already recorded" and never write the
    // line at all.
    expect(await payments.handleIpn(A_CALLBACK, THE_GATEWAY)).toBe("RECORDED");
    expect(await folios.getBalance(attempt.bookingId)).toBe(-AMOUNT);
  });
});

describe("the stay a callback pays for", () => {
  it("is confirmed by the money, and stops being a hold", async () => {
    // The transition `booking-state-machine.md` §3 captions "deposit taken",
    // and the reason this file now builds a real `BookingService`. A guest
    // holds no capability that reaches `booking.confirm`, so if the callback
    // does not make this move nothing does — and `hold-expiry-sweep.ts` cancels
    // the stay two minutes later, releasing a room that has been paid for.
    const attempt = await anAttemptOn(await aHold());

    gateway.verification = takenBy(attempt.reference, "14528960");

    expect(await payments.handleIpn(A_CALLBACK, THE_GATEWAY)).toBe("RECORDED");

    const stay = await stayOf(attempt.bookingId);

    expect(stay.state).toBe("CONFIRMED");
    // The expiry goes with the state, and this is the half the sweep reads. A
    // confirmed stay still carrying a TTL is a date the sweep can act on, and
    // what it would do with it is cancel a sold room.
    expect(stay.holdExpiresAt).toBeNull();

    // And nothing was written to. `aHold` names no contact, which is what a
    // walk-in and a desk booking are, and a confirmation composed for one of
    // those would be a message with nowhere to go.
    expect(queuedConfirmations).toHaveLength(0);
  });

  it("keeps the money and the confirmation in one commit", async () => {
    // The ledger refuses after the payment row and the transition are both
    // written. All three have to be gone, and the stay in particular has to be
    // holding still — a confirmation that survived a failed posting would be a
    // room taken off the market for a payment that never landed.
    const held = await aHold();
    const attempt = await anAttemptOn(held);

    gateway.verification = takenBy(attempt.reference, "14528961");

    await refused(
      new PaymentService(
        gateways,
        new LedgerThatRefuses(db, new SystemConfigService(), noAccrual),
        new BusinessDateService(new SystemConfigService()),
        bookings,
        new TransactionRunner(db),
        new AlerterUnderTest(),
        new SystemConfigService(),
      ).handleIpn(A_CALLBACK, THE_GATEWAY),
    );

    const stay = await stayOf(held);

    expect(stay.state).toBe("HELD");
    expect(stay.holdExpiresAt).not.toBeNull();
  });

  it("is left where it stands when the money is a balance rather than a deposit", async () => {
    // `aBooking` opens a `CONFIRMED` stay, which is what a guest paying at the
    // desk or on departure is. `confirm` would answer a later state with
    // `409 IllegalTransition`, and the caller is inside the transaction that
    // posts the money — so a refusal here would roll back a payment the gateway
    // has already taken. The money posts and the state does not move.
    const attempt = await anAttempt();

    gateway.verification = takenBy(attempt.reference, "14528962");

    expect(await payments.handleIpn(A_CALLBACK, THE_GATEWAY)).toBe("RECORDED");

    expect((await stayOf(attempt.bookingId)).state).toBe("CONFIRMED");
    expect(await folios.getBalance(attempt.bookingId)).toBe(-AMOUNT);
  });

  it("keeps a callback that arrives after the sweep from being refused", async () => {
    // The race the TTL makes real: the payer finished, and the hold expired
    // before VNPay's notification arrived. `CANCELLED` is terminal, so there is
    // no transition to make — and refusing the callback would leave the gateway
    // holding money this property had no record of. It posts, the cancellation
    // stands, and `FR-PAY-05`'s sweep is what puts the pair in front of somebody
    // who can hand the money back.
    const held = await aHold();
    const attempt = await anAttemptOn(held);

    await cancelledLikeTheSweep(held);

    gateway.verification = takenBy(attempt.reference, "14528963");

    expect(await payments.handleIpn(A_CALLBACK, THE_GATEWAY)).toBe("RECORDED");

    expect((await stayOf(held)).state).toBe("CANCELLED");
    expect(await folios.getBalance(held)).toBe(-AMOUNT);
  });
});

describe("money landing on a stay nobody can honour", () => {
  it("posts it, leaves the stay cancelled, and wakes somebody about it", async () => {
    // The other half of the case above, and the whole of what this adds. The
    // money is real, the room is gone, and nothing in the system will hand it
    // back on its own — `FR-PAY-04`'s refund is a person's act at the gateway.
    // Until this page existed, the only thing that would ever surface the pair
    // was `FR-PAY-05`'s nightly comparison, which is a night late for a guest
    // who is watching their statement.
    const held = await aHold();
    const attempt = await anAttemptOn(held);
    const { reference } = await stayOf(held);

    await cancelledLikeTheSweep(held);

    gateway.verification = takenBy(attempt.reference, "14528970");

    expect(await payments.handleIpn(A_CALLBACK, THE_GATEWAY)).toBe("RECORDED");

    // Posted, and the stay left exactly where the sweep left it. A page that
    // had cost the guest their payment, or quietly resurrected the booking,
    // would be a worse answer than the silence it replaced.
    expect(await folios.getBalance(held)).toBe(-AMOUNT);
    expect((await stayOf(held)).state).toBe("CANCELLED");

    const raised = pagesAbout(reference);

    expect(raised).toHaveLength(1);

    // Everything the responder needs to act without opening a console: which
    // stay, what state it is in, how much to hand back, and the two strings the
    // gateway's own merchant screen is searched by.
    expect(raised[0]!.alert.kind).toBe("payment-on-cancelled-stay");
    expect(raised[0]!.alert.details).toMatchObject({
      reference,
      state: "CANCELLED",
      // A string, because `bigint` does not survive `JSON.stringify` and the
      // figure is the one thing this message exists to state.
      amount: AMOUNT.toString(),
      gatewayTransactionId: "14528970",
      paidAt: PAID_AT.toISOString(),
    });
    // The sentence a human reads first has to stand on its own — a receiver
    // that renders `text` and drops the rest is the ordinary Slack webhook.
    expect(raised[0]!.alert.text).toContain(reference);
    expect(raised[0]!.alert.text).toContain(AMOUNT.toString());
  });

  it("wakes them once, however many times the gateway delivers the callback", async () => {
    // The IPN is redelivered until it is acknowledged, so a page per delivery
    // is a phone ringing all night about one payment. The replay never reaches
    // the stay: the attempt already records this transaction, so the handler
    // raises its sentinel and rolls back before anything lands.
    const held = await aHold();
    const attempt = await anAttemptOn(held);
    const { reference } = await stayOf(held);

    await cancelledLikeTheSweep(held);

    gateway.verification = takenBy(attempt.reference, "14528971");

    const outcomes = [
      await payments.handleIpn(A_CALLBACK, THE_GATEWAY),
      await payments.handleIpn(A_CALLBACK, THE_GATEWAY),
      await payments.handleIpn(A_CALLBACK, THE_GATEWAY),
    ];

    // Asserted before the outcomes, because the page count is the claim and the
    // outcomes are how it is arrived at: a handler that stopped telling the two
    // deliveries apart should fail this case on the phone that rang twice.
    expect(pagesAbout(reference)).toHaveLength(1);
    expect(outcomes).toEqual([
      "RECORDED",
      "ALREADY_RECORDED",
      "ALREADY_RECORDED",
    ]);
  });

  it("wakes nobody when the posting was refused and no money landed", async () => {
    // The page is registered inside the transaction and dispatched by
    // `TransactionRunner` only after it commits, so a transaction that rolls
    // back throws it away unrun. Anything else pages somebody about a payment
    // that is not on any account — a responder sent to refund money the
    // property never took.
    const held = await aHold();
    const attempt = await anAttemptOn(held);
    const { reference } = await stayOf(held);

    await cancelledLikeTheSweep(held);

    gateway.verification = takenBy(attempt.reference, "14528972");

    await refused(
      new PaymentService(
        gateways,
        new LedgerThatRefuses(db, new SystemConfigService(), noAccrual),
        new BusinessDateService(new SystemConfigService()),
        bookings,
        new TransactionRunner(db),
        new AlerterUnderTest(),
        new SystemConfigService(),
      ).handleIpn(A_CALLBACK, THE_GATEWAY),
    );

    expect(await linesOf(held)).toHaveLength(0);
    expect(pagesAbout(reference)).toHaveLength(0);
  });

  it("has the money on the account by the time the page goes out", async () => {
    // The ordering, proved rather than asserted about the source. The alerter
    // reads the payment table on this file's own pool — a different connection
    // from the one the transaction is on — so a page raised from inside that
    // transaction would see nothing, and the count below would be zero.
    //
    // Which is what makes this a claim about the connection pool too:
    // `page` is a `fetch` with a timeout, and one dispatched inside the
    // transaction would hold a connection open for the length of a vendor round
    // trip. `database.module.ts` sizes the pool at ten.
    const held = await aHold();
    const attempt = await anAttemptOn(held);
    const { reference } = await stayOf(held);

    await cancelledLikeTheSweep(held);

    gateway.verification = takenBy(attempt.reference, "14528973");

    expect(await payments.handleIpn(A_CALLBACK, THE_GATEWAY)).toBe("RECORDED");

    expect(pagesAbout(reference)[0]!.paymentsCommitted).toBe(1);
  });

  it("takes the payment even when the pager itself fails", async () => {
    // `OpsAlertService` never throws — its own file argues that at length — but
    // the guarantee this file needs is one level down and does not depend on
    // that promise being kept: work registered for after the commit cannot
    // reach back through a commit that has already happened. A payment that a
    // failed notification could undo would be the property refusing money it
    // has taken because it could not tell anybody it had.
    const held = await aHold();
    const attempt = await anAttemptOn(held);

    await cancelledLikeTheSweep(held);

    gateway.verification = takenBy(attempt.reference, "14528974");

    const outcome = await new PaymentService(
      gateways,
      folios,
      new BusinessDateService(new SystemConfigService()),
      bookings,
      new TransactionRunner(db),
      new AlerterThatCannotDeliver(),
      new SystemConfigService(),
    ).handleIpn(A_CALLBACK, THE_GATEWAY);

    expect(outcome).toBe("RECORDED");
    expect(await folios.getBalance(held)).toBe(-AMOUNT);
  });
});

describe("money landing on a stay the property can still honour", () => {
  it("wakes nobody when it is the deposit that confirms a hold", async () => {
    const held = await aHold();
    const attempt = await anAttemptOn(held);
    const { reference } = await stayOf(held);

    gateway.verification = takenBy(attempt.reference, "14528975");

    expect(await payments.handleIpn(A_CALLBACK, THE_GATEWAY)).toBe("RECORDED");

    expect((await stayOf(held)).state).toBe("CONFIRMED");
    expect(pagesAbout(reference)).toHaveLength(0);
  });

  it("wakes nobody when it is a balance on a stay already confirmed", async () => {
    // `booking-state-machine.md` §1 gives `CONFIRMED` a balance, so this is the
    // desk taking a card for a stay it confirmed off-line — ordinary money, and
    // a pager that cried about it would be muted inside a week.
    const attempt = await anAttempt();
    const { reference } = await stayOf(attempt.bookingId);

    gateway.verification = takenBy(attempt.reference, "14528976");

    expect(await payments.handleIpn(A_CALLBACK, THE_GATEWAY)).toBe("RECORDED");

    expect(pagesAbout(reference)).toHaveLength(0);
  });

  it("wakes nobody when the guest did not arrive and the charge stands", async () => {
    // `NO_SHOW` is the state this decision turned on. It is a stay that did not
    // happen, but §3 levies a no-show charge on it and §1 leaves the arrival
    // night on the folio, so there is money genuinely owing — and §2 makes
    // `NO_SHOW → CHECKED_IN` legal, so a guest who landed at 02:00 may still be
    // given the room. Paging "nobody can honour this stay" would be telling a
    // responder something untrue about both.
    const attempt = await anAttempt();
    const { reference } = await stayOf(attempt.bookingId);

    await db
      .update(booking)
      .set({ state: "NO_SHOW" })
      .where(eq(booking.id, attempt.bookingId));

    gateway.verification = takenBy(attempt.reference, "14528977");

    expect(await payments.handleIpn(A_CALLBACK, THE_GATEWAY)).toBe("RECORDED");

    expect(await folios.getBalance(attempt.bookingId)).toBe(-AMOUNT);
    expect(pagesAbout(reference)).toHaveLength(0);
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
    method: THE_GATEWAY,
    amount: AMOUNT,
    description: "Deposit against the stay",
    returnUrl: RETURN_URL,
    payerIpAddress: PAYER_ADDRESS,
    guestAccountId: null,
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

/**
 * A stay the funnel is still holding — the state a guest's own payment arrives
 * against.
 *
 * Inserted rather than taken through `BookingService.createHold`, for the same
 * reason {@link aBooking} is: this file is about what a callback does to a stay,
 * and a hold taken through the funnel would also consume inventory that nothing
 * here gives back. The TTL is set well ahead so that no case races the clock;
 * `hold-expiry.e2e-spec.ts` is where an expiry that has actually fallen due is
 * proven.
 *
 * `minutesLeft` is for the cases about the window an attempt buys: a hold with
 * an hour on it is one no extension could be seen against, since the extension
 * may only ever lengthen a deadline.
 */
async function aHold(minutesLeft = 60): Promise<string> {
  bookingOrdinal += 1;

  const [stay] = await db
    .insert(booking)
    .values({
      reference: `MRV-PAYHLD-${String(bookingOrdinal).padStart(4, "0")}`,
      state: "HELD",
      holdExpiresAt: new Date(Date.now() + minutesLeft * MS_PER_MINUTE),
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

/**
 * The state a stay is in now, whether it is still counting down, and what a
 * person calls it.
 *
 * The reference comes back because it is what a page carries: a responder
 * searches by it, so an assertion against a uuid would be checking a string
 * nobody in the message ever sees.
 */
async function stayOf(
  bookingId: string,
): Promise<{ reference: string; state: string; holdExpiresAt: Date | null }> {
  const [stay] = await db
    .select({
      reference: booking.reference,
      state: booking.state,
      holdExpiresAt: booking.holdExpiresAt,
    })
    .from(booking)
    .where(eq(booking.id, bookingId));

  return stay!;
}

/**
 * A hold the sweep has already taken, written the way it leaves one.
 *
 * Written directly rather than through `BookingService.cancel`, and shaped by
 * two of `booking`'s own constraints: `booking_hold_expiry_exactly_when_held`
 * refuses a stay that is no longer being held while still carrying the date it
 * would be released on, and
 * `booking_records_a_cancellation_instant_exactly_when_cancelled` refuses a
 * cancellation nobody dated. The sweep also gives the nights back; this file's
 * stays never took any, so releasing inventory that was never consumed is the
 * one part of it that is left out.
 */
async function cancelledLikeTheSweep(bookingId: string): Promise<void> {
  await db
    .update(booking)
    .set({
      state: "CANCELLED",
      cancellationReason: "HOLD_EXPIRED",
      cancelledAt: new Date(),
      holdExpiresAt: null,
    })
    .where(eq(booking.id, bookingId));
}

/** Every page raised about one stay, in the order they went out. */
function pagesAbout(reference: string): RaisedPage[] {
  return pagesRaised.filter(
    (page) => page.alert.details.reference === reference,
  );
}

/** How much of a hold is left, from now, in minutes. */
async function minutesLeftOn(bookingId: string): Promise<number> {
  const { holdExpiresAt } = await stayOf(bookingId);

  if (!holdExpiresAt) {
    throw new Error("that stay is not holding anything");
  }

  return (holdExpiresAt.getTime() - Date.now()) / MS_PER_MINUTE;
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

/** Signs the confirmation's two links. Any value will do — nothing in this file
 *  follows one — but it has to be a value, because the key is derived at
 *  construction. */
const CONFIRMATION_SECRET = "a-secret-at-least-thirty-two-characters-long";

/** Every confirmation the transition handed over. Empty is the expectation:
 *  none of these stays names anybody to write to. */
const queuedConfirmations: OutgoingEmail[] = [];

const confirmationsQueued = {
  enqueue: async (email: OutgoingEmail) => {
    queuedConfirmations.push(email);
  },
} as unknown as MailQueue;

/**
 * The real booking service, wired the way `booking.module.ts` wires it.
 *
 * Real rather than stubbed because the transition a paid callback performs is
 * now part of what this file proves, and a stand-in would confirm nothing while
 * reporting that it had. Every collaborator below is the genuine one except the
 * folio port, which is the stub `booking.module.ts` binds for the same reason it
 * exists at all — `FolioPort` is the edge a cancellation posts a penalty
 * through, and nothing this file drives cancels anything.
 *
 * The two check-in flags are off and the TTL is an hour. Neither is read on the
 * path under test: `confirmPaidHold` moves `HELD → CONFIRMED`, which consumes no
 * inventory, asks no housekeeping question, and clears the expiry rather than
 * computing one. They are named so the `Env` is a value rather than a cast over
 * an empty object, and so a later reader can see they were considered.
 *
 * The payment window beside them *is* read, on the other path this file drives:
 * opening an attempt extends the hold it is opened against, and that figure is
 * how far.
 */
function realBookings(): BookingService {
  const inventory = new InventoryService();
  const businessDate = new BusinessDateService(new SystemConfigService());
  const quotes = new StayQuoteService();
  const housekeeping = new HousekeepingService();

  return new BookingService(
    inventory,
    quotes,
    businessDate,
    new AssignmentService(inventory, businessDate, quotes, housekeeping),
    new GuestService(),
    housekeeping,
    new FolioStubService(),
    {
      BOOKING_HOLD_TTL_MINUTES: 60,
      // Read on the path an attempt opens: the stay is given this long from now
      // to finish paying, and never less than it already had.
      BOOKING_PAYMENT_WINDOW_MINUTES: PAYMENT_WINDOW_MINUTES,
      BOOKING_EARLY_CHECK_IN_ENABLED: false,
      BOOKING_DIRTY_ROOM_CHECK_IN_ENABLED: false,
      // Read only where a confirmation is composed: it is the origin the two
      // links in that message point at.
      WEB_ORIGIN: "https://mariva.test",
      BETTER_AUTH_SECRET: CONFIRMATION_SECRET,
    } as Env,
    new BookingTokenService({
      BETTER_AUTH_SECRET: CONFIRMATION_SECRET,
      NODE_ENV: "test",
    } as Env),
    // Real, over a queue that records rather than delivers. The stays this file
    // pays for carry no contact address, so nothing should reach it — a message
    // arriving here would mean the confirmation had stopped asking whether there
    // was anybody to send one to.
    new BookingConfirmationService(
      undefined as unknown as MailerService,
      confirmationsQueued,
      undefined as unknown as PinoLogger,
    ),
    // §7's ladder, reached only where a stay is sold to a signed-in guest.
    tiersAt(businessDate),
    // Nothing here cancels a confirmed stay that names somebody to write to, so
    // a cancellation reaching this stub is a gate that moved rather than a
    // message this file meant to send.
    noCancellations,
  );
}

/** A page that went out, and what the account already said when it did. */
interface RaisedPage {
  readonly alert: OpsAlert;

  /**
   * How many payment rows carried this page's gateway transaction id at the
   * moment it was sent, read on this file's pool.
   *
   * One is the whole of the post-commit claim. The read is on a different
   * connection from the one the handler's transaction is on, so a page raised
   * from inside that transaction sees the row it has not committed yet as
   * absent, and this is zero.
   */
  readonly paymentsCommitted: number;
}

/**
 * Every page any service in this file raised, oldest first.
 *
 * Shared across the alerters below rather than held per instance, because two
 * cases build a service of their own and every case reads its pages back
 * through {@link pagesAbout}, which is scoped by the stay rather than by who
 * sent it.
 */
const pagesRaised: RaisedPage[] = [];

/**
 * The real alerter's shape, recording rather than dispatching.
 *
 * Subclassed so the method's signature is the genuine one — a rename or a
 * changed return type is a compile error here rather than a case that quietly
 * stops observing anything. `page` is what is replaced and only `page`: what a
 * webhook POST does with the body is `ops-alert.service.spec.ts`'s, and
 * reaching an endpoint from here would be testing somebody's uptime.
 */
class AlerterUnderTest extends OpsAlertService {
  constructor() {
    super(undefined as unknown as Env, undefined as unknown as PinoLogger);
  }

  override async page(alert: OpsAlert): Promise<boolean> {
    pagesRaised.push({
      alert,
      paymentsCommitted: (
        await paymentsUnder(String(alert.details.gatewayTransactionId))
      ).length,
    });

    return true;
  }
}

/**
 * An alerter that cannot deliver, and says so the way the real one never
 * would — by throwing.
 *
 * Stronger than an unconfigured endpoint on purpose: `OpsAlertService` promises
 * never to throw, and the guarantee under test is the one that holds even if
 * that promise is broken.
 */
class AlerterThatCannotDeliver extends OpsAlertService {
  constructor() {
    super(undefined as unknown as Env, undefined as unknown as PinoLogger);
  }

  override async page(): Promise<never> {
    throw new Error("the on-call endpoint is unreachable");
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
