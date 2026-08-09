// Which room a booking gets, against a real database —
// `booking-state-machine.md` §5's first, second and fifth rows.
//
// The database is the subject here rather than the backdrop. Two of the three
// guarantees this file asserts are Postgres's and not the service's: the
// `EXCLUDE USING gist` constraint is what refuses a second guest in room 304,
// and `room_assignment_covers_at_least_one_night` is what refuses the closed-off
// row a same-day move would otherwise leave behind. Neither can be proved
// against a mock, because a mock has no constraints — a suite built on one would
// pass whatever the service did with them.
//
// No Nest application is booted, for the reason `inventory-reservation.e2e-spec.ts`
// gives: the subject is one service and the database underneath it, and the
// routes that will call it are a later task's. So this file opens the
// transaction the way a controller will, one per operation, which is also the
// only way to prove that a refused type change leaves *both* counters where it
// found them.
//
// The property's day is stopped. A room move's whole behaviour turns on where
// today falls inside the stay — the old room keeps the nights up to it and the
// new one takes the rest — so a suite running against the wall clock would
// assert one thing this year and another thing next, against stays whose dates
// have to sit inside the seeded calendar either way.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import type { RoomTypeCode, StayDate } from "@mariva/shared";
import { ORPCError } from "@orpc/nest";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SystemConfigService } from "../src/modules/system-config/system-config.service.js";
import * as schema from "../src/database/schema/index.js";
import { booking } from "../src/database/schema/booking.js";
import { roomCondition } from "../src/database/schema/housekeeping.js";
import {
  room,
  roomAssignment,
  roomType,
  typeInventory,
} from "../src/database/schema/inventory.js";
import { seedDatabase } from "../src/database/seed/seed.js";
import { AssignmentService } from "../src/modules/booking/assignment.service.js";
import { BusinessDateService } from "../src/modules/booking/business-date.service.js";
import { StayQuoteService } from "../src/modules/booking/stay-quote.service.js";
import { HousekeepingService } from "../src/modules/housekeeping/housekeeping.service.js";
import { InventoryService } from "../src/modules/inventory/inventory.service.js";

const SEED_FROM = parseDate("2027-06-01");

// The seed lays the types down in display order and takes the numbers in
// ascending order — `seed.ts` says so and says why. Named here so an assertion
// reads as "a Superior" rather than as the string "201".
const SUPERIOR = "201";
const ANOTHER_SUPERIOR = "202";
const A_THIRD_SUPERIOR = "203";
const DELUXE = "303";
const ANOTHER_DELUXE = "304";

const ARRIVAL = "2027-06-10";
const DEPARTURE = "2027-06-15";

/** Mid-stay: two nights slept, three still to come. */
const TODAY = parseDate("2027-06-12");

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let assignments: AssignmentService;
let inventory: InventoryService;
let reference = 9_000;

/**
 * The property's day, stopped — the same device
 * `booking-lifecycle.e2e-spec.ts` uses and for the same reason. A room move's
 * whole behaviour turns on where today falls inside the stay, and every stay
 * here is a 2027 date chosen to sit inside the seeded calendar.
 */
class StoppedClock extends BusinessDateService {
  constructor(private readonly today: StayDate) {
    super(new SystemConfigService());
  }

  override async current(): Promise<StayDate> {
    return this.today;
  }
}

beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is unset — vitest.config.ts loads .env.test");
  }

  pool = new pg.Pool({ connectionString });
  db = drizzle({ client: pool, schema });

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  // No synthetic stays. Every assertion below counts rooms or reads the one
  // assignment a booking holds, and five hundred random holds would make both
  // of those numbers unpredictable.
  await seedDatabase(db, { from: SEED_FROM, bookings: 0 });

  inventory = new InventoryService();
  assignments = new AssignmentService(
    inventory,
    new StoppedClock(TODAY),
    new StayQuoteService(),
    new HousekeepingService(),
  );
});

