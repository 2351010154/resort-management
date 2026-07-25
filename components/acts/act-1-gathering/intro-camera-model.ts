// One camera for the whole intro. The monogram, the cards and the interior plate
// are planes at different world depths in front of a single camera that pushes
// forward as you scroll — that shared projection is what makes them read as one
// space instead of stacked effects. The monogram is the nearest of them, so it
// grows fastest and passes the camera first, opening onto the field behind.

import { arrivalImages } from "@/lib/arrival-image-manifest";
import { INTRO_VIDEO_BASE, introVideoBySlug } from "@/lib/intro-video-manifest";

/**
 * Depth of the interior plate — far enough that it only drifts. Read against
 * TRAVEL: it has to sit several travels back, or a camera crossing three depth
 * units takes the backdrop to 4x, which is both a visible upscale of a 1920px
 * photograph and far more motion than something behind everything should have.
 * At 9 it creeps to ~1.5x across the whole act.
 */
export const PLATE_DEPTH = 9;

/**
 * Camera travel across the act, in scene depth units.
 *
 * Advance is linear in progress — constant forward velocity — so a plane's
 * apparent size grows as `1/(depth - z)`: slow while it is far off, then faster
 * and faster as it arrives, without bound once it reaches the camera. That
 * acceleration is the whole sensation of travelling forward.
 *
 * It has to stay linear. An advance that eases out — `1 - e^(-k·p)` and the like
 * — spends most of its travel in the first half of the act and then parks near
 * its limit: the near planes decelerate exactly when they should be rushing
 * past, and the far ones never arrive at all. That reads as heavy however much
 * scroll distance it is given, because the problem is the velocity, not the span.
 */
const TRAVEL = 3.06;

export interface IntroCamera {
  /** Scrub progress across the pinned act, 0-1. */
  progress: number;
  /** Camera advance into the scene, 0 → TRAVEL. */
  z: number;
  /** 0-1 mount fade — the scene lifts out of the flat sea once the SDF is ready. */
  entry: number;
  /** 0-1 opening of the mark itself: a dot at 0, the full monogram at 1. */
  reveal: number;
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function cameraAdvance(progress: number): number {
  return TRAVEL * clamp01(progress);
}

/** Monogram height, in scene units — the mark's size on screen at rest. */
export const APERTURE_UNITS = 44;

/**
 * Depth of the monogram plane — the nearest thing in the scene, so the mark
 * outruns every photograph behind it and the frame ends up inside a single
 * stroke rather than zoomed on a picture of the letter.
 *
 * Its ratio to TRAVEL is what sets the act's shape, because the plane reaches
 * the camera at exactly `depth / TRAVEL`. At 1.28 against a travel of 3.06 the
 * mark is off frame by p≈0.38 and past the camera by p≈0.42 — the same 40/60
 * split of mark to imagery the reference runs, and over the same ~100vh.
 */
export const APERTURE_DEPTH = 1.28;

/** Progress at which the monogram plane reaches the camera and is gone. */
export const APERTURE_PASS = APERTURE_DEPTH / TRAVEL;

/** Magnification of the monogram plane; 1 at rest. */
export function apertureMagnify(z: number): number {
  return planeScale(APERTURE_DEPTH, z) * APERTURE_DEPTH;
}

/**
 * Magnifications the sheet retires between.
 *
 * Late and narrow on purpose — the geometry is what gets rid of the sheet, not
 * this. Around 46x the mark's thickest stroke covers the frame corners, and
 * since the lens converges its sample on the middle of that stroke, every pixel
 * resolves to "inside the mark" and the quad goes transparent on its own. What
 * is on screen just before that is bright sky rushing outward — the walls of
 * the letter going past. Fading the sheet out any earlier than that instead
 * leaves a half-opaque wash of sea over the darkened interior, which greys the
 * whole frame at the exact moment it should be opening.
 *
 * Unlike the reference's mask — a real plane, which simply ends up behind the
 * camera — ours is a fullscreen quad, so it still needs telling to leave: past
 * the pass point there is no plane left to magnify and no reason to keep drawing.
 */
const SHEET_OUT_FROM = 34;
const SHEET_OUT_TO = 70;

/**
 * Opacity of the sea sheet as the mark blows past. Expressed against apparent
 * depth rather than magnification so it is linear in scroll: magnification is
 * already hyperbolic here, and fading linearly in it drops the sheet in the last
 * half percent of the window.
 */
export function sheetOpacity(z: number): number {
  const apparent = APERTURE_DEPTH - z;
  const from = APERTURE_DEPTH / SHEET_OUT_FROM;
  const to = APERTURE_DEPTH / SHEET_OUT_TO;
  return clamp01((apparent - to) / (from - to));
}

/** Apparent scale of the interior plate; 1 at rest. */
export function plateDrift(z: number): number {
  return planeScale(PLATE_DEPTH, z) * PLATE_DEPTH;
}

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
  /** Still: the photograph itself, or a video card's poster. */
  src: string;
  /** Empty for video cards — their one encode is already card-sized. */
  srcSet: string;
  /** Present only on video cards. */
  video?: { webm: string; mp4: string };
  aspect: number;
  /** World position; on-screen vmin is this divided by apparent depth. */
  x: number;
  y: number;
  depth: number;
  /** World width; divide by apparent depth for the on-screen vmin. */
  width: number;
  rotation: number;
}

