// Tier helpers for the generated image manifest. Every asset ships as 1-3
// width tiers (see scripts/prepare-arrival-images.mjs); `src` points at the
// largest, so picking a tier is a filename swap.

import type { ArrivalImage } from "./arrival-image-manifest";

export function tierSrc(src: string, width: number): string {
  return src.replace(/-\d+\.webp$/, `-${width}.webp`);
}

/** Full `srcset` so the browser picks by layout width and pixel density. */
export function tierSrcSet(image: Pick<ArrivalImage, "src" | "tiers">): string {
  return [...image.tiers]
    .sort((a, b) => a - b)
    .map((w) => `${tierSrc(image.src, w)} ${w}w`)
    .join(", ");
}
