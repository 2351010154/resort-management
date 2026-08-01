// The funnel's motion, expressed once, in Motion's vocabulary.
//
// `lib/motion-tokens.ts` is still the single source: every number below is
// imported from it, and the one thing this file adds is the *cubic-bezier
// control points* for the two curves that previously existed only as a CSS
// string and a GSAP name. Motion takes an ease as four numbers, so a third
// spelling of each curve was unavoidable — the point of putting it here is that
// it is derived beside its own source and asserted against it in a test, rather
// than typed out at each call site where nothing would catch a drifting digit.
//
// Why Motion is in the funnel at all, when `design-foundations.md` §5 used to
// say CSS only: the funnel needs elements to animate *out*. A bottom sheet that
// enters on an ease-out and leaves on the same curve spends its last frames
// crawling, which reads as a snag exactly when the guest has finished with it —
// `motion-tokens.ts` documents that and named `EASE_UI_EXIT` for it, then noted
// it was GSAP-only, "nothing exits under CSS yet". Nothing could: CSS has no
// exit. The choice was a snagging close or keeping a dismissed sheet mounted.
//
// The `three` / `gsap` / `lenis` budget is untouched. Motion is not on that
// list, `tech-stack.md` already names it as this repo's motion budget, and it
// ships no WebGL, no scroll hijacking and no plugin registry.

import {
  DUR_UI,
  EASE_SCENE_CSS,
  EASE_UI_CSS,
  STAGGER_CASCADE,
} from "@/lib/motion-tokens";

/**
 * Control points for a `cubic-bezier(a, b, c, d)` string.
 *
 * Parsed rather than re-typed, so `EASE_UI_CSS` stays the one hand-written
 * curve in the repository — which is the invariant `design-foundations.md` §5
 * leans on, and it survives a third consumer only if that consumer reads it.
 */
function bezierPoints(css: string): [number, number, number, number] {
  const points = css
    .slice(css.indexOf("(") + 1, css.lastIndexOf(")"))
    .split(",")
    .map((part) => Number.parseFloat(part));

  if (points.length !== 4 || points.some(Number.isNaN)) {
    throw new Error(`not a cubic-bezier: ${css}`);
  }

  return [points[0], points[1], points[2], points[3]];
}

/** `EASE_UI` as Motion takes it. The curve every entrance here rides. */
export const EASE_UI_POINTS = bezierPoints(EASE_UI_CSS);

/** `EASE_SCENE` as Motion takes it. Unused in the funnel; exported for parity. */
export const EASE_SCENE_POINTS = bezierPoints(EASE_SCENE_CSS);

/**
 * `EASE_UI_EXIT` — `power2.in`, the accelerate-away counterpart.
 *
 * GSAP names it; CSS could not use it; these are the same curve's points. GSAP's
 * `power2.in` is `t³`, whose Bézier form is (0.32, 0, 0.67, 0) — the standard
 * `ease-in-cubic` handles. This is the one curve in the funnel that is not a
 * `var(--ease-*)`, because there is no CSS declaration for it to be.
 */
export const EASE_UI_EXIT_POINTS = [0.32, 0, 0.67, 0] as const;

/** A shorter exit than entrance: leaving should not be dwelt on. */
const DUR_UI_EXIT = 0.4;

/**
 * The gap between one step's composition and the next.
 *
 * Short on purpose, and the shortest duration in this file. The step swap is not
 * a transition between two states of one screen — the two steps have no frame in
 * common, and `booking-screen.tsx` argues at length that dissolving one page into
 * a different page pretends they are one composition. What this buys instead is
 * that the outgoing step is *gone* before the incoming one starts, so the eye is
 * handed the ground for a moment rather than a jump cut. Long enough not to be a
 * cut, short enough that nobody waits for it.
 */
const DUR_STEP_EXIT = 0.18;

