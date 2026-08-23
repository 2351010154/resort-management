// The statements the performance page is read with, against a real Postgres —
// `FR-RPT-03`.
//
// `performance-queries.service.spec.ts` covers the arithmetic and covers it from
// literals, which is the right shape for arithmetic and says nothing at all
// about SQL. Two of the three statements under it are this file's subject, and
// neither is issued anywhere else in the suite:
//
//  - **The property window**, which selects three columns
//    `report-queries.service.ts` never touches. That service reads the two
//    revenue columns the money page adds up; `sellable_rooms` and `rooms_sold`
//    reach Postgres for the first time here, as `smallint`s the driver has to
//    hand back as numbers beside a `bigint` it hands back as a `bigint`.
//  - **The per-type window and its join**, which is the sharper of the two. The
//    snapshot stores a room type by id on purpose — a code copied in as text
//    would survive a rename and show one type twice — and the contract carries
//    the *code*, because a report is read by a person. The join is where those
//    two decisions meet, and until here Drizzle assembles it and never hands it
//    to Postgres.
//
// The third statement is `max(business_date)`, which is `ReportQueries`' and is
// covered by `report-queries-storage.e2e-spec.ts`. It is not asserted again here
// — the point of injecting that service rather than writing a second maximum is
// that there is only one statement to test.
//
// There is one authorisation case at the end and no database in it. What decides
// whether a caller reaches this page is the row the route declares and the grant
// the matrix holds for their role, both resolved before a row is read — so the
// receptionist's refusal and the accountant's service are asserted from the two
// facts the guard composes, which is how `export-authority.spec.ts` asserts the
// same claim about the revenue page.
//
// Everything else runs inside a transaction that is rolled back, which is forced
// rather than tidy for the reason `night-audit-storage.e2e-spec.ts` gives at
// length: a snapshot cannot be deleted at all, so a spec that committed would
// leave days nothing can clear.
//
// The dates are years past the horizon `seedDatabase` publishes and every window
// is asked with an explicit `from`, so no seeded snapshot can drift into a
// total. The room types are read out of the database rather than named here,
// because the property's types are the seed's.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import { ROOM_TYPE_CODES, type RoomTypeCode } from "@mariva/shared";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CAPABILITY_KEY } from "../src/common/auth/access.decorators.js";
import * as schema from "../src/database/schema/index.js";
import { roomType } from "../src/database/schema/inventory.js";
import {
  nightAuditSnapshot,
  nightAuditSnapshotType,
} from "../src/database/schema/night-audit.js";
import { staffGrant } from "../src/modules/identity/rbac/matrix.js";
import { permits } from "../src/modules/identity/rbac/roles.js";
import { PerformanceQueries } from "../src/modules/reporting/performance-queries.service.js";
import { ReportQueries } from "../src/modules/reporting/report-queries.service.js";
import { ReportingController } from "../src/modules/reporting/reporting.controller.js";

/** Two consecutive trading days of this file's own, past every seeded one. */
const FIRST_DAY = "2032-05-30";
const SECOND_DAY = "2032-05-31";
/** A day in the following month, so a monthly cut has two buckets to make. */
const A_DAY_IN_JUNE = "2032-06-01";

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The service under test, with the boundary it shares with the revenue page. */
function performanceQueries(): PerformanceQueries {
  return new PerformanceQueries(new ReportQueries());
}

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

