// What the snapshot declarations promise, and what is left to a database.
//
// One claim carries this file: a business date can be closed once. `FR-RPT-01`
// asks for exactly that and `night-audit.job.ts` depends on it twice over — it
// is the sweep's predicate, and it is what makes the runner's second pass over
// the same transaction come back empty. Every other guarantee here is a
// consequence of it, so the keys are what is asserted.
//
// Whether Postgres actually refuses the second insert, and whether the trigger
// in `0043` actually refuses an `UPDATE`, are questions about the migration that
// no assertion over a schema object can answer — `reconciliation.spec.ts` says
// the same about its own key and hands the question to a storage test against a
// real database. What is asserted below is that the declarations exist and say
// what the service was written against.

import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { nightAuditSnapshot, nightAuditSnapshotType } from "./night-audit.js";

const day = getTableConfig(nightAuditSnapshot);
const byType = getTableConfig(nightAuditSnapshotType);

describe("the key on a closed day", () => {
  it("is the business date itself, so a second freeze has nowhere to go", () => {
    expect(nightAuditSnapshot.businessDate.primary).toBe(true);
    // The date and not a surrogate id beside a unique index. They would refuse
    // the same second row; the difference is that a surrogate invites a second
    // row to be *addressed*, and nothing about this table is ever addressed
    // except by the day it is about.
    expect(day.primaryKeys).toEqual([]);
  });

  it("is a date, so the trading day and the calendar day cannot be confused", () => {
    // §2's business date, held as the ISO text Postgres stores. A timestamp here
    // would invite a snapshot per instant, and a `Date` at UTC midnight is the
    // previous night in UTC+7 — the off-by-one `schema/inventory.ts` states the
    // same defence against.
    expect(nightAuditSnapshot.businessDate.columnType).toBe("PgDateString");
  });
});

describe("the key on one type's share of it", () => {
  it("is the day and the type together, so one type is one row a night", () => {
    expect(
      byType.primaryKeys[0]?.columns.map((column) => column.name),
    ).toEqual(["business_date", "room_type_id"]);
  });

  it("names the day it belongs to and the type it is about", () => {
    // Both by reference. A type row for a day nobody closed, or one naming a
    // type the property does not have, is refused by Postgres rather than by
    // whichever writer remembered.
    expect(
      byType.foreignKeys
        .map((key) => key.reference().columns.map((column) => column.name))
        .flat()
        .sort(),
    ).toEqual(["business_date", "room_type_id"]);
  });
});

describe("the figures", () => {
  it("are đồng as bigint, on both the property row and the type rows", () => {
    // `money.ts`'s rule. A folio read through `number` loses đồng above 2^53
    // silently, and these columns are summed across a month by every report that
    // reads them.
    for (const money of [
      nightAuditSnapshot.netRoomRevenueVnd,
      nightAuditSnapshot.otherRevenueVnd,
      nightAuditSnapshotType.netRoomRevenueVnd,
    ]) {
      expect(money.columnType).toBe("PgBigInt64");
    }
  });

  it("refuse a negative count and allow an occupancy above 100%", () => {
    const checks = [...day.checks, ...byType.checks].map((check) => check.name);

    expect(checks).toEqual([
      "night_audit_snapshot_counts_are_not_negative",
      "night_audit_snapshot_type_counts_are_not_negative",
    ]);

    // And nothing holding `rooms_sold` under `sellable_rooms`, deliberately. A
    // room withdrawn from sale after the night was sold leaves a day genuinely
    // sold above what was sellable, and a check refusing that row would stop the
    // audit closing the day over a figure that is the true reading of what
    // happened.
    expect(checks.some((name) => name.includes("at_most"))).toBe(false);
  });
});
