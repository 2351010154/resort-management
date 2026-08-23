// The statements the Reports pages are read with, against a real Postgres.
//
// `report-queries.service.spec.ts` covers the arithmetic — the bucketing, the
// join, the tally — and covers it from literals, which is the right shape for
// arithmetic and says nothing at all about SQL. Three of the four statements
// under those pure functions are not obvious, and none of them is issued
// anywhere else in the suite:
//
//  - **`max(business_date)`**, which is the boundary every report page is
//    stamped with. A day the audit skipped is left where it is rather than
//    shortening the answer, so the maximum is what "how far has the audit got"
//    means and the gap is dealt with in the join above.
//  - **The penalty predicate**, which is the sharpest thing in the file: §4's
//    charge, *plus* a `REVERSAL` whose reversed line was one, found through an
//    aliased self-join that is deliberately not narrowed by the window. Get it
//    wrong in either direction and the property either keeps reporting a penalty
//    it waived or loses one it took. Drizzle assembles that `or` and, until
//    here, never hands it to Postgres.
//  - **The live room count**, whose `coalesce(status, 'CLEAN')` is the whole of
//    how a room nobody has ever recorded a condition for still appears. A count
//    driven from `room_condition` instead would quietly shorten the property, on
//    the one page whose job is to say how many rooms there are.
//
// Everything runs inside a transaction that is rolled back, which is forced
// rather than tidy for the reason `night-audit-storage.e2e-spec.ts` gives at
// length: a snapshot cannot be deleted at all, so a spec that committed would
// leave days nothing can clear.
//
// The dates are years past the horizon `seedDatabase` publishes, and that is
// load-bearing twice over. The boundary is a maximum over the whole table, so a
// case asserting it has to be certain its own day is the latest one; and the
// window is asked with an explicit `from`, so a seeded snapshot cannot drift
// into a total. The room counts are the exception and are asserted as
// *movements* — this room type gained one clean room — because the property's
// rooms are the seed's and this file should not claim to know how many there
// are.

import { parseDate } from "@internationalized/date";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { booking } from "../src/database/schema/booking.js";
import { folio, folioPosting } from "../src/database/schema/folio.js";
import { roomCondition } from "../src/database/schema/housekeeping.js";
import * as schema from "../src/database/schema/index.js";
import { room, roomType } from "../src/database/schema/inventory.js";
import { nightAuditSnapshot } from "../src/database/schema/night-audit.js";
import { ReportQueries } from "../src/modules/reporting/report-queries.service.js";

/** Three consecutive trading days of this file's own, past every seeded one. */
const FIRST_DAY = "2031-03-30";
const SECOND_DAY = "2031-03-31";
/** The day after the last one this file closes — the gap the audit never
 *  reached, which penalties may land on and must not be reported from. */
const AN_UNCLOSED_DAY = "2031-04-01";

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

describe("the boundary a report page is stamped with", () => {
  it("is the latest day the audit closed, gaps in the middle and all", async () => {
    await rolledBack(async (tx) => {
      await freeze(tx, FIRST_DAY, 10_000_000n, 1_000_000n);
      await freeze(tx, SECOND_DAY, 12_000_000n, 2_000_000n);

      expect(await new ReportQueries().lastClosedBusinessDate(tx)).toBe(
        SECOND_DAY,
      );
    });
  });
});

