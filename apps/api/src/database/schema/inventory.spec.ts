// What this file can prove without a database, and what it deliberately leaves
// to one.
//
// The room type codes cross three boundaries — a Postgres enum, a zod schema and
// a React card — and the failure worth catching is drift between them: a type
// renamed in one place and not the others produces rows nothing can read rather
// than an error anyone sees. That is a shape question, so it is asserted here.
//
// Whether Postgres actually rejects a duplicate room number, a room pointing at
// no type, or a type claiming more heads than it has beds is a question about
// the migration, and the migration for these tables does not exist yet. Those
// assertions belong beside `0002_inventory_core.sql` — a test that applies no
// SQL cannot prove SQL enforces anything.

import { ROOM_TYPE_CODES, roomTypeCodeSchema } from "@mariva/shared";
import type { RoomTypeCode } from "@mariva/shared";
import { describe, expect, it } from "vitest";
import { room, roomType, roomTypeCodeEnum } from "./inventory.js";

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