// Every case starts against the property as the seed laid it down: no stays, no
// rooms held, every counter at zero. The alternative is a file whose later cases
// depend on how many Superiors the earlier ones happened to consume — the
// property has twelve, several cases here want one on the same night, and a
// suite that runs out of them fails in the fixture rather than in the assertion.
beforeEach(async () => {
  await db.execute(
    sql`truncate room_assignment, booking restart identity cascade`,
  );
  await db.update(typeInventory).set({ soldRooms: 0 });
  // A move hands the room the guest left back to housekeeping, so the condition
  // rows are state this file writes and has to clear. Left behind, the case
  // asserting that a move into the same room dirties nothing would read the
  // `DIRTY` an earlier case put there and pass without the code doing anything.
  await db.delete(roomCondition);
});

afterAll(async () => {
  await pool?.end();
});

/** The id of a room type, by the code the desk speaks. */
async function typeId(code: RoomTypeCode): Promise<string> {
  const [found] = await db
    .select({ id: roomType.id })
    .from(roomType)
    .where(eq(roomType.code, code))
    .limit(1);

  return found!.id;
}

/**
 * A booking in a given state, with its nights actually consumed.
 *
 * The inventory movement is not decoration: a type change releases the nights
 * of the type it moves away from, and a booking whose nights were never sold
 * would drive `sold_rooms` below zero — refused by
 * `type_inventory_sold_not_negative`, and refused for exactly the right reason.
 * So the fixture sells the stay the way the funnel would.
 */
