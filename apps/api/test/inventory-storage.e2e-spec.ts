// The two inventory layers, against a real Postgres.
//
// `src/database/schema/inventory.spec.ts` asserts what the declarations say.
// This file asserts what the database does with them, because the claim being
// made is not that a service remembers to check — it is that the wrong state
// cannot be stored. Only a database can answer that, so this suite applies the
// committed migrations and then tries to write rows the property could not
// honour.
//
// It runs against `mariva_test`, which `.env.test` points at, and it applies
// the migrations rather than pushing the schema: the SQL under test is the SQL
// that will run in production, hand-written exclusion constraint included.
//
// No Nest application is booted. Nothing here goes through a controller, a
// guard or a service — the subject is the storage layer itself, and a stack
// above it would only add ways for a failure to mean something else.

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../src/database/schema/index.js";
import {
  room,
  roomAssignment,
  roomType,
  typeInventory,
} from "../src/database/schema/inventory.js";

// The SQLSTATE codes Postgres answers with. Asserted by code rather than by
// message, because a message is localised and a code is the contract.
const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const EXCLUSION_VIOLATION = "23P01";

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;

// One type and two rooms of it — everything below hangs off these two ids.
let deluxeId: string;
let room201Id: string;
let room202Id: string;

beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is unset — vitest.config.ts loads .env.test");
  }

  pool = new pg.Pool({ connectionString });
  db = drizzle({ client: pool, schema });

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  // A clean slate, and only ever in the test database — `.env.test` is the
  // single place that decides which one that is.
  await db.execute(
    sql`truncate room_assignment, type_inventory, room, room_type restart identity cascade`,
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

  deluxeId = deluxe!.id;

  const rooms = await db
    .insert(room)
    .values([
      { number: "201", floor: 2, roomTypeId: deluxeId },
      { number: "202", floor: 2, roomTypeId: deluxeId },
    ])
    .returning();

  room201Id = rooms[0]!.id;
  room202Id = rooms[1]!.id;
});

afterAll(async () => {
  await pool?.end();
});

describe("the type-level counter", () => {
  it("refuses a night that sold more rooms than it has", async () => {
    const refusal = await refused(
      db.insert(typeInventory).values({
        roomTypeId: deluxeId,
        stayDate: "2026-09-01",
        totalRooms: 10,
        soldRooms: 11,
      }),
    );

    expect(refusal.code).toBe(CHECK_VIOLATION);
    expect(refusal.constraint).toBe("type_inventory_sold_at_most_total");
  });

  it("accepts a night that sold every room it has", async () => {
    // Sold out is a normal state and not an error. A constraint written with
    // `<` instead of `<=` would make the last room of every night unsellable,
    // which is a bug that costs revenue and looks like caution.
    const [full] = await db
      .insert(typeInventory)
      .values({
        roomTypeId: deluxeId,
        stayDate: "2026-09-02",
        totalRooms: 10,
        soldRooms: 10,
      })
      .returning();

    expect(full?.soldRooms).toBe(10);
    expect(full?.totalRooms).toBe(10);
  });

  it("refuses a negative sold count", async () => {
    // A release that decrements one time too many. Without this the row would
    // read as availability the property does not have.
    const refusal = await refused(
      db.insert(typeInventory).values({
        roomTypeId: deluxeId,
        stayDate: "2026-09-03",
        totalRooms: 10,
        soldRooms: -1,
      }),
    );

    expect(refusal.code).toBe(CHECK_VIOLATION);
    expect(refusal.constraint).toBe("type_inventory_sold_not_negative");
  });

  it("refuses a negative room count", async () => {
    // The constraint Postgres names here is not fixed: a negative total also
    // breaks the ceiling against any sold count that is not negative too, and
    // which of the two it reports first is its business. That the row is
    // refused is the assertion.
    const refusal = await refused(
      db.insert(typeInventory).values({
        roomTypeId: deluxeId,
        stayDate: "2026-09-04",
        totalRooms: -1,
        soldRooms: 0,
      }),
    );

    expect(refusal.code).toBe(CHECK_VIOLATION);
  });

  it("refuses a second row for the same type and date", async () => {
    await db.insert(typeInventory).values({
      roomTypeId: deluxeId,
      stayDate: "2026-09-05",
      totalRooms: 10,
      soldRooms: 4,
    });

    // Two rows would each hold part of the count, and the ceiling would be
    // enforced twice against two halves — oversell arriving through the
    // constraint that exists to refuse it.
    const refusal = await refused(
      db.insert(typeInventory).values({
        roomTypeId: deluxeId,
        stayDate: "2026-09-05",
        totalRooms: 10,
        soldRooms: 6,
      }),
    );

    expect(refusal.code).toBe(UNIQUE_VIOLATION);
    expect(refusal.constraint).toBe("type_inventory_room_type_date_key");
  });
});

