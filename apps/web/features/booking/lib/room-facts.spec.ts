import { describe, expect, it } from "vitest";
import { roomChips, roomFacts } from "./room-facts";
import { ROOM_AMENITIES, ROOM_TYPES, roomType } from "./room-types";

describe("roomFacts", () => {
  it("states whom it sleeps, how big, and what it faces", () => {
    expect(roomFacts(roomType("JUNIOR_SUITE"))).toBe(
      "3 guests, 52 m², corner, two aspects",
    );
  });

  it("gives every type all three, in that order", () => {
    for (const type of ROOM_TYPES) {
      const line = roomFacts(type);

      expect(line).toContain(`${type.maxOccupancy} guests`);
      expect(line).toContain(`${type.squareMetres} m²`);
      expect(line).toContain(type.aspect);
      expect(line.indexOf("guests")).toBeLessThan(line.indexOf("m²"));
    }
  });

  it("says nothing about the extra bed", () => {
    // It is an allowance rather than a property of the room, and it costs money.
    // The stage states what it costs; a row that hinted at one without the other
    // would be a price the guest finds later.
    for (const type of ROOM_TYPES) {
      expect(roomFacts(type)).not.toContain("extra bed");
    }
  });
});

describe("roomChips", () => {
  it("names the outlook, cased as the first word of a line", () => {
    expect(roomChips(roomType("PREMIER"))).toContainEqual({
      icon: "eye",
      label: "City",
    });
    expect(roomChips(roomType("JUNIOR_SUITE"))).toContainEqual({
      icon: "eye",
      label: "Corner, two aspects",
    });
  });

  // The guard exists so an edit to the property file that renames or drops an
  // amenity is a screen that will not render rather than a chip quietly
  // disagreeing with the property. Nothing proved it fired until this.
  it("reads every label out of the property's own list", () => {
    for (const type of ROOM_TYPES) {
      const chips = roomChips(type);
      const amenities = chips.filter((chip) => chip.icon !== "eye");

      expect(amenities).not.toHaveLength(0);

      for (const chip of amenities) {
        expect(ROOM_AMENITIES).toContain(chip.label);
      }
    }
  });

  it("gives every type the five amenities and the outlook, in that order", () => {
    for (const type of ROOM_TYPES) {
      const chips = roomChips(type);

      expect(chips).toHaveLength(6);
      expect(chips.at(-1)?.icon).toBe("eye");
      expect(new Set(chips.map((chip) => chip.icon)).size).toBe(6);
    }
  });
});