describe("what a range of closed days performed at", () => {
  it("reads the three frozen counts back and divides them once", () => {
    return rolledBack(async (tx) => {
      // Two nights of different sizes, so the answer separates the summed rule
      // from the averaged one on the way back out of the database as well as in
      // the arithmetic: 34,000,000 over 21 rooms sold, not the mean of the two
      // nights' rates.
      await freeze(tx, FIRST_DAY, 10, 1, 1_000_000n);
      await freeze(tx, SECOND_DAY, 40, 20, 33_000_000n);

      const report = await performanceQueries().performance(tx, {
        bucket: "MONTH",
        from: parseDate(FIRST_DAY),
        to: parseDate("2032-05-31"),
      });

      expect(report.buckets).toHaveLength(1);
      expect(report.buckets[0]).toMatchObject({
        from: FIRST_DAY,
        to: SECOND_DAY,
        closedDays: 2,
      });
      expect(report.buckets[0]?.property).toMatchObject({
        sellableRooms: 50,
        roomsSold: 21,
        netRoomRevenueVnd: 34_000_000n,
        adrVnd: 1_619_048n,
        revparVnd: 680_000n,
      });
      expect(report.buckets[0]?.property.occupancy).toBeCloseTo(0.42, 10);

      // The counts come back as numbers and the money as a `bigint`, which is
      // `smallint` and `bigint` being read as `money.ts` and the schema declare
      // them rather than as whatever the driver felt like.
      expect(typeof report.buckets[0]?.property.roomsSold).toBe("number");
      expect(typeof report.buckets[0]?.property.netRoomRevenueVnd).toBe(
        "bigint",
      );
    });
  });

  it("stops at the boundary and says where it stopped", () => {
    // A reader asking for a fortnight that runs past today: the answer stops
    // where the audit did, and the stamp says where that was rather than the
    // page pretending the range was honoured.
    return rolledBack(async (tx) => {
      await freeze(tx, FIRST_DAY, 40, 20, 40_000_000n);
      await freeze(tx, SECOND_DAY, 40, 30, 60_000_000n);

      const report = await performanceQueries().performance(tx, {
        bucket: "DAY",
        from: parseDate(FIRST_DAY),
        to: parseDate("2032-12-31"),
      });

      expect(report.lastClosedBusinessDate).toBe(SECOND_DAY);
      expect(report.buckets.map((held) => held.from)).toEqual([
        FIRST_DAY,
        SECOND_DAY,
      ]);
      expect(report.totals.closedDays).toBe(2);
    });
  });

  it("answers a range that begins after the boundary with nothing, stamp and all", () => {
    // Not asserted by closing no day — the seed has closed some — but by asking
    // about a stretch that begins after the boundary, which reaches the same
    // early return without the file having to empty a table it cannot refill.
    // `byType` is empty rather than five all-null rows: a type with no frozen
    // row has no measured fact behind it.
    return rolledBack(async (tx) => {
      const report = await performanceQueries().performance(tx, {
        bucket: "DAY",
        from: parseDate("2099-01-01"),
        to: parseDate("2099-01-31"),
      });

      expect(report.buckets).toEqual([]);
      expect(report.totals).toEqual({
        closedDays: 0,
        property: {
          sellableRooms: 0,
          roomsSold: 0,
          netRoomRevenueVnd: 0n,
          occupancy: null,
          adrVnd: null,
          revparVnd: null,
        },
        byType: [],
      });
    });
  });

  it("cuts one range into months without the totals moving", () => {
    // One statement, two shapes. The daily cut and the monthly cut are the same
    // days grouped differently, so the range totals are identical — which is what
    // "the buckets partition the closed days" means where a reader can see it.
    return rolledBack(async (tx) => {
      await freeze(tx, SECOND_DAY, 40, 20, 40_000_000n);
      await freeze(tx, A_DAY_IN_JUNE, 40, 10, 30_000_000n);

      const reports = performanceQueries();
      const range = {
        from: parseDate(FIRST_DAY),
        to: parseDate("2032-06-30"),
      };

      const daily = await reports.performance(tx, { bucket: "DAY", ...range });
      const monthly = await reports.performance(tx, {
        bucket: "MONTH",
        ...range,
      });

      expect(daily.buckets).toHaveLength(2);
      expect(monthly.buckets).toHaveLength(2);
      expect(monthly.buckets[0]).toMatchObject({
        from: SECOND_DAY,
        to: SECOND_DAY,
        closedDays: 1,
      });
      expect(monthly.totals).toEqual(daily.totals);
      // 70,000,000 over 30 rooms sold, whichever way the range was cut.
      expect(monthly.totals.property.adrVnd).toBe(2_333_333n);
    });
  });
});