/**
 * A room replacing another on the two plates at the foot of the room step.
 *
 * Faster than `enter`/`leave`, because these run under `mode="wait"` — the
 * outgoing plate has to be gone before the incoming one mounts, so the guest
 * waits for the sum rather than the longer of the two. 0.15 + 0.3 lands at 0.45,
 * which is inside the 0.5 the photograph behind them takes to dissolve: the
 * reading settles as the room finishes arriving, rather than after it.
 */
const DUR_SWAP_OUT = 0.15;
const DUR_SWAP_IN = 0.3;

const enter = { duration: DUR_UI, ease: EASE_UI_POINTS } as const;
const leave = { duration: DUR_UI_EXIT, ease: EASE_UI_EXIT_POINTS } as const;
const stepLeave = {
  duration: DUR_STEP_EXIT,
  ease: EASE_UI_EXIT_POINTS,
} as const;

/**
 * A full-height sheet, entering from the bottom edge.
 *
 * `transform` only — a sheet that animates its height re-lays-out its own
 * contents on every frame, and `login-screen.module.css` already established
 * that a funnel control must keep its size and its focus behaviour throughout.
 */
export const sheetMotion = {
  initial: { y: "100%" },
  animate: { y: "0%", transition: enter },
  exit: { y: "100%", transition: leave },
} as const;

/** The scrim behind it. Opacity only, so it never captures a frame's layout. */
export const scrimMotion = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: enter },
  exit: { opacity: 0, transition: leave },
} as const;

/**
 * One photograph of a room replacing another on the stage.
 *
 * **Opacity alone, and nothing else may be added to it.** A frame that slides is
 * a slideshow, and a slideshow of a hotel room is marketing; a frame that
 * dissolves is the same room, looked at again. Both frames are in the layer for
 * the length of the cross-fade — the outgoing one leaves on the same duration
 * the incoming one arrives on, rather than the shorter exit the sheets take,
 * because a dissolve where one side moves faster than the other shows the ground
 * through the middle of it.
 */
export const frameMotion = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: enter },
  exit: { opacity: 0, transition: enter },
} as const;

/**
 * The room list, on first paint and on every re-quote.
 *
 * Five cards at `STAGGER_CASCADE` caps the cascade at 0.4s of delay, which is
 * why the list does not need a "don't animate after the first time" flag: it is
 * over before it can annoy anyone re-pricing a plan.
 */
export const cardListMotion = {
  animate: { transition: { staggerChildren: STAGGER_CASCADE } },
} as const;

export const cardMotion = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: enter },
} as const;

/**
 * The room sheet's wide presentation — a centred dialog over a scrim.
 *
 * Opacity and a short rise, not the full-height translate the narrow sheet
 * takes: a panel in the middle of the page has no edge to come from.
 */
export const dialogMotion = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: enter },
  exit: { opacity: 0, y: 12, transition: leave },
} as const;

/**
 * One of the screen's two views, replacing the other.
 *
 * The inactive view is *unmounted*, not hidden — which is how "one open decision
 * at a time" is guaranteed by the tree rather than by CSS discipline. Unmounting
 * is also why this variant exists at all: the outgoing view has to be able to
 * leave, and CSS has no exit.
 *
 * It leaves on opacity alone and arrives on opacity plus a short rise. A view
 * that slid out as well as in would read as navigation, and changing a date is
 * refining one search rather than going somewhere.
 */
export const viewMotion = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: enter },
  exit: { opacity: 0, transition: leave },
} as const;

/**
 * One whole step of the funnel replacing the other.
 *
 * **Opacity only, and no travel at all on this element.** The step is not a view
 * inside a frame — it is the bar, the photograph, the plates and the foot, the
 * entire window — and a composition that size sliding anywhere is the page
 * transition `booking-screen.tsx` refuses. What it does instead is leave: the
 * outgoing step fades to the screen's own ground over `DUR_STEP_EXIT`, and under
 * `mode="wait"` it is unmounted before the next one is built. The guest gets a
 * beat of ivory rather than a jump.
 *
 * The arrival is carried by the plates below, not here — `plateMotion`, which
 * this staggers. `delayChildren` is deliberately zero: the fade out has already
 * happened by the time this runs, so a further wait before anything appears
 * would be dead air the guest reads as slowness.
 */
