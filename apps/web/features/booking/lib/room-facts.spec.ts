import { describe, expect, it } from "vitest";
import { roomFacts } from "./room-facts";
import { ROOM_TYPES, roomType } from "./room-types";

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
