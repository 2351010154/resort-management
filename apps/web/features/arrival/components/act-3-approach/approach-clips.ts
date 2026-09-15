// The four passages Act 3 can play, and the labels that switch between them.
//
// Each one is a short cut from a different master reel, slowed and encoded
// outside the repository — the source ranges are not carried here. This file
// only says what the page offers and in what order.
//
// Order is the argument the column makes, so it is not alphabetical and not the
// order the masters happen to sit in: dawn, then the arrival itself, then the
// last of the light, then the night. Read top to bottom it is one day at the
// house, which is what earns four labels the reader can move between rather
// than four clips that merely differ.
//
// `arrival` is first-loaded rather than first-listed. It is the passage the act
// was built around — the same warm approach the single loop used to play — so
// it is what the reader sees before touching anything, while the column still
// reads as a day in order.

export interface ApproachClip {
  /** Stable id; also the asset basename under /video/approach/. */
  readonly id: string;
  /** The label in the column. Set in caps by the stylesheet, not here. */
  readonly label: string;
  /** Read by screen readers in place of the bare label. */
  readonly description: string;
}

export const APPROACH_CLIPS: readonly ApproachClip[] = [
  {
    id: "first-light",
    label: "First light",
    description: "The house at dawn, in mist",
  },
  {
    id: "arrival",
    label: "Arrival",
    description: "The corridor, and the water beyond it",
  },
  {
    id: "last-light",
    label: "Last light",
    description: "The pavilion against a gold sea",
  },
  {
    id: "nocturne",
    label: "Nocturne",
    description: "The colonnade after dark",
  },
];

/** Where the act opens. See the note above on why this is not index 0. */
export const DEFAULT_CLIP_INDEX = APPROACH_CLIPS.findIndex(
  (clip) => clip.id === "arrival",
);

export function clipSource(clip: ApproachClip, format: "webm" | "mp4") {
  return `/video/approach/${clip.id}.${format}`;
}

export function clipPoster(clip: ApproachClip) {
  return `/video/approach/${clip.id}-poster.webp`;
}
