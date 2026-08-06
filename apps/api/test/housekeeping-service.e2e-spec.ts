// The housekeeping service against a real Postgres — `FR-HK-01` and `FR-HK-02`.
//
// One claim is why this file is an e2e rather than a unit test with a stubbed
// executor: setting `OUT_OF_ORDER` must leave `type_inventory.total_rooms`
// exactly where it was. A stub would only prove that the service does not call
// a method the test author remembered to spy on, which is a statement about the
// test. Reading the counter before the status change and after it is a
// statement about the property's sellable inventory, and it is the one
// `FR-HK-02` asks for.
//
// The rest is the same reasoning applied to the upsert and the board: `on
// conflict do update`, a correlated `exists` over a half-open range and a
// coalesce over a missing row are SQL, and SQL is only right where it runs.
//
// No Nest application is booted. Every method takes its executor as an
// argument and the service injects nothing, so the subject is reachable with a
// `new` — and this suite stays independent of where the module is registered.
//
// It runs against `mariva_test`, which `.env.test` points at, and it applies
// the migrations rather than pushing the schema.

import { parseDate } from "@internationalized/date";
import { ORPCError } from "@orpc/nest";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { booking } from "../src/database/schema/booking.js";
import { roomCondition } from "../src/database/schema/housekeeping.js";
import { staffUser } from "../src/database/schema/identity.js";
import * as schema from "../src/database/schema/index.js";
import {
  room,
  roomAssignment,
  roomType,
  typeInventory,
} from "../src/database/schema/inventory.js";
import {
  type BoardRoom,
  HousekeepingService,
  type RoomReadiness,
} from "../src/modules/housekeeping/housekeeping.service.js";

// The day the property is having. Every occupancy question below is answered
// against this one date, which is what the service takes it as a parameter for.
const BUSINESS_DATE = parseDate("2027-11-14");

// Enough of a calendar for the inventory assertion to have something to read.
const TOTAL_ROOMS = 10;
const SOLD_ROOMS = 3;

const HOUSEKEEPER = {
  email: "buong.phong@mariva.test",
  fullName: "Phạm Thị Duyên",
} as const;

// Floor 2 is here so the board's ordering has two floors to get right.
const ROOMS = [
  { number: "210", floor: 2 },
  { number: "301", floor: 3 },
  { number: "302", floor: 3 },
  { number: "303", floor: 3 },
  { number: "304", floor: 3 },
  { number: "305", floor: 3 },
  { number: "306", floor: 3 },
] as const;

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;

const housekeeping = new HousekeepingService();

let deluxeTypeId: string;
let housekeeperId: string;
const roomIds = new Map<string, string>();

beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is unset — vitest.config.ts loads .env.test");
  }

  pool = new pg.Pool({ connectionString });
  db = drizzle({ client: pool, schema });

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  await db.execute(
    sql`truncate room_condition, room_assignment, booking_night, booking, type_inventory, room, room_type, staff_session, staff_user restart identity cascade`,
  );

  const [deluxe] = await db
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
    .returning();

  deluxeTypeId = deluxe!.id;

  const [staff] = await db
    .insert(staffUser)
    .values({
      ...HOUSEKEEPER,
      role: "HOUSEKEEPING",
      passwordHash: "not-a-real-hash",
    })
    .returning();

  housekeeperId = staff!.id;

  // No condition rows are written with them. Every room below starts as one
  // the service has never been asked about, which is the state the board's
  // fallback has to answer for.
  const created = await db
    .insert(room)
    .values(ROOMS.map((each) => ({ ...each, roomTypeId: deluxeTypeId })))
    .returning({ id: room.id, number: room.number });

  for (const each of created) {
    roomIds.set(each.number, each.id);
  }

  await db.insert(typeInventory).values({
    roomTypeId: deluxeTypeId,
    stayDate: BUSINESS_DATE.toString(),
    totalRooms: TOTAL_ROOMS,
    soldRooms: SOLD_ROOMS,
  });

  // 303 has a guest in it on the business date; 305's guest leaves that
  // morning; 304 is held by a closure with nobody in it at all.
  await hold("303", "2027-11-13", "2027-11-16", "with a guest");
  await hold("305", "2027-11-12", "2027-11-14", "leaving today");
  await closure("304", "2027-11-13", "2027-11-16");
});

