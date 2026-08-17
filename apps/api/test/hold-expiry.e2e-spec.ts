// The TTL that gives a hold's rooms back — `FR-BOOK-02`, second half.
//
// `booking-lifecycle.e2e-spec.ts` proves the first half: a hold consumes every
// night of its stay the moment the funnel takes it. That leaves the property one
// sweep away from selling nothing, because a hold nobody pays for consumes those
// nights for good — so the claim under test here is arithmetic on
// `type_inventory` and not a state column. A suite that checked the booking read
// `CANCELLED` would pass against a sweep that never touched a counter, which is
// the only failure that costs the property a room.
//
// Three things are asserted that the sweep could plausibly get wrong, and each is
// a night the property would lose or a stay it would break:
//
// - a hold whose TTL has run out is cancelled and its nights released;
// - a hold still inside its TTL, and a booking that was confirmed out of one,
//   are both left exactly as they were;
// - a second pass over the same transaction finds nothing — the property
//   `job-runner.service.ts` enforces on every run, checked here against the real
//   sweep rather than against a probe.
//
// **A hold now dies at the earlier of two clocks**, and the second one is the
// guest: the funnel says every twenty seconds that it is still open, and a hold
// falls due a grace after the last of those. That adds three claims, and two of
// them are the ones a mistake would be expensive in:
//
// - presence may only ever bring the moment forward. A hold pinged continuously
//   still dies at its TTL, because a browser that could push the deadline out
//   would be a way to keep a room off the shelf for as long as a script kept
//   asking — the exact abuse the caps in `booking.service.ts` exist to bound.
// - a hold released *early* is never one with money in flight. A guest paying by
//   QR code is in a banking app with the tab backgrounded, which is precisely
//   when presence is absent and precisely the worst moment to resell their room.
// - the TTL path is unchanged, `PENDING` attempt or not. That is a separate
//   decision about inventory the property has not taken, and a suite that did not
//   pin it would let it be changed by accident.
//
// **What keeps a paying guest's room, then, is the TTL itself moving.** Opening
// a payment attempt extends `hold_expires_at` to cover the round trip, which is
// the one thing in the tree that pushes that deadline out — so the claim this
// file has to hold is the two behaviours meeting: an attempt opened through the
// real service, and the sweep run straight afterwards taking nothing. It is
// asserted through `PaymentService` rather than by writing the column, because a
// case that moved the deadline itself would prove only that the sweep can read a
// date this file chose.
//
// Both clocks are moved with a direct `update` on the row. The alternative is a
// suite that waits out a real TTL, and the floor on `BOOKING_HOLD_TTL_MINUTES` is
// one minute — the columns are what the sweep reads, so writing one is the same
// event as a clock reaching it.
//
// No Nest application is booted for the behaviour, for the reason
// `booking-lifecycle.e2e-spec.ts` gives: the subject is a sweep, a service and
// the rows underneath them. One case does boot the container, and only to answer
// the question the wiring turns on — whether the sweep is registered at all. A
// sweep that works and is in nobody's registry is the exact shape of the gap
// this file closes.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import type { RoomTypeCode, StayDate } from "@mariva/shared";
import { Test } from "@nestjs/testing";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import type { Env } from "../src/config/env.js";
import { SystemConfigService } from "../src/modules/system-config/system-config.service.js";
import { booking } from "../src/database/schema/booking.js";
import { folio } from "../src/database/schema/folio.js";
import { payment } from "../src/database/schema/payment.js";
import * as schema from "../src/database/schema/index.js";
import { roomType, typeInventory } from "../src/database/schema/inventory.js";
import { seedDatabase } from "../src/database/seed/seed.js";
import { TransactionRunner } from "../src/database/transaction-runner.js";
import { JobRunner } from "../src/jobs/job-runner.service.js";
import { JobsModule } from "../src/jobs/jobs.module.js";
import { AssignmentService } from "../src/modules/booking/assignment.service.js";
import {
  type Booking,
  BookingService,
  type CreateBookingInput,
} from "../src/modules/booking/booking.service.js";
import { BusinessDateService } from "../src/modules/booking/business-date.service.js";
import { HoldExpirySweep } from "../src/modules/booking/hold-expiry-sweep.js";
import { FolioStubService } from "../src/modules/booking/ports/folio-stub.service.js";
import { StayQuoteService } from "../src/modules/booking/stay-quote.service.js";
import { FolioService } from "../src/modules/folio/folio.service.js";
import { GuestService } from "../src/modules/guest/guest.service.js";
import { HousekeepingService } from "../src/modules/housekeeping/housekeeping.service.js";
import { InventoryService } from "../src/modules/inventory/inventory.service.js";
import type { OpsAlertService } from "../src/modules/notification/ops-alert.service.js";
import { PaymentService } from "../src/modules/payment/payment.service.js";
import type {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentGateway,
} from "../src/modules/payment/ports/payment-gateway.port.js";
import { noAccrual } from "./accrual.js";
import { noConfirmations, noStayLinks } from "./no-announcement.js";
import { tiersAt } from "./tiers.js";

