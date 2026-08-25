import { describe, expect, it } from "vitest";

import type {
  BoardRoom,
  HousekeepingBoard,
} from "@/features/housekeeping/board-queries";

import {
  closureAttempt,
  mayCloseRooms,
  mayMarkOutOfOrder,
  NO_CLOSURE_FIELDS,
  narrowRooms,
  outOfOrderAttempt,
  roomMatches,
  roomStateLabel,
  roomsByType,
  withOutOfOrder,
} from "./room-list";

/* The rooms screen's decisions, held to the rules the module states.
 *
 * Nothing here renders anything, for the reason `vitest.config.ts` gives. What
 * is covered instead is everything underneath the markup: how the property is
 * grouped, which operator is offered which of the two kinds of unavailable, how
 * many nights a closure withdraws from sale, and what the board reads like the
 * instant after a room is shut.
 */

const TODAY = "2026-08-16";

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

describe("roomsByType", () => {
  it("groups in the product's own type order rather than alphabetically", () => {
    const groups = roomsByType([
      room({ roomNumber: "501", roomType: "PANORAMA_SUITE" }),
      room({ roomNumber: "301", roomType: "DELUXE" }),
      room({ roomNumber: "101", roomType: "SUPERIOR" }),
    ]);

    expect(groups.map((group) => group.roomType)).toEqual([
      "SUPERIOR",
      "DELUXE",
      "PANORAMA_SUITE",
    ]);
  });

  it("runs the rooms of a type in door order", () => {
    const groups = roomsByType([
      room({ roomNumber: "4010" }),
      room({ roomNumber: "402" }),
      room({ roomNumber: "401" }),
    ]);

    expect(groups[0].rooms.map((one) => one.roomNumber)).toEqual([
      "401",
      "402",
      "4010",
    ]);
  });

  it("shows no heading for a type the property has no rooms of", () => {
    // The board is the only room read in the contract, so an empty group would
    // be this screen claiming to know a type catalogue nothing answers.
    const groups = roomsByType([room({ roomType: "PREMIER" })]);

    expect(groups).toHaveLength(1);
    expect(groups[0].roomType).toBe("PREMIER");
  });
});

describe("roomStateLabel", () => {
  it("reads a room's condition beside whether anybody is in it", () => {
    expect(roomStateLabel(room({ status: "CLEAN", isOccupied: true }))).toBe(
      "Clean, Occupied",
    );
    expect(roomStateLabel(room({ status: "DIRTY" }))).toBe("Dirty, Vacant");
  });

  it("says only that a shut room is shut", () => {
    // A room nobody may enter is not "dirty and also shut": the condition
    // underneath is not the fact somebody scanning the list needs.
    expect(
      roomStateLabel(room({ status: "OUT_OF_ORDER", isOccupied: false })),
    ).toBe("Out of order");
  });
});

describe("who is offered which kind of unavailable", () => {
  it("offers room state to everyone who works the property", () => {
    expect(mayMarkOutOfOrder("RECEPTIONIST")).toBe(true);
    expect(mayMarkOutOfOrder("HOUSEKEEPING")).toBe(true);
    expect(mayMarkOutOfOrder("MANAGER")).toBe(true);
    expect(mayMarkOutOfOrder("ADMIN")).toBe(true);
  });

  it("offers it to nobody who only reads money", () => {
    expect(mayMarkOutOfOrder("ACCOUNTANT")).toBe(false);
  });

  it("keeps the commercial act to management", () => {
    // A closure moves `total_rooms` and changes what a guest can buy.
    expect(mayCloseRooms("MANAGER")).toBe(true);
    expect(mayCloseRooms("ADMIN")).toBe(true);
    expect(mayCloseRooms("RECEPTIONIST")).toBe(false);
    expect(mayCloseRooms("HOUSEKEEPING")).toBe(false);
    expect(mayCloseRooms("ACCOUNTANT")).toBe(false);
  });
});

describe("closureAttempt", () => {
  it("counts the nights it withdraws before anything is confirmed", () => {
    const attempt = closureAttempt(
      { checkIn: TODAY, checkOut: "2026-08-19", reason: "Bathroom retiling" },
      "402",
      TODAY,
    );

    expect(attempt).toEqual({
      input: {
        roomNumber: "402",
        checkIn: "2026-08-16",
        checkOut: "2026-08-19",
        reason: "Bathroom retiling",
      },
      // Half-open: the 16th, 17th and 18th are withdrawn and the 19th is not.
      nights: 3,
    });
  });

  it("counts relative dates from the property's day and not the browser's", () => {
    const attempt = closureAttempt(
      { checkIn: "today", checkOut: "+7d", reason: "Air conditioning" },
      "402",
      TODAY,
    );

    expect("input" in attempt && attempt.input.checkIn).toBe("2026-08-16");
    expect("input" in attempt && attempt.input.checkOut).toBe("2026-08-23");
    expect("nights" in attempt && attempt.nights).toBe(7);
  });

  it("refuses a range that does not run forwards, in the contract's words", () => {
    const attempt = closureAttempt(
      { checkIn: "2026-08-19", checkOut: TODAY, reason: "Bathroom retiling" },
      "402",
      TODAY,
    );

    expect("problem" in attempt && attempt.problem).toBe(
      "checkOut must fall after checkIn",
    );
  });

  it("refuses a single date, because a closure is a range", () => {
    const attempt = closureAttempt(
      { checkIn: TODAY, checkOut: TODAY, reason: "Bathroom retiling" },
      "402",
      TODAY,
    );

    expect("problem" in attempt).toBe(true);
  });

  it("refuses a closure with no reason", () => {
    // "Why is 304 out?" is the question the column exists to answer, so the
    // desk is asked here rather than by a 400 after the press.
    const attempt = closureAttempt(
      { checkIn: TODAY, checkOut: "+2d", reason: "   " },
      "402",
      TODAY,
    );

    expect("problem" in attempt).toBe(true);
  });

  it("names the two dates when neither has been typed yet", () => {
    const attempt = closureAttempt(NO_CLOSURE_FIELDS, "402", TODAY);

    expect("problem" in attempt && attempt.problem).toContain(
      "first and a last",
    );
  });

  it("refuses a date that never existed rather than rolling it forward", () => {
    const attempt = closureAttempt(
      { checkIn: "31/2", checkOut: "+2d", reason: "Bathroom retiling" },
      "402",
      TODAY,
    );

    expect("problem" in attempt).toBe(true);
  });
});

