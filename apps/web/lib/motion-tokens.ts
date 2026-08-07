// Measured motion spec (brainstorm notes 2026-07-24) — single source for every
// ease/duration/stagger. No magic numbers in components.
//
// This file is also where the `--ease-*` custom properties come from. They used
// to be typed out a second time in globals.css and kept level by a comment,
// which is a synchronisation anyone can lose: the CSS curve and the GSAP curve
// have to be the same curve, or a card that fades under CSS and a card that
// fades under a tween stop agreeing. `motionTokensCss()` below emits them, and
// the root layout puts that in the document head — so a cubic-bezier is written
// by hand exactly once, here.

/** Scene transitions: podium/floema signature expo-out. */
export const EASE_SCENE = "expo.out";
export const EASE_SCENE_CSS = "cubic-bezier(0.19, 1, 0.22, 1)";

/** UI micro-interactions: wolverine power2-out. */
export const EASE_UI = "power2.out";
export const EASE_UI_CSS = "cubic-bezier(0.23, 1, 0.32, 1)";

/**
 * The same micro-interaction leaving. An ease-out exit spends its last frames
 * crawling the final few pixels, which on a collapsing panel reads as a snag
 * right at the end; accelerating away instead lets it commit and be gone.
 * GSAP only — nothing exits under CSS yet.
 */
export const EASE_UI_EXIT = "power2.in";

/** The custom properties stylesheets read, and the GSAP string each mirrors. */
export const EASE_CUSTOM_PROPERTIES = {
  "--ease-scene": EASE_SCENE_CSS,
  "--ease-ui": EASE_UI_CSS,
} as const;

/**
 * The `:root` block carrying the eases, for the root layout to inline.
 *
 * Inlined rather than written to a .css file by a script: a generated file in
 * the tree can be edited, can go stale against its generator, and needs a CI
 * check of its own to prove it has not. A string built at render time cannot
 * drift from the constants it is built from.
 */
export function motionTokensCss(): string {
  const declarations = Object.entries(EASE_CUSTOM_PROPERTIES)
    .map(([name, value]) => `${name}:${value}`)
    .join(";");
  return `:root{${declarations}}`;
}

/** Scene transition duration, seconds (measured range 1.2–1.6). */
export const DUR_SCENE = 1.4;
/** Izanami cinematic moves for large media (measured 2–3s). */
export const DUR_SCENE_SLOW = 2.4;
/** UI micro duration, seconds (measured range 0.4–0.6). */
export const DUR_UI = 0.5;
/** Menu/card cascade stagger, seconds. */
export const STAGGER_CASCADE = 0.1;

/**
 * Lenis turns `lerp` into `damp(from, to, lerp * 60, dt)`, so the figure is a
 * rate: the page closes `lerp * 60` of the remaining gap per second, and its
 * time constant is `1 / (lerp * 60)`.
 *
 * 0.06 is a 280ms constant — most of a second to finish one notch of the wheel.
 * That is past glide and into lag: the page is still arriving somewhere you
 * asked for four notches ago, so nothing on it reads as answering the hand. At
 * 0.1 the constant is 170ms, which still coasts visibly — a notch lands over
 * about ten frames rather than snapping — but the first frame of the answer is
 * already moving, which is the whole of "I am scrolling this".
 */
export const LENIS_LERP = 0.1;
/**
 * Full travel per notch. Held at 0.8, a wheel notch bought four fifths of what
 * the same notch buys on every other page the reader has ever used, and the
 * deficit compounds across a ride this long — the heaviness people describe as
 * "slow" is mostly this, not the lerp. Weight now comes entirely from the
 * coast, which is where it belongs: how the page stops, not how far it goes.
 */
export const LENIS_WHEEL_MULTIPLIER = 1;

/**
 * How much the page weighs under the wheel. One setting for the whole ride was
 * the problem: the glide that makes a pinned cascade read as a camera move is
 * the same glide a reader has to fight through three stacked panels of type,
 * where nothing moves but the words they are already reading.
 *
 * Two numbers, because they are the two halves of "heavy" and neither alone is
 * it: `wheelMultiplier` is how far one notch of the wheel carries, `lerp` is how
 * long the page takes to stop once it has. Cinematic spends both — a short
 * throw that keeps drifting. Light gives the notch its full travel and settles
 * inside a couple of frames, which is what a screen you read rather than watch
 * wants.
 */
export interface ScrollWeight {
  lerp: number;
  wheelMultiplier: number;
}

/** The set pieces, and the default for anything that does not say otherwise:
 *  the measured M1 feel, unchanged. */
export const SCROLL_WEIGHT_CINEMATIC: ScrollWeight = {
  lerp: LENIS_LERP,
  wheelMultiplier: LENIS_WHEEL_MULTIPLIER,
};

/** Reading screens: the same travel per notch, and the coast cut to about
 *  60ms — enough to take the step out of a wheel notch and no more. Still
 *  smoothed; this is not native scroll, it is the same instrument played
 *  quietly. */
export const SCROLL_WEIGHT_LIGHT: ScrollWeight = {
  lerp: 0.17,
  wheelMultiplier: 1,
};

export const SCROLL_WEIGHTS = {
  cinematic: SCROLL_WEIGHT_CINEMATIC,
  light: SCROLL_WEIGHT_LIGHT,
} as const;

export type ScrollWeightName = keyof typeof SCROLL_WEIGHTS;