describe("what a range of closed days came to", () => {
  it("reads the frozen figures and stops at the boundary", async () => {
    // A reader asking for a fortnight that runs past today: the answer stops
    // where the audit did, and the stamp says where that was rather than the
    // page pretending the range was honoured.
    await rolledBack(async (tx) => {
      await freeze(tx, FIRST_DAY, 10_000_000n, 1_000_000n);
      await freeze(tx, SECOND_DAY, 12_000_000n, 2_000_000n);

      const reports = new ReportQueries();
      const daily = await reports.revenue(tx, {
        bucket: "DAY",
        from: parseDate(FIRST_DAY),
        to: parseDate("2031-04-30"),
      });

      expect(daily.lastClosedBusinessDate).toBe(SECOND_DAY);
      expect(daily.buckets.map((held) => held.from)).toEqual([
        FIRST_DAY,
        SECOND_DAY,
      ]);
      expect(daily.totals).toMatchObject({
        closedDays: 2,
        roomRevenueVnd: 22_000_000n,
        otherRevenueVnd: 3_000_000n,
      });

      // The same two days asked for by month, which is the proof that the
      // grouping is the service's and not the statement's: one statement, two
      // shapes, and the totals do not move.
      const monthly = await reports.revenue(tx, {
        bucket: "MONTH",
        from: parseDate(FIRST_DAY),
        to: parseDate("2031-04-30"),
      });

      expect(monthly.buckets).toHaveLength(1);
      expect(monthly.buckets[0]).toMatchObject({
        from: FIRST_DAY,
        to: SECOND_DAY,
        closedDays: 2,
      });
      expect(monthly.totals).toEqual(daily.totals);
    });
  });

  it("answers a property whose audit has never run with nothing", async () => {
    // Not asserted by closing no day — the seed has closed some — but by asking
    // about a stretch that begins after the boundary, which reaches the same
    // early return without the file having to empty a table it cannot refill.
    await rolledBack(async (tx) => {
      const report = await new ReportQueries().revenue(tx, {
        bucket: "DAY",
        from: parseDate("2099-01-01"),
        to: parseDate("2099-01-31"),
      });

      expect(report.buckets).toEqual([]);
      expect(report.totals).toMatchObject({
        closedDays: 0,
        roomRevenueVnd: 0n,
        totalVnd: 0n,
      });
    });
  });
});

describe("the penalties a range kept", () => {
  it("sums §4's charges onto the trading day the ledger filed them under", async () => {
    await rolledBack(async (tx) => {
      const stay = await aStay(tx);

      await freeze(tx, FIRST_DAY, 10_000_000n, 0n);
      await penalty(tx, stay, FIRST_DAY, 900_000n);
      await penalty(tx, stay, FIRST_DAY, 600_000n);

      const report = await new ReportQueries().revenue(tx, {
        bucket: "DAY",
        from: parseDate(FIRST_DAY),
        to: parseDate(FIRST_DAY),
      });

      expect(report.buckets).toEqual([
        {
          from: FIRST_DAY,
          to: FIRST_DAY,
          closedDays: 1,
          roomRevenueVnd: 10_000_000n,
          otherRevenueVnd: 0n,
          penaltyRevenueVnd: 1_500_000n,
          totalVnd: 11_500_000n,
        },
      ]);
    });
  });

  it("takes a waived penalty back off, on the day the credit was filed", async () => {
    // The reversal, resolved the way `night-audit.service.ts` resolves one: a
    // `REVERSAL` is whatever it undoes. The credit is dated to the day it was
    // taken rather than to the day of the charge — the ledger is append-only and
    // the earlier day is already frozen — so the two land in different buckets
    // and the fortnight nets to what the property actually kept.
    await rolledBack(async (tx) => {
      const stay = await aStay(tx);

      await freeze(tx, FIRST_DAY, 0n, 0n);
      await freeze(tx, SECOND_DAY, 0n, 0n);

      const charged = await penalty(tx, stay, FIRST_DAY, 900_000n);
      await reversalOf(tx, stay, charged, SECOND_DAY, -900_000n);

      const report = await new ReportQueries().revenue(tx, {
        bucket: "DAY",
        from: parseDate(FIRST_DAY),
        to: parseDate(SECOND_DAY),
      });

      expect(
        report.buckets.map((held) => held.penaltyRevenueVnd),
      ).toEqual([900_000n, -900_000n]);
      expect(report.totals.penaltyRevenueVnd).toBe(0n);
    });
  });

  it("counts no line that is not a penalty, whatever else the folio holds", async () => {
    // The predicate's other direction. A room charge, its VAT and a payment all
    // sit on the same account on the same day; none of them is §4's charge, and
    // the snapshot is what says what the day earned.
    await rolledBack(async (tx) => {
      const stay = await aStay(tx);

      await freeze(tx, FIRST_DAY, 5_000_000n, 0n);

      const night = await line(tx, stay, FIRST_DAY, "ROOM_CHARGE", 5_000_000n);

      // The tax line names the sale it was levied on, which
      // `folio_posting_derives_exactly_when_a_tax_line` requires and which is
      // the arrangement `FR-FOL-02` decomposes a gross figure into.
      await line(tx, stay, FIRST_DAY, "VAT", 500_000n, night);
      await line(tx, stay, FIRST_DAY, "PAYMENT", -5_500_000n);

      const report = await new ReportQueries().revenue(tx, {
        bucket: "DAY",
        from: parseDate(FIRST_DAY),
        to: parseDate(FIRST_DAY),
      });

      expect(report.buckets[0]?.penaltyRevenueVnd).toBe(0n);
    });
  });

  it("leaves a penalty on a day the audit never closed off the page", async () => {
    // The gap, end to end. The audit reached the thirty-first and refused the
    // first of April; a cancellation taken that day is real money the property
    // kept, and it is not on this report — because a bucket carrying takings
    // from a day with no room revenue beside it is the page showing a night
    // nobody has agreed on. It appears when the day is closed.
    await rolledBack(async (tx) => {
      const stay = await aStay(tx);

      await freeze(tx, SECOND_DAY, 12_000_000n, 0n);
      await penalty(tx, stay, SECOND_DAY, 400_000n);
      await penalty(tx, stay, AN_UNCLOSED_DAY, 5_000_000n);

      const report = await new ReportQueries().revenue(tx, {
        bucket: "MONTH",
        from: parseDate(FIRST_DAY),
        to: parseDate("2031-12-31"),
      });

      expect(report.lastClosedBusinessDate).toBe(SECOND_DAY);
      expect(report.totals.closedDays).toBe(1);
      expect(report.totals.penaltyRevenueVnd).toBe(400_000n);
    });
  });
});