afterAll(async () => {
  await pool?.end();
});

/** A booking, and the room held for it across a half-open range. */
async function hold(
  roomNumber: string,
  checkIn: string,
  checkOut: string,
  label: string,
): Promise<void> {
  const [sold] = await db
    .insert(booking)
    .values({
      reference: `MRV-20271114-${roomNumber}`,
      state: "CONFIRMED",
      roomTypeId: deluxeTypeId,
      checkInDate: checkIn,
      checkOutDate: checkOut,
      ratePlanCode: "STANDARD",
      adults: 2,
      quotedStayTotalGross: 3_000_000n,
      quotedPercentAdjustment: 0,
      quotedExtraPersonPerNightGross: 600_000n,
    })
    .returning({ id: booking.id });

  if (!sold) {
    throw new Error(`no booking written for the room ${label}`);
  }

  await db.insert(roomAssignment).values({
    roomId: roomIds.get(roomNumber)!,
    bookingId: sold.id,
    checkInDate: checkIn,
    checkOutDate: checkOut,
  });
}

/** A room held for a repair rather than for a guest — no booking behind it. */
async function closure(
  roomNumber: string,
  checkIn: string,
  checkOut: string,
): Promise<void> {
  await db.insert(roomAssignment).values({
    roomId: roomIds.get(roomNumber)!,
    checkInDate: checkIn,
    checkOutDate: checkOut,
    closureReason: "Balcony railing",
  });
}

/** One room's tile off the board. */
async function tileFor(roomNumber: string): Promise<BoardRoom> {
  const board = await housekeeping.getBoard(db, BUSINESS_DATE);
  const tile = board.find((each) => each.roomNumber === roomNumber);

  if (!tile) {
    throw new Error(`room ${roomNumber} is missing from the board`);
  }

  return tile;
}

/** The type's sellable figures — what `FR-HK-02` says housekeeping must not
 *  move. */
async function sellable(): Promise<{ totalRooms: number; soldRooms: number }> {
  const [row] = await db
    .select({
      totalRooms: typeInventory.totalRooms,
      soldRooms: typeInventory.soldRooms,
    })
    .from(typeInventory)
    .where(
      and(
        eq(typeInventory.roomTypeId, deluxeTypeId),
        eq(typeInventory.stayDate, BUSINESS_DATE.toString()),
      ),
    )
    .limit(1);

  if (!row) {
    throw new Error("no inventory row for the business date");
  }

  return row;
}

/** The refusal a call provoked. Fails the test if the service accepted it. */
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

  throw new Error("the service accepted a call it should have refused");
}

