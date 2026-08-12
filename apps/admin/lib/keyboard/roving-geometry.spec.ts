import { describe, expect, it } from "vitest";

import { jumpFor, stepFor, targetIndex } from "./roving-geometry";

describe("stepFor", () => {
  it("steers the vertical arrows for a vertical list", () => {
    expect(stepFor("ArrowDown", "vertical")).toBe(1);
    expect(stepFor("ArrowUp", "vertical")).toBe(-1);
    expect(stepFor("ArrowRight", "vertical")).toBe(0);
    expect(stepFor("ArrowLeft", "vertical")).toBe(0);
  });

  it("steers the horizontal arrows for a horizontal list", () => {
    expect(stepFor("ArrowRight", "horizontal")).toBe(1);
    expect(stepFor("ArrowLeft", "horizontal")).toBe(-1);
    expect(stepFor("ArrowDown", "horizontal")).toBe(0);
    expect(stepFor("ArrowUp", "horizontal")).toBe(0);
  });

  it("steers all four for a grid", () => {
    expect(stepFor("ArrowDown", "both")).toBe(1);
    expect(stepFor("ArrowRight", "both")).toBe(1);
    expect(stepFor("ArrowUp", "both")).toBe(-1);
    expect(stepFor("ArrowLeft", "both")).toBe(-1);
  });

  it("leaves every other key alone", () => {
    // 0 is what stops the group swallowing a press it does not steer.
    for (const key of ["Tab", "Enter", " ", "a", "Escape", "PageDown"]) {
      expect(stepFor(key, "both")).toBe(0);
    }
  });
});

describe("jumpFor", () => {
  it("reads Home and End, and nothing else", () => {
    expect(jumpFor("Home")).toBe("first");
    expect(jumpFor("End")).toBe("last");
    expect(jumpFor("ArrowDown")).toBeNull();
    expect(jumpFor("PageUp")).toBeNull();
  });
});

describe("targetIndex", () => {
  it("steps within the list", () => {
    expect(targetIndex(2, 1, null, 5, true)).toBe(3);
    expect(targetIndex(2, -1, null, 5, true)).toBe(1);
  });

  describe("at the boundaries", () => {
    it("wraps when looping", () => {
      expect(targetIndex(4, 1, null, 5, true)).toBe(0);
      expect(targetIndex(0, -1, null, 5, true)).toBe(4);
    });

    it("clamps when not looping", () => {
      expect(targetIndex(4, 1, null, 5, false)).toBe(4);
      expect(targetIndex(0, -1, null, 5, false)).toBe(0);
    });

    it("holds still on a single-member list", () => {
      expect(targetIndex(0, 1, null, 1, true)).toBe(0);
      expect(targetIndex(0, -1, null, 1, true)).toBe(0);
      expect(targetIndex(0, 1, null, 1, false)).toBe(0);
    });
  });

  describe("arrowing in from outside", () => {
    it("enters at the end the press is arriving from", () => {
      // ArrowDown into a list picks its first row; ArrowUp picks its last.
      expect(targetIndex(-1, 1, null, 5, true)).toBe(0);
      expect(targetIndex(-1, -1, null, 5, true)).toBe(4);
    });

    it("does the same whether or not the list loops", () => {
      expect(targetIndex(-1, 1, null, 5, false)).toBe(0);
      expect(targetIndex(-1, -1, null, 5, false)).toBe(4);
    });
  });

  describe("jumps", () => {
    it("goes to an end regardless of where it started", () => {
      expect(targetIndex(3, 0, "first", 5, true)).toBe(0);
      expect(targetIndex(3, 0, "last", 5, true)).toBe(4);
      expect(targetIndex(-1, 0, "first", 5, true)).toBe(0);
      expect(targetIndex(-1, 0, "last", 5, true)).toBe(4);
    });

    it("outranks a step given at the same time", () => {
      expect(targetIndex(3, 1, "first", 5, true)).toBe(0);
    });
  });

  describe("when there is nothing to move to", () => {
    it("refuses an empty list", () => {
      // Null rather than 0: the caller must leave the press alone instead of
      // acting on an index into a list with no members.
      expect(targetIndex(-1, 1, null, 0, true)).toBeNull();
      expect(targetIndex(-1, 0, "first", 0, true)).toBeNull();
      expect(targetIndex(-1, 0, "last", 0, false)).toBeNull();
    });

    it("refuses a press that steers nothing", () => {
      expect(targetIndex(2, 0, null, 5, true)).toBeNull();
    });
  });
});