const SEED_FROM = parseDate("2027-06-01");

const CHECK_IN = "2028-02-10";
const CHECK_OUT = "2028-02-13";

/** The nights a three-night stay sells, arrival first — never the departure. */
const NIGHTS = [CHECK_IN, "2028-02-11", "2028-02-12"] as const;

const HOLD_TTL_MINUTES = 15;

/**
 * How long a hold outlives the guest standing on it, in this suite.
 *
 * Two minutes, which is the shipped default, and comfortably inside the TTL
 * above — so a hold released early here is released by presence and could not
 * have been released by the TTL, which is what makes the two claims separable.
 */
const HOLD_GRACE_SECONDS = 120;

/**
 * How long opening a payment attempt buys the hold it is opened against.
 *
 * Comfortably past the TTL above, which is what makes the extension visible: a
 * hold written past due and then paid for has a deadline that could only have
 * come from the attempt.
 */
const PAYMENT_WINDOW_MINUTES = 20;

/**
 * The property's day, stopped at the first night the seed prices.
 *
 * Every stay below arrives in its future, so the arrival guard passes on its
 * merits rather than on what today happens to be — `booking-lifecycle.e2e-spec.ts`
 * makes the argument. Only the instant is fixed; the hour and the zone stay the
 * real service's.
 */
class StoppedClock extends BusinessDateService {
  constructor(private readonly today: StayDate) {
    super(new SystemConfigService());
  }

  override async current(): Promise<StayDate> {
    return this.today;
  }
}

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let bookings: BookingService;
let sweep: HoldExpirySweep;
let payments: PaymentService;

beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is unset — vitest.config.ts loads .env.test");
  }

  pool = new pg.Pool({ connectionString });
  db = drizzle({ client: pool, schema });

  await migrate(db, { migrationsFolder: "./src/database/migrations" });
  await seedDatabase(db, { from: SEED_FROM, bookings: 0 });

  const inventory = new InventoryService();
  const clock = new StoppedClock(SEED_FROM);

  bookings = new BookingService(
    inventory,
    new StayQuoteService(),
    clock,
    new AssignmentService(
      inventory,
      clock,
      new StayQuoteService(),
      new HousekeepingService(),
    ),
    new GuestService(),
    new HousekeepingService(),
    new FolioStubService(),
    environment(),
    // Neither is reached here: the confirmation email is minted and queued only
    // by the transition a paid hold makes, which nothing in this file drives.
    // Stubs that say so if they are, rather than casts that say nothing.
    noStayLinks,
    noConfirmations,
    // §7's ladder, reached only where a stay is sold to a signed-in guest.
    tiersAt(clock),
  );

  sweep = new HoldExpirySweep(bookings, environment());

  // The real service, because the claim is what *opening an attempt* does to a
  // hold: a case that wrote the attempt's row, or the deadline, itself would
  // prove only that this file can write a date the sweep reads. The gateway is
  // the one thing stood in for, at the boundary `FR-PAY-01` draws — nothing here
  // sends a payer anywhere, and `vnpay.adapter.spec.ts` is where that port is
  // earned. The ledger and the transaction are the real ones, since the
  // extension has to be in the same commit as the attempt.
  payments = new PaymentService(
    new GatewayThatOpensAnything(),
    new FolioService(db, new SystemConfigService(), noAccrual),
    new BusinessDateService(new SystemConfigService()),
    bookings,
    new TransactionRunner(db),
    // Never reached: a page is raised only when money lands on a stay the
    // property cannot honour, and nothing here resolves a callback at all —
    // every case stops at the attempt and the deadline it bought. A stub that
    // says so by name rather than a cast that says nothing.
    {
      page: () => {
        throw new Error(
          "OpsAlertService.page was reached from a suite that resolves no " +
            "callback, so no money has landed anywhere to page about",
        );
      },
    } as unknown as OpsAlertService,
  );
});