async function bookingIn(
  state: "HELD" | "CONFIRMED" | "CHECKED_IN" | "CANCELLED",
  options: {
    roomType?: RoomTypeCode;
    checkIn?: string;
    checkOut?: string;
  } = {},
): Promise<string> {
  const code = options.roomType ?? "SUPERIOR";
  const checkIn = options.checkIn ?? ARRIVAL;
  const checkOut = options.checkOut ?? DEPARTURE;

  reference += 1;

  await inventory.reserve(db, {
    roomType: code,
    checkIn: parseDate(checkIn),
    checkOut: parseDate(checkOut),
  });

  const [made] = await db
    .insert(booking)
    .values({
      reference: `MRV-20270610-${reference}`,
      state,
      roomTypeId: await typeId(code),
      checkInDate: checkIn,
      checkOutDate: checkOut,
      ratePlanCode: "STANDARD",
      adults: 2,
      quotedStayTotalGross: 5_000_000n,
      quotedPercentAdjustment: 0,
      quotedExtraPersonPerNightGross: 600_000n,
      // Both columns a cancellation owes, and both biconditional with the
      // state: `booking_reason_exactly_when_cancelled` wants the reason and
      // `booking_records_a_cancellation_instant_exactly_when_cancelled` wants
      // the moment §4 would price it by.
      cancellationReason: state === "CANCELLED" ? "GUEST_REQUEST" : null,
      cancelledAt:
        state === "CANCELLED" ? new Date("2027-06-09T12:00:00Z") : null,
      // `booking_hold_expiry_exactly_when_held` holds every writer to it: a
      // hold without a TTL is a room nothing would ever release.
      holdExpiresAt: state === "HELD" ? new Date("2027-06-09T12:00:00Z") : null,
    })
    .returning({ id: booking.id });

  return made!.id;
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

/** `sold_rooms` for a type on one night. */
async function soldOn(code: RoomTypeCode, night: string): Promise<number> {
  const [row] = await db
    .select({ soldRooms: typeInventory.soldRooms })
    .from(typeInventory)
    .innerJoin(roomType, eq(roomType.id, typeInventory.roomTypeId))
    .where(and(eq(roomType.code, code), eq(typeInventory.stayDate, night)))
    .limit(1);

  return row!.soldRooms;
}

/** What the housekeeping board says about a room, or null when nothing does. */
async function conditionOf(roomNumber: string): Promise<string | null> {
  const [found] = await db
    .select({ status: roomCondition.status })
    .from(roomCondition)
    .innerJoin(room, eq(room.id, roomCondition.roomId))
    .where(eq(room.number, roomNumber))
    .limit(1);

  return found?.status ?? null;
}

/** The status of a refusal, or a failure naming what came back instead. */
async function refusalOf(operation: Promise<unknown>): Promise<string> {
  try {
    await operation;
  } catch (error) {
    if (error instanceof ORPCError) {
      return error.code;
    }

    throw error;
  }

  throw new Error("The operation was expected to be refused and was not");
}

describe("assigning a room", () => {
  it("gives a confirmed booking the room it will occupy, for the whole stay", async () => {
    const id = await bookingIn("CONFIRMED");

    const held = await db.transaction(
      async (tx) =>
        await assignments.assign(tx, { bookingId: id, roomNumber: SUPERIOR }),
    );

    expect(held).toMatchObject({
      bookingId: id,
      roomNumber: SUPERIOR,
    });
    expect(held.checkIn.toString()).toBe(ARRIVAL);
    expect(held.checkOut.toString()).toBe(DEPARTURE);
  });

  it("refuses a room of a type the booking was not sold", async () => {
    // The two layers `schema/inventory.ts` describes would otherwise disagree:
    // the Deluxe counter reads one free while the room is occupied, and the
    // Superior counter reads one sold while every Superior is empty.
    const id = await bookingIn("CONFIRMED");

    const refusal = await refusalOf(
      db.transaction(
        async (tx) =>
          await assignments.assign(tx, { bookingId: id, roomNumber: DELUXE }),
      ),
    );

    expect(refusal).toBe("CONFLICT");
    expect(await heldBy(id)).toHaveLength(0);
  });

  it("refuses a room number nobody has", async () => {
    const id = await bookingIn("CONFIRMED");

    expect(
      await refusalOf(
        db.transaction(
          async (tx) =>
            await assignments.assign(tx, { bookingId: id, roomNumber: "999" }),
        ),
      ),
    ).toBe("NOT_FOUND");
  });

  it("refuses a second booking the room somebody already holds", async () => {
    // The acceptance criterion, and it is Postgres's line rather than this
    // service's: `room_assignment_no_double_booking` evaluates while holding the
    // index entry, so two transactions inserting overlapping holds on one room
    // cannot both commit however the application was written.
    const first = await bookingIn("CONFIRMED");
    const second = await bookingIn("CONFIRMED", {
      checkIn: "2027-06-12",
      checkOut: "2027-06-18",
    });

    await db.transaction(
      async (tx) =>
        await assignments.assign(tx, {
          bookingId: first,
          roomNumber: ANOTHER_SUPERIOR,
        }),
    );

    const refusal = await refusalOf(
      db.transaction(
        async (tx) =>
          await assignments.assign(tx, {
            bookingId: second,
            roomNumber: ANOTHER_SUPERIOR,
          }),
      ),
    );

    expect(refusal).toBe("CONFLICT");
    expect(await heldBy(second)).toHaveLength(0);
  });

  it("accepts a stay beginning the day the last one ends", async () => {
    // `[)` is the load-bearing pair of characters. The departure date is not a
    // night sold, so back-to-back arrivals share a boundary rather than a night
    // — the ordinary case a hotel runs on, not a conflict to special-case.
    const next = await bookingIn("CONFIRMED", {
      checkIn: DEPARTURE,
      checkOut: "2027-06-20",
    });

    const held = await db.transaction(
      async (tx) =>
        await assignments.assign(tx, {
          bookingId: next,
          roomNumber: SUPERIOR,
        }),
    );

    expect(held.roomNumber).toBe(SUPERIOR);
  });

  it("replaces the room when a guest who has not arrived is reassigned", async () => {
    // Nobody has occupied the old room, so there is no night to keep and the row
    // goes rather than being closed off — a row covering no nights is the one
    // hold the exclusion constraint cannot see.
    const id = await bookingIn("CONFIRMED");

    await db.transaction(
      async (tx) =>
        await assignments.assign(tx, {
          bookingId: id,
          roomNumber: A_THIRD_SUPERIOR,
        }),
    );

    await db.transaction(
      async (tx) =>
        await assignments.assign(tx, { bookingId: id, roomNumber: "204" }),
    );

    const rows = await heldBy(id);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.number).toBe("204");
  });

  it("refuses a booking that is still held", async () => {
    // §5 gives room work to `CONFIRMED` and `CHECKED_IN` only. A room picked
    // before the deposit is taken would have two guests racing for one key while
    // the type still has stock.
    const id = await bookingIn("HELD");

    expect(
      await refusalOf(
        db.transaction(
          async (tx) =>
            await assignments.assign(tx, {
              bookingId: id,
              roomNumber: "205",
            }),
        ),
      ),
    ).toBe("CONFLICT");
  });

  it("refuses a cancelled booking", async () => {
    const id = await bookingIn("CANCELLED");

    expect(
      await refusalOf(
        db.transaction(
          async (tx) =>
            await assignments.assign(tx, {
              bookingId: id,
              roomNumber: "206",
            }),
        ),
      ),
    ).toBe("CONFLICT");
  });

  it("sends a checked-in guest who already holds a room to the room move", async () => {
    const id = await bookingIn("CHECKED_IN");

    await db.transaction(
      async (tx) =>
        await assignments.assign(tx, { bookingId: id, roomNumber: "207" }),
    );

    expect(
      await refusalOf(
        db.transaction(
          async (tx) =>
            await assignments.assign(tx, {
              bookingId: id,
              roomNumber: "208",
            }),
        ),
      ),
    ).toBe("CONFLICT");
  });

  it("refuses a booking id nobody has", async () => {
    expect(
      await refusalOf(
        db.transaction(
          async (tx) =>
            await assignments.assign(tx, {
              bookingId: "00000000-0000-0000-0000-000000000000",
              roomNumber: SUPERIOR,
            }),
        ),
      ),
    ).toBe("NOT_FOUND");
  });
});