describe("outOfOrderAttempt", () => {
  it("sends the reason with a room that is going out", () => {
    expect(outOfOrderAttempt("402", true, "  Shower mixer leaking ")).toEqual({
      input: {
        roomNumber: "402",
        outOfOrder: true,
        reason: "Shower mixer leaking",
      },
    });
  });

  it("refuses to shut a room without saying why", () => {
    const attempt = outOfOrderAttempt("402", true, "   ");

    expect("problem" in attempt).toBe(true);
  });

  it("needs no reason to put a room back", () => {
    expect(outOfOrderAttempt("402", false, "")).toEqual({
      input: { roomNumber: "402", outOfOrder: false },
    });
  });
});

describe("withOutOfOrder", () => {
  const board: HousekeepingBoard = {
    businessDate: TODAY,
    rooms: [
      room({ roomNumber: "402", status: "CLEAN", isReady: true }),
      room({ roomNumber: "403" }),
    ],
  };

  it("shuts the room it was given and leaves the floor alone", () => {
    const next = withOutOfOrder(board, {
      roomNumber: "402",
      outOfOrder: true,
      reason: " Shower mixer leaking ",
    });

    expect(next.rooms[0]).toMatchObject({
      status: "OUT_OF_ORDER",
      isReady: false,
      note: "Shower mixer leaking",
    });
    expect(next.rooms[1]).toEqual(board.rooms[1]);
  });

  it("returns a reopened room to dirty rather than guessing it is ready", () => {
    // Somebody has been working in there. `CLEAN` would paint the exact field
    // the check-in guard reads, and walk a guest into an unserviced room.
    const shut = withOutOfOrder(board, {
      roomNumber: "402",
      outOfOrder: true,
      reason: "Shower mixer leaking",
    });

    expect(
      withOutOfOrder(shut, { roomNumber: "402", outOfOrder: false }).rooms[0],
    ).toMatchObject({ status: "DIRTY", isReady: false, note: null });
  });

  it("does not mutate the cached board it was given", () => {
    withOutOfOrder(board, {
      roomNumber: "402",
      outOfOrder: true,
      reason: "Shower mixer leaking",
    });

    expect(board.rooms[0].status).toBe("CLEAN");
  });

  it("leaves the board untouched when the room is not on it", () => {
    const next = withOutOfOrder(board, {
      roomNumber: "999",
      outOfOrder: true,
      reason: "Shower mixer leaking",
    });

    expect(next.rooms).toEqual(board.rooms);
  });
});

describe("searching the list", () => {
  it("answers every room while nothing has been typed", () => {
    expect(roomMatches(room(), "")).toBe(true);
    expect(roomMatches(room(), "   ")).toBe(true);
  });

  it("finds a room part way through its number", () => {
    expect(roomMatches(room({ roomNumber: "402" }), "02")).toBe(true);
    expect(roomMatches(room({ roomNumber: "402" }), "03")).toBe(false);
  });

  it("finds a type by the code and by how anybody says it", () => {
    const junior = room({ roomType: "JUNIOR_SUITE" });

    expect(roomMatches(junior, "JUNIOR_SUITE")).toBe(true);
    expect(roomMatches(junior, "junior suite")).toBe(true);
    expect(roomMatches(junior, "deluxe")).toBe(false);
  });

  it("matches a condition in the words the row itself prints", () => {
    expect(roomMatches(room({ status: "OUT_OF_ORDER" }), "out of order")).toBe(
      true,
    );
    expect(roomMatches(room({ status: "DIRTY" }), "dirty")).toBe(true);
    expect(
      roomMatches(room({ status: "CLEAN", isOccupied: true }), "occupied"),
    ).toBe(true);
    expect(
      roomMatches(room({ status: "CLEAN", isOccupied: true }), "vacant"),
    ).toBe(false);
  });

  it("takes a type off the list once the query has emptied it", () => {
    const groups = roomsByType([
      room({ roomNumber: "101", roomType: "SUPERIOR" }),
      room({ roomNumber: "301", roomType: "DELUXE" }),
    ]);

    expect(narrowRooms(groups, "101").map((group) => group.roomType)).toEqual([
      "SUPERIOR",
    ]);
    expect(narrowRooms(groups, "601")).toEqual([]);
  });

  it("leaves the property whole when nothing has been typed", () => {
    const groups = roomsByType([
      room({ roomNumber: "101", roomType: "SUPERIOR" }),
      room({ roomNumber: "301", roomType: "DELUXE" }),
    ]);

    expect(narrowRooms(groups, "")).toEqual(groups);
  });
});