/** The three figures this suite turns on, in the shape every reader takes them. */
function environment(): Env {
  return {
    BOOKING_HOLD_TTL_MINUTES: HOLD_TTL_MINUTES,
    BOOKING_HOLD_GRACE_SECONDS: HOLD_GRACE_SECONDS,
    BOOKING_PAYMENT_WINDOW_MINUTES: PAYMENT_WINDOW_MINUTES,
  } as Env;
}

// Every case counts rooms, so each starts against the property as the seed laid
// it down — a case reading a counter another one left behind is reading a number
// nobody chose. The cascade takes the folios and attempts the money cases write
// with it.
beforeEach(async () => {
  await db.execute(sql`truncate booking restart identity cascade`);
  await db.update(typeInventory).set({ soldRooms: 0 });
});

afterAll(async () => {
  await pool?.end();
});

describe("a hold whose TTL has run out", () => {
  it("gives back every night it was consuming", async () => {
    const held = await createHold(stay("DELUXE", CHECK_IN, CHECK_OUT));

    expect(await soldOn("DELUXE", NIGHTS)).toEqual([1, 1, 1]);

    await expire(held.id);
    const cancelled = await runSweep();

    expect(cancelled).toEqual([held.id]);
    expect(await soldOn("DELUXE", NIGHTS)).toEqual([0, 0, 0]);
  });

  it("is cancelled under the reason only the sweep may write", async () => {
    const held = await createHold(stay("DELUXE", CHECK_IN, CHECK_OUT));

    await expire(held.id);
    await runSweep();

    const [row] = await db.select().from(booking).where(eq(booking.id, held.id));

    expect(row!.state).toBe("CANCELLED");
    // `contract/booking.ts` excludes `HOLD_EXPIRED` from the reasons a desk may
    // send, so this row can only have been written by the sweep — which is what
    // makes the reason worth asserting rather than an implementation detail.
    expect(row!.cancellationReason).toBe("HOLD_EXPIRED");
    // `booking_hold_expiry_exactly_when_held` refuses a cancelled row that kept
    // its expiry, so a sweep that left one would fail here as a constraint
    // violation rather than as this assertion. Both are the same claim.
    expect(row!.holdExpiresAt).toBeNull();
  });

  it("takes every expired hold in one pass, not the first one it finds", async () => {
    const first = await createHold(stay("DELUXE", CHECK_IN, CHECK_OUT));
    const second = await createHold(stay("DELUXE", CHECK_IN, CHECK_OUT));

    expect(await soldOn("DELUXE", NIGHTS)).toEqual([2, 2, 2]);

    await expire(first.id);
    await expire(second.id);

    expect(await runSweep()).toHaveLength(2);
    expect(await soldOn("DELUXE", NIGHTS)).toEqual([0, 0, 0]);
  });
});

describe("a hold the sweep must not touch", () => {
  it("leaves one that is still inside its TTL", async () => {
    const held = await createHold(stay("DELUXE", CHECK_IN, CHECK_OUT));

    expect(await runSweep()).toEqual([]);

    const [row] = await db.select().from(booking).where(eq(booking.id, held.id));

    expect(row!.state).toBe("HELD");
    expect(await soldOn("DELUXE", NIGHTS)).toEqual([1, 1, 1]);
  });

  it("leaves a stay that was confirmed out of a hold", async () => {
    const held = await createHold(stay("DELUXE", CHECK_IN, CHECK_OUT));
    await db.transaction((exec) => bookings.confirm(exec, held.id));

    // The confirmation cleared the expiry, so there is nothing for the predicate
    // to match — which is the guarantee, stated the way the sweep sees it. A
    // deposit taken and then swept is the failure this case exists for.
    await expire(held.id, { onlyIfHeld: true });

    expect(await runSweep()).toEqual([]);

    const [row] = await db.select().from(booking).where(eq(booking.id, held.id));

    expect(row!.state).toBe("CONFIRMED");
    expect(await soldOn("DELUXE", NIGHTS)).toEqual([1, 1, 1]);
  });
});

