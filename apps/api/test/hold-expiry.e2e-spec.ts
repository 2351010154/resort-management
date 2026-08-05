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
// The expiry is moved into the past with a direct `update` on the row. The
// alternative is a suite that waits out a real TTL, and the floor on
// `BOOKING_HOLD_TTL_MINUTES` is one minute — the column is what the sweep reads,
// so writing it is the same event as a clock reaching it.
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
import { booking } from "../src/database/schema/booking.js";
import * as schema from "../src/database/schema/index.js";
import { roomType, typeInventory } from "../src/database/schema/inventory.js";
import { seedDatabase } from "../src/database/seed/seed.js";
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
import { GuestService } from "../src/modules/guest/guest.service.js";
import { HousekeepingService } from "../src/modules/housekeeping/housekeeping.service.js";
import { InventoryService } from "../src/modules/inventory/inventory.service.js";

const SEED_FROM = parseDate("2027-06-01");

const CHECK_IN = "2028-02-10";
const CHECK_OUT = "2028-02-13";

/** The nights a three-night stay sells, arrival first — never the departure. */
const NIGHTS = [CHECK_IN, "2028-02-11", "2028-02-12"] as const;

const HOLD_TTL_MINUTES = 15;
const ROLLOVER_HOUR = 4;

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
    super({ BUSINESS_DATE_ROLLOVER_HOUR: ROLLOVER_HOUR } as Env);
  }

  override current(): StayDate {
    return this.today;
  }
}

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let bookings: BookingService;
let sweep: HoldExpirySweep;

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
    { BOOKING_HOLD_TTL_MINUTES: HOLD_TTL_MINUTES } as Env,
  );

  sweep = new HoldExpirySweep(bookings);
});

// Every case counts rooms, so each starts against the property as the seed laid
// it down — a case reading a counter another one left behind is reading a number
// nobody chose.
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
      expect(registered?.schedule).toMatch(/^\*\/\d+ \* \* \* \*$/);
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
