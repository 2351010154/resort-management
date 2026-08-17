// The sweep that finds the guests who never came — `FR-BOOK-04`.
//
// `no-show.e2e-spec.ts` proves the transition: what `markNoShow` does to the
// counters, the room hold and the state once somebody asks for it. What it
// cannot prove is that anybody ever does. Until this sweep runs, a stay nobody
// arrived for stays `CONFIRMED` with all five of its nights consumed, and the
// four the property could resell are lost to a room that stood empty.
//
// So what is asserted here is which stays the sweep picks up and which it walks
// past — the predicate, in the two directions that cost the property something:
//
// - an arrival the business date has left behind is written off, its arrival
//   night kept and the rest of its nights back on sale;
// - an arrival on the business date itself, and a guest already in the building,
//   are both left exactly as they were;
// - a second pass over the same transaction finds nothing, which is the property
//   `job-runner.service.ts` enforces on every run, checked here against the real
//   sweep rather than against a probe.
//
// The stays are taken by the desk on a day before they arrive and swept on a day
// after — two `BookingService` instances over two stopped clocks, because a
// booking cannot be created into the past and cannot be written off before its
// arrival. That is the property's own day moving, which is the only thing that
// turns a confirmed stay into a no-show.
//
// No Nest application is booted for the behaviour, for the reason
// `no-show.e2e-spec.ts` gives: the subject is a sweep, a service and the rows
// underneath them. One case does boot the container, and only to answer the
// question the wiring turns on — whether the sweep is registered at all. A sweep
// that works and is in nobody's registry is the exact shape of the gap this file
// closes.

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
import { roomCondition } from "../src/database/schema/housekeeping.js";
import * as schema from "../src/database/schema/index.js";
import {
  room,
  roomAssignment,
  roomType,
  typeInventory,
} from "../src/database/schema/inventory.js";
import { seedDatabase } from "../src/database/seed/seed.js";
import { JobRunner } from "../src/jobs/job-runner.service.js";
import { JobsModule } from "../src/jobs/jobs.module.js";
import { AssignmentService } from "../src/modules/booking/assignment.service.js";
import {
  BookingService,
  type CreateBookingInput,
} from "../src/modules/booking/booking.service.js";
import { BusinessDateService } from "../src/modules/booking/business-date.service.js";
import { NoShowSweep } from "../src/modules/booking/no-show-sweep.js";
import { FolioStubService } from "../src/modules/booking/ports/folio-stub.service.js";
import { StayQuoteService } from "../src/modules/booking/stay-quote.service.js";
import { GuestService } from "../src/modules/guest/guest.service.js";
import { HousekeepingService } from "../src/modules/housekeeping/housekeeping.service.js";
import { InventoryService } from "../src/modules/inventory/inventory.service.js";
import { noConfirmations, noStayLinks } from "./no-announcement.js";
import { tiersAt } from "./tiers.js";

const SEED_FROM = parseDate("2027-06-01");

/** The day the desk takes every stay below — before all of them arrive. */
const BOOKED_ON = SEED_FROM;

const ARRIVAL = "2027-06-10";
const DEPARTURE = "2027-06-15";

/** The nights a five-night stay sells, arrival first — never the departure. */
const NIGHTS = [
  ARRIVAL,
  "2027-06-11",
  "2027-06-12",
  "2027-06-13",
  "2027-06-14",
] as const;

/**
 * The day the sweep runs as: the one after the arrival above.
 *
 * The arrival night is over and the property has rolled past it, which is
 * exactly the condition the sweep is looking for and nothing weaker.
 */
const BUSINESS_DATE = parseDate("2027-06-11");

// Superiors, per `seed.ts`'s display-order rule: the twelve take 201–210 and
// then 301, 302.
const SUPERIOR = "201";
const ANOTHER_SUPERIOR = "202";

const A_GUEST = {
  fullName: "Trần Thị Mai",
  cccdNumber: "079301004321",
  nationality: "VN",
} as const;

