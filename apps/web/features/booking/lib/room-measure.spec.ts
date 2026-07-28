import { describe, expect, it } from "vitest";
import { measureLineLabel, occupancyDots, sizeBarFills } from "./room-measure";
import { ROOM_TYPES, roomType } from "./room-types";

// The card carries three drawn facts and about eleven words. These are the two
// things that has to be true for that to be honest: the glyphs say the same
// thing as the sentence they are labelled with, and the bars are measured
// against the rooms the guest is actually being offered.

describe("occupancyDots", () => {
  it("draws one filled dot per head and one open dot for an extra bed", () => {
    const runs = ROOM_TYPES.map((type) => occupancyDots(type));

    expect(runs.map((run) => run.filled)).toEqual([2, 2, 3, 3, 4]);
    // Three of the five types take an extra bed — `property-and-tariff.md` §1.
    expect(runs.filter((run) => run.open > 0)).toHaveLength(3);
  });

  it("never draws more than one open dot", () => {
    for (const type of ROOM_TYPES) {
      expect(occupancyDots(type).open).toBeLessThanOrEqual(1);
    }
  });
});

describe("sizeBarFills", () => {
  it("normalises over the whole set when the whole set is rendered", () => {
    const fills = sizeBarFills(ROOM_TYPES);

    // 28 / 34 / 42 / 52 / 68 against 68.
    expect(ROOM_TYPES.map((type) => fills.get(type.code))).toEqual([
      41, 50, 62, 76, 100,
    ]);
  });

  it("normalises over the rendered subset, not over ROOM_TYPES", () => {
    // The largest room is sold out. The largest room *on screen* is the Junior
    // Suite, and its bar has to be the full track — a bar measured against a
    // room the guest cannot have is a bar measured against nothing.
    const shown = ROOM_TYPES.filter((type) => type.code !== "PANORAMA_SUITE");
    const fills = sizeBarFills(shown);

    expect(fills.get("JUNIOR_SUITE")).toBe(100);
    expect(fills.get("SUPERIOR")).toBe(54); // 28 of 52.
    expect(Math.max(...fills.values())).toBe(100);
  });

  it("survives an empty set rather than dividing by zero", () => {
    expect(sizeBarFills([]).size).toBe(0);
  });
});

describe("measureLineLabel", () => {
  it("names the occupancy, the extra bed, the size and the aspect", () => {
    expect(measureLineLabel(roomType("JUNIOR_SUITE"))).toBe(
      "Sleeps 3, extra bed available. 52 square metres. Corner, two aspects.",
    );
  });

  it("says nothing about an extra bed on a type that does not take one", () => {
    const label = measureLineLabel(roomType("SUPERIOR"));

    expect(label).toBe("Sleeps 2. 28 square metres. Courtyard.");
    expect(label).not.toContain("extra bed");
  });

  it("agrees with the glyphs on every type", () => {
    for (const type of ROOM_TYPES) {
      const label = measureLineLabel(type);
      const { filled, open } = occupancyDots(type);

      expect(label).toContain(`Sleeps ${filled}.`.replace(".", ""));
      expect(label).toContain(`${type.squareMetres} square metres`);
      expect(label.includes("extra bed available")).toBe(open > 0);
    }
  });

  it("reads the middle dot as a pause rather than as a character", () => {
    expect(measureLineLabel(roomType("JUNIOR_SUITE"))).not.toContain("·");
  });
});
