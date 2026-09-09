import { describe, expect, it } from "vitest";
import { BEATS, KNOTS, MOBILE_LENGTH, RIBBON_LENGTH } from "./ribbon-beats";
import { centre, edgeWave, ribbonPath } from "./ribbon-geometry";
import { CAMERA_STOPS, cameraAt, exitOpacity } from "./ribbon-pacing";

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
    // cameraAt reads scroll, not the authored stop positions: it stretches
    // the authored curve over whatever length the act is given. Sampling a
    // stop means converting back, or the windows slide off the segments they
    // are meant to measure as soon as the act is retuned to a new length.
    const authoredTravel = CAMERA_STOPS[CAMERA_STOPS.length - 1][0];
    const scrollAt = (position: number) =>
      (position * (RIBBON_LENGTH - 100)) / authoredTravel;
    const speed = (from: number, to: number) =>
      (cameraAt(scrollAt(to)) - cameraAt(scrollAt(from))) / (to - from);

    const hold = CAMERA_STOPS[2][0];
    const settled = CAMERA_STOPS[3][0];
    const crossed = CAMERA_STOPS[4][0];
    expect(speed(settled, crossed)).toBeGreaterThan(speed(hold, settled) * 4);
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
    ).toBeGreaterThan(0.25);
  });
  it("keeps the first circular photo clear of the compact introduction", () => {
    const aperture = BEATS[0].aperture!;
    for (let time = 0; time <= 60; time += 0.5) {
      const phase = time * 8;
      const photoLeft =
        centre(KNOTS, aperture.y, phase) + aperture.dx - aperture.widthVw / 2;
      // The introduction occupies 54–73vw; its own centre drift is shared.
      const textRight =
        73 +
        centre(KNOTS, BEATS[0].y, phase) -
        centre(KNOTS, BEATS[0].y, 0, false);
      expect(photoLeft).toBeGreaterThan(textRight);
    }
  });
  it("freezes completely for reduced motion", () => {
    expect(ribbonPath({ ...options, swaying: false, time: 0 })).toBe(
      ribbonPath({ ...options, swaying: false, time: 20 }),
    );
  });
});
