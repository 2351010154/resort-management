// The write path, under contention — `FR-INV-02` and `NFR-01`.
//
// The requirement is not that a service checks availability before selling. It
// is that fifty people reaching for the same last room produce one booking and
// forty-nine refusals, and that the counter afterwards reads exactly what the
// property owns. That claim cannot be made about a mock: a mock has no row
// locks, so a suite built on one would pass whatever the service did with them.
// So this runs the real service, against the migrated database `.env.test`
// names, fifty transactions at a time.
//
// No Nest application is booted — `inventory-storage.e2e-spec.ts` gives the
// reason and it holds here: the subject is one service and the database
// underneath it, and an HTTP stack around them would only add ways for a
// failure to mean something else. The service is a class with one dependency,
// so it is constructed with one.
//
// The pool is this file's own and is sized above the concurrency it drives.
// The application's pool is ten connections wide by design, and borrowing it
// would quietly serialise the race into five batches of ten — which is a
// perfectly correct result and no test of anything.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import type { RoomTypeCode } from "@mariva/shared";
import { ORPCError } from "@orpc/nest";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../src/database/schema/index.js";
import { roomType, typeInventory } from "../src/database/schema/inventory.js";
import { seedDatabase } from "../src/database/seed/seed.js";
import {
  InventoryService,
  type StayInventory,
} from "../src/modules/inventory/inventory.service.js";

const SEED_FROM = parseDate("2027-06-01");

// The mix from `seed/property.ts`. Named here so an assertion reads as "every
// Deluxe the property has" rather than as the number ten.
const DELUXE_ROOMS = 10;
const PREMIER_ROOMS = 8;
const JUNIOR_SUITE_ROOMS = 6;

/** `FR-INV-02`'s number, and the reason this file exists. */
const SIMULTANEOUS_GUESTS = 50;

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let inventory: InventoryService;

beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is unset — vitest.config.ts loads .env.test");
  }

  pool = new pg.Pool({
    connectionString,
    max: SIMULTANEOUS_GUESTS + 10,
  });
  db = drizzle({ client: pool, schema });

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  // The real property, and not one stay against it: every assertion below
  // counts rooms, and five hundred synthetic holds would make "one Deluxe left"
  // a number nobody can predict.
  await seedDatabase(db, { from: SEED_FROM, bookings: 0 });

  inventory = new InventoryService(db);
});

afterAll(async () => {
  await pool?.end();
});

describe("the last room of a type", () => {
  const NIGHT = "2027-09-14";
  const NEXT_DAY = "2027-09-15";

  it("goes to exactly one of fifty simultaneous requests", async () => {
    // Nine of the ten Deluxes gone, which is the state the fiftieth guest and
    // the first are both looking at.
    await sell("DELUXE", [NIGHT], DELUXE_ROOMS - 1);

    const outcomes = await Promise.allSettled(
      Array.from({ length: SIMULTANEOUS_GUESTS }, () =>
        inventory.reserve(stay("DELUXE", NIGHT, NEXT_DAY)),
      ),
    );

    expect(outcomes.filter((each) => each.status === "fulfilled")).toHaveLength(
      1,
    );

    // Clean refusals: every one of the forty-nine is the conflict the check
    // constraint produced, translated. A single 500 among them would mean the
    // race was won by an unhandled driver error rather than by the database
    // refusing an oversell, and the count alone would not say so.
    expect(outcomes.filter(isConflict)).toHaveLength(SIMULTANEOUS_GUESTS - 1);

    // The assertion the requirement is actually about. Not "at most ten sold" —
    // exactly ten, because a race that loses an increment is as wrong as one
    // that gains one and is far harder to notice.
    expect(await counterOn("DELUXE", NIGHT)).toEqual({
      totalRooms: DELUXE_ROOMS,
      soldRooms: DELUXE_ROOMS,
    });
  });

  it("leaves the night after it alone", async () => {
    // Half-open: the departure date is not a night sold, so fifty requests for
    // the fourteenth touched nothing on the fifteenth.
    expect(await counterOn("DELUXE", NEXT_DAY)).toEqual({
      totalRooms: DELUXE_ROOMS,
      soldRooms: 0,
    });
  });
});