describe("where the property's rooms are standing", () => {
  it("counts a room nobody has recorded a condition for as clean", async () => {
    // The `coalesce`, which is the whole of how the count is the property's
    // rooms rather than the rooms somebody has touched. Asserted as a movement
    // because the seed owns the property and this file should not claim to know
    // how many rooms it has.
    await rolledBack(async (tx) => {
      const reports = new ReportQueries();
      const before = await reports.roomStatus(tx);

      const typeId = await someRoomType(tx);

      await tx
        .insert(room)
        .values({ number: "RPT-901", floor: 9, roomTypeId: typeId });

      const after = await reports.roomStatus(tx);

      expect(after.rooms).toBe(before.rooms + 1);
      expect(cleanIn(after)).toBe(cleanIn(before) + 1);
    });
  });

  it("counts a recorded condition as the condition it was recorded in", async () => {
    await rolledBack(async (tx) => {
      const reports = new ReportQueries();
      const before = await reports.roomStatus(tx);

      const typeId = await someRoomType(tx);
      const [added] = await tx
        .insert(room)
        .values({ number: "RPT-902", floor: 9, roomTypeId: typeId })
        .returning({ id: room.id });

      await tx
        .insert(roomCondition)
        .values({ roomId: added!.id, status: "OUT_OF_ORDER", note: "a leak" });

      const after = await reports.roomStatus(tx);

      expect(after.rooms).toBe(before.rooms + 1);
      expect(cleanIn(after)).toBe(cleanIn(before));
      expect(countOf(after, "OUT_OF_ORDER")).toBe(
        countOf(before, "OUT_OF_ORDER") + 1,
      );
    });
  });

  it("adds up to the same figure per type as it does property-wide", async () => {
    // The claim `roomStatusReportSchema` makes about the two: they are counted
    // over the same rooms in the same statement, so a page showing one is not
    // showing a different property from a page showing the other.
    await rolledBack(async (tx) => {
      const report = await new ReportQueries().roomStatus(tx);

      const overTypes = report.byType.reduce(
        (sum, type) => sum + type.rooms,
        0,
      );
      const overStatuses = report.byStatus.reduce(
        (sum, count) => sum + count.rooms,
        0,
      );

      expect(overTypes).toBe(report.rooms);
      expect(overStatuses).toBe(report.rooms);

      for (const type of report.byType) {
        expect(
          type.byStatus.reduce((sum, count) => sum + count.rooms, 0),
        ).toBe(type.rooms);
      }
    });
  });

  it("carries the family's boundary and the instant it was counted", async () => {
    // Both, because the stamp is the family's page furniture and is *not* where
    // these counts came from — `screens.md` reframes it as a boundary for
    // exactly this page.
    await rolledBack(async (tx) => {
      await freeze(tx, SECOND_DAY, 1n, 0n);

      const report = await new ReportQueries().roomStatus(tx);

      expect(report.lastClosedBusinessDate).toBe(SECOND_DAY);
      expect(report.takenAt.getTime()).toBeLessThanOrEqual(Date.now());
    });
  });
});