const HOLD_TTL_MINUTES = 20;

/**
 * The property's day, stopped — the same device `no-show.e2e-spec.ts` uses and
 * for the same reason. The hour and the zone stay the real service's; only the
 * instant it reads is fixed.
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
let sweep: NoShowSweep;

/** The desk, on a given day. */
function deskAt(today: StayDate): BookingService {
  const inventory = new InventoryService();
  const clock = new StoppedClock(today);

  return new BookingService(
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
    // Neither is reached here: the confirmation email is minted and queued only
    // by the transition a paid hold makes, which nothing in this file drives.
    // Stubs that say so if they are, rather than casts that say nothing.
    noStayLinks,
    noConfirmations,
    // §7's ladder, reached only where a stay is sold to a signed-in guest.
    tiersAt(clock),
  );
}

/** The rooms service, on a given day. */
function roomsAt(today: StayDate): AssignmentService {
  return new AssignmentService(
    new InventoryService(),
    new StoppedClock(today),
    new StayQuoteService(),
    new HousekeepingService(),
  );
}

beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is unset — vitest.config.ts loads .env.test");
  }

  pool = new pg.Pool({ connectionString });
  db = drizzle({ client: pool, schema });

  await migrate(db, { migrationsFolder: "./src/database/migrations" });
  await seedDatabase(db, { from: SEED_FROM, bookings: 0 });

  // The sweep transitions through a desk whose day is the one it sweeps as,
  // which is what the scheduled path hands it: `job-scheduler.service.ts` runs
  // every sweep over `BusinessDateService.current()`.
  sweep = new NoShowSweep(deskAt(BUSINESS_DATE));
});

// Every case counts rooms, so each starts against the property as the seed laid
// it down — a case reading a counter another one left behind is reading a number
// nobody chose.
beforeEach(async () => {
  await db.execute(
    sql`truncate registration, room_assignment, booking, guest restart identity cascade`,
  );
  await db.update(typeInventory).set({ soldRooms: 0 });
  await db.delete(roomCondition);
});

afterAll(async () => {
  await pool?.end();
});

describe("a stay whose arrival night the property has left behind", () => {
  it("keeps the arrival night sold and puts the rest back", async () => {
    const id = await stayHolding(SUPERIOR);

    expect(await soldAcrossTheStay()).toEqual([1, 1, 1, 1, 1]);

    expect(await runSweep()).toEqual([id]);

    // §3's inventory effect, reached by a sweep rather than by the desk: the
    // no-show charge is levied against the arrival night, and the four nights
    // nobody is coming for are back on sale.
    expect(await soldAcrossTheStay()).toEqual([1, 0, 0, 0, 0]);
    expect(await stateOf(id)).toBe("NO_SHOW");
  });

  it("cuts the room's hold back to the night that was charged for", async () => {
    // The room follows the counter. Left running to the original departure, the
    // hold would keep the room against `room_assignment_no_double_booking` across
    // nights the counter now reads as free — the room unsellable and the type
    // reading available.
    const id = await stayHolding(SUPERIOR);

    await runSweep();

    expect(await heldBy(id)).toEqual([
      { number: SUPERIOR, checkInDate: ARRIVAL, checkOutDate: "2027-06-11" },
    ]);
  });

  it("takes every stay the night left behind, not the first one it finds", async () => {
    const first = await stayHolding(SUPERIOR);
    const second = await stayHolding(ANOTHER_SUPERIOR);

    expect(await soldAcrossTheStay()).toEqual([2, 2, 2, 2, 2]);

    const written = await runSweep();

    expect(written).toHaveLength(2);
    expect([...written].sort()).toEqual([first, second].sort());
    expect(await soldAcrossTheStay()).toEqual([2, 0, 0, 0, 0]);
  });

  it("writes off a stay that was never given a room", async () => {
    // §1 makes the assignment optional in `CONFIRMED`, so this is an ordinary
    // booking rather than a broken one: a phone reservation nobody picked a room
    // for. The nights still have to come back.
    const id = await confirmedStay();

    expect(await runSweep()).toEqual([id]);
    expect(await soldAcrossTheStay()).toEqual([1, 0, 0, 0, 0]);
    expect(await heldBy(id)).toHaveLength(0);
  });
});

