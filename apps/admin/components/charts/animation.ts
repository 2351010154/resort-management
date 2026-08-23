/* Entrance motion for the charts, neutralised at its source.
 *
 * **These figures were 1100 ms and are zero, and that is a Mariva edit to
 * vendored source rather than a setting.** `NFR-04` asks an admin console for
 * interaction feedback under 150 ms and *no entrance animation on operational
 * screens*, and `design-foundations.md` §5 says the same thing in words: a
 * report a manager opens twice a day should be readable the moment it paints,
 * not a second later. The upstream components are animation-forward and every
 * one of them reads its default from here, so zeroing it here is what makes the
 * requirement true of any chart anybody adds later — a prop passed at each call
 * site would be a promise every new chart has to remember to keep.
 *
 * The easing constants stay because the type wants them and because nothing is
 * eased over zero seconds. Hover and tooltip motion is *interaction* rather than
 * entrance, is not governed by this file, and is deliberately kept.
 */

import type { Transition } from "motion/react";

/** Default clip-reveal easing for cartesian charts. Unused while the duration
 *  below is zero, and kept because it is part of the vendored surface. */
export const DEFAULT_ANIMATION_EASING = "cubic-bezier(0.85, 0, 0.15, 1)";

/** No entrance reveal — `NFR-04`. */
export const DEFAULT_ANIMATION_DURATION_MS = 0;

/** Default enter transition. Zero-duration, so a chart is drawn in the state it
 *  is going to be in. */
export const DEFAULT_CHART_ENTER_TRANSITION: Transition = {
  type: "tween",
  duration: 0,
  ease: [0.85, 0, 0.15, 1],
};

/**
 * Clip-path width reveal must use tween — spring does not reliably animate SVG width.
 */
export function clipRevealTransition(enterTransition?: Transition): Transition {
  if (enterTransition?.type === "tween") {
    return {
      ...enterTransition,
      ease: enterTransition.ease ?? DEFAULT_CHART_ENTER_TRANSITION.ease,
    };
  }

  const duration =
    typeof enterTransition?.duration === "number"
      ? enterTransition.duration
      : DEFAULT_ANIMATION_DURATION_MS / 1000;

  return {
    type: "tween",
    duration,
    ease: DEFAULT_CHART_ENTER_TRANSITION.ease,
  };
}