describe("the condition of a room", () => {
  it("reads as clean until somebody says otherwise", async () => {
    // 306 has no condition row. The board answers for it anyway, in the state
    // the column's own default gives a room nobody has touched — a room
    // missing from the grid is a room nobody is sent to clean.
    const tile = await tileFor("306");

    expect(tile.status).toBe("CLEAN");
    expect(tile.isReady).toBe(true);
    expect(tile.updatedAt).toBeNull();
    expect(tile.updatedBy).toBeNull();
  });

  it("writes the first condition a room has ever had", async () => {
    // The upsert's insert path: no row exists yet, and a read-then-update
    // would have found nothing to update.
    const written = await housekeeping.setCondition(db, {
      roomNumber: "301",
      status: "DIRTY",
      updatedBy: housekeeperId,
    });

    expect(written).toMatchObject({
      roomNumber: "301",
      status: "DIRTY",
      note: null,
    });
    expect(written.updatedAt).toBeInstanceOf(Date);
  });

  it("moves the same room on to inspected and back to clean", async () => {
    // The conflict path, twice. `INSPECTED` is the optional supervisor pass and
    // `CLEAN` is what a cleaning round ends in; both admit a guest.
    await housekeeping.setCondition(db, {
      roomNumber: "301",
      status: "INSPECTED",
      updatedBy: housekeeperId,
    });

    expect((await tileFor("301")).status).toBe("INSPECTED");

    await housekeeping.setCondition(db, {
      roomNumber: "301",
      status: "CLEAN",
      updatedBy: housekeeperId,
    });

    const tile = await tileFor("301");

    expect(tile.status).toBe("CLEAN");
    expect(tile.isReady).toBe(true);

    // One row, whatever the number of writes. Three inserts would have been
    // three answers to whether a guest may be admitted, and
    // `room_condition_room_id_key` would have refused the second — which is
    // what `on conflict do update` is here to stop being a failed tap.
    const stored = await db
      .select({ id: roomCondition.id })
      .from(roomCondition)
      .where(eq(roomCondition.roomId, roomIds.get("301")!));

    expect(stored).toHaveLength(1);
  });

  it("names who last touched the room", async () => {
    // What the board is read for. A staff name, never a guest's — `screens.md`
    // §Staff surfaces.
    expect((await tileFor("301")).updatedBy).toBe(HOUSEKEEPER.fullName);
  });

  it("lets the system dirty a room with nobody to attribute it to", async () => {
    // Checkout hands the room back as `DIRTY` with no member of staff making a
    // cleaning judgement — `booking-state-machine.md` §3.
    await housekeeping.setCondition(db, {
      roomNumber: "210",
      status: "DIRTY",
    });

    const tile = await tileFor("210");

    expect(tile.status).toBe("DIRTY");
    expect(tile.isReady).toBe(false);
    expect(tile.updatedBy).toBeNull();
  });

  it("refuses a room number nobody has", async () => {
    const refusal = await refused(
      housekeeping.setCondition(db, { roomNumber: "999", status: "CLEAN" }),
    );

    expect(refusal.code).toBe("NOT_FOUND");
  });

  it("refuses to take a room out of order through the wrong door", async () => {
    // A different capability governs that status. Nothing is written.
    const refusal = await refused(
      housekeeping.setCondition(db, {
        roomNumber: "301",
        status: "OUT_OF_ORDER" as RoomReadiness,
      }),
    );

    expect(refusal.code).toBe("BAD_REQUEST");
    expect((await tileFor("301")).status).toBe("CLEAN");
  });
});

