// The booking table and its keys, against a real Postgres.
//
// `src/database/schema/booking.spec.ts` asserts what the declarations say. This
// file asserts what the database does with them, because the claim being made
// is not that a service remembers to check — it is that a half-stated booking
// cannot be stored. Only a database can answer that, so this suite applies the
// committed migrations and then tries to write rows the property could not
// honour.
//
// The rows it tries are the ones the state machine will lean on: a cancellation
// with no reason to price it by, a hold with no expiry to sweep it at, and an
// assignment naming a stay nobody took. Each of those is a bug that would
// otherwise surface a milestone later as a booking nobody can explain.
//
// It runs against `mariva_test`, which `.env.test` points at, and it applies
// the migrations rather than pushing the schema: the SQL under test is the SQL
// that will run in production. No Nest application is booted — the subject is
// the storage layer itself.

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { booking, bookingNight } from "../src/database/schema/booking.js";
import * as schema from "../src/database/schema/index.js";
import {
  room,
  roomAssignment,
  roomType,
} from "../src/database/schema/inventory.js";

const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

const CHECK_IN = "2027-05-10";
const CHECK_OUT = "2027-05-13";

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;

let deluxeId: string;
let room301Id: string;

// References are unique and this suite writes many bookings, so they are
// counted rather than drawn: a random one would make a failing run harder to
// reproduce than the bug it found.
let referenceOrdinal = 0;

/** A booking the property could honour. Each test overrides the one field it is
 *  about, so a refusal names the constraint under test and not a second one the
 *  fixture happened to break. */
function aBooking(
  overrides: Partial<typeof booking.$inferInsert> = {},
): typeof booking.$inferInsert {
  referenceOrdinal += 1;

  return {
    reference: `MRV-20270510-${String(referenceOrdinal).padStart(4, "0")}`,
    state: "CONFIRMED" as const,
    roomTypeId: deluxeId,
    checkInDate: CHECK_IN,
    checkOutDate: CHECK_OUT,
    ratePlanCode: "STANDARD" as const,
    adults: 2,
    quotedStayTotalGross: 5_400_000n,
    quotedPercentAdjustment: 0,
    quotedExtraPersonPerNightGross: 600_000n,
    ...overrides,
  };
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
    sql`truncate room_assignment, booking_night, booking, type_inventory, room, room_type restart identity cascade`,
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

  const [room301] = await db
    .insert(room)
    .values({ number: "301", floor: 3, roomTypeId: deluxeId })
    .returning();

  room301Id = room301!.id;
});

afterAll(async () => {
  await pool?.end();
});

describe("the state and its reason", () => {
  it("refuses a cancellation that says nothing about why", async () => {
    // §4's grid prices a cancellation by its reason. A cancelled booking
    // without one cannot be priced at all, and the row would sit there looking
    // ordinary until a refund had to be computed from it.
    const refusal = await refused(
      db.insert(booking).values(aBooking({ state: "CANCELLED" })),
    );

    expect(refusal.code).toBe(CHECK_VIOLATION);
    expect(refusal.constraint).toBe("booking_reason_exactly_when_cancelled");
  });

  it("refuses a reason on a booking that is still live", async () => {
    // The other direction, and it matters as much: a cancellation reason on a
    // confirmed stay is a cancellation somebody started and did not finish.
    const refusal = await refused(
      db
        .insert(booking)
        .values(aBooking({ cancellationReason: "GUEST_REQUEST" })),
    );

    expect(refusal.code).toBe(CHECK_VIOLATION);
    expect(refusal.constraint).toBe("booking_reason_exactly_when_cancelled");
  });

  it("stores a cancellation that carries its reason", async () => {
    const [cancelled] = await db
      .insert(booking)
      .values(
        aBooking({ state: "CANCELLED", cancellationReason: "HOLD_EXPIRED" }),
      )
      .returning();

    expect(cancelled?.state).toBe("CANCELLED");
    expect(cancelled?.cancellationReason).toBe("HOLD_EXPIRED");
  });
});

