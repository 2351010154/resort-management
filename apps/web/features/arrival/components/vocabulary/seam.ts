// A photograph turning over into another one, under the reader's hand.
//
// The device is a seam: the incoming picture is uncovered by an edge that
// crosses the tile, and the two pictures behind that edge travel at different
// rates — the one arriving follows the seam in a little slower than the seam
// itself, the one leaving drifts back behind it. The two rates are the whole
// depth of the move; the tile never scales. Nothing here runs on a clock:
// the seam is placed on a scrubbed timeline the caller owns, so scrolling
// down draws it and scrolling back up undraws it.
//
// Lifted out of Act 2's chapter system, which is where it was written, so that
// a tile anywhere on the page can turn over the same way.

import type gsap from "gsap";

/**
 * Which way a seam travels. Physical, not logical: `clip-path: inset()` is
 * measured against the box's physical edges and is not mirrored by
 * `direction: rtl`, so "rightward" means rightward on every panel.
 */
export type Seam = "down" | "up" | "rightward" | "leftward";

/**
 * Per seam: the clip the incoming layer starts fully hidden behind, the axis
 * the photographs travel on, and the sign of that travel. The sign is negative
 * when the seam sweeps along the positive axis and positive when it sweeps
 * back, so the incoming photograph always follows the seam and the outgoing
 * one always drifts against it.
 */
export const SEAM: Record<
  Seam,
  { from: string; axis: "xPercent" | "yPercent"; sign: number }
> = {
  down: { from: "inset(0% 0% 100% 0%)", axis: "yPercent", sign: -1 },
  up: { from: "inset(100% 0% 0% 0%)", axis: "yPercent", sign: 1 },
  rightward: { from: "inset(0% 100% 0% 0%)", axis: "xPercent", sign: -1 },
  leftward: { from: "inset(0% 0% 0% 100%)", axis: "xPercent", sign: 1 },
};

/**
 * Travel of the two photographs behind a seam, in % of the tile's own size,
 * measured off the reference capture: the incoming one arrives a little slower
 * than the seam that uncovers it, and the outgoing one drifts back behind.
 */
export const SEAM_ENTER = 90;
export const SEAM_EXIT = 10;

/**
 * The seam's curve, and the reason it is this one rather than the obvious one.
 *
 * A seam should leave and arrive rather than switch on and off, so it wants an
 * `inOut`. But an `inOut` does not slow an edge down — it redistributes it, and
 * what it takes off the two ends it puts in the middle, which is the only part
 * of the sweep anyone is looking at. `power1.inOut` is quadratic, so its
 * velocity peaks at twice the average: it makes a seam read *faster* than the
 * linear one it replaced over the same distance. `sine.inOut` peaks at pi/2 —
 * about 1.57 — which is the mildest in-out there is. What actually buys a slow
 * seam is distance, and that is the caller's `duration`.
 */
export const SEAM_EASE = "sine.inOut";

/**
 * The lag a scrubbed seam follows the scroll through, in seconds.
 *
 * A seam pinned to the wheel exactly steps once per notch and stops dead
 * between them. Following the scroll instead of tracking it, it glides and
 * comes to rest a beat after the reader does. Longer than `SCRUB_DRIFT`
 * because a seam is the one thing on the wall the reader is watching cross.
 */
export const SEAM_SCRUB = 0.8;

export interface SeamTile {
  /** The layer that is uncovered. It carries the clip; its `img` travels. */
  incoming: HTMLElement;
  /** The layer being covered. Only its `img` moves. */
  outgoing: HTMLElement;
  seam: Seam;
}

/**
 * Place one seam on a timeline: the clip that uncovers the incoming layer and
 * the two travels behind it, all three on one curve and one duration — they
 * are one edge, and any difference between their rates shows up as the seam
 * sliding off the pictures it is cutting between. `at` and `duration` are in
 * the timeline's own units, which for a scrubbed timeline is scroll.
 */
export function addSeam(
  timeline: gsap.core.Timeline,
  { incoming, outgoing, seam }: SeamTile,
  at: number,
  duration: number,
): void {
  const { from, axis, sign } = SEAM[seam];
  const arriving = incoming.querySelector("img");
  const leaving = outgoing.querySelector("img");
  timeline
    .fromTo(
      incoming,
      { clipPath: from },
      { clipPath: "inset(0% 0% 0% 0%)", duration, ease: SEAM_EASE },
      at,
    )
    .fromTo(
      arriving,
      { [axis]: sign * SEAM_ENTER },
      { [axis]: 0, duration, ease: SEAM_EASE },
      at,
    )
    .fromTo(
      leaving,
      { [axis]: 0 },
      { [axis]: sign * SEAM_EXIT, duration, ease: SEAM_EASE },
      at,
    );
}
