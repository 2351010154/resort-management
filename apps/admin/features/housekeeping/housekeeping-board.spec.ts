import { describe, expect, it } from "vitest";

import type { BoardRoom, HousekeepingBoard } from "./board-queries";
import {
  boardReading,
  boardTile,
  floorsOf,
  nextCondition,
} from "./housekeeping-board";

/* The board's decisions, held to the rules the module states.
 *
 * Nothing here renders anything, for the reason `vitest.config.ts` gives. What
 * is covered instead is everything underneath the grid: which floor a room is
 * on and in what order, what a tap writes, what the property is told when the
 * board could not be read — and, in the case this screen exists to get right,
 * exactly which facts about a room reach the floor.
 */

const TOUCHED = "2026-08-16T07:40:00.000Z";

function room(over: Partial<BoardRoom> = {}): BoardRoom {
  return {
    roomNumber: "402",
    floor: 4,
    roomType: "SUPERIOR",
    status: "DIRTY",
    isReady: false,
    isOccupied: false,
    note: null,
    updatedAt: null,
    updatedBy: null,
    ...over,
  };
}

describe("floorsOf", () => {
  it("groups the property by floor, lowest first", () => {
    const floors = floorsOf([
      room({ roomNumber: "402", floor: 4 }),
      room({ roomNumber: "101", floor: 1 }),
      room({ roomNumber: "201", floor: 2 }),
      room({ roomNumber: "102", floor: 1 }),
    ]);

    expect(floors.map((floor) => floor.floor)).toEqual([1, 2, 4]);
    expect(floors[0].rooms.map((one) => one.roomNumber)).toEqual([
      "101",
      "102",
    ]);
  });

  it("orders rooms by door number rather than as text", () => {
    // A plain string compare puts 4010 between 401 and 402, which sends
    // somebody working the grid back down the corridor.
    const floors = floorsOf([
      room({ roomNumber: "4010" }),
      room({ roomNumber: "402" }),
      room({ roomNumber: "401" }),
    ]);

    expect(floors[0].rooms.map((one) => one.roomNumber)).toEqual([
      "401",
      "402",
      "4010",
    ]);
  });

  it("keeps a floor the property numbers oddly, and loses no room", () => {
    const rooms = [
      room({ roomNumber: "G01", floor: 0 }),
      room({ roomNumber: "B01", floor: -1 }),
      room({ roomNumber: "101", floor: 1 }),
    ];

    const floors = floorsOf(rooms);

    expect(floors.map((floor) => floor.floor)).toEqual([-1, 0, 1]);
    expect(floors.flatMap((floor) => floor.rooms)).toHaveLength(rooms.length);
  });

  it("answers nothing for a property with no rooms on the board", () => {
    expect(floorsOf([])).toEqual([]);
  });
});

describe("nextCondition", () => {
  it("cycles the three states a cleaning round moves a room between", () => {
    expect(nextCondition("DIRTY")).toBe("CLEAN");
    expect(nextCondition("CLEAN")).toBe("INSPECTED");
    // Closing the cycle is what makes a mistaken tap correctable, and finding a
    // tray in a "clean" room sayable.
    expect(nextCondition("INSPECTED")).toBe("DIRTY");
  });

  it("refuses to guess for a room that is out of order", () => {
    // The other row of the matrix, and a readiness write clears the repair note
    // as it lands. The Rooms screen returns such a room to service.
    expect(nextCondition("OUT_OF_ORDER")).toBeNull();
  });
});