describe("the hold and its expiry", () => {
  it("refuses a hold that never expires", async () => {
    // A hold with no expiry holds a room forever, and the TTL sweep has no date
    // to find it by. It is the one row that would silently reduce availability
    // for the rest of the calendar.
    const refusal = await refused(
      db.insert(booking).values(aBooking({ state: "HELD" })),
    );

    expect(refusal.code).toBe(CHECK_VIOLATION);
    expect(refusal.constraint).toBe("booking_hold_expiry_exactly_when_held");
  });

  it("refuses an expiry left on a booking that is no longer held", async () => {
    // A stale TTL on a confirmed stay is a date the sweep could act on, and
    // what it would do with it is cancel a room the property has sold.
    const refusal = await refused(
      db
        .insert(booking)
        .values(aBooking({ holdExpiresAt: new Date("2027-05-01T10:00:00Z") })),
    );

    expect(refusal.code).toBe(CHECK_VIOLATION);
    expect(refusal.constraint).toBe("booking_hold_expiry_exactly_when_held");
  });

  it("stores a hold that expires", async () => {
    const expiry = new Date("2027-05-01T10:00:00Z");

    const [held] = await db
      .insert(booking)
      .values(aBooking({ state: "HELD", holdExpiresAt: expiry }))
      .returning();

    expect(held?.state).toBe("HELD");
    expect(held?.holdExpiresAt).toEqual(expiry);
  });
});

describe("the stay itself", () => {
  it("refuses a booking of no nights", async () => {
    // The same row `room_assignment` refuses, and for the same reason: a stay
    // whose departure is its arrival holds nothing and collides with nothing.
    const refusal = await refused(
      db.insert(booking).values(aBooking({ checkOutDate: CHECK_IN })),
    );

    expect(refusal.code).toBe(CHECK_VIOLATION);
    expect(refusal.constraint).toBe("booking_covers_at_least_one_night");
  });

  it("refuses a party with nobody old enough to check in", async () => {
    const refusal = await refused(
      db.insert(booking).values(aBooking({ adults: 0, childAges: [7] })),
    );

    expect(refusal.code).toBe(CHECK_VIOLATION);
    expect(refusal.constraint).toBe("booking_has_an_adult");
  });

  it("refuses a child of negative age", async () => {
    // Every age from zero up resolves to a band in `occupancy-pricing.ts`. A
    // negative one resolves to the free band and quietly stops being charged.
    const refusal = await refused(
      db.insert(booking).values(aBooking({ childAges: [4, -1] })),
    );

    expect(refusal.code).toBe(CHECK_VIOLATION);
    expect(refusal.constraint).toBe("booking_child_ages_are_ages");
  });

  it("stores the ages it was quoted for, in order", async () => {
    const [family] = await db
      .insert(booking)
      .values(aBooking({ adults: 2, childAges: [3, 9] }))
      .returning();

    expect(family?.childAges).toEqual([3, 9]);
  });

  it("refuses a second booking answering to one reference", async () => {
    const reference = "MRV-20270510-0042";

    await db.insert(booking).values(aBooking({ reference }));

    const refusal = await refused(
      db.insert(booking).values(aBooking({ reference })),
    );

    expect(refusal.code).toBe(UNIQUE_VIOLATION);
  });
});

