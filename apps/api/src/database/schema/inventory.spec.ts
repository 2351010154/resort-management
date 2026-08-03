// What this file can prove without a database, and what it deliberately leaves
// to one.
//
// The room type codes cross three boundaries — a Postgres enum, a zod schema and
// a React card — and the failure worth catching is drift between them: a type
// renamed in one place and not the others produces rows nothing can read rather
// than an error anyone sees. That is a shape question, so it is asserted here.
//
// Whether Postgres actually rejects a duplicate room number, an oversold night
// or a room held twice across the same dates is a question about the migration,
// and it is answered in `test/inventory-storage.e2e-spec.ts` against a real
// database — a test that applies no SQL cannot prove SQL enforces anything.
//
// What stays here is everything true of the declarations themselves: which
// columns exist, which may be null, which index carries a uniqueness rule, and
// that the one constraint Drizzle has no expression for is still written into
// the migration by the hand that put it there.

import { readFileSync } from "node:fs";
import { ROOM_TYPE_CODES, roomTypeCodeSchema } from "@mariva/shared";
import type { RoomTypeCode } from "@mariva/shared";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  room,
  roomAssignment,
  roomType,
  roomTypeCodeEnum,
  typeInventory,
} from "./inventory.js";
import type { TypeInventoryRow } from "./inventory.js";

describe("the room type codes", () => {
  it("are the same five in Postgres as on the wire", () => {
    // Both are built from ROOM_TYPE_CODES, and this asserts that they still are.
    // Inlining either list would let one be edited without the other.
    expect(roomTypeCodeEnum.enumValues).toEqual([...ROOM_TYPE_CODES]);
    expect(roomTypeCodeSchema.options).toEqual([...ROOM_TYPE_CODES]);
  });

  it("number five, because the mix in §1 sums to forty rooms", () => {
    expect(ROOM_TYPE_CODES).toHaveLength(5);
  });

  it("cannot be joined by a sixth", () => {
    // @ts-expect-error — the enum is closed at the five in property-and-tariff.md
    // §1. A sixth code is a seed bug, and it fails to compile rather than
    // reaching a room card that has nothing to render.
    const invented: RoomTypeCode = "PENTHOUSE";

    expect(roomTypeCodeSchema.safeParse(invented).success).toBe(false);
  });
});

describe("the inventory tables", () => {
  it("give a room exactly one type", () => {
    const references = room.roomTypeId.getSQLType();

    expect(references).toBe("uuid");
    expect(room.roomTypeId.notNull).toBe(true);
  });

  it("hold no column the property file states once", () => {
    // Included occupancy, the twelve amenities and the room photographs each
    // have one owner outside this table — see the header of inventory.ts. A
    // column reappearing here is a second source for a fact that has one.
    const columns = Object.keys(roomType);

    // Asserted first, so the three absences below cannot pass by reading an
    // object that holds no column names at all.
    expect(columns).toContain("maxOccupancy");
    expect(columns).toContain("takesExtraBed");

    expect(columns).not.toContain("includedOccupancy");
    expect(columns).not.toContain("amenities");
    expect(columns).not.toContain("photos");
  });
});