describe("a hold whose guest has stopped being there", () => {
  it("is released a grace later, long before its TTL", async () => {
    const held = await createHold(stay("DELUXE", CHECK_IN, CHECK_OUT));

    expect(await soldOn("DELUXE", NIGHTS)).toEqual([1, 1, 1]);

    // Not touched: the expiry is still a quarter of an hour away, so a sweep
    // that took this row read the presence clock and nothing else.
    await lastSeen(held.id, HOLD_GRACE_SECONDS + 30);

    expect(await runSweep()).toEqual([held.id]);
    expect(await soldOn("DELUXE", NIGHTS)).toEqual([0, 0, 0]);
  });

  it("is left alone while it is only late, not absent", async () => {
    // Inside the grace, which is what makes the grace worth having: a guest in a
    // lift, on a lock screen, or between two failed pings has not left, and a
    // sweep that took this row would be releasing rooms out from under guests
    // who are still buying them.
    const held = await createHold(stay("DELUXE", CHECK_IN, CHECK_OUT));

    await lastSeen(held.id, HOLD_GRACE_SECONDS - 30);

    expect(await runSweep()).toEqual([]);
    expect(await soldOn("DELUXE", NIGHTS)).toEqual([1, 1, 1]);
  });

  it("is filed as the expiry it is, under the one reason a sweep may write", async () => {
    // One reason for both clocks. Which of the two deadlines arrived first is
    // not a fact anybody prices, reports or acts on differently, and a second
    // code would split one event by a detail no reader of it has a use for.
    const held = await createHold(stay("DELUXE", CHECK_IN, CHECK_OUT));

    await lastSeen(held.id, HOLD_GRACE_SECONDS + 30);
    await runSweep();

    const [row] = await db.select().from(booking).where(eq(booking.id, held.id));

    expect(row!.state).toBe("CANCELLED");
    expect(row!.cancellationReason).toBe("HOLD_EXPIRED");
  });

  it("is not one that was taken with no browser behind it", async () => {
    // A hold from a seed, a fixture or a service call has nobody to be present
    // or absent, so its `last_seen_at` is null and only the TTL governs it.
    // Reading a null as "last seen at the beginning of time" would have this
    // sweep cancel every such hold on its first tick.
    const held = await createHold(stay("DELUXE", CHECK_IN, CHECK_OUT));

    await db
      .update(booking)
      .set({ lastSeenAt: null })
      .where(eq(booking.id, held.id));

    expect(await runSweep()).toEqual([]);
    expect(await stateOf(held.id)).toBe("HELD");
  });
});

describe("what presence cannot do", () => {
  it("cannot hold a room past the TTL, however often the guest says they are there", async () => {
    // The one claim the whole feature has to be incapable of breaking. A browser
    // that could push a deadline out is a way to keep a room off the shelf for
    // as long as a script keeps asking, which is exactly the abuse the caps in
    // `booking.service.ts` are written for — so the sweep takes the *earlier* of
    // the two instants and a hold pinged continuously still dies at its TTL.
    const held = await createHold(stay("DELUXE", CHECK_IN, CHECK_OUT));

    await expire(held.id);
    // Present this very second, which is the most a funnel can ever claim.
    await lastSeen(held.id, 0);

    expect(await runSweep()).toEqual([held.id]);
    expect(await soldOn("DELUXE", NIGHTS)).toEqual([0, 0, 0]);
  });
});

