// The plan arithmetic, §3's child bands and the two figures on a card are not
// asserted here any more, and their absence is not a gap. They are the API's,
// applied by `stayTotalGross` in `@mariva/shared` and held to account beside it —
// this feature reads the offers rather than deriving them, so a copy of those
// assertions here would be testing a second implementation that no longer exists.

import { parseDate } from "@internationalized/date";
import type { RoomTypeCode } from "@mariva/shared";
import { describe, expect, it } from "vitest";
import { ROOM_TYPES, roomType } from "./room-types";
import {
  nightsInRange,
  occupancyFit,
  type Party,
  partitionRoomTypes,
} from "./stay-quote";

const ROOM_GROSS = 2_000_000n;

describe("occupancy is a fit test, not a filter", () => {
  it("fits a party inside the maximum", () => {
    expect(
      occupancyFit(roomType("PREMIER"), { adults: 3, children: [] }),
    ).toEqual({
      fits: true,
    });
  });

  // §3: occupancy above the maximum is a rejection, not a price. The card still
  // renders — hiding it makes the guest think the hotel has no such room.
  it("says who a room sleeps and how many are asking", () => {
    const fit = occupancyFit(roomType("SUPERIOR"), { adults: 3, children: [] });

    expect(fit).toEqual({ fits: false, reason: "Sleeps 2. You are 3." });
  });

  it("counts children toward the maximum", () => {
    const fit = occupancyFit(roomType("SUPERIOR"), {
      adults: 2,
      children: [{ age: 4 }],
    });

    expect(fit.fits).toBe(false);
  });
});

describe("nights of a range", () => {
  // The half-open convention: the departure date is not a night sold. This is the
  // off-by-one the whole calendar is built around.
  it("excludes the departure date", () => {
    const nights = nightsInRange({
      checkIn: parseDate("2026-08-10"),
      checkOut: parseDate("2026-08-12"),
    });

    expect(nights.map((d) => d.toString())).toEqual([
      "2026-08-10",
      "2026-08-11",
    ]);
  });
});

describe("the partition into cards and demoted rows", () => {
  /** An offer per type, with only the named codes free for the range. */
  function offering(...free: RoomTypeCode[]) {
    return ROOM_TYPES.map((type) => ({
      code: type.code,
      perNightGross: ROOM_GROSS,
      stayTotalGross: ROOM_GROSS,
      isAvailable: free.includes(type.code),
    }));
  }

  const two: Party = { adults: 2, children: [] };
  const three: Party = { adults: 3, children: [] };

  it("gives a card to what is free and fits, and a row to the rest", () => {
    const { takeable, soldOut, tooSmall } = partitionRoomTypes(
      offering("SUPERIOR", "PREMIER", "PANORAMA_SUITE"),
      two,
    );

    expect(takeable.map((type) => type.code)).toEqual([
      "SUPERIOR",
      "PREMIER",
      "PANORAMA_SUITE",
    ]);
    expect(soldOut.map((type) => type.code)).toEqual([
      "DELUXE",
      "JUNIOR_SUITE",
    ]);
    expect(tooSmall).toEqual([]);
  });

  it("demotes a type the party does not fit even when it is free", () => {
    const { takeable, tooSmall } = partitionRoomTypes(
      offering(...ROOM_TYPES.map((type) => type.code)),
      three,
    );

    // Superior and Deluxe both sleep two.
    expect(tooSmall.map((type) => type.code)).toEqual(["SUPERIOR", "DELUXE"]);
    expect(takeable.map((type) => type.code)).toEqual([
      "PREMIER",
      "JUNIOR_SUITE",
      "PANORAMA_SUITE",
    ]);
  });

  it("calls a type too small before it calls it sold out", () => {
    // Both true at once. "Not free for these nights" invites the guest to move
    // their dates, and moving the dates cannot make a room sleep three.
    const { soldOut, tooSmall } = partitionRoomTypes(offering(), three);

    expect(tooSmall.map((type) => type.code)).toEqual(["SUPERIOR", "DELUXE"]);
    expect(soldOut.map((type) => type.code)).toEqual([
      "PREMIER",
      "JUNIOR_SUITE",
      "PANORAMA_SUITE",
    ]);
  });

  it("loses no type, whatever the search", () => {
    const { takeable, soldOut, tooSmall } = partitionRoomTypes(
      offering("JUNIOR_SUITE"),
      three,
    );

    // Hiding a type makes the guest think the hotel does not have that room.
    expect(takeable.length + soldOut.length + tooSmall.length).toBe(
      ROOM_TYPES.length,
    );
  });

  it("leaves nothing takeable when the party fits nothing free", () => {
    // This is what sends the view to `NoAvailability` rather than to a column of
    // caps-labelled lines.
    expect(partitionRoomTypes(offering("SUPERIOR"), three).takeable).toEqual(
      [],
    );
  });

  it("keeps ROOM_TYPES' order inside each group", () => {
    const { soldOut } = partitionRoomTypes(offering("PREMIER"), two);
    const order = ROOM_TYPES.map((type) => type.code);

    const positions = soldOut.map((type) => order.indexOf(type.code));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});
