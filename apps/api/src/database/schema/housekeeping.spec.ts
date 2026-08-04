// What the housekeeping declarations say, and what is left to a database.
//
// The claim this file exists to hold is the orthogonality `FR-HK-02` turns on:
// a room's condition is stored against the room and nothing else, so there is
// no column here through which marking a room out of order could reach the
// figure the property sells against. `type_inventory.total_rooms` is moved by
// `FR-INV-04`'s room closure and by nothing in this module. That is asserted as
// an absence, because the shape being rejected — a `totalRooms` or `sellable`
// column added "so the board can take a room off sale" — is exactly what a
// well-meaning later change would reach for.
//
// Whether Postgres actually refuses a second condition on one room, or a
// condition naming a room the property does not have, is a question about the
// migration, and it is answered in `test/housekeeping-storage.e2e-spec.ts`
// against a real database.

import { HOUSEKEEPING_STATUSES } from "@mariva/shared";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { roomCondition } from "./housekeeping.js";

describe("the room condition", () => {
  it("names the four states and no more", () => {
    // `FR-HK-01`'s list. A fifth value added to the tuple and not to the
    // migration is an enum the database will refuse to store, so the vocabulary
    // is asserted where both layers read it from.
    expect(HOUSEKEEPING_STATUSES).toEqual([
      "CLEAN",
      "DIRTY",
      "INSPECTED",
      "OUT_OF_ORDER",
    ]);
  });

  it("holds nothing that could take a room off sale", () => {
    // `FR-HK-02`: setting `OUT_OF_ORDER` never reduces sellable inventory. That
    // is a property of the schema before it is a property of the service — the
    // condition row has no path to `type_inventory`, which is keyed by room
    // *type* and date and is moved only by `FR-INV-04`'s closure.
    const columns = Object.keys(roomCondition);

    expect(columns).toContain("roomId");
    expect(columns).not.toContain("roomTypeId");
    expect(columns).not.toContain("totalRooms");
    expect(columns).not.toContain("stayDate");
  });

  it("starts a room clean and leaves every later state to a writer", () => {
    // A room nobody has stayed in is clean, which is the only default that is
    // true of a room the moment it is added. `DIRTY` as a default would put the
    // property's whole stock behind a cleaning round that never happened.
    expect(roomCondition.status.notNull).toBe(true);
    expect(roomCondition.status.default).toBe("CLEAN");
  });

  it("lets the system dirty a room without naming a member of staff", () => {
    // Checkout sets `DIRTY` with nobody deciding to — `booking-state-machine.md`
    // §3 lists it as an effect of the transition. A `NOT NULL` here would force
    // the transition to attribute a cleaning judgement to whoever pressed
    // checkout.
    expect(roomCondition.updatedBy.notNull).toBe(false);
    expect(roomCondition.updatedAt.notNull).toBe(true);
  });

  it("gives a room exactly one condition", () => {
    // Two rows for room 402 would each be a complete-looking answer to whether a
    // guest may be checked into it, and the guard would admit or refuse by
    // whichever it read first.
    const unique = getTableConfig(roomCondition).indexes.find(
      (declared) => declared.config.name === "room_condition_room_id_key",
    );

    expect(unique?.config.unique).toBe(true);
    // Expressions read as `(expression)` — this index uses none, and a rename
    // that turned the column into one would show up as that rather than as a
    // pass.
    expect(
      (unique?.config.columns ?? []).map((column) =>
        "name" in column && typeof column.name === "string"
          ? column.name
          : "(expression)",
      ),
    ).toEqual(["room_id"]);
  });

  it("refuses a note that was demanded and not given", () => {
    const declared = getTableConfig(roomCondition).checks.map(
      (check) => check.name,
    );

    expect(declared).toEqual(["room_condition_note_present_when_set"]);
  });
});
