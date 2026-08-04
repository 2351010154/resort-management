// The room condition table and its keys, against a real Postgres.
//
// `src/database/schema/housekeeping.spec.ts` asserts what the declarations say.
// This file asserts what the database does with them, and it exists for one
// claim in particular: `FR-HK-02` — setting `OUT_OF_ORDER` never reduces
// sellable inventory. That is not a promise about a service that has not been
// written yet. It is a fact about the two tables, and the test below states it
// the only way that survives the housekeeping service arriving later: it takes
// the type's inventory before the status change and after it, and the figures
// are the same because nothing joins the one to the other.
//
// The rest is the row a housekeeping board cannot survive: a room with two
// conditions, a condition naming a room the property does not have, and an
// out-of-order room with a blank reason.
//
// It runs against `mariva_test`, which `.env.test` points at, and it applies the
// migrations rather than pushing the schema: the SQL under test is the SQL that
// will run in production. No Nest application is booted — the subject is the
// storage layer itself.

import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { roomCondition } from "../src/database/schema/housekeeping.js";
import { staffUser } from "../src/database/schema/identity.js";
import * as schema from "../src/database/schema/index.js";
import {
  room,
  roomType,
  typeInventory,
} from "../src/database/schema/inventory.js";

const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

// A uuid the migrations guarantee nothing points at — every id in this suite is
// `defaultRandom()`, so this one names no row by construction.
const NO_SUCH_ROW = "00000000-0000-0000-0000-000000000000";

const STAY_DATE = "2027-11-14";

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;

let deluxeTypeId: string;
let housekeeperId: string;

// Room numbers are unique and this suite writes several, so they are counted
// rather than drawn: a random one would make a failing run harder to reproduce
// than the bug it found.
let roomOrdinal = 0;

/** A room of the seeded Deluxe type, numbered so no two tests collide. */
async function aRoom(): Promise<string> {
  roomOrdinal += 1;

  const [created] = await db
    .insert(room)
    .values({
      number: `9${String(roomOrdinal).padStart(2, "0")}`,
      floor: 9,
      roomTypeId: deluxeTypeId,
    })
    .returning();

  return created!.id;
}

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

  const [housekeeper] = await db
    .insert(staffUser)
    .values({
      email: "housekeeper@mariva.test",
      fullName: "Phạm Thị D",
      role: "HOUSEKEEPING",
      passwordHash: "not-a-real-hash",
    })
    .returning();

  housekeeperId = housekeeper!.id;
});

afterAll(async () => {
  await pool?.end();
});

describe("the condition of a room", () => {
  it("starts clean and records who changed it", async () => {
    const roomId = await aRoom();

    const [initial] = await db
      .insert(roomCondition)
      .values({ roomId })
      .returning();

    expect(initial?.status).toBe("CLEAN");
    expect(initial?.updatedBy).toBeNull();

    const [cleaned] = await db
      .update(roomCondition)
      .set({ status: "INSPECTED", updatedBy: housekeeperId })
      .where(eq(roomCondition.roomId, roomId))
      .returning();

    expect(cleaned?.status).toBe("INSPECTED");
    expect(cleaned?.updatedBy).toBe(housekeeperId);
  });

  it("lets the system dirty a room with nobody to attribute it to", async () => {
    // Checkout sets `DIRTY` as an effect of the transition
    // (`booking-state-machine.md` §3). There is no member of staff making a
    // cleaning judgement, and a `NOT NULL` actor would force the transition to
    // invent one.
    const roomId = await aRoom();

    await db.insert(roomCondition).values({ roomId });

    const [dirtied] = await db
      .update(roomCondition)
      .set({ status: "DIRTY" })
      .where(eq(roomCondition.roomId, roomId))
      .returning();

    expect(dirtied?.status).toBe("DIRTY");
    expect(dirtied?.updatedBy).toBeNull();
  });

  it("refuses a second condition for one room", async () => {
    // Two rows are two complete-looking answers to whether a guest may be
    // checked in, and the guard would admit or refuse by whichever it read
    // first.
    const roomId = await aRoom();

    await db.insert(roomCondition).values({ roomId });

    const refusal = await refused(
      db.insert(roomCondition).values({ roomId, status: "DIRTY" }),
    );

    expect(refusal.code).toBe(UNIQUE_VIOLATION);
    expect(refusal.constraint).toBe("room_condition_room_id_key");
  });

  it("refuses a condition for a room the property does not have", async () => {
    const refusal = await refused(
      db.insert(roomCondition).values({ roomId: NO_SUCH_ROW }),
    );

    expect(refusal.code).toBe(FOREIGN_KEY_VIOLATION);
    expect(refusal.constraint).toBe("room_condition_room_id_room_id_fk");
  });

  it("refuses a reason that was demanded and not given", async () => {
    // A room out of order for a stated reason and one out of order for none
    // have to stay tellable apart, so only one of them is storable.
    const roomId = await aRoom();

    const refusal = await refused(
      db
        .insert(roomCondition)
        .values({ roomId, status: "OUT_OF_ORDER", note: "   " }),
    );

    expect(refusal.code).toBe(CHECK_VIOLATION);
    expect(refusal.constraint).toBe("room_condition_note_present_when_set");
  });
});