describe("the per-type rows a bucket carries", () => {
  it("reads them back under the type's code rather than its id", () => {
    // The join, which is the whole of how a row keyed by uuid becomes a row a
    // person can read. The codes are taken from the database rather than named
    // here, because the property's types are the seed's.
    return rolledBack(async (tx) => {
      const types = await twoRoomTypes(tx);

      await freeze(tx, FIRST_DAY, 40, 12, 24_000_000n);
      await freezeType(tx, FIRST_DAY, types[0].id, 20, 8, 8_000_000n);
      await freezeType(tx, FIRST_DAY, types[1].id, 20, 4, 16_000_000n);

      const report = await performanceQueries().performance(tx, {
        bucket: "DAY",
        from: parseDate(FIRST_DAY),
        to: parseDate(FIRST_DAY),
      });

      const byType = report.buckets[0]?.byType ?? [];

      expect(byType.map((row) => row.roomType)).toEqual(
        // In the property's own ladder order, which is the order the codes are
        // declared in and the order the seed's types come back in.
        types.map((type) => type.code),
      );
      expect(byType[0]).toMatchObject({
        sellableRooms: 20,
        roomsSold: 8,
        adrVnd: 1_000_000n,
        revparVnd: 400_000n,
      });
      expect(byType[1]?.adrVnd).toBe(4_000_000n);
    });
  });

  it("names only the types that were frozen in the bucket", () => {
    // A type the audit froze no row for has no measured fact, and an all-null
    // row for it would assert a measurement nobody made — which on this page is
    // the difference between "nothing was recorded" and "the suites sold
    // nothing".
    return rolledBack(async (tx) => {
      const types = await twoRoomTypes(tx);

      await freeze(tx, FIRST_DAY, 40, 5, 10_000_000n);
      await freezeType(tx, FIRST_DAY, types[0].id, 20, 5, 10_000_000n);

      const report = await performanceQueries().performance(tx, {
        bucket: "DAY",
        from: parseDate(FIRST_DAY),
        to: parseDate(FIRST_DAY),
      });

      expect(report.buckets[0]?.byType.map((row) => row.roomType)).toEqual([
        types[0].code,
      ]);
      // The property row is still the property's, counted over its own columns
      // rather than over the one type that has a row.
      expect(report.buckets[0]?.property.sellableRooms).toBe(40);
    });
  });

  it("sums a type across the bucket's days and carries it into the totals", () => {
    return rolledBack(async (tx) => {
      const types = await twoRoomTypes(tx);

      await freeze(tx, FIRST_DAY, 40, 1, 1_000_000n);
      await freeze(tx, SECOND_DAY, 40, 20, 33_000_000n);
      await freezeType(tx, FIRST_DAY, types[0].id, 20, 1, 1_000_000n);
      await freezeType(tx, SECOND_DAY, types[0].id, 20, 20, 33_000_000n);

      const report = await performanceQueries().performance(tx, {
        bucket: "MONTH",
        from: parseDate(FIRST_DAY),
        to: parseDate(SECOND_DAY),
      });

      // 34,000,000 over 21 again, one level down: the type's month is not the
      // mean of its two nights either.
      expect(report.buckets[0]?.byType[0]).toMatchObject({
        roomType: types[0].code,
        roomsSold: 21,
        adrVnd: 1_619_048n,
      });
      expect(report.totals.byType[0]).toEqual(report.buckets[0]?.byType[0]);
    });
  });

  it("reports a night sold above what was on sale, uncapped", () => {
    // A closure that withdrew a room after the night was sold. The schema
    // carries no `rooms_sold <= sellable_rooms` check on purpose, so this row
    // goes in — and the reading comes back out of the database as it went in
    // rather than clipped somewhere between.
    return rolledBack(async (tx) => {
      await freeze(tx, FIRST_DAY, 38, 40, 76_000_000n);

      const report = await performanceQueries().performance(tx, {
        bucket: "DAY",
        from: parseDate(FIRST_DAY),
        to: parseDate(FIRST_DAY),
      });

      expect(report.buckets[0]?.property.occupancy).toBeGreaterThan(1);
      expect(report.buckets[0]?.property.revparVnd).toBe(2_000_000n);
    });
  });
});