// Hand-placed, and laid out by when each card arrives rather than by where it
// sits. World position and width are both divided by apparent depth on screen,
// so the numbers here are the *rest* frame multiplied by depth: a card's
// on-screen place and size at p=0 are `x/depth` and `width/depth` in vmin.
//
// Depths are spaced so cards reach the camera at an even cadence — one every
// ~9vh of scroll — from p≈0.40, just as the mark clears, through to the end of
// the act. Nothing arrives before that: while the mark is still opening the
// field only grows behind it, which is what keeps the letter the subject until
// it is gone.
//
// Two constraints shape the tail, both consequences of a forward push moving
// everything radially outward:
//
//   - Offset grows as `x/apparent`, faster than size does. A deep card more than
//     about 7vmin off centre at rest leaves the frame before it has finished
//     growing, so the last arrivals — the ones the act ends on — are placed
//     close to the middle. Depth, not distance, is what holds them in reserve.
//   - The deepest three never reach the camera, so they are still opening out
//     when the bloom lands. Nothing in the field is ever parked.
type Placement = [slug: string, x: number, y: number, depth: number, width: number, rotation: number];

const LAYOUT: Placement[] = [
  ["temple-gate", 24.6, -18.1, 1.53, 15.6, -4],
  ["arva-sunset-bonsai", 35.3, 27.4, 1.75, 15.7, -3],
  ["terrace-lunch-sea", 47.3, -6.6, 1.97, 25, -2],
  ["forest-steps-kimono", 10.6, -43.5, 2.19, 19.8, -3],
  ["suite-lounge-sky", -65.3, -42.7, 2.41, 50.2, 3],
  ["mori-suite-lantern", -16.1, 60, 2.63, 43.8, 4],
  ["waterfall-cliff", 51.2, -53.5, 2.74, 49, -3],
  ["timber-bedroom", -64.8, 10.8, 2.85, 49.6, -4],
  ["library-lounge", 22.9, 60.5, 2.94, 45.9, -2],
  ["steam-bath-window", -32.2, -58.4, 3.02, 42.3, -3],
  ["resort-walkway", 65.7, -11.6, 3.09, 48.3, 2],
  ["round-window-ikebana", -64.9, 40.8, 3.15, 44.5, -4],
  // The finale. Everything above has swept past by the time these fill out.
  ["lobby-light-hall", -30.4, -19.2, 3.2, 38.4, -3],
  ["calligraphy-hand", 30.7, 14.4, 3.25, 36.1, 4],
  ["spa-hall-arch", -16.5, 21.4, 3.29, 36.2, 3],
  ["kyoto-suite-living", 19.9, -23.2, 3.32, 34.9, -2],
  ["amanemu-lake-aerial", -23.5, -5, 3.35, 33.5, 2],
  ["pool-pavilion", 10.1, 27, 3.38, 32.1, -4],
  ["sunset-hills", 1.7, -8.6, 3.42, 30.8, 3],
];