describe("the two inventory layers", () => {
  it("date every night by the calendar and never by the clock", () => {
    // A timestamp column would put an arrival at 23:50 Ho Chi Minh City on the
    // day before in UTC, which is the off-by-one night that reads as a booking
    // system quietly losing a day's revenue rather than as a bug.
    expect(typeInventory.stayDate.getSQLType()).toBe("date");
    expect(roomAssignment.checkInDate.getSQLType()).toBe("date");
    expect(roomAssignment.checkOutDate.getSQLType()).toBe("date");

    // `mode: "string"` — the ISO text Postgres stores, not a `Date` the driver
    // reconstructed at UTC midnight. Asserted at the type level because that is
    // where the mode is visible; a `Date` here stops compiling.
    const stayDate: TypeInventoryRow["stayDate"] = "2026-08-14";

    expect(stayDate).toBe("2026-08-14");
  });

  it("give a type one row per date and no second one", () => {
    const unique = indexNamed(
      typeInventory,
      "type_inventory_room_type_date_key",
    );

    expect(unique?.config.unique).toBe(true);
    expect(indexedColumns(unique)).toEqual(["room_type_id", "stay_date"]);
  });

  it("index the date on its own, because that is what a search scans", () => {
    // The unique index above leads with the type and cannot answer "every type
    // between these two dates", which is the query the availability search runs.
    const byDate = indexNamed(typeInventory, "type_inventory_stay_date_idx");

    expect(byDate?.config.unique).toBe(false);
    expect(indexedColumns(byDate)).toEqual(["stay_date"]);
  });

  it("declare the three checks that leave oversell unrepresentable", () => {
    const declared = getTableConfig(typeInventory)
      .checks.map((check) => check.name)
      .sort();

    expect(declared).toEqual([
      "type_inventory_sold_at_most_total",
      "type_inventory_sold_not_negative",
      "type_inventory_total_not_negative",
    ]);
  });

  it("let a held room have no booking behind it", () => {
    // A room withdrawn from sale is held through the same table as a booked
    // one. Requiring a booking id would mean modelling a closure somewhere
    // else, and a second table the exclusion constraint does not see is a room
    // that can be closed and sold at once.
    expect(roomAssignment.roomId.notNull).toBe(true);
    expect(roomAssignment.bookingId.notNull).toBe(false);
    expect(roomAssignment.closureReason.notNull).toBe(false);
  });

  it("keep the half-open stay range in the migration Drizzle did not write", () => {
    // This proves the hand-written line survived, not that Postgres honours it
    // — the storage suite proves that. It is here because regenerating the
    // migration would drop the constraint silently, and a dropped exclusion
    // constraint is a system that behaves correctly until two guests arrive.
    const migration = readFileSync(
      new URL("../migrations/0002_inventory_core.sql", import.meta.url),
      "utf8",
    );

    expect(migration).toContain("EXCLUDE USING gist");
    expect(migration).toContain(
      `daterange("check_in_date", "check_out_date", '[)')`,
    );
  });

  it("keep the booking key in the migration Drizzle did not write either", () => {
    // The other hand-written constraint, added at M4 once there was a booking
    // table to point at. Same exposure as the exclusion constraint above: a
    // regeneration would drop it silently, and what a missing key allows is a
    // room held for a booking that does not exist.
    const migration = readFileSync(
      new URL("../migrations/0006_booking_core.sql", import.meta.url),
      "utf8",
    );

    expect(migration).toContain(
      `ALTER TABLE "room_assignment" ADD CONSTRAINT "room_assignment_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id")`,
    );
  });
});

describe("what each table hangs off", () => {
  it("points a room at its type and an assignment at its room", () => {
    // Drizzle resolves a reference lazily, so one aimed at the wrong table
    // typechecks and stays wrong until a migration is generated against a
    // database somebody has already filled — at which point the fix is a data
    // migration rather than an edit.
    expect(parentsOf(room)).toEqual([
      { table: "room_type", from: ["room_type_id"], to: ["id"] },
    ]);
    // One here and not two: the key to `booking` exists in the database but is
    // written by hand into the migration, for the import-cycle reason
    // inventory.ts gives at the column. The test below is what guards it.
    expect(parentsOf(roomAssignment)).toEqual([
      { table: "room", from: ["room_id"], to: ["id"] },
    ]);
  });

  it("counts inventory against a type rather than against a room", () => {
    // The two layers answer different questions — the header of inventory.ts
    // makes the argument. A counter keyed on a room would be `room_assignment`
    // written twice, and it could not refuse the forty-first sale of forty
    // rooms without visiting every one of them.
    expect(parentsOf(typeInventory)).toEqual([
      { table: "room_type", from: ["room_type_id"], to: ["id"] },
    ]);
  });
});

/** Every table a table references, and the columns joining them.
 *
 *  Sorted by the table referenced, so an assertion describes which parents
 *  exist rather than the order they happen to be declared in. */
function parentsOf(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table)
    .foreignKeys.map((foreignKey) => {
      const reference = foreignKey.reference();

      return {
        table: getTableConfig(reference.foreignTable).name,
        from: reference.columns.map((column) => column.name),
        to: reference.foreignColumns.map((column) => column.name),
      };
    })
    .sort((left, right) => left.table.localeCompare(right.table));
}

/** The declared index of that name, or undefined if nothing declares it. */
function indexNamed(table: Parameters<typeof getTableConfig>[0], name: string) {
  return getTableConfig(table).indexes.find(
    (declared) => declared.config.name === name,
  );
}

/** The column names an index covers, in order. Expressions are not used here,
 *  and one appearing would mean the assertion above is reading the wrong
 *  index — so it surfaces as a name nothing matches rather than as a skip. */
function indexedColumns(index: ReturnType<typeof indexNamed>): string[] {
  return (index?.config.columns ?? []).map((column) =>
    "name" in column && typeof column.name === "string"
      ? column.name
      : "(expression)",
  );
}