describe("boardTile", () => {
  it("says what state the room is in and whether anybody is in it", () => {
    const tile = boardTile(
      room({ status: "CLEAN", isReady: true, isOccupied: true }),
    );

    expect(tile).toMatchObject({
      roomNumber: "402",
      roomTypeLabel: "SUPERIOR",
      conditionLabel: "Clean",
      occupancyLabel: "Occupied",
      isReady: true,
      next: "INSPECTED",
      advanceLabel: "Mark inspected",
    });
  });

  it("names the act by its result, because a large target is pressed once", () => {
    expect(boardTile(room({ status: "DIRTY" })).advanceLabel).toBe(
      "Mark clean",
    );
    expect(boardTile(room({ status: "INSPECTED" })).advanceLabel).toBe(
      "Mark dirty",
    );
  });

  it("offers no act on a room that is out of order, and says why it is shut", () => {
    const tile = boardTile(
      room({ status: "OUT_OF_ORDER", note: "Shower mixer leaking" }),
    );

    expect(tile.advanceLabel).toBeNull();
    expect(tile.next).toBeNull();
    expect(tile.noteLabel).toBe("Shower mixer leaking");
  });

  it("carries no note for a room that is not shut", () => {
    // A readiness write clears the note, so a note on a clean room would be a
    // tile contradicting itself.
    expect(boardTile(room({ status: "CLEAN", note: "stale" })).noteLabel).toBe(
      null,
    );
  });

  it("attributes the last change to the person who made it, in property time", () => {
    const tile = boardTile(
      room({ updatedAt: TOUCHED, updatedBy: "Trần Văn A" }),
    );

    expect(tile.touchedLabel).toContain("Trần Văn A");
    // 07:40Z is 14:40 in Ho Chi Minh City. A board that rendered the operator's
    // own zone would tell a housekeeper on a phone set to UTC that nobody has
    // been in since the morning.
    expect(tile.touchedLabel).toContain("14:40");
    expect(tile.touchedLabel).toContain("16 Aug");
  });

  it("attributes a change nobody signed to the system rather than to check-out", () => {
    // Check-out is the caller that leaves no name, but so is seeding, and a
    // tile claiming a check-out that never happened invents property history.
    expect(boardTile(room({ updatedAt: TOUCHED })).touchedLabel).toContain(
      "the system",
    );
  });

  it("says so when nobody has recorded the room at all", () => {
    expect(boardTile(room()).touchedLabel).toBe("Not recorded yet");
  });

  it("shows no guest and no money, whatever the board hands it", () => {
    /* The rule `screens.md` §"Staff surfaces" states, asserted rather than
     * commented. The room below carries fields the contract does not have, so
     * this fails if the tile ever widens into "whatever came back": the screen
     * renders these fields and reads nothing else off a room. */
    const polluted = {
      ...room({ updatedAt: TOUCHED, updatedBy: "Trần Văn A" }),
      guestName: "Nguyễn Thị Hương",
      guestNames: ["Nguyễn Thị Hương"],
      balance: 2_500_000n,
      rate: "2.500.000 ₫",
    } as BoardRoom;

    const tile = boardTile(polluted);

    expect(Object.keys(tile).toSorted()).toEqual([
      "advanceLabel",
      "conditionLabel",
      "isReady",
      "next",
      "noteLabel",
      "occupancyLabel",
      "roomNumber",
      "roomTypeLabel",
      "touchedLabel",
    ]);

    const rendered = Object.values(tile)
      .filter((value) => typeof value === "string")
      .join(" | ");

    expect(rendered).not.toContain("Nguyễn");
    expect(rendered).not.toContain("Hương");
    expect(rendered).not.toContain("2.500.000");
    expect(rendered).not.toContain("2500000");
    expect(rendered).not.toContain("₫");
  });
});

describe("boardReading", () => {
  const board: HousekeepingBoard = {
    businessDate: "2026-08-16",
    rooms: [room({ roomNumber: "101", floor: 1 }), room({ roomNumber: "402" })],
  };

  it("draws the floors once the board has answered", () => {
    const reading = boardReading(false, board);

    expect(reading.status).toBe("ready");
    expect(reading.status === "ready" && reading.businessDate).toBe(
      "2026-08-16",
    );
    expect(reading.status === "ready" && reading.floors).toHaveLength(2);
  });

  it("is pending before an answer rather than a property with no rooms", () => {
    expect(boardReading(false, undefined).status).toBe("pending");
  });

  it("reports the failure even when a stale board is still in the cache", () => {
    // A grid drawn beside a failed refetch is a statement about the floors that
    // nothing currently supports.
    expect(boardReading(true, board).status).toBe("failed");
  });
});
