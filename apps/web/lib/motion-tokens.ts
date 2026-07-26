// Measured motion spec (brainstorm notes 2026-07-24) — single source for every
// ease/duration/stagger. No magic numbers in components.

/** Scene transitions: podium/floema signature expo-out. */
export const EASE_SCENE = "expo.out";
export const EASE_SCENE_CSS = "cubic-bezier(0.19, 1, 0.22, 1)";

/** UI micro-interactions: wolverine power2-out. */
export const EASE_UI = "power2.out";
export const EASE_UI_CSS = "cubic-bezier(0.23, 1, 0.32, 1)";

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