describe("a hold with money already on its way", () => {
  it("survives the guest disappearing entirely", async () => {
    // The guest is in their banking app with the QR code up and this tab
    // backgrounded or gone — the single likeliest moment for presence to stop
    // arriving, and the single worst moment to put their room back on sale. The
    // TTL still governs it; nothing else does.
    const held = await createHold(stay("DELUXE", CHECK_IN, CHECK_OUT));

    await payingFor(held.id);
    await lastSeen(held.id, HOLD_GRACE_SECONDS * 10);

    expect(await runSweep()).toEqual([]);
    expect(await stateOf(held.id)).toBe("HELD");
    expect(await soldOn("DELUXE", NIGHTS)).toEqual([1, 1, 1]);
  });

  it("is not saved by an attempt that came to nothing", async () => {
    // `PENDING` is the whole of "in flight". An attempt that failed is money
    // that is not coming, so the hold behind it is an abandoned one like any
    // other — and a sweep that read "has an attempt" instead of "has a pending
    // attempt" would leave a room held by every guest whose card was declined.
    const held = await createHold(stay("DELUXE", CHECK_IN, CHECK_OUT));

    await payingFor(held.id, "FAILED");
    await lastSeen(held.id, HOLD_GRACE_SECONDS + 30);

    expect(await runSweep()).toEqual([held.id]);
  });

  it("is given more of it by the attempt that was just opened", async () => {
    // The two behaviours meeting, and the failure they exist to prevent: the
    // guest pressed pay near the end of the TTL, VNPay took longer than what was
    // left, and the sweep cancelled a room the gateway was at that moment
    // collecting for — after which the callback finds a stay that is no longer
    // `HELD`, posts the money and confirms nothing.
    //
    // The deadline is written past due before the attempt opens rather than
    // waited out, for the reason the header gives: the column *is* what the sweep
    // reads, so moving it is the same event as the clock reaching it. What the
    // case then turns on is that the row is still `HELD` when the payer arrives,
    // which is every moment between the TTL passing and the sweep's next tick.
    const held = await createHold(stay("DELUXE", CHECK_IN, CHECK_OUT));

    await expire(held.id);
    await payFor(held);

    expect(await runSweep()).toEqual([]);
    expect(await stateOf(held.id)).toBe("HELD");
    expect(await soldOn("DELUXE", NIGHTS)).toEqual([1, 1, 1]);
  });

  it("is still cancelled when it is the TTL that ran out", async () => {
    // Deliberately unchanged, and pinned so it is not tidied up in passing. A
    // hold whose TTL has passed is cancelled whether or not an attempt is open:
    // `confirmPaidHold` and the nightly reconciliation are the property's answer
    // to a callback that lands after the room has gone, and guarding this branch
    // would be a room held indefinitely by an attempt nobody ever finishes.
    const held = await createHold(stay("DELUXE", CHECK_IN, CHECK_OUT));

    await payingFor(held.id);
    await expire(held.id);

    expect(await runSweep()).toEqual([held.id]);
    expect(await soldOn("DELUXE", NIGHTS)).toEqual([0, 0, 0]);
  });
});

describe("the sweep as the runner requires it", () => {
  it("changes nothing on a second pass over the same transaction", async () => {
    const held = await createHold(stay("DELUXE", CHECK_IN, CHECK_OUT));
    await expire(held.id);

    // Exactly what `JobRunner` does before it commits: run, and if anything was
    // touched, run again and require nothing. A sweep failing this is rolled
    // back whole rather than discovered later in a counter that drifted.
    const [first, second] = await db.transaction(async (exec) => [
      await sweep.run(exec),
      await sweep.run(exec),
    ]);

    expect(first).toEqual([held.id]);
    expect(second).toEqual([]);
    expect(await soldOn("DELUXE", NIGHTS)).toEqual([0, 0, 0]);
  });

  it("is registered on the scheduler, under a cron it can be found by", async () => {
    // The one case that boots the container. `jobs.module.ts` keeps the registry
    // as a list somebody has to edit, which buys a readable file at the cost of
    // a sweep that can exist and never run — so the registry is asserted rather
    // than assumed.
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, JobsModule],
    }).compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    try {
      const registered = app.get(JobRunner).find("hold-expiry");

      expect(registered).toBeInstanceOf(HoldExpirySweep);
      // Minutes, not hours. A TTL collected once a night would hold a room for
      // a day, which is the sweep running and the requirement still unmet.
      // Every minute or every few of them — the cadence is the property's
      // tolerance for how long an abandoned hold keeps a room, and either shape
      // of the minute field satisfies the claim this case makes.
      expect(registered?.schedule).toMatch(/^(\*|\*\/\d+) \* \* \* \*$/);
    } finally {
      await app.close();
    }
  });
});

/** One transition, in its own transaction — the boundary a controller draws. */
async function createHold(input: CreateBookingInput): Promise<Booking> {
  return await db.transaction((exec) => bookings.createHold(exec, input));
}

/** The sweep, through the boundary the runner opens around it. */
async function runSweep(): Promise<readonly string[]> {
  return await db.transaction((exec) => sweep.run(exec));
}

/**
 * Moves a hold's expiry into the past.
 *
 * `onlyIfHeld` is for the confirmed case, where the check constraint refuses an
 * expiry on a row that is no longer `HELD` — the update has to be the no-op the
 * state already makes it.
 */
async function expire(
  bookingId: string,
  options: { onlyIfHeld?: boolean } = {},
): Promise<void> {
  const held = eq(booking.state, "HELD");

  await db
    .update(booking)
    .set({ holdExpiresAt: sql`now() - interval '1 minute'` })
    .where(
      options.onlyIfHeld
        ? and(eq(booking.id, bookingId), held)
        : eq(booking.id, bookingId),
    );
}