// The moving cards, spread down the near and middle depths rather than
// clustered, so something is always alive inside the mark: the first is close
// enough to sweep past as the opening blows out, the last is far enough back to
// still be arriving well after it has gone.
const VIDEO_LAYOUT: Placement[] = [
  ["colonnade-walk", -19.4, 9, 1.42, 16.8, 3],
  ["arch-garden", -40.3, -24.7, 1.64, 23.4, 2],
  ["pool-teal", -13.1, 39.3, 1.86, 19.6, 4],
  ["hammam-hands", -51.3, 18.4, 2.08, 26.3, 3],
  ["terracotta-corridor", -29.1, -2.6, 2.3, 21.2, 2],
  ["atlas-ridge", 69.6, 45.6, 2.52, 57.6, -2],
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

const STILL_CARDS: IntroCard[] = LAYOUT.flatMap(
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

const VIDEO_CARDS: IntroCard[] = VIDEO_LAYOUT.flatMap(
  ([slug, x, y, depth, width, rotation]) => {
    const tile = introVideoBySlug.get(slug);
    if (!tile) return [];
    return [{
      src: `${INTRO_VIDEO_BASE}/${slug}.webp`,
      srcSet: "",
      video: {
        webm: `${INTRO_VIDEO_BASE}/${slug}.webm`,
        mp4: `${INTRO_VIDEO_BASE}/${slug}.mp4`,
      },
      aspect: tile.width / tile.height,
      x, y, depth, width, rotation,
    }];
  },
);

// Sorted so the DOM order matches the depth order the stacking context wants.
export const INTRO_CARDS: IntroCard[] = [...STILL_CARDS, ...VIDEO_CARDS].sort(
  (a, b) => b.depth - a.depth,
);

/**
 * The plate the whole scene sits in front of — what fills the mark before the
 * first cards arrive.
 *
 * An interior, and specifically one with no sky in it. The act used to open on
 * ivory, so a coastal aerial read as a window; against the sea backdrop the
 * same photograph puts its own sky inside the letter, a few shades off the sky
 * outside it, and the strokes stop reading as an opening at all — worst in the
 * caps, which are narrow enough to sit entirely inside the outline's spill.
 * Warm columns at dusk give the opening something to be a window onto, and go
 * on doing it as the interior sinks toward black.
 */
export const PLATE_IMAGE = bySlug.get("lounge-columns-dusk") ?? FIELD[0];

/**
 * Cards fade as they outgrow the frame, so nothing ever slams the viewport shut.
 *
 * `coverage` is how many frames wide the card is on its *narrower* axis — the
 * point at which it would black the viewport out if it were centred. Keyed to
 * that rather than to apparent depth because a card that reaches the camera
 * grows without bound: with the camera crossing three depth units the cards
 * arrive at very different world widths, and one depth threshold either lets the
 * wide ones swallow the frame or retires the narrow ones while they are still
 * small enough to be worth looking at.
 *
 * The window is deliberately short — a slow fade leaves several cards part-
 * transparent at once, which reads as a stack of ghosts rather than depth.
 */
const COVER_FULL = 1;
const COVER_GONE = 1.7;

export function cardOpacity(coverage: number): number {
  return clamp01((COVER_GONE - coverage) / (COVER_GONE - COVER_FULL));
}

/**
 * Aerial perspective: distant planes sit back into the dark and lift as they
 * approach. Doing this on *apparent* depth rather than world depth means a card
 * brightens as the camera closes on it, which is most of the sense of travel.
 *
 * Deep enough to read as haze rather than as a dim exposure: the far tier sits
 * at a quarter brightness, so those cards emerge from the dark instead of merely
 * sharpening, which is what carries the depth of the field now that the camera
 * actually crosses it. Not lower than that — past about a fifth they stop
 * reading as photographs held back in the dark and start reading as absent.
 */
const FOG_NEAR = 0.8;
const FOG_FAR = 3.4;
const FOG_FLOOR = 0.27;

export function cardLuminance(apparent: number): number {
  const lift = 1 - clamp01((apparent - FOG_NEAR) / (FOG_FAR - FOG_NEAR));
  return FOG_FLOOR + (1 - FOG_FLOOR) * lift;
}