describe("the room-level hold", () => {
  it("refuses a second stay overlapping the first in the same room", async () => {
    await db.insert(roomAssignment).values({
      roomId: room201Id,
      checkInDate: "2026-08-01",
      checkOutDate: "2026-08-05",
    });

    const refusal = await refused(
      db.insert(roomAssignment).values({
        roomId: room201Id,
        checkInDate: "2026-08-03",
        checkOutDate: "2026-08-07",
      }),
    );

    expect(refusal.code).toBe(EXCLUSION_VIOLATION);
    expect(refusal.constraint).toBe("room_assignment_no_overlap");
  });

  it("accepts a stay beginning on the day the last one ends", async () => {
    // The `[)` proof, and the assertion this file exists for. Room 201 is held
    // above from the first to the fifth. A guest arriving on the fifth takes a
    // room the previous guest has left: the departure date is not a night sold,
    // so the two ranges touch at a boundary and do not overlap. A closed upper
    // bound here would refuse every changeover day the hotel runs on.
    const [next] = await db
      .insert(roomAssignment)
      .values({
        roomId: room201Id,
        checkInDate: "2026-08-05",
        checkOutDate: "2026-08-07",
      })
      .returning();

    expect(next?.checkInDate).toBe("2026-08-05");
  });

  it("accepts the same dates in a different room", async () => {
    // The constraint is about one room, not about the calendar. Forty rooms
    // sold for the same week is a full hotel, not a conflict.
    const [other] = await db
      .insert(roomAssignment)
      .values({
        roomId: room202Id,
        checkInDate: "2026-08-01",
        checkOutDate: "2026-08-05",
      })
      .returning();

    expect(other?.roomId).toBe(room202Id);
  });

  it("holds a room with no booking behind it, for a closure", async () => {
    const [closure] = await db
      .insert(roomAssignment)
      .values({
        roomId: room202Id,
        checkInDate: "2026-10-01",
        checkOutDate: "2026-10-04",
        closureReason: "Bathroom re-tiling",
      })
      .returning();

    expect(closure?.bookingId).toBeNull();

    // And the closure blocks a booking exactly as another booking would: to the
    // exclusion constraint a room held for a leaking pipe and a room held for a
    // guest are the same fact.
    const refusal = await refused(
      db.insert(roomAssignment).values({
        roomId: room202Id,
        checkInDate: "2026-10-02",
        checkOutDate: "2026-10-06",
      }),
    );

    expect(refusal.code).toBe(EXCLUSION_VIOLATION);
  });

  it("refuses a hold that covers no night at all", async () => {
    // An empty range overlaps nothing, so the exclusion constraint cannot see
    // it. It is the one row that would slip past the guarantee this table
    // gives, and it is refused by a check instead.
    const refusal = await refused(
      db.insert(roomAssignment).values({
        roomId: room201Id,
        checkInDate: "2026-11-01",
        checkOutDate: "2026-11-01",
      }),
    );

    expect(refusal.code).toBe(CHECK_VIOLATION);
    expect(refusal.constraint).toBe("room_assignment_covers_at_least_one_night");
  });
});

/** What Postgres said when it refused the write. */
interface Refusal {
  readonly code: string | undefined;
  readonly constraint: string | undefined;
}

/**
 * Runs a write that must fail and returns the refusal.
 *
 * A write that succeeds fails the test here rather than at a later assertion
 * reading an absent error, so "the database accepted it" is what the report
 * says instead of "cannot read properties of undefined".
 */
async function refused(write: Promise<unknown>): Promise<Refusal> {
  try {
    await write;
  } catch (error) {
    return refusalOf(error);
  }

  throw new Error("the database stored a row it should have refused");
}

/**
 * The SQLSTATE code and constraint name out of a thrown error.
 *
 * Drizzle wraps a driver error in one of its own, so the fields that matter sit
 * on a cause one or more levels down. The chain is walked rather than assumed
 * to be one deep, because the day Drizzle adds a layer the assertions should
 * still describe the constraint rather than start reading `undefined`.
 */
function refusalOf(error: unknown): Refusal {
  for (let current = error; current instanceof Error; current = current.cause) {
    const { code, constraint } = current as Error & {
      code?: unknown;
      constraint?: unknown;
    };

    if (typeof code === "string") {
      return {
        code,
        constraint: typeof constraint === "string" ? constraint : undefined,
      };
    }
  }

  throw error;
}