describe("who reaches the performance page", () => {
  // The two facts the guard composes, read off the class and off the matrix
  // rather than restated here. `rbac-matrix.md` §Reports grants *Occupancy / ADR
  // / RevPAR* separately from *Revenue and financial reports*, and this is that
  // separation having consequences: the row is a row of its own, the accountant
  // holds it at 👁, and the desk holds nothing on it.
  const declared = Reflect.getMetadata(
    CAPABILITY_KEY,
    (ReportingController.prototype as unknown as Record<string, object>)
      .performance,
  );

  it("is decided by reporting.performance and not by the revenue page's row", () => {
    expect(declared).toEqual({ key: "reporting.performance", action: "read" });
  });

  it("refuses a receptionist", () => {
    expect(staffGrant("reporting.performance", "RECEPTIONIST")).toBe("denied");
    expect(
      permits(staffGrant("reporting.performance", "RECEPTIONIST"), "read"),
    ).toBe(false);
  });

  it("serves an accountant, at the 👁 the matrix gives them", () => {
    expect(staffGrant("reporting.performance", "ACCOUNTANT")).toBe("read");
    expect(
      permits(staffGrant("reporting.performance", "ACCOUNTANT"), "read"),
    ).toBe(true);
  });

  it("serves a manager and an admin, and nobody else", () => {
    for (const role of ["MANAGER", "ADMIN"] as const) {
      expect(permits(staffGrant("reporting.performance", role), "read")).toBe(
        true,
      );
    }

    expect(
      permits(staffGrant("reporting.performance", "HOUSEKEEPING"), "read"),
    ).toBe(false);
  });
});

/** Closes a day at the three counts a case wants to read back. */
async function freeze(
  tx: Tx,
  businessDate: string,
  sellableRooms: number,
  roomsSold: number,
  netRoomRevenueVnd: bigint,
): Promise<void> {
  await tx.insert(nightAuditSnapshot).values({
    businessDate,
    sellableRooms,
    roomsSold,
    netRoomRevenueVnd,
    otherRevenueVnd: 0n,
  });
}

/** One type's row on a day the property row above has already closed — the
 *  child references the parent's key, so the order matters. */
async function freezeType(
  tx: Tx,
  businessDate: string,
  roomTypeId: string,
  sellableRooms: number,
  roomsSold: number,
  netRoomRevenueVnd: bigint,
): Promise<void> {
  await tx.insert(nightAuditSnapshotType).values({
    businessDate,
    roomTypeId,
    sellableRooms,
    roomsSold,
    netRoomRevenueVnd,
  });
}

/**
 * Two of the property's room types, in the order the report puts them back in.
 *
 * Read out of the database rather than named, and seeded when the database has
 * fewer than two — `report-queries-storage.e2e-spec.ts` carries the same
 * fallback for the same reason: the suite runs against a database another file
 * may have emptied, and a case about a join cannot be the case that discovers
 * there is nothing to join to.
 *
 * Put into `ROOM_TYPE_CODES` order here, which is the order the service promises
 * and is a fact about the contract rather than about the seed's `display_order`
 * column. A case can then assert an ordering without hard-coding two codes and
 * without assuming the two orders coincide.
 */
async function twoRoomTypes(
  tx: Tx,
): Promise<
  [{ id: string; code: RoomTypeCode }, { id: string; code: RoomTypeCode }]
> {
  const present = await tx
    .select({ id: roomType.id, code: roomType.code })
    .from(roomType);

  const held = new Set(present.map((type) => type.code));
  const types = [...present];

  for (const code of ROOM_TYPE_CODES.slice(0, 2)) {
    if (held.has(code)) {
      continue;
    }

    const [created] = await tx
      .insert(roomType)
      .values({
        code,
        name: code,
        maxOccupancy: 2,
        beddingSleeps: 2,
        takesExtraBed: true,
        squareMetres: 30,
        bedding: "one king bed (1.80 m)",
        aspect: "garden",
        description: "A garden-facing room with a king bed.",
        displayOrder: ROOM_TYPE_CODES.indexOf(code) + 1,
      })
      .returning({ id: roomType.id, code: roomType.code });

    types.push(created!);
  }

  const inLadderOrder = types.sort(
    (one, other) =>
      ROOM_TYPE_CODES.indexOf(one.code) - ROOM_TYPE_CODES.indexOf(other.code),
  );

  return [inLadderOrder[0]!, inLadderOrder[1]!];
}

const ROLLBACK = Symbol("rollback");

/**
 * Runs the body in a transaction and throws it away.
 *
 * The only cleanup a table that refuses `DELETE` has — and every case here
 * closes days of its own, which is the write nothing can take back.
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
