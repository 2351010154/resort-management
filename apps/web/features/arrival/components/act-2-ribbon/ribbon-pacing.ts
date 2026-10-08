import { ACT2_ACT3_OVERLAP } from "@/features/arrival/lib/act-seams";
import { MOBILE_LENGTH, RIBBON_LENGTH } from "./ribbon-beats";

export const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
export const smooth = (value: number) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
export const ramp = (value: number, from: number, to: number) =>
  clamp01((value - from) / (to - from));

// Arrival, slow inspection, then travel to the next composition. Every hold
// still advances gently, so the scene never feels like a locked scrollbar.
// The first and last holds are the shortest the reading allows: the first
// is the ribbon's birth, already watched rising out of Act 1, and the last is
// one line over the horizon. Longer, each was most of a screen of scroll in
// which nothing on the frame visibly changed.
export const CAMERA_STOPS = [
  [0, -36],
  [130, -22],
  [260, 86],
  [420, 104],
  [550, 179],
  [690, 202],
  [810, 279],
  [970, 297],
  [1090, 382],
  [1150, 396],
  [1210, 492],
  [1260, 504],
  [1300, 534],
] as const;

const CAMERA_TANGENTS = CAMERA_STOPS.map(([x, y], index) => {
  if (index === CAMERA_STOPS.length - 1) return 0;
  const [nextX, nextY] = CAMERA_STOPS[index + 1];
  const nextSlope = (nextY - y) / (nextX - x);
  if (index === 0) return nextSlope;
  const [previousX, previousY] = CAMERA_STOPS[index - 1];
  const previousSlope = (y - previousY) / (x - previousX);
  const previousSpan = x - previousX;
  const nextSpan = nextX - x;
  const weight1 = 2 * nextSpan + previousSpan;
  const weight2 = nextSpan + 2 * previousSpan;
  return (weight1 + weight2) / (weight1 / previousSlope + weight2 / nextSlope);
});

export function cameraAt(scroll: number, narrow = false): number {
  const authoredTravel = CAMERA_STOPS[CAMERA_STOPS.length - 1][0];
  const scale =
    ((narrow ? MOBILE_LENGTH : RIBBON_LENGTH) - 100) / authoredTravel;
  const position = Math.max(0, scroll / scale);
  for (let i = 1; i < CAMERA_STOPS.length; i++) {
    const [end, to] = CAMERA_STOPS[i];
    const [start, from] = CAMERA_STOPS[i - 1];
    if (position <= end) {
      const t = (position - start) / (end - start);
      const t2 = t * t;
      const t3 = t2 * t;
      // Shared monotone tangents carry momentum through each reading beat.
      // The camera progressively slows and releases instead of stopping at
      // every boundary; harmonic slopes keep it inside the authored stops.
      return (
        (2 * t3 - 3 * t2 + 1) * from +
        (t3 - 2 * t2 + t) * (end - start) * CAMERA_TANGENTS[i - 1] +
        (-2 * t3 + 3 * t2) * to +
        (t3 - t2) * (end - start) * CAMERA_TANGENTS[i]
      );
    }
  }
  return CAMERA_STOPS[CAMERA_STOPS.length - 1][1];
}
export function exitOpacity(scroll: number, length: number): number {
  const start = length - ACT2_ACT3_OVERLAP;
  return 1 - smooth(ramp(scroll, start + 20, length - 100));
}
