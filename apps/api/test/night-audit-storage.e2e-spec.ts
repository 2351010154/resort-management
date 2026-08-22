// The night-audit snapshot, against a real Postgres.
//
// The claim under test is `FR-RPT-01`'s in one clause — reports read snapshots,
// so history never changes — and no service can keep it. "A closed trading day
// is written once and never again" is a sentence about every client that will
// ever open this database: the sweep that writes it, a support script, a later
// migration, somebody at a psql prompt at the end of a long night. So it is
// asserted the only way it can be, by issuing the forbidden statements against
// real rows and reading the refusal back.
//
// Two mechanisms, and they answer different questions. The primary key on
// `night_audit_snapshot` is what makes a second freeze of one day impossible,
// which is also the sweep's idempotency: `night-audit.job.ts` writes the row and
// its second pass finds the day no longer outstanding. The trigger in `0043` is
// what makes the row that exists stay what it was. A key without the trigger
// would leave a day editable in place, which is the same lie arrived at more
// quietly.
//
// Everything here runs inside a transaction that is rolled back, and that is
// forced rather than tidy — `folio-storage.e2e-spec.ts` makes the argument and
// it is sharper here, because a snapshot cannot be deleted at all. A spec that
// committed its rows would leave days nothing can clear and a room type nothing
// can release, and `seedDatabase` would fail several files later for a reason
// that looks nothing like this file. Each refusal is taken inside a savepoint,
// so the test can go on to check that the row it tried to rewrite is still
// exactly as it was.
//
// It runs against `mariva_test`, which `.env.test` points at, and it applies the
// migrations rather than pushing the schema: the trigger under test lives in
// `0043_a_closed_trading_day_is_frozen_once.sql` and only migrating puts it
// there. No Nest application is booted — the subject is the storage layer
// itself.
//
// ## And the three statements the service reads a day with
//
// The last suite is here because nothing else executes them. `night-audit.job.
// spec.ts` runs the sweep against a stand-in that answers `select` without
// reading a predicate — deliberately, because which lines are revenue is what
// the roll-up is being asked and a stand-in that filtered would be answering
// instead of it. The cost is that the SQL itself is never issued: the aliased
// self-join that names the line a reversal undoes, the correlated `not exists`
// that finds a night nobody charged, and the `on conflict do nothing …
// returning` the whole idempotency argument rests on are all assembled by
// Drizzle and, until here, never handed to Postgres.
//
// So the cases below build a night out of real rows and let `NightAuditService`
// read it. What they assert is small on purpose — a figure, a count, a stay's id
// — because the arithmetic is the other suite's subject and this one is asking
// only whether the statements run and come back with the rows they name.

import { parseDate } from "@internationalized/date";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { booking } from "../src/database/schema/booking.js";
import { folio, folioPosting } from "../src/database/schema/folio.js";
import * as schema from "../src/database/schema/index.js";
import { roomType, typeInventory } from "../src/database/schema/inventory.js";
import {
  nightAuditSnapshot,
  nightAuditSnapshotType,
} from "../src/database/schema/night-audit.js";
import { NightAuditService } from "../src/modules/reporting/night-audit.service.js";

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

// Raised by `night_audit_snapshot_refuse_rewrite()`. This system's own code, in
// a class the SQL standard leaves to implementations, so a caller can tell an
// attempt to rewrite a closed day from every other error a function might raise
// — and tell it apart without matching message text, which is the whole reason
// `0011`, `0023` and `0042` each took a code of their own.
const FROZEN_SNAPSHOT_VIOLATION = "MV008";

/** The trading day these cases close. Its own date, so nothing collides. */
const A_CLOSED_DAY = "2027-10-14";

/** A date no snapshot exists for, where a test needs a day nobody closed. */
const AN_UNCLOSED_DAY = "2027-10-15";

/**
 * The night the service cases below build out of real rows.
 *
 * Its own date, and deliberately years past the horizon `seedDatabase`
 * publishes: the service sums the inventory and the postings of *every* type and
 * stay on the date it is given, so a night that shared a date with the seed
 * would be asserted against the seed's rooms as well as this file's. The
 * `type_inventory` rows for it are cleared inside the transaction regardless,
 * because "the seed does not reach 2029" is a fact about the seed and this file
 * should not depend on it.
 */