/** How many rooms the report says are clean. */
function cleanIn(report: { byStatus: readonly { status: string; rooms: number }[] }) {
  return countOf(report, "CLEAN");
}

function countOf(
  report: { byStatus: readonly { status: string; rooms: number }[] },
  status: string,
): number {
  return report.byStatus.find((count) => count.status === status)?.rooms ?? 0;
}

/** Closes a day at the two figures a case wants to read back. */
async function freeze(
  tx: Tx,
  businessDate: string,
  netRoomRevenueVnd: bigint,
  otherRevenueVnd: bigint,
): Promise<void> {
  await tx.insert(nightAuditSnapshot).values({
    businessDate,
    sellableRooms: 40,
    roomsSold: 18,
    netRoomRevenueVnd,
    otherRevenueVnd,
  });
}

/**
 * A stay with an account open, which is all a folio line needs behind it.
 *
 * The columns are the ones the table requires and no more: this file's subject
 * is which lines the penalty predicate matches, not how a booking comes to
 * exist, which is `booking-storage.e2e-spec.ts`'s.
 */
async function aStay(tx: Tx): Promise<string> {
  const typeId = await someRoomType(tx);

  const [stay] = await tx
    .insert(booking)
    .values({
      reference: `RPT-${stayCount++}`,
      // Cancelled with a reason beside it, which is the state §4's charge is
      // taken in and which `booking_reason_exactly_when_cancelled` requires the
      // pair of. A stay in any other state would have carried the penalty just
      // as well for the predicate's sake; this one is the honest arrangement.
      state: "CANCELLED",
      cancellationReason: "GUEST_REQUEST",
      cancelledAt: new Date(),
      roomTypeId: typeId,
      checkInDate: FIRST_DAY,
      checkOutDate: SECOND_DAY,
      ratePlanCode: "STANDARD",
      adults: 2,
      quotedStayTotalGross: 1_400_000n,
      quotedPercentAdjustment: 0,
      quotedExtraPersonPerNightGross: 600_000n,
    })
    .returning({ id: booking.id });

  const [account] = await tx
    .insert(folio)
    .values({ bookingId: stay!.id })
    .returning({ id: folio.id });

  return account!.id;
}

/** §4's charge on an account, dated to the trading day it was taken on. */
async function penalty(
  tx: Tx,
  folioId: string,
  businessDate: string,
  amount: bigint,
): Promise<string> {
  const [posted] = await tx
    .insert(folioPosting)
    .values({
      folioId,
      type: "POLICY_CHARGE",
      chargeBasis: "FIRST_NIGHT",
      amount,
      description: "Cancellation charge",
      businessDate,
    })
    .returning({ id: folioPosting.id });

  return posted!.id;
}

/** The correction that takes one back off, filed on the day it was made. */
async function reversalOf(
  tx: Tx,
  folioId: string,
  reversesPostingId: string,
  businessDate: string,
  amount: bigint,
): Promise<void> {
  await tx.insert(folioPosting).values({
    folioId,
    type: "REVERSAL",
    reversesPostingId,
    amount,
    description: "Cancellation charge waived",
    businessDate,
  });
}

/** Any other line on the account, so the predicate has something to reject. */
async function line(
  tx: Tx,
  folioId: string,
  businessDate: string,
  type: "ROOM_CHARGE" | "VAT" | "PAYMENT",
  amount: bigint,
  parentPostingId?: string,
): Promise<string> {
  const [posted] = await tx
    .insert(folioPosting)
    .values({
      folioId,
      type,
      amount,
      description: type,
      businessDate,
      parentPostingId,
    })
    .returning({ id: folioPosting.id });

  return posted!.id;
}

/** Keeps every stay this file opens on a reference of its own. */
let stayCount = 0;

/** A room type to hang a stay or a room on, seeded if the database has none —
 *  `night-audit-storage.e2e-spec.ts` carries the same helper for the same
 *  reason: the suite runs against a database another file may have emptied. */
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
 * The only cleanup a table that refuses `DELETE` has — and the reports here
 * close days of their own, which is the write nothing can take back.
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