describe("the frozen quote", () => {
  it("refuses a stay sold for nothing", async () => {
    // A comp is a folio adjustment at M6, not a booking priced at zero — the
    // rate calendar refuses zero for the same reason.
    const refusal = await refused(
      db.insert(booking).values(aBooking({ quotedStayTotalGross: 0n })),
    );

    expect(refusal.code).toBe(CHECK_VIOLATION);
    expect(refusal.constraint).toBe("booking_quoted_total_positive");
  });

  it("refuses a frozen adjustment the plan itself could not hold", async () => {
    const refusal = await refused(
      db.insert(booking).values(aBooking({ quotedPercentAdjustment: -140 })),
    );

    expect(refusal.code).toBe(CHECK_VIOLATION);
    expect(refusal.constraint).toBe("booking_quoted_adjustment_within_bounds");
  });

  it("refuses a breakfast line that would post as nothing", async () => {
    const refusal = await refused(
      db
        .insert(booking)
        .values(aBooking({ quotedBreakfastPerPersonGross: 0n })),
    );

    expect(refusal.code).toBe(CHECK_VIOLATION);
    expect(refusal.constraint).toBe(
      "booking_quoted_breakfast_positive_when_set",
    );
  });

  it("keeps the nights that add up to the total it stored", async () => {
    // The invariant the two tables exist to hold together: the calendar prices
    // as they stood, summed, with the plan's percentage applied once over the
    // whole stay — `property-and-tariff.md` §5. Asserted here as arithmetic
    // over stored rows, which is what a folio at M6 will do to explain a line.
    const nights = [
      { stayDate: "2027-05-10", standardGross: 1_800_000n },
      { stayDate: "2027-05-11", standardGross: 1_800_000n },
      { stayDate: "2027-05-12", standardGross: 2_070_000n },
    ];

    const total = nights.reduce((sum, night) => sum + night.standardGross, 0n);

    const [sold] = await db
      .insert(booking)
      .values(
        aBooking({
          quotedStayTotalGross: (total * BigInt(100 - 10)) / 100n,
          quotedPercentAdjustment: -10,
          ratePlanCode: "NONREF",
        }),
      )
      .returning();

    await db
      .insert(bookingNight)
      .values(nights.map((night) => ({ ...night, bookingId: sold!.id })));

    const stored = await db
      .select({ standardGross: bookingNight.standardGross })
      .from(bookingNight)
      .where(sql`${bookingNight.bookingId} = ${sold!.id}`);

    const restored =
      (stored.reduce((sum, night) => sum + night.standardGross, 0n) *
        BigInt(100 + sold!.quotedPercentAdjustment)) /
      100n;

    expect(restored).toBe(sold!.quotedStayTotalGross);
  });

  it("refuses a second price for one night of one booking", async () => {
    const [sold] = await db.insert(booking).values(aBooking()).returning();

    await db.insert(bookingNight).values({
      bookingId: sold!.id,
      stayDate: CHECK_IN,
      standardGross: 1_800_000n,
    });

    const refusal = await refused(
      db.insert(bookingNight).values({
        bookingId: sold!.id,
        stayDate: CHECK_IN,
        standardGross: 1_900_000n,
      }),
    );

    expect(refusal.code).toBe(UNIQUE_VIOLATION);
  });

  it("refuses a night belonging to no booking", async () => {
    const refusal = await refused(
      db.insert(bookingNight).values({
        bookingId: crypto.randomUUID(),
        stayDate: CHECK_IN,
        standardGross: 1_800_000n,
      }),
    );

    expect(refusal.code).toBe(FOREIGN_KEY_VIOLATION);
  });
});

describe("the key room assignment waited for", () => {
  it("refuses a hold naming a booking nobody took", async () => {
    // The constraint this milestone was told to add. Before it, a typo in a
    // booking id produced a room held against nothing — inventory consumed by a
    // stay no query could find, and no error anywhere.
    const refusal = await refused(
      db.insert(roomAssignment).values({
        roomId: room301Id,
        bookingId: crypto.randomUUID(),
        checkInDate: CHECK_IN,
        checkOutDate: CHECK_OUT,
      }),
    );

    expect(refusal.code).toBe(FOREIGN_KEY_VIOLATION);
  });

  it("holds a room for a booking that exists", async () => {
    const [sold] = await db.insert(booking).values(aBooking()).returning();

    const [held] = await db
      .insert(roomAssignment)
      .values({
        roomId: room301Id,
        bookingId: sold!.id,
        checkInDate: "2027-06-01",
        checkOutDate: "2027-06-04",
      })
      .returning();

    expect(held?.bookingId).toBe(sold!.id);
  });

  it("refuses to delete a booking a room is still held for", async () => {
    // No `onDelete`, so Postgres restricts. A booking deleted out from under
    // its assignment would leave a room held by nothing, which is the same
    // orphan the key above refuses to create in the first place.
    const [sold] = await db.insert(booking).values(aBooking()).returning();

    await db.insert(roomAssignment).values({
      roomId: room301Id,
      bookingId: sold!.id,
      checkInDate: "2027-07-01",
      checkOutDate: "2027-07-03",
    });

    const refusal = await refused(
      db.delete(booking).where(sql`${booking.id} = ${sold!.id}`),
    );

    expect(refusal.code).toBe(FOREIGN_KEY_VIOLATION);
  });

  it("still holds a room for no booking at all, for a closure", async () => {
    const [closure] = await db
      .insert(roomAssignment)
      .values({
        roomId: room301Id,
        checkInDate: "2027-08-01",
        checkOutDate: "2027-08-05",
        closureReason: "Air conditioning replacement",
      })
      .returning();

    expect(closure?.bookingId).toBeNull();
  });
});

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