const A_NIGHT_OF_ITS_OWN = "2029-02-17";

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is unset — vitest.config.ts loads .env.test");
  }

  pool = new pg.Pool({ connectionString });
  db = drizzle({ client: pool, schema });

  await migrate(db, { migrationsFolder: "./src/database/migrations" });
});

afterAll(async () => {
  await pool?.end();
});

describe("one snapshot per business date", () => {
  it("refuses a second freeze of a day already closed", async () => {
    // `FR-RPT-01`: exactly once per business date. This is the sweep's
    // idempotency stated as a property of the database rather than of the
    // sweep — `night-audit.job.ts` never checks whether a day is closed before
    // inserting, because between a read and an insert there is nothing holding
    // the key and two runs that both looked would both write.
    await rolledBack(async (tx) => {
      await freeze(tx, A_CLOSED_DAY);

      const refusal = await refused(tx, (savepoint) =>
        savepoint.insert(nightAuditSnapshot).values({
          businessDate: A_CLOSED_DAY,
          sellableRooms: 40,
          roomsSold: 40,
          netRoomRevenueVnd: 99_000_000n,
          otherRevenueVnd: 0n,
        }),
      );

      expect(refusal.code).toBe(UNIQUE_VIOLATION);

      // And the day still says what it said. A refusal that had partially
      // applied would be the rewrite this table exists to prevent.
      const [frozen] = await tx
        .select()
        .from(nightAuditSnapshot)
        .where(eq(nightAuditSnapshot.businessDate, A_CLOSED_DAY));

      expect(frozen?.roomsSold).toBe(18);
      expect(frozen?.netRoomRevenueVnd).toBe(21_600_000n);
    });
  });

  it("refuses a second row for one room type on one day", async () => {
    // The same claim one level down. Two rows for one pair would each hold part
    // of the night, and the property-wide row above them would agree with
    // neither.
    await rolledBack(async (tx) => {
      const typeId = await someRoomType(tx);

      await freeze(tx, A_CLOSED_DAY);
      await freezeType(tx, A_CLOSED_DAY, typeId);

      const refusal = await refused(tx, (savepoint) =>
        freezeType(savepoint, A_CLOSED_DAY, typeId),
      );

      expect(refusal.code).toBe(UNIQUE_VIOLATION);
    });
  });
});

describe("a day that has been closed", () => {
  it("refuses an UPDATE of the figures it was closed with", async () => {
    await rolledBack(async (tx) => {
      await freeze(tx, A_CLOSED_DAY);

      const refusal = await refused(tx, (savepoint) =>
        savepoint
          .update(nightAuditSnapshot)
          .set({ netRoomRevenueVnd: 1n })
          .where(eq(nightAuditSnapshot.businessDate, A_CLOSED_DAY)),
      );

      expect(refusal.code).toBe(FROZEN_SNAPSHOT_VIOLATION);

      const [frozen] = await tx
        .select()
        .from(nightAuditSnapshot)
        .where(eq(nightAuditSnapshot.businessDate, A_CLOSED_DAY));

      expect(frozen?.netRoomRevenueVnd).toBe(21_600_000n);
    });
  });

  it("refuses a DELETE of the day itself", async () => {
    // Deleting is how a day would be re-audited: remove the row, run the sweep
    // again, get a different December. The refusal is what makes "reports never
    // see a day the audit has not closed" also mean "and never a different one".
    await rolledBack(async (tx) => {
      await freeze(tx, A_CLOSED_DAY);

      const refusal = await refused(tx, (savepoint) =>
        savepoint
          .delete(nightAuditSnapshot)
          .where(eq(nightAuditSnapshot.businessDate, A_CLOSED_DAY)),
      );

      expect(refusal.code).toBe(FROZEN_SNAPSHOT_VIOLATION);

      const [standing] = await tx
        .select()
        .from(nightAuditSnapshot)
        .where(eq(nightAuditSnapshot.businessDate, A_CLOSED_DAY));

      expect(standing?.businessDate).toBe(A_CLOSED_DAY);
    });
  });

  it("refuses an UPDATE of one room type's share of it", async () => {
    // The same trigger, on the table where the edit would be least visible: a
    // property-wide row that still adds up while one type's revenue has been
    // moved under it is the report nobody can check.
    await rolledBack(async (tx) => {
      const typeId = await someRoomType(tx);

      await freeze(tx, A_CLOSED_DAY);
      await freezeType(tx, A_CLOSED_DAY, typeId);

      const refusal = await refused(tx, (savepoint) =>
        savepoint
          .update(nightAuditSnapshotType)
          .set({ roomsSold: 0 })
          .where(
            and(
              eq(nightAuditSnapshotType.businessDate, A_CLOSED_DAY),
              eq(nightAuditSnapshotType.roomTypeId, typeId),
            ),
          ),
      );

      expect(refusal.code).toBe(FROZEN_SNAPSHOT_VIOLATION);
    });
  });

  it("refuses a DELETE of one room type's share of it", async () => {
    await rolledBack(async (tx) => {
      const typeId = await someRoomType(tx);

      await freeze(tx, A_CLOSED_DAY);
      await freezeType(tx, A_CLOSED_DAY, typeId);

      const refusal = await refused(tx, (savepoint) =>
        savepoint
          .delete(nightAuditSnapshotType)
          .where(eq(nightAuditSnapshotType.businessDate, A_CLOSED_DAY)),
      );

      expect(refusal.code).toBe(FROZEN_SNAPSHOT_VIOLATION);
    });
  });
});

