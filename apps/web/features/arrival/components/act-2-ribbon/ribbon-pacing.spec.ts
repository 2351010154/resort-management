import { describe, expect, it } from "vitest";
import { KNOTS, MOBILE_LENGTH, RIBBON_LENGTH } from "./ribbon-beats";
import { edgeWave, ribbonPath } from "./ribbon-geometry";
import { cameraAt, exitOpacity } from "./ribbon-pacing";

describe("ribbon camera", () => {
  it("moves forward without jumps or reversing between holds", () => {
    for (const narrow of [false, true]) {
      const length = narrow ? MOBILE_LENGTH : RIBBON_LENGTH;
      let previous = cameraAt(0, narrow);
      for (let travel = 1; travel <= length; travel++) {
        const next = cameraAt(travel, narrow);
        expect(next).toBeGreaterThanOrEqual(previous);
        expect(next - previous).toBeLessThan(4);
        previous = next;
      }
      expect(previous).toBe(534);
    }
  });
  it("spends more scroll inspecting a scene than crossing to the next", () => {
    const roomHoldSpeed = (cameraAt(460) - cameraAt(300)) / 160;
    const transitionSpeed = (cameraAt(590) - cameraAt(460)) / 130;
    expect(transitionSpeed).toBeGreaterThan(roomHoldSpeed * 4);
  });
  it("keeps the horizon visible until Act 3 is underneath, then clears it", () => {
    for (const length of [RIBBON_LENGTH, MOBILE_LENGTH]) {
      expect(exitOpacity(length - 160, length)).toBe(1);
      expect(exitOpacity(length - 140, length)).toBe(1);
      expect(exitOpacity(length - 120, length)).toBeGreaterThan(0);
      expect(exitOpacity(length - 100, length)).toBe(0);
    }
  });
});

describe("ribbon edge motion", () => {
  const options = {
    knots: KNOTS,
    from: 70,
    to: 220,
    s: 140,
    aspect: 0.625,
    apertures: [],
  };
  it("continues waving while the scroll position is stationary", () => {
    expect(ribbonPath({ ...options, swaying: true, time: 0 })).not.toBe(
      ribbonPath({ ...options, swaying: true, time: 2 }),
    );
    expect(
      Math.abs(edgeWave(120, 140, 0) - edgeWave(120, 140, 2)),
    ).toBeGreaterThan(1);
  });
  it("freezes completely for reduced motion", () => {
    expect(ribbonPath({ ...options, swaying: false, time: 0 })).toBe(
      ribbonPath({ ...options, swaying: false, time: 20 }),
    );
  });
});
