// What Act 1 is made of: one photograph and two bougainvillea loops.
//
// Hand-written rather than read out of `image-manifest.ts`, which carries the
// note "GENERATED ... do not edit by hand" at its top. Its cutter reads a source
// library outside the repository and is itself gitignored, so an entry added
// there by hand is an entry the next run silently drops. These three assets were
// cut once, by the commands recorded in `docs/architecture/arrival-opening.md`,
// and they are the only images in the arrival that no manifest owns — so they
// are declared here, next to the act that is their only consumer.

/** Shape `tierSrcSet` needs: the largest cut, and the widths that exist. */
export interface HeroPlate {
  src: string;
  width: number;
  height: number;
  tiers: number[];
  alt: string;
}

/**
 * The photograph the whole act is one view of.
 *
 * An extended view of the original terrace gives the opening more garden and
 * pool around the architecture. Both this act and the ribbon use this plate
 * so their shared photograph stays in register through the transition.
 */
export const HERO_PLATE: HeroPlate = {
  src: "/images/act-1-arrival/terrace-canopy-wide-1672.webp",
  width: 1672,
  height: 941,
  tiers: [1672, 1280, 640],
  alt: "A terrace under a flowering canopy, with lounge seating, open glass doors and a lawn running down to the pool edge",
};

export interface FlowerLoop {
  /** Base path; `.webm` is the loop, `.webp` the poster under it. */
  base: string;
}

/**
 * The two bougainvillea branches, as VP9 loops with a real alpha channel.
 *
 * Safari decodes neither VP9 alpha nor the HEVC-with-alpha `.mov` the source
 * material also ships — that encode needs VideoToolbox, which is macOS only, so
 * this repository cannot cut one. Safari therefore holds the poster, which is a
 * frame of the same branch with the same alpha. The branch is still there and
 * still overlaps the frame; it simply does not move in the wind.
 */
export const FLOWER_LEFT: FlowerLoop = {
  base: "/video/arrival-botanical/bougainvillea-01",
};

export const FLOWER_RIGHT: FlowerLoop = {
  base: "/video/arrival-botanical/bougainvillea-07",
};