describe("the types under a closed day", () => {
  it("are reachable from the day they belong to", async () => {
    // What every Reports page does: pick the days, then read the types under
    // them. `FR-RPT-03`'s three ratios are computed from these three columns, so
    // the join being the ordinary one is the whole of the access pattern.
    await rolledBack(async (tx) => {
      const typeId = await someRoomType(tx);

      await freeze(tx, A_CLOSED_DAY);
      await freezeType(tx, A_CLOSED_DAY, typeId);

      const under = await tx
        .select({
          roomTypeId: nightAuditSnapshotType.roomTypeId,
          sellableRooms: nightAuditSnapshotType.sellableRooms,
          roomsSold: nightAuditSnapshotType.roomsSold,
          netRoomRevenueVnd: nightAuditSnapshotType.netRoomRevenueVnd,
        })
        .from(nightAuditSnapshot)
        .innerJoin(
          nightAuditSnapshotType,
          eq(
            nightAuditSnapshotType.businessDate,
            nightAuditSnapshot.businessDate,
          ),
        )
        .where(eq(nightAuditSnapshot.businessDate, A_CLOSED_DAY));

      expect(under).toEqual([
        {
          roomTypeId: typeId,
          sellableRooms: 20,
          roomsSold: 18,
          netRoomRevenueVnd: 21_600_000n,
        },
      ]);
    });
  });

  it("cannot exist for a day nobody closed", async () => {
    // The other direction, and the reason the reference is there: a type row
    // standing alone would be revenue attributed to a trading day the property
    // never reported, which no page would show and no total would include.
    await rolledBack(async (tx) => {
      const typeId = await someRoomType(tx);

      const refusal = await refused(tx, (savepoint) =>
        freezeType(savepoint, AN_UNCLOSED_DAY, typeId),
      );

      expect(refusal.code).toBe(FOREIGN_KEY_VIOLATION);
    });
  });
});

