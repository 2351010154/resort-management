import { describe, expect, it } from "vitest";

import { type HousekeepingBoard, withRoomCondition } from "./board-queries";

/* The guess the optimistic write paints, checked on its own.
 *
 * This is the part of an optimistic mutation that can be wrong in a way nobody
 * notices: the cache is put back on failure and refreshed on success, so a bad
 * guess shows for a fraction of a second and then corrects itself — which is
 * exactly the flicker the pattern exists to prevent.
 */
const board: HousekeepingBoard = {
  businessDate: "2026-08-16",
  rooms: [
    {
      roomNumber: "402",
      floor: 4,
      roomType: "SUPERIOR",
      status: "DIRTY",
      isReady: false,
      isOccupied: false,
      note: null,
      updatedAt: null,
      updatedBy: null,
    },
    {
      roomNumber: "403",
      floor: 4,
      roomType: "PREMIER",
      status: "DIRTY",
      isReady: false,
      isOccupied: true,
      note: null,
      updatedAt: null,
      updatedBy: null,
    },
  ],
};

describe("withRoomCondition", () => {
  it("moves the room that was written and leaves the floor alone", () => {
    const next = withRoomCondition(board, {
      roomNumber: "402",
      status: "CLEAN",
    });

    expect(next.rooms[0]).toMatchObject({ status: "CLEAN", isReady: true });
    expect(next.rooms[1]).toEqual(board.rooms[1]);
    expect(next.businessDate).toBe(board.businessDate);
  });

  it("derives readiness rather than leaving the tile disagreeing with itself", () => {
    // `INSPECTED` admits a guest as well as `CLEAN` does; the supervisor pass is
    // optional. `DIRTY` admits nobody.
    expect(
      withRoomCondition(board, { roomNumber: "402", status: "INSPECTED" })
        .rooms[0].isReady,
    ).toBe(true);

    expect(
      withRoomCondition(
        withRoomCondition(board, { roomNumber: "402", status: "CLEAN" }),
        { roomNumber: "402", status: "DIRTY" },
      ).rooms[0].isReady,
    ).toBe(false);
  });

  it("does not mutate the cached board it was given", () => {
    withRoomCondition(board, { roomNumber: "402", status: "CLEAN" });

    expect(board.rooms[0].status).toBe("DIRTY");
  });

  it("leaves the board untouched when the room is not on it", () => {
    const next = withRoomCondition(board, {
      roomNumber: "999",
      status: "CLEAN",
    });

    expect(next.rooms).toEqual(board.rooms);
  });
});