describe("a room out of order", () => {
  it("leaves the type's sellable inventory exactly where it was", async () => {
    // `FR-HK-02`, stated against the tables. Withdrawing a room from sale is
    // `FR-INV-04`'s closure, which moves `total_rooms` and which the RBAC matrix
    // §3 grants to a manager; marking a room out of order is a cleaning act a
    // housekeeper may perform. The counter below does not move, and it cannot:
    // `room_condition` is keyed by room and `type_inventory` by type and date,
    // with nothing joining the one to the other.
    const roomId = await aRoom();

    await db.insert(roomCondition).values({ roomId });

    await db.insert(typeInventory).values({
      roomTypeId: deluxeTypeId,
      stayDate: STAY_DATE,
      totalRooms: 10,
      soldRooms: 3,
    });

    const before = await sellableOn(STAY_DATE);

    await db
      .update(roomCondition)
      .set({
        status: "OUT_OF_ORDER",
        updatedBy: housekeeperId,
        note: "shower mixer leaking into 402 below",
      })
      .where(eq(roomCondition.roomId, roomId));

    const after = await sellableOn(STAY_DATE);

    expect(after).toEqual(before);
    expect(after).toEqual({ totalRooms: 10, soldRooms: 3 });
  });

  it("keeps the room itself, so the closure that would remove it is a separate act", async () => {
    // The room is still part of the property while it is out of order — it is
    // the physical room a folio, an assignment and next month's stay all point
    // at. Nothing here deletes or hides it.
    const roomId = await aRoom();

    await db
      .insert(roomCondition)
      .values({ roomId, status: "OUT_OF_ORDER", note: "lock replacement" });

    const [stillThere] = await db.select().from(room).where(eq(room.id, roomId));

    expect(stillThere?.id).toBe(roomId);
  });
});

/** The type's sellable figures for a date — what `FR-HK-02` says housekeeping
 *  must not move. */
async function sellableOn(
  stayDate: string,
): Promise<{ totalRooms: number; soldRooms: number }> {
  const [row] = await db
    .select({
      totalRooms: typeInventory.totalRooms,
      soldRooms: typeInventory.soldRooms,
    })
    .from(typeInventory)
    .where(
      sql`${typeInventory.roomTypeId} = ${deluxeTypeId} and ${typeInventory.stayDate} = ${stayDate}`,
    );

  if (!row) {
    throw new Error(`no inventory row for ${stayDate}`);
  }

  return row;
}

type Refusal = { code: string; constraint?: string };

/** The refusal a write provoked. Fails the test if the database accepted it. */
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
 * to be one deep.
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