describe("what the service reads a day off the ledger with", () => {
  it("freezes the night the postings and the inventory actually say", async () => {
    // One Deluxe night, charged at 1,200,000 đồng net with its tax line beside
    // it, against twenty rooms on sale. The VAT is in the ledger and must not be
    // in the room revenue — `FR-GST-04` — and here that is asserted through the
    // statement that reads the column rather than through a literal handed to
    // the roll-up.
    await rolledBack(async (tx) => {
      const typeId = await someRoomType(tx);

      await onSale(tx, typeId, A_NIGHT_OF_ITS_OWN, 20);

      const stay = await occupied(tx, typeId, A_NIGHT_OF_ITS_OWN, "CHECKED_IN");

      await charge(tx, stay, A_NIGHT_OF_ITS_OWN, 1_200_000n);

      expect(
        await new NightAuditService().freeze(tx, parseDate(A_NIGHT_OF_ITS_OWN)),
      ).toBe(true);

      const [frozen] = await tx
        .select()
        .from(nightAuditSnapshot)
        .where(eq(nightAuditSnapshot.businessDate, A_NIGHT_OF_ITS_OWN));

      expect(frozen).toMatchObject({
        sellableRooms: 20,
        roomsSold: 1,
        netRoomRevenueVnd: 1_200_000n,
        otherRevenueVnd: 0n,
      });

      // And the type row beneath it, which is what `FR-RPT-03`'s three ratios
      // are taken over.
      const under = await tx
        .select()
        .from(nightAuditSnapshotType)
        .where(eq(nightAuditSnapshotType.businessDate, A_NIGHT_OF_ITS_OWN));

      expect(under).toMatchObject([
        {
          roomTypeId: typeId,
          sellableRooms: 20,
          roomsSold: 1,
          netRoomRevenueVnd: 1_200_000n,
        },
      ]);
    });
  });

  it("answers a second freeze of the same day with false, at the key", async () => {
    // The idempotency the runner's second pass turns on, issued as the statement
    // the service actually writes: `on conflict do nothing … returning` gives
    // back no row, and no row is what tells the service it closed nothing. A
    // stand-in can model that; only Postgres can confirm the statement means it.
    await rolledBack(async (tx) => {
      await someRoomType(tx);

      const audit = new NightAuditService();

      expect(await audit.freeze(tx, parseDate(A_NIGHT_OF_ITS_OWN))).toBe(true);
      expect(await audit.freeze(tx, parseDate(A_NIGHT_OF_ITS_OWN))).toBe(false);

      const days = await tx
        .select({ businessDate: nightAuditSnapshot.businessDate })
        .from(nightAuditSnapshot)
        .where(eq(nightAuditSnapshot.businessDate, A_NIGHT_OF_ITS_OWN));

      expect(days).toHaveLength(1);
    });
  });

  it("names the stay that occupied a night nothing charged, and only that one", async () => {
    // The question the sweep asks before it freezes, and the one the whole
    // refuse-rather-than-understate decision rests on. The departed stay is the
    // case: `RoomChargeSweep` charges `CHECKED_IN` only, so a stay that occupied
    // the night and has since left is the one no run will ever post for.
    await rolledBack(async (tx) => {
      const typeId = await someRoomType(tx);

      const departed = await occupied(
        tx,
        typeId,
        A_NIGHT_OF_ITS_OWN,
        "CHECKED_OUT",
      );
      const charged = await occupied(
        tx,
        typeId,
        A_NIGHT_OF_ITS_OWN,
        "CHECKED_IN",
      );

      await charge(tx, charged, A_NIGHT_OF_ITS_OWN, 1_200_000n);

      expect(
        await new NightAuditService().unchargedStays(
          tx,
          parseDate(A_NIGHT_OF_ITS_OWN),
        ),
      ).toEqual([departed]);
    });
  });
});

/**
 * How many of a type the property put on sale that night, and nothing else.
 *
 * The date is cleared first because the service sums `total_rooms` over every
 * type with a row on it. A seeded row left standing would be added to this one,
 * and the case would be asserting the seed's property rather than its own.
 */
async function onSale(
  tx: Tx,
  roomTypeId: string,
  stayDate: string,
  totalRooms: number,
): Promise<void> {
  await tx.delete(typeInventory).where(eq(typeInventory.stayDate, stayDate));

  await tx.insert(typeInventory).values({ roomTypeId, stayDate, totalRooms });
}

/**
 * A stay across the night, in the state a case needs it in, with an account
 * open.
 *
 * The columns are the ones the table requires and no more: this file's subject
 * is what the audit reads off a stay, not how a stay comes to exist, which is
 * `booking-storage.e2e-spec.ts`'s.
 */
async function occupied(
  tx: Tx,
  roomTypeId: string,
  night: string,
  state: "CHECKED_IN" | "CHECKED_OUT",
): Promise<string> {
  const [stay] = await tx
    .insert(booking)
    .values({
      reference: `NA-${state}-${night}-${stayCount++}`,
      state,
      roomTypeId,
      checkInDate: night,
      checkOutDate: parseDate(night).add({ days: 1 }).toString(),
      ratePlanCode: "STANDARD",
      adults: 2,
      quotedStayTotalGross: 1_400_000n,
      quotedPercentAdjustment: 0,
      quotedExtraPersonPerNightGross: 600_000n,
    })
    .returning({ id: booking.id });

  await tx.insert(folio).values({ bookingId: stay!.id });

  return stay!.id;
}

