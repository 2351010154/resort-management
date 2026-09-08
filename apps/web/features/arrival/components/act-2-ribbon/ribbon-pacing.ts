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
export const CAMERA_STOPS = [
  [0, -36],
  [170, -22],
  [300, 86],
  [460, 104],
  [590, 179],
  [730, 202],
  [850, 279],
  [1010, 297],
  [1130, 382],
  [1190, 396],
  [1250, 492],
  [1340, 504],
  [1380, 534],
] as const;

export function cameraAt(scroll: number, narrow = false): number {
  const scale = narrow ? (MOBILE_LENGTH - 100) / (RIBBON_LENGTH - 100) : 1;
  const position = Math.max(0, scroll / scale);
  for (let i = 1; i < CAMERA_STOPS.length; i++) {
    const [end, to] = CAMERA_STOPS[i];
    const [start, from] = CAMERA_STOPS[i - 1];
    if (position <= end)
      return from + (to - from) * smooth((position - start) / (end - start));
  }
  return CAMERA_STOPS[CAMERA_STOPS.length - 1][1];
}
export function exitOpacity(scroll: number, length: number): number {
  const start = length - ACT2_ACT3_OVERLAP;
  return 1 - smooth(ramp(scroll, start + 20, length - 100));
}