describe("moving a checked-in guest", () => {
  it("closes the old room at the business date and opens the new one from it", async () => {
    // The acceptance criterion, and §5's own note on the row: "new assignment
    // row; old one closed at today's date". Both rows are true — the guest slept
    // in the first room until today and in the second one after — and a single
    // row rewritten to name the new room would claim nobody was ever in the old.
    const id = await bookingIn("CHECKED_IN");

    await db.transaction(
      async (tx) =>
        await assignments.assign(tx, { bookingId: id, roomNumber: "209" }),
    );

    const moved = await db.transaction(
      async (tx) =>
        await assignments.move(tx, { bookingId: id, roomNumber: "210" }),
    );

    expect(moved.roomNumber).toBe("210");

    const rows = await heldBy(id);

    expect(rows).toEqual([
      { number: "209", checkInDate: ARRIVAL, checkOutDate: "2027-06-12" },
      { number: "210", checkInDate: "2027-06-12", checkOutDate: DEPARTURE },
    ]);
  });

  it("moves the guest again, out of the room they moved into", async () => {
    // The second move must read the room the guest is in *now* and not the one
    // they left. Ordered the other way round, this closes a row that is already
    // closed and leaves the guest holding two live rooms.
    const id = await bookingIn("CHECKED_IN");

    await db.transaction(
      async (tx) =>
        await assignments.assign(tx, { bookingId: id, roomNumber: "301" }),
    );
    await db.transaction(
      async (tx) =>
        await assignments.move(tx, { bookingId: id, roomNumber: "302" }),
    );
    await db.transaction(
      async (tx) =>
        await assignments.move(tx, { bookingId: id, roomNumber: SUPERIOR }),
    );

    const rows = await heldBy(id);

    // 302 was held for no nights at all — moved into and out of on one day — so
    // it leaves nothing behind rather than a row covering no nights.
    expect(rows).toEqual([
      { number: "301", checkInDate: ARRIVAL, checkOutDate: "2027-06-12" },
      { number: SUPERIOR, checkInDate: "2027-06-12", checkOutDate: DEPARTURE },
    ]);
  });

  it("leaves nothing behind when the guest moves on the day they arrived", async () => {
    // The room was wrong the moment they opened the door, which is an ordinary
    // afternoon rather than an edge case. Closing the old row at its own start
    // date would write a stay of no nights, which
    // `room_assignment_covers_at_least_one_night` refuses.
    const id = await bookingIn("CHECKED_IN", {
      checkIn: "2027-06-12",
      checkOut: "2027-06-16",
    });

    await db.transaction(
      async (tx) =>
        await assignments.assign(tx, { bookingId: id, roomNumber: SUPERIOR }),
    );

    await db.transaction(
      async (tx) =>
        await assignments.move(tx, {
          bookingId: id,
          roomNumber: ANOTHER_SUPERIOR,
        }),
    );

    const rows = await heldBy(id);

    expect(rows).toEqual([
      {
        number: ANOTHER_SUPERIOR,
        checkInDate: "2027-06-12",
        checkOutDate: "2027-06-16",
      },
    ]);
  });

  it("refuses a booking that is not in the building", async () => {
    const id = await bookingIn("CONFIRMED");

    expect(
      await refusalOf(
        db.transaction(
          async (tx) =>
            await assignments.move(tx, { bookingId: id, roomNumber: SUPERIOR }),
        ),
      ),
    ).toBe("CONFLICT");
  });

  it("refuses a checked-in booking that holds no room", async () => {
    const id = await bookingIn("CHECKED_IN");

    expect(
      await refusalOf(
        db.transaction(
          async (tx) =>
            await assignments.move(tx, { bookingId: id, roomNumber: SUPERIOR }),
        ),
      ),
    ).toBe("CONFLICT");
  });

  it("refuses a move on the day the guest departs", async () => {
    // There is no night left to move them into, and the row that would be
    // written covers none.
    const id = await bookingIn("CHECKED_IN", {
      checkIn: "2027-06-08",
      checkOut: "2027-06-12",
    });

    await db.transaction(
      async (tx) =>
        await assignments.assign(tx, { bookingId: id, roomNumber: SUPERIOR }),
    );

    expect(
      await refusalOf(
        db.transaction(
          async (tx) =>
            await assignments.move(tx, {
              bookingId: id,
              roomNumber: ANOTHER_SUPERIOR,
            }),
        ),
      ),
    ).toBe("CONFLICT");
  });

  it("refuses moving a guest into a room another guest is in", async () => {
    // §5's "never moves a different checked-in guest", which is the exclusion
    // constraint rather than a check this service performs.
    const staying = await bookingIn("CHECKED_IN");
    const moving = await bookingIn("CHECKED_IN");

    await db.transaction(
      async (tx) =>
        await assignments.assign(tx, {
          bookingId: staying,
          roomNumber: SUPERIOR,
        }),
    );
    await db.transaction(
      async (tx) =>
        await assignments.assign(tx, {
          bookingId: moving,
          roomNumber: ANOTHER_SUPERIOR,
        }),
    );

    expect(
      await refusalOf(
        db.transaction(
          async (tx) =>
            await assignments.move(tx, {
              bookingId: moving,
              roomNumber: SUPERIOR,
            }),
        ),
      ),
    ).toBe("CONFLICT");

    // And the guest who was not moving is still where they were, in one row.
    expect(await heldBy(staying)).toEqual([
      { number: SUPERIOR, checkInDate: ARRIVAL, checkOutDate: DEPARTURE },
    ]);
  });

  it("hands the room the guest left back to housekeeping", async () => {
    // §3 gives check-out this effect and a mid-stay move is the same fact: the
    // bed in 209 has been slept in and nobody is going back to it. Without the
    // hand-back the room keeps the `CLEAN` that §4's room-ready guard demanded
    // in order to admit this guest, the guard passes on it again, and the next
    // arrival is checked into an unstripped bed.
    const id = await bookingIn("CHECKED_IN");

    await db.transaction(
      async (tx) =>
        await assignments.assign(tx, { bookingId: id, roomNumber: "209" }),
    );

    await db.transaction(
      async (tx) =>
        await assignments.move(tx, { bookingId: id, roomNumber: "210" }),
    );

    expect(await conditionOf("209")).toBe("DIRTY");
    // The room they moved into is left alone — somebody is in it now, and
    // housekeeping was not asked to judge it.
    expect(await conditionOf("210")).toBeNull();
  });

  it("leaves the fault on a room the guest was moved out of because of it", async () => {
    // The case the hand-back is most likely to meet: a shower fails at 22:00,
    // the desk withdraws the room and moves the guest. `setCondition` writes
    // `DIRTY` with the note cleared, so dirtying here would take both the status
    // and the reason with the guest — leaving a broken room one cleaning round
    // away from the next arrival, and nobody sent to repair it.
    const id = await bookingIn("CHECKED_IN");

    await db.transaction(
      async (tx) =>
        await assignments.assign(tx, { bookingId: id, roomNumber: "209" }),
    );

    await db.transaction(
      async (tx) =>
        await new HousekeepingService().setOutOfOrder(tx, {
          roomNumber: "209",
          outOfOrder: true,
          reason: "shower mixer leaking",
        }),
    );

    await db.transaction(
      async (tx) =>
        await assignments.move(tx, { bookingId: id, roomNumber: "210" }),
    );

    expect(await conditionOf("209")).toBe("OUT_OF_ORDER");
  });

  it("dirties nothing when the guest is moved into the room they are in", async () => {
    // The move splits the hold in two and leaves the guest exactly where they
    // were, so nothing was vacated. A board showing 209 as a room to strip
    // would send a housekeeper into an occupied one.
    const id = await bookingIn("CHECKED_IN");

    await db.transaction(
      async (tx) =>
        await assignments.assign(tx, { bookingId: id, roomNumber: "209" }),
    );

    await db.transaction(
      async (tx) =>
        await assignments.move(tx, { bookingId: id, roomNumber: "209" }),
    );

    expect(await conditionOf("209")).toBeNull();
  });
});