/**
 * The night's rent on that stay's account, with the tax line the sale carries.
 *
 * `posted_by` is left null, which is what makes it the sweep's own line — the
 * narrowing both `room-charge-sweep.ts` and `unchargedStays` are written around.
 */
async function charge(
  tx: Tx,
  bookingId: string,
  businessDate: string,
  net: bigint,
): Promise<void> {
  const [account] = await tx
    .select({ id: folio.id })
    .from(folio)
    .where(eq(folio.bookingId, bookingId));

  const [room] = await tx
    .insert(folioPosting)
    .values({
      folioId: account!.id,
      type: "ROOM_CHARGE",
      amount: net,
      description: "One night",
      businessDate,
    })
    .returning({ id: folioPosting.id });

  // Beside it and never inside it. A snapshot that counted this as revenue would
  // report the property's takings as the guest's bill.
  await tx.insert(folioPosting).values({
    folioId: account!.id,
    type: "VAT",
    amount: net / 10n,
    description: "VAT",
    businessDate,
    parentPostingId: room!.id,
  });
}

/** Keeps every stay this file opens on a reference of its own. */
let stayCount = 0;

/**
 * Closes a day at a figure the other cases read back.
 *
 * Eighteen of forty rooms at 1,200,000 đồng net apiece — an ordinary night,
 * chosen so that no two of the columns hold the same number and a test asserting
 * the wrong one fails.
 */
async function freeze(tx: Tx, businessDate: string): Promise<void> {
  await tx.insert(nightAuditSnapshot).values({
    businessDate,
    sellableRooms: 40,
    roomsSold: 18,
    netRoomRevenueVnd: 21_600_000n,
    otherRevenueVnd: 3_400_000n,
  });
}

/** One room type's share of that night. */
async function freezeType(
  tx: Tx,
  businessDate: string,
  roomTypeId: string,
): Promise<unknown> {
  return await tx.insert(nightAuditSnapshotType).values({
    businessDate,
    roomTypeId,
    sellableRooms: 20,
    roomsSold: 18,
    netRoomRevenueVnd: 21_600_000n,
  });
}

/**
 * A room type to attribute a night to, seeded if the database has none.
 *
 * `folio-storage.e2e-spec.ts` carries the same helper for the same reason: the
 * suite runs against a database another file may have emptied, and this file's
 * subject is the snapshot rather than the property.
 */
async function someRoomType(tx: Tx): Promise<string> {
  const [existing] = await tx
    .select({ id: roomType.id })
    .from(roomType)
    .limit(1);

  if (existing) {
    return existing.id;
  }

  const [created] = await tx
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

  return created!.id;
}

const ROLLBACK = Symbol("rollback");

/**
 * Runs the body in a transaction and throws it away.
 *
 * The only cleanup a table that refuses `DELETE` has.
 */
async function rolledBack(body: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await body(tx);

      throw ROLLBACK;
    });
  } catch (thrown) {
    if (thrown !== ROLLBACK) {
      throw thrown;
    }
  }
}

/** What the database said when it refused a write. */
interface Refusal {
  readonly code: string;
  readonly message: string;
  readonly constraint?: string;
}

/**
 * Issues a write that must be refused, inside a savepoint, and reports the
 * refusal.
 *
 * The savepoint is what lets the case carry on afterwards: a failed statement
 * aborts the transaction it is in, and every one of these tests reads the
 * untouched row back after the refusal.
 */
async function refused(
  tx: Tx,
  write: (savepoint: Tx) => Promise<unknown>,
): Promise<Refusal> {
  try {
    await tx.transaction(async (savepoint) => {
      await write(savepoint);
    });
  } catch (error) {
    return refusalOf(error);
  }

  throw new Error("the database stored a row it should have refused");
}

/**
 * The driver's own fields, dug out of whatever Drizzle wrapped them in.
 *
 * `folio-storage.e2e-spec.ts` walks the chain the same way and for the same
 * reason: the depth is not something to assume.
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
        message: current.message,
        constraint: typeof constraint === "string" ? constraint : undefined,
      };
    }
  }

  throw error;
}