describe("a room out of order", () => {
  it("leaves the type's sellable inventory exactly where it was", async () => {
    // `FR-HK-02`, stated the way the requirement states it. Withdrawing a room
    // from sale is `FR-INV-04`'s closure — a manager's act that moves
    // `total_rooms`. This is a cleaning act, and the counter below does not
    // move because nothing in the service names the table it lives in.
    const before = await sellable();

    const written = await housekeeping.setOutOfOrder(db, {
      roomNumber: "302",
      outOfOrder: true,
      reason: "shower mixer leaking into 202 below",
      updatedBy: housekeeperId,
    });

    expect(written.status).toBe("OUT_OF_ORDER");
    expect(written.note).toBe("shower mixer leaking into 202 below");

    const after = await sellable();

    expect(after).toEqual(before);
    expect(after).toEqual({ totalRooms: TOTAL_ROOMS, soldRooms: SOLD_ROOMS });
  });

  it("stops the room reading as ready, and says why", async () => {
    const tile = await tileFor("302");

    expect(tile.status).toBe("OUT_OF_ORDER");
    expect(tile.isReady).toBe(false);
    expect(tile.note).toBe("shower mixer leaking into 202 below");
  });

  it("stores the reason without the whitespace it was typed with", async () => {
    const written = await housekeeping.setOutOfOrder(db, {
      roomNumber: "302",
      outOfOrder: true,
      reason: "  lock replacement  ",
      updatedBy: housekeeperId,
    });

    expect(written.note).toBe("lock replacement");
  });

  it("hands the room back to housekeeping when the repair is done", async () => {
    // Not to `CLEAN`: somebody has been working in there, and §4's guard admits
    // a guest into `CLEAN` or `INSPECTED`. Guessing in that direction would
    // open the room to a guest before a housekeeper has seen it.
    const written = await housekeeping.setOutOfOrder(db, {
      roomNumber: "302",
      outOfOrder: false,
      updatedBy: housekeeperId,
    });

    expect(written.status).toBe("DIRTY");
    // The reason went with the state it explained. A room reading `DIRTY`
    // under "lock replacement" is a board contradicting itself.
    expect(written.note).toBeNull();
    expect((await tileFor("302")).note).toBeNull();
  });

  it("drops the reason when a cleaning round finishes instead", async () => {
    await housekeeping.setOutOfOrder(db, {
      roomNumber: "302",
      outOfOrder: true,
      reason: "carpet drying",
      updatedBy: housekeeperId,
    });

    const written = await housekeeping.setCondition(db, {
      roomNumber: "302",
      status: "CLEAN",
      updatedBy: housekeeperId,
    });

    expect(written.status).toBe("CLEAN");
    expect(written.note).toBeNull();
  });

  it("refuses a room number nobody has", async () => {
    const refusal = await refused(
      housekeeping.setOutOfOrder(db, {
        roomNumber: "999",
        outOfOrder: true,
        reason: "Nonexistent",
      }),
    );

    expect(refusal.code).toBe("NOT_FOUND");
  });

  it("refuses a reason that was demanded and not given", async () => {
    const refusal = await refused(
      housekeeping.setOutOfOrder(db, { roomNumber: "302", outOfOrder: true }),
    );

    expect(refusal.code).toBe("BAD_REQUEST");
  });
});

describe("the board", () => {
  it("shows a room occupied while a guest's stay covers the business date", async () => {
    expect((await tileFor("303")).isOccupied).toBe(true);
  });

  it("shows a room vacant on the morning the guest leaves", async () => {
    // Half-open, like every other range in the system: the departure date is
    // not a night. It is also the tile a housekeeper is looking for.
    expect((await tileFor("305")).isOccupied).toBe(false);
  });

  it("does not call a closed room occupied", async () => {
    // A closure holds the room so nobody else may be given it, but there is no
    // guest in it — occupied and held are different questions, and only one of
    // them is on this board.
    expect((await tileFor("304")).isOccupied).toBe(false);
  });

  it("shows what a housekeeper walks with and no money and no guest", async () => {
    // `FR-HK-02` and `screens.md` §Staff surfaces: housekeeping sees no money
    // and no guest names. Asserted over the whole tile rather than by naming
    // the fields to avoid, because the field that gets added later is the one
    // no such list would have mentioned.
    //
    // `roomType` is inside that line rather than outside it — what has to be
    // made up in the room is neither a price nor a person.
    const tile = await tileFor("303");

    expect(Object.keys(tile).sort()).toEqual([
      "floor",
      "isOccupied",
      "isReady",
      "note",
      "roomNumber",
      "roomType",
      "status",
      "updatedAt",
      "updatedBy",
    ]);
  });

  it("holds every room the property has, once each", async () => {
    const board = await housekeeping.getBoard(db, BUSINESS_DATE);

    // Once each even for 303, whose room is held across a range: a join to
    // `room_assignment` would have produced a tile per stay.
    expect(board.map((tile) => tile.roomNumber)).toEqual(
      ROOMS.map((each) => each.number),
    );
  });

  it("walks the floors in the order they are walked", async () => {
    const board = await housekeeping.getBoard(db, BUSINESS_DATE);

    expect(board[0]).toMatchObject({ roomNumber: "210", floor: 2 });
    expect(board.at(-1)).toMatchObject({ roomNumber: "306", floor: 3 });
  });
});
