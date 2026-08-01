import { describe, expect, it } from "vitest";
import { absenceNotes } from "./room-absence";
import { roomType } from "./room-types";
import type { Party } from "./stay-quote";

const TWO: Party = { adults: 2, children: [] };
const THREE: Party = { adults: 3, children: [] };

const types = (...codes: Parameters<typeof roomType>[0][]) =>
  codes.map((code) => roomType(code));

describe("absenceNotes", () => {
  it("says nothing when every room is on the list", () => {
    expect(absenceNotes({ soldOut: [], tooSmall: [] }, TWO)).toEqual([]);
  });

  it("agrees the verb with one name", () => {
    expect(
      absenceNotes({ soldOut: types("SUPERIOR"), tooSmall: [] }, TWO),
    ).toEqual(["Superior is not free for these nights."]);
  });

  it("agrees the verb with several, and joins them as a reader would", () => {
    expect(
      absenceNotes(
        {
          soldOut: types("SUPERIOR", "PREMIER", "JUNIOR_SUITE"),
          tooSmall: [],
        },
        TWO,
      ),
    ).toEqual([
      "Superior, Premier and Junior Suite are not free for these nights.",
    ]);
  });

  it("counts the party in words for the rooms it does not fit", () => {
    expect(
      absenceNotes(
        { soldOut: [], tooSmall: types("SUPERIOR", "DELUXE") },
        THREE,
      ),
    ).toEqual(["Superior and Deluxe are too small for three guests."]);
  });

  it("keeps the two reasons apart", () => {
    // One sentence covering both would have to say "not free or too small",
    // which tells the guest neither.
    expect(
      absenceNotes(
        { soldOut: types("PREMIER"), tooSmall: types("SUPERIOR") },
        THREE,
      ),
    ).toEqual([
      "Premier is not free for these nights.",
      "Superior is too small for three guests.",
    ]);
  });
});