describe("a stay the property cannot sell in full", () => {
  const CHECK_IN = "2027-10-05";
  const SOLD_OUT = "2027-10-06";
  const CHECK_OUT = "2027-10-08";
  const NIGHTS = [CHECK_IN, SOLD_OUT, "2027-10-07"];

  it("is refused, and leaves every night of it untouched", async () => {
    // The middle night only. The first and the third have rooms, so a service
    // that walked the range night by night would consume the first, fail on the
    // second, and leave a room sold to a booking that does not exist.
    await sell("PREMIER", [SOLD_OUT], PREMIER_ROOMS);

    const before = await countersOn("PREMIER", NIGHTS);

    await expect(
      inventory.reserve(stay("PREMIER", CHECK_IN, CHECK_OUT)),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    expect(await countersOn("PREMIER", NIGHTS)).toEqual(before);
  });
});

describe("a stay across nights the property has not opened", () => {
  it("is refused rather than sold across a calendar that does not exist", async () => {
    // The seed opens twelve months from 2027-06-01. A stay running off the end
    // has no counter to move on its later nights, and incrementing only the
    // nights that happen to have rows would sell a stay the property cannot
    // honour the moment those dates are opened.
    await expect(
      inventory.reserve(stay("DELUXE", "2028-05-30", "2028-06-03")),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    expect(await counterOn("DELUXE", "2028-05-30")).toEqual({
      totalRooms: DELUXE_ROOMS,
      soldRooms: 0,
    });
  });
});

describe("a stay that is sold", () => {
  const CHECK_IN = "2027-11-02";
  const CHECK_OUT = "2027-11-05";
  const NIGHTS = [CHECK_IN, "2027-11-03", "2027-11-04"];

  it("consumes one room on each of its nights", async () => {
    const movement = await inventory.reserve(
      stay("DELUXE", CHECK_IN, CHECK_OUT),
    );

    expect(movement.nights).toBe(NIGHTS.length);
    expect(await countersOn("DELUXE", NIGHTS)).toEqual(
      NIGHTS.map(() => ({ totalRooms: DELUXE_ROOMS, soldRooms: 1 })),
    );

    // And nothing on the departure date, for the third time and deliberately:
    // an off-by-one night is the failure this convention exists to prevent and
    // it is invisible in every number except this one.
    expect(await counterOn("DELUXE", CHECK_OUT)).toEqual({
      totalRooms: DELUXE_ROOMS,
      soldRooms: 0,
    });
  });

  it("gives the nights back when it is released", async () => {
    await inventory.release(stay("DELUXE", CHECK_IN, CHECK_OUT));

    expect(await countersOn("DELUXE", NIGHTS)).toEqual(
      NIGHTS.map(() => ({ totalRooms: DELUXE_ROOMS, soldRooms: 0 })),
    );
  });

  it("refuses a release of nights nobody sold", async () => {
    // `type_inventory_sold_not_negative`. A cancellation processed twice would
    // otherwise leave the row reading as availability the property does not
    // have — the same oversell, arriving from the other direction.
    await expect(
      inventory.release(stay("DELUXE", CHECK_IN, CHECK_OUT)),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    expect(await countersOn("DELUXE", NIGHTS)).toEqual(
      NIGHTS.map(() => ({ totalRooms: DELUXE_ROOMS, soldRooms: 0 })),
    );
  });
});

describe("simultaneous multi-night stays", () => {
  const CHECK_IN = "2027-12-11";
  const CHECK_OUT = "2027-12-13";
  const NIGHTS = [CHECK_IN, "2027-12-12"];
  const FREE = 3;
  const GUESTS = 20;

  it("sell exactly what the tightest night had left", async () => {
    await sell("JUNIOR_SUITE", NIGHTS, JUNIOR_SUITE_ROOMS - FREE);

    const outcomes = await Promise.allSettled(
      Array.from({ length: GUESTS }, () =>
        inventory.reserve(stay("JUNIOR_SUITE", CHECK_IN, CHECK_OUT)),
      ),
    );

    expect(outcomes.filter((each) => each.status === "fulfilled")).toHaveLength(
      FREE,
    );
    expect(outcomes.filter(isConflict)).toHaveLength(GUESTS - FREE);

    // Two rows moved per transaction rather than one, which is where a booking
    // write can deadlock instead of merely conflicting. A deadlock surfaces as
    // a 40P01 that no branch translates, so it would show up above as a
    // rejection that is not a conflict — and here as a counter short of full.
    expect(await countersOn("JUNIOR_SUITE", NIGHTS)).toEqual(
      NIGHTS.map(() => ({
        totalRooms: JUNIOR_SUITE_ROOMS,
        soldRooms: JUNIOR_SUITE_ROOMS,
      })),
    );
  });
});

describe("requests that are not about inventory at all", () => {
  it("refuses a stay of no nights", async () => {
    await expect(
      inventory.reserve(stay("DELUXE", "2027-08-01", "2027-08-01")),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });
  });

  it("refuses a stay that ends before it begins", async () => {
    await expect(
      inventory.reserve(stay("DELUXE", "2027-08-05", "2027-08-01")),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });
  });

  // Not here: the 404 for a type the property has not laid down. `room_type_code`
  // is a Postgres enum, so a code outside the five is refused as a bad parameter
  // before the lookup runs, and the only way to reach the branch is a database
  // migrated and not seeded — which is every other test in this file's fixture
  // taken apart and put back. The branch is the same one `closure.service.ts`
  // has for an unknown room number, where a text column makes it testable.
});

/** The request shape, from the two strings a date is written as. */
function stay(
  code: RoomTypeCode,
  checkIn: string,
  checkOut: string,
): StayInventory {
  return {
    roomType: code,
    checkIn: parseDate(checkIn),
    checkOut: parseDate(checkOut),
  };
}

/** A rejection that is the refusal this service promises, and not a fault. */
function isConflict(outcome: PromiseSettledResult<unknown>): boolean {
  return (
    outcome.status === "rejected" &&
    outcome.reason instanceof ORPCError &&
    outcome.reason.code === "CONFLICT" &&
    outcome.reason.status === 409
  );
}

interface Counter {
  readonly totalRooms: number;
  readonly soldRooms: number;
}

/** Sets how many of a type are already gone on each of the given nights. */
async function sell(
  code: RoomTypeCode,
  nights: readonly string[],
  soldRooms: number,
): Promise<void> {
  const [type] = await db
    .select({ id: roomType.id })
    .from(roomType)
    .where(eq(roomType.code, code))
    .limit(1);

  await db
    .update(typeInventory)
    .set({ soldRooms })
    .where(
      and(
        eq(typeInventory.roomTypeId, type!.id),
        inArray(typeInventory.stayDate, [...nights]),
      ),
    );
}

async function counterOn(code: RoomTypeCode, night: string): Promise<Counter> {
  return (await countersOn(code, [night]))[0]!;
}

/** The two numbers for each night, in the order the nights were asked for. */
async function countersOn(
  code: RoomTypeCode,
  nights: readonly string[],
): Promise<Counter[]> {
  const rows = await db
    .select({
      stayDate: typeInventory.stayDate,
      totalRooms: typeInventory.totalRooms,
      soldRooms: typeInventory.soldRooms,
    })
    .from(typeInventory)
    .innerJoin(roomType, eq(roomType.id, typeInventory.roomTypeId))
    .where(
      and(
        eq(roomType.code, code),
        inArray(typeInventory.stayDate, [...nights]),
      ),
    );

  const byDate = new Map(rows.map((row) => [row.stayDate, row]));

  return nights.map((night) => {
    const row = byDate.get(night);

    if (!row) {
      throw new Error(`${code} has no counter on ${night}`);
    }

    return { totalRooms: row.totalRooms, soldRooms: row.soldRooms };
  });
}
