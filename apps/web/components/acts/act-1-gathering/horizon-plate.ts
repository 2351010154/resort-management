// The sea the monogram stands in — Act 1's backdrop, and the reason the act no
// longer opens on the same ivory the page ends on.
//
// Both foreground paths need it and both need it placed identically: the WebGL
// lens samples it as a texture, the flat canvas sheet draws it with the mark
// punched out. So the media and the arithmetic that positions it live here
// rather than in either of them.

import { FOCUS_Y } from "@/lib/monogram-glyph";

/**
 * Where the waterline sits in the encode, as a fraction of its height. The
 * encode is cropped to put it here on purpose — see the crop note in
 * scripts/encode-intro-horizon.mjs.
 */
const SOURCE_HORIZON = 0.6198;

/**
 * Where the waterline crosses the mark, as a fraction of the mark's height.
 *
 * Past 1 the letter would float above the sea; at 0.88 it stands in it, with
 * the last eighth of every stroke under water — which is what puts a waterline
 * across the mark rather than behind it, and what gives the reflection
 * something to start from.
 */
export const HORIZON_AT = 0.88;

export const HORIZON_POSTER = "/video/horizon/sea-poster.webp";

/**
 * Screen y of the waterline, in CSS px. The mark is centred on its focus point
 * rather than on its box (see FOCUS_Y), so the waterline's offset from the
 * middle of the frame is the distance between the two, not HORIZON_AT itself.
 */
export function horizonScreenY(viewHeight: number, markHeight: number): number {
  return viewHeight / 2 + (HORIZON_AT - FOCUS_Y) * markHeight;
}

/**
 * Encoded tiers. The backdrop is soft sky and flat water with no fine detail,
 * so the mobile tier can be genuinely small; picking by viewport rather than by
 * DPR is deliberate, since upscaling this content costs nothing visible.
 */
const TIERS = [
  { width: 900, upTo: 900 },
  { width: 1760, upTo: Infinity },
];

export function horizonSources(viewWidth: number): { webm: string; mp4: string } {
  const tier = TIERS.find((t) => viewWidth <= t.upTo) ?? TIERS[TIERS.length - 1];
  return {
    webm: `/video/horizon/sea-${tier.width}.webm`,
    mp4: `/video/horizon/sea-${tier.width}.mp4`,
  };
}

export interface HorizonPlacement {
  /** Cover-fit box, in CSS px, top-left origin. */
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Fits the backdrop and slides it so its waterline lands where the mark needs
 * it — cover fit is the floor, not the answer.
 *
 * Cover alone centres the frame and leaves the horizon wherever the viewport
 * aspect happens to put it, and no offset can move it further than the slack
 * cover leaves. So the fit is grown until there *is* slack: the frame has to be
 * tall enough that SOURCE_HORIZON of it reaches down to the waterline, and that
 * what remains below reaches the bottom of the viewport. Whichever of those two
 * demands is larger sets the height, and the crop is cut so that on a laptop
 * screen neither exceeds plain cover.
 */
export function horizonPlacement(
  viewWidth: number,
  viewHeight: number,
  texWidth: number,
  texHeight: number,
  horizonY: number,
): HorizonPlacement {
  const needed = Math.max(
    horizonY / SOURCE_HORIZON,
    (viewHeight - horizonY) / (1 - SOURCE_HORIZON),
  );
  const scale = Math.max(viewWidth / texWidth, viewHeight / texHeight, needed / texHeight);
  const width = texWidth * scale;
  const height = texHeight * scale;
  const top = Math.min(0, Math.max(viewHeight - height, horizonY - SOURCE_HORIZON * height));
  return { left: (viewWidth - width) / 2, top, width, height };
}