describe("changing the room type", () => {
  const NIGHT = ARRIVAL;

  it("moves the inventory between the two types atomically", async () => {
    // The acceptance criterion. One counter down, the other up, and both inside
    // the caller's transaction — a release that committed without its reserve
    // would hand the property a Superior back and sell a Deluxe it does not
    // have.
    const id = await bookingIn("CONFIRMED");

    const superiorsBefore = await soldOn("SUPERIOR", NIGHT);
    const deluxesBefore = await soldOn("DELUXE", NIGHT);

    const changed = await db.transaction(
      async (tx) =>
        await assignments.changeRoomType(tx, {
          bookingId: id,
          roomType: "DELUXE",
        }),
    );

    expect(changed).toMatchObject({
      from: "SUPERIOR",
      to: "DELUXE",
      nights: 5,
      assignment: null,
    });

    expect(await soldOn("SUPERIOR", NIGHT)).toBe(superiorsBefore - 1);
    expect(await soldOn("DELUXE", NIGHT)).toBe(deluxesBefore + 1);

    // And the booking itself is sold as the new type, so every later read of it
    // — availability, the folio, the housekeeping board — agrees with the
    // counters above.
    const [row] = await db
      .select({ code: roomType.code })
      .from(booking)
      .innerJoin(roomType, eq(roomType.id, booking.roomTypeId))
      .where(eq(booking.id, id))
      .limit(1);

    expect(row!.code).toBe("DELUXE");
  });

  it("moves the guest's key with the counters", async () => {
    const id = await bookingIn("CONFIRMED");

    await db.transaction(
      async (tx) =>
        await assignments.assign(tx, { bookingId: id, roomNumber: "205" }),
    );

    const changed = await db.transaction(
      async (tx) =>
        await assignments.changeRoomType(tx, {
          bookingId: id,
          roomType: "DELUXE",
          roomNumber: ANOTHER_DELUXE,
        }),
    );

    expect(changed.assignment?.roomNumber).toBe(ANOTHER_DELUXE);

    // Nobody had arrived, so the Superior leaves nothing behind.
    expect(await heldBy(id)).toEqual([
      { number: ANOTHER_DELUXE, checkInDate: ARRIVAL, checkOutDate: DEPARTURE },
    ]);
  });

  it("keeps the nights a checked-in guest already slept in the old room", async () => {
    const id = await bookingIn("CHECKED_IN");

    await db.transaction(
      async (tx) =>
        await assignments.assign(tx, { bookingId: id, roomNumber: "206" }),
    );

    await db.transaction(
      async (tx) =>
        await assignments.changeRoomType(tx, {
          bookingId: id,
          roomType: "DELUXE",
          roomNumber: "305",
        }),
    );

    expect(await heldBy(id)).toEqual([
      { number: "206", checkInDate: ARRIVAL, checkOutDate: "2027-06-12" },
      { number: "305", checkInDate: "2027-06-12", checkOutDate: DEPARTURE },
    ]);
  });

  it("will not silently drop the room a booking is holding", async () => {
    // Dropping it would leave a checked-in guest holding no room at all, which
    // `check-in.guard.ts` treats as a booking that may not be in the building.
    const id = await bookingIn("CONFIRMED");

    await db.transaction(
      async (tx) =>
        await assignments.assign(tx, { bookingId: id, roomNumber: "207" }),
    );

    expect(
      await refusalOf(
        db.transaction(
          async (tx) =>
            await assignments.changeRoomType(tx, {
              bookingId: id,
              roomType: "DELUXE",
            }),
        ),
      ),
    ).toBe("BAD_REQUEST");
  });

  it("puts both counters back when the new type is sold out", async () => {
    // The atomicity claim from the failing side, which is the side that matters:
    // a partial movement here is an oversell that nothing downstream would
    // notice.
    const id = await bookingIn("CONFIRMED");

    const premierId = await typeId("PREMIER");

    await db
      .update(typeInventory)
      .set({ soldRooms: typeInventory.totalRooms })
      .where(
        and(
          eq(typeInventory.roomTypeId, premierId),
          gte(typeInventory.stayDate, ARRIVAL),
          lt(typeInventory.stayDate, DEPARTURE),
        ),
      );

    const superiorsBefore = await soldOn("SUPERIOR", NIGHT);
    const premiersBefore = await soldOn("PREMIER", NIGHT);

    expect(
      await refusalOf(
        db.transaction(
          async (tx) =>
            await assignments.changeRoomType(tx, {
              bookingId: id,
              roomType: "PREMIER",
            }),
        ),
      ),
    ).toBe("CONFLICT");

    expect(await soldOn("SUPERIOR", NIGHT)).toBe(superiorsBefore);
    expect(await soldOn("PREMIER", NIGHT)).toBe(premiersBefore);
  });

  it("does nothing when the booking is already the type asked for", async () => {
    // Idempotent for the reason every transition in `booking.service.ts` is: a
    // retried request must not move the counters a second time, which would sell
    // the property a room it never had.
    const id = await bookingIn("CONFIRMED");

    const before = await soldOn("SUPERIOR", NIGHT);

    const changed = await db.transaction(
      async (tx) =>
        await assignments.changeRoomType(tx, {
          bookingId: id,
          roomType: "SUPERIOR",
        }),
    );

    expect(changed).toMatchObject({ from: "SUPERIOR", to: "SUPERIOR" });
    expect(await soldOn("SUPERIOR", NIGHT)).toBe(before);
  });

  it("reports the room a booking still holds when nothing changes", async () => {
    const id = await bookingIn("CONFIRMED");

    await db.transaction(
      async (tx) =>
        await assignments.assign(tx, { bookingId: id, roomNumber: "208" }),
    );

    const changed = await db.transaction(
      async (tx) =>
        await assignments.changeRoomType(tx, {
          bookingId: id,
          roomType: "SUPERIOR",
        }),
    );

    expect(changed.assignment?.roomNumber).toBe("208");
  });

  it("refuses a room of the type the booking is changing away from", async () => {
    const id = await bookingIn("CONFIRMED");

    await db.transaction(
      async (tx) =>
        await assignments.assign(tx, { bookingId: id, roomNumber: "210" }),
    );

    expect(
      await refusalOf(
        db.transaction(
          async (tx) =>
            await assignments.changeRoomType(tx, {
              bookingId: id,
              roomType: "DELUXE",
              roomNumber: ANOTHER_SUPERIOR,
            }),
        ),
      ),
    ).toBe("CONFLICT");
  });

  it("refuses a booking that is not confirmed or in the building", async () => {
    const id = await bookingIn("HELD");

    expect(
      await refusalOf(
        db.transaction(
          async (tx) =>
            await assignments.changeRoomType(tx, {
              bookingId: id,
              roomType: "DELUXE",
            }),
        ),
      ),
    ).toBe("CONFLICT");
  });

  it("hands back the room a checked-in guest is upgraded out of", async () => {
    // An upgrade mid-stay vacates a room exactly as a move does, and the guest
    // slept in it up to today — the row above proves the nights are kept, and
    // this proves somebody is sent to strip the bed under them.
    const id = await bookingIn("CHECKED_IN");

    await db.transaction(
      async (tx) =>
        await assignments.assign(tx, { bookingId: id, roomNumber: "206" }),
    );

    await db.transaction(
      async (tx) =>
        await assignments.changeRoomType(tx, {
          bookingId: id,
          roomType: "DELUXE",
          roomNumber: "305",
        }),
    );

    expect(await conditionOf("206")).toBe("DIRTY");
  });

  it("leaves the room clean when the guest has not arrived to dirty it", async () => {
    // An upgrade decided the week before moves a key nobody has collected. The
    // old row is deleted rather than closed because it would cover no night, and
    // that is the same fact: nobody has been in 206, so nobody is sent to it.
    const id = await bookingIn("CONFIRMED");

    await db.transaction(
      async (tx) =>
        await assignments.assign(tx, { bookingId: id, roomNumber: "206" }),
    );

    await db.transaction(
      async (tx) =>
        await assignments.changeRoomType(tx, {
          bookingId: id,
          roomType: "DELUXE",
          roomNumber: "305",
        }),
    );

    expect(await conditionOf("206")).toBeNull();
  });

  it("refuses a room named for a booking that is holding none", async () => {
    // The mirror of the refusal above. §5 files putting a booking into a room as
    // its own operation with its own capability, so a type change that also
    // assigned would perform it under this one's authority — and answering
    // politely while dropping the room would report a key nobody was given.
    const id = await bookingIn("CONFIRMED");

    expect(
      await refusalOf(
        db.transaction(
          async (tx) =>
            await assignments.changeRoomType(tx, {
              bookingId: id,
              roomType: "DELUXE",
              roomNumber: DELUXE,
            }),
        ),
      ),
    ).toBe("BAD_REQUEST");

    // And the type is where it was: the refusal came before either counter.
    expect(await soldOn("SUPERIOR", NIGHT)).toBe(1);
    expect(await soldOn("DELUXE", NIGHT)).toBe(0);
  });
});
