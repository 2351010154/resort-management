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

import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../src/database/schema/index.js";
import { roomType } from "../src/database/schema/inventory.js";
import {
  nightAuditSnapshot,
  nightAuditSnapshotType,
} from "../src/database/schema/night-audit.js";

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