describe("a stay the sweep must not touch", () => {
  it("leaves one arriving on the business date itself", async () => {
    // The property has not finished that day. The guest is late, not absent, and
    // a sweep that wrote them off at noon would release the rest of their stay
    // and cut their room hold back to tonight while they were still in a taxi.
    const id = await stayHolding(SUPERIOR, {
      checkIn: BUSINESS_DATE.toString(),
      checkOut: DEPARTURE,
    });

    expect(await runSweep()).toEqual([]);

    expect(await stateOf(id)).toBe("CONFIRMED");
    expect(await soldAcrossTheStay()).toEqual([0, 1, 1, 1, 1]);
    expect(await heldBy(id)).toEqual([
      {
        number: SUPERIOR,
        checkInDate: BUSINESS_DATE.toString(),
        checkOutDate: DEPARTURE,
      },
    ]);
  });

  it("leaves a guest who is already in the building", async () => {
    // `CHECKED_IN → NO_SHOW` is not a cell §2 draws, so a sweep that selected
    // this row would not merely be wrong about the guest — it would throw inside
    // the runner's transaction and take every other write-off of the night with
    // it.
    const id = await stayHolding(SUPERIOR);

    await db.transaction(
      async (tx) =>
        await deskAt(parseDate(ARRIVAL)).checkIn(tx, {
          bookingId: id,
          guests: [A_GUEST],
        }),
    );

    expect(await runSweep()).toEqual([]);

    expect(await stateOf(id)).toBe("CHECKED_IN");
    expect(await soldAcrossTheStay()).toEqual([1, 1, 1, 1, 1]);
  });

  it("leaves a stay the sweep already wrote off", async () => {
    const id = await stayHolding(SUPERIOR);

    expect(await runSweep()).toEqual([id]);
    // A second run over the same night is the manager re-running one that
    // failed. Releasing the nights again would credit the property with
    // inventory it never sold.
    expect(await runSweep()).toEqual([]);

    expect(await soldAcrossTheStay()).toEqual([1, 0, 0, 0, 0]);
  });
});

describe("the sweep as the runner requires it", () => {
  it("changes nothing on a second pass over the same transaction", async () => {
    const id = await stayHolding(SUPERIOR);

    // Exactly what `JobRunner` does before it commits: run, and if anything was
    // touched, run again and require nothing. A sweep failing this is rolled
    // back whole rather than discovered later in a counter that drifted.
    const [first, second] = await db.transaction(async (exec) => [
      await sweep.run(exec, BUSINESS_DATE),
      await sweep.run(exec, BUSINESS_DATE),
    ]);

    expect(first).toEqual([id]);
    expect(second).toEqual([]);
    expect(await soldAcrossTheStay()).toEqual([1, 0, 0, 0, 0]);
  });

  it("keeps none of its work when handed a date the property has not reached", async () => {
    // The manual trigger takes any business date, so it can be handed one in the
    // future — and a stay arriving next week has not failed to arrive.
    // `markNoShow` refuses it, and the refusal has to cost the property nothing:
    // the run is one transaction and everything in it goes back.
    const id = await confirmedStay({
      checkIn: "2027-06-14",
      checkOut: "2027-06-16",
    });

    await expect(runSweep(parseDate("2027-06-20"))).rejects.toThrow();

    expect(await stateOf(id)).toBe("CONFIRMED");
    expect(await soldOn("SUPERIOR", "2027-06-15")).toBe(1);
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
      const registered = app.get(JobRunner).find("no-show");

      expect(registered).toBeInstanceOf(NoShowSweep);
      // Five fields, and one that fires more than once a day: the rollover hour
      // is configuration, so a sweep pinned to a single hour would write off
      // nothing for a day the morning after somebody changed it.
      expect(registered?.schedule).toMatch(/^\S+ \* \* \* \*$/);
    } finally {
      await app.close();
    }
  });
});