/**
 * Moves a hold's last sighting that many seconds into the past.
 *
 * Postgres' own clock, because that is the one the sweep compares against — a
 * suite that wrote an instant from this process would be asserting about the
 * difference between two machines rather than about the rule.
 */
async function lastSeen(bookingId: string, secondsAgo: number): Promise<void> {
  await db
    .update(booking)
    .set({ lastSeenAt: sql`now() - ${`${secondsAgo} seconds`}::interval` })
    .where(eq(booking.id, bookingId));
}

/**
 * A gateway attempt against a hold, in whatever state the case is about.
 *
 * Written straight into the two tables rather than through `payment.service.ts`,
 * for the reason this file boots no Nest container: the subject is a sweep and
 * the rows underneath it, and what the sweep reads is a `PENDING` row joined
 * through a folio. `paid_at` stays null, which
 * `payment_paid_at_exactly_when_money_moved` requires of both states used here.
 */
async function payingFor(
  bookingId: string,
  status: "PENDING" | "FAILED" = "PENDING",
): Promise<void> {
  const [opened] = await db
    .insert(folio)
    .values({ bookingId })
    .returning({ id: folio.id });

  await db.insert(payment).values({
    folioId: opened!.id,
    method: "VNPAY",
    amount: 1_000n,
    status,
    attemptReference: `attempt-${bookingId}`,
  });
}

/**
 * The guest opening checkout on their own hold, through the real service.
 *
 * The funnel's own door: the credential is the booking the hold minted rather
 * than an account, and the amount is the stay's frozen total, which is the only
 * figure that door accepts. Everything the extension needs is on the far side of
 * those two checks, so a case that skipped them would be opening an attempt no
 * guest could.
 */
async function payFor(held: Booking): Promise<void> {
  await payments.createPaymentRequest({
    bookingId: held.id,
    amount: held.stayTotalGross,
    description: "The stay, paid in full before arrival",
    returnUrl: "https://mariva.test/stay/payment/return",
    payerIpAddress: "203.0.113.44",
    guestAccountId: null,
    provenBookingId: held.id,
  });
}

/** The request shape, from the two strings a date is written as. */
function stay(
  code: RoomTypeCode,
  checkIn: string,
  checkOut: string,
): CreateBookingInput {
  return {
    roomType: code,
    checkIn: parseDate(checkIn),
    checkOut: parseDate(checkOut),
    plan: "STANDARD",
    party: { adults: 2, children: [] },
  };
}

/** Where a stay stands, straight off the row. */
async function stateOf(bookingId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ state: booking.state })
    .from(booking)
    .where(eq(booking.id, bookingId));

  return row?.state;
}

/**
 * The port, agreeing to open whatever it is handed.
 *
 * Nothing in this file follows the address it hands back — the subject is what
 * the property wrote down before the payer was sent anywhere. The three methods
 * below it throw rather than answering, so a case that wandered onto the
 * callback path fails loudly instead of being quietly agreed with.
 */
class GatewayThatOpensAnything implements PaymentGateway {
  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    return await Promise.resolve({
      paymentUrl: `https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?vnp_TxnRef=${input.reference}`,
    });
  }

  async verifyCallback(): Promise<never> {
    throw new Error("no case here acts on a callback");
  }

  async refund(): Promise<never> {
    throw new Error("no case here refunds");
  }

  async queryTransaction(): Promise<never> {
    throw new Error("no case here queries the gateway");
  }
}

/** What the property has sold on each of those nights. */
async function soldOn(
  code: RoomTypeCode,
  nights: readonly string[],
): Promise<number[]> {
  const rows = await db
    .select({
      stayDate: typeInventory.stayDate,
      soldRooms: typeInventory.soldRooms,
    })
    .from(typeInventory)
    .innerJoin(roomType, eq(roomType.id, typeInventory.roomTypeId))
    .where(
      and(eq(roomType.code, code), inArray(typeInventory.stayDate, [...nights])),
    );

  const byDate = new Map(rows.map((row) => [row.stayDate, row.soldRooms]));

  return nights.map((night) => {
    const soldRooms = byDate.get(night);

    if (soldRooms === undefined) {
      throw new Error(`${code} has no counter on ${night}`);
    }

    return soldRooms;
  });
}
