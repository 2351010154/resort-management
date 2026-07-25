// One camera for the whole intro. The photo cards and the coast plate are
// planes at different world depths in front of a single camera that pushes
// forward as you scroll — that shared projection is what makes them read as one
// space instead of stacked effects. The monogram window itself is fixed; it is
// the frame the world moves behind, not a plane in it.

import { arrivalImages } from "@/lib/arrival-image-manifest";

/** Depth of the coast plate — far enough that it only drifts. */
export const PLATE_DEPTH = 4;
/**
 * Camera travel constant. Advance is `1 - e^(-K·p)`, which makes a plane at
 * depth 1 grow as `e^(K·p)` — an exponential zoom, which is what constant
 * forward velocity through a perspective world looks like.
 */
const TRAVEL = 3.9;

export interface IntroCamera {
  /** Scrub progress across the pinned act, 0-1. */
  progress: number;
  /** Camera advance toward the aperture plane, 0 → ~0.98. */
  z: number;
  /** 0-1 mount fade — the scene lifts out of flat ivory once the SDF is ready. */
  entry: number;
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function cameraAdvance(progress: number): number {
  // Linear in progress on purpose: it makes the zoom exponential, which is what
  // reads as travelling forward at a steady speed rather than accelerating.
  return 1 - Math.exp(-TRAVEL * clamp01(progress));
}

/** Monogram height, in scene units. */
export const APERTURE_UNITS = 44;

/**
 * One scene unit in px. The aperture, the cards and their positions are all
 * measured in this, so the whole scene rescales as one. Plain vmin would leave
 * the monogram tiny in the middle of a mostly-empty frame on a tall phone; this
 * resolves to exactly vmin/100 at desktop aspect ratios and grows on portrait.
 */
export function sceneUnitPx(viewWidth: number, viewHeight: number): number {
  return Math.min(viewWidth * 0.56, viewHeight * 0.44) / APERTURE_UNITS;
}

/** Apparent scale of a plane at `depth`, relative to its scale at rest. */
export function planeScale(depth: number, z: number): number {
  return 1 / Math.max(depth - z, 1e-3);
}

export interface IntroCard {
  src: string;
  srcSet: string;
  aspect: number;
  /** World position; on-screen vmin is this divided by apparent depth. */
  x: number;
  y: number;
  depth: number;
  /** World width; divide by apparent depth for the on-screen vmin. */
  width: number;
  rotation: number;
}

// Hand-placed rather than scattered, in two groups.
//
// The near group (depth ~1.1-1.8) sits inside the monogram's bounding box, so
// each card pays off through a stroke while the aperture is still small, then
// sweeps out past the camera during the push.
//
// The far group (depth ~1.9-3.6) is what the near group flies away to reveal.
// A forward-moving camera pushes everything radially outward, so a card that
// starts outside the frame can never enter it — depth, not distance, is the only
// way to hold something in reserve. Their world widths scale with depth so they
// still read at a usable size from back there.
const LAYOUT: Array<[slug: string, x: number, y: number, depth: number, width: number, rotation: number]> = [
  ["pool-pavilion", -15, 7, 1.1, 12, 3],
  ["temple-gate", 19, -14, 1.18, 12, -4],
  ["lobby-light-hall", -31, -19, 1.26, 20, 2],
  ["arva-sunset-bonsai", 27, 21, 1.34, 12, -3],
  ["dark-pool-dusk", -10, 30, 1.42, 16, 4],
  ["terrace-lunch-sea", 36, -5, 1.5, 19, -2],
  ["spa-pool-lightshafts", -39, 14, 1.58, 17, 3],
  ["forest-steps-kimono", 8, -33, 1.66, 15, -3],
  ["kyoto-suite-living", -22, -2, 1.74, 17, 2],
  ["suite-lounge-sky", -52, -34, 1.92, 40, 3],
  ["sunset-hills", 58, 38, 2.1, 48, -2],
  ["mori-suite-lantern", -14, 52, 2.28, 38, 4],
  ["waterfall-cliff", 46, -48, 2.46, 44, -3],
  ["timber-bedroom", -60, 10, 2.64, 46, -4],
  ["library-lounge", 22, 58, 2.82, 44, -2],
  ["steam-bath-window", -32, -58, 3, 42, -3],
  ["resort-walkway", 68, -12, 3.2, 50, 2],
  ["round-window-ikebana", -70, 44, 3.4, 48, -4],
  ["calligraphy-hand", 34, 16, 3.6, 40, 4],
];

const FIELD = arrivalImages["act-1-converge"];
const bySlug = new Map(FIELD.map((image) => [image.src.replace(/^.*\/|-\d+\.webp$/g, ""), image]));

function tierFor(image: (typeof FIELD)[number]) {
  const tiers = [...image.tiers].sort((a, b) => a - b);
  const swap = (width: number) => image.src.replace(/-\d+\.webp$/, `-${width}.webp`);
  return {
    src: swap(tiers[Math.min(1, tiers.length - 1)]),
    srcSet: tiers.map((w) => `${swap(w)} ${w}w`).join(", "),
  };
}

export const INTRO_CARDS: IntroCard[] = LAYOUT.flatMap(
  ([slug, x, y, depth, width, rotation]) => {
    const image = bySlug.get(slug);
    if (!image) return [];
    return [{
      ...tierFor(image),
      aspect: image.width / image.height,
      x, y, depth, width, rotation,
    }];
  },
);

/** The coast plate the whole scene sits in front of. */
export const PLATE_IMAGE = bySlug.get("coast-aerial") ?? FIELD[0];

/**
 * Cards fade as they reach the camera so nothing ever slams the viewport shut.
 * `apparent` is `depth - z`; 1 while comfortably ahead, 0 once it has passed.
 * The window is deliberately short — a slow fade leaves several cards part-
 * transparent at once, which reads as a stack of ghosts rather than depth.
 */
export function cardOpacity(apparent: number): number {
  return clamp01((apparent - 0.18) / 0.12);
}

/**
 * Aerial perspective: distant planes sit back into the dark and lift as they
 * approach. Doing this on *apparent* depth rather than world depth means a card
 * brightens as the camera closes on it, which is most of the sense of travel.
 */
export function cardLuminance(apparent: number): number {
  return 0.6 + 0.4 * clamp01((1.9 - apparent) / 1.2);
}