/** A confirmed stay with its nights consumed, taken before it arrives. */
async function confirmedStay(
  options: { checkIn?: string; checkOut?: string } = {},
): Promise<string> {
  const made = await db.transaction(
    async (tx) =>
      await deskAt(BOOKED_ON).createConfirmed(
        tx,
        stay(options.checkIn ?? ARRIVAL, options.checkOut ?? DEPARTURE),
      ),
  );

  return made.id;
}

/** A stay that is confirmed and holds a room. */
async function stayHolding(
  roomNumber: string,
  options: { checkIn?: string; checkOut?: string } = {},
): Promise<string> {
  const id = await confirmedStay(options);

  await db.transaction(
    async (tx) =>
      await roomsAt(BOOKED_ON).assign(tx, { bookingId: id, roomNumber }),
  );

  return id;
}

/** The sweep, through the boundary the runner opens around it. */
async function runSweep(
  businessDate: StayDate = BUSINESS_DATE,
): Promise<readonly string[]> {
  return await db.transaction((exec) => sweep.run(exec, businessDate));
}

/** The request shape, from the two strings a date is written as. */
function stay(checkIn: string, checkOut: string): CreateBookingInput {
  return {
    roomType: "SUPERIOR",
    checkIn: parseDate(checkIn),
    checkOut: parseDate(checkOut),
    plan: "STANDARD",
    party: { adults: 2, children: [] },
  };
}

/** `sold_rooms` for a type on one night. */
async function soldOn(code: RoomTypeCode, night: string): Promise<number> {
  const [row] = await db
    .select({ soldRooms: typeInventory.soldRooms })
    .from(typeInventory)
    .innerJoin(roomType, eq(roomType.id, typeInventory.roomTypeId))
    .where(and(eq(roomType.code, code), eq(typeInventory.stayDate, night)))
    .limit(1);

  if (!row) throw new Error(`SUPERIOR has no counter on ${night}`);

  return row.soldRooms;
}

/** `sold_rooms` across the five nights above, arrival first. */
async function soldAcrossTheStay(): Promise<number[]> {
  const rows = await db
    .select({
      stayDate: typeInventory.stayDate,
      soldRooms: typeInventory.soldRooms,
    })
    .from(typeInventory)
    .innerJoin(roomType, eq(roomType.id, typeInventory.roomTypeId))
    .where(
      and(
        eq(roomType.code, "SUPERIOR"),
        inArray(typeInventory.stayDate, [...NIGHTS]),
      ),
    );

  const byDate = new Map(rows.map((row) => [row.stayDate, row.soldRooms]));

  return NIGHTS.map((night) => {
    const soldRooms = byDate.get(night);

    if (soldRooms === undefined) {
      throw new Error(`SUPERIOR has no counter on ${night}`);
    }

    return soldRooms;
  });
}

/** Every assignment row a booking holds, oldest first. */
async function heldBy(
  bookingId: string,
): Promise<{ number: string; checkInDate: string; checkOutDate: string }[]> {
  return await db
    .select({
      number: room.number,
      checkInDate: roomAssignment.checkInDate,
      checkOutDate: roomAssignment.checkOutDate,
    })
    .from(roomAssignment)
    .innerJoin(room, eq(room.id, roomAssignment.roomId))
    .where(eq(roomAssignment.bookingId, bookingId))
    .orderBy(roomAssignment.checkInDate);
}

/** The state one booking is in. */
async function stateOf(bookingId: string): Promise<string> {
  const [row] = await db
    .select({ state: booking.state })
    .from(booking)
    .where(eq(booking.id, bookingId));

  return row!.state;
}