export const stepMotion = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: { ...enter, staggerChildren: STAGGER_CASCADE },
  },
  exit: { opacity: 0, transition: stepLeave },
} as const;

/**
 * One plate of an arriving step, rising into place.
 *
 * The 8px is the same rise `viewMotion` uses and it is the only travel in the
 * step swap: the plates are what the guest reads, so they are what arrives, and
 * the photograph behind them is simply already there. Staggered by their parent
 * so the column and the room's price do not land on the same frame — two plates
 * appearing together read as one box, and they are not one box.
 *
 * **Transform only, and the omission of opacity is load-bearing.** Two reasons,
 * either of which alone would be enough:
 *
 * - The plates are already fading, because `stepMotion` fades the whole step
 *   they are in. Fading them again inside a fading parent multiplies the two
 *   curves, and what that draws is a plate that stays muddy for most of its
 *   arrival and then arrives all at once at the end.
 * - `booking-screen.module.css` lifts these same two plates off the photograph
 *   when the guest reaches for the gallery — the "peek" — and it does it with
 *   `opacity` in a stylesheet. Motion writes what it animates to the element's
 *   *inline* style, which beats a class rule outright. An opacity here would
 *   leave `opacity: 1` on the element for good and the peek would silently stop
 *   working, with nothing failing anywhere to say so.
 */
export const plateMotion = {
  initial: { y: 8 },
  animate: { y: 0, transition: enter },
} as const;

/**
 * `plateMotion` at rest, for `useReducedMotion`.
 *
 * Not `stillMotion`, for the second reason above: that variant asserts an
 * opacity, and asserting one on these two elements is exactly what breaks the
 * peek. A guest who has asked for less motion has not asked for the plates to
 * stop getting out of the way of the photograph.
 */
export const stillPlateMotion = {
  initial: { y: 0 },
  animate: { y: 0, transition: { duration: 0 } },
} as const;

/**
 * The room's plates, when the guest picks a different room.
 *
 * **This exists because the loudest change on the step used to have no motion
 * in it at all.** Picking a room re-pointed the photograph, the name, the two
 * sentences, the four facts and the total — the whole window — and every one of
 * them cut in the same frame while the list they were picked from faded. The
 * ground dissolves now (`frameMotion`, and see `room-ground.tsx` for why it
 * stopped remounting), and this is its counterpart on the reading.
 *
 * No travel: the plates stay exactly where they are and their contents are
 * replaced. A plate that slid would say the guest had gone somewhere, and they
 * have not — they are looking at the same corner of the same screen, at a
 * different room.
 */
export const roomSwapMotion = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: { duration: DUR_SWAP_IN, ease: EASE_UI_POINTS },
  },
  exit: {
    opacity: 0,
    transition: { duration: DUR_SWAP_OUT, ease: EASE_UI_EXIT_POINTS },
  },
} as const;

/**
 * Every variant above with its movement removed, for `useReducedMotion`.
 *
 * §9's rule, which the arrival learned the hard way: a reduced-motion path is a
 * composition in its own right, not a frozen frame of the animated one. The
 * global kill-switch in `globals.css` cuts CSS durations to 0.01ms — under
 * Motion that is not even in play, so the sheet would otherwise still translate
 * a full viewport height in half a second. Here it is simply *there*, at rest,
 * and only opacity carries the arrival.
 */
export const stillMotion = {
  initial: { opacity: 1 },
  animate: { opacity: 1, transition: { duration: 0 } },
  exit: { opacity: 1, transition: { duration: 0 } },
} as const;
