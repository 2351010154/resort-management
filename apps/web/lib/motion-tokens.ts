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

/** Podium measured 0.08; lowered to 0.06 at M1 — user asked for more glide. */
export const LENIS_LERP = 0.06;
/** Measured range 0.8–1; bottom of range per M1 heavier-feel call. */
export const LENIS_WHEEL_MULTIPLIER = 0.8;
