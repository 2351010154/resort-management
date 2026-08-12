// Where an arrow key lands, as arithmetic.
//
// Split out of `roving-focus.tsx` so it can be tested. The component around it
// is verified in a browser — what matters there is where focus actually goes —
// but which index a press resolves to is pure, and the boundaries (first, last,
// looping or clamping, arrowing in from outside) are exactly the places an
// off-by-one hides. A private function inside a client component is unreachable
// from a spec, and this one is the part worth reaching.

export type Orientation = "vertical" | "horizontal" | "both";

/** Jump straight to an end, rather than stepping. */
export type Jump = "first" | "last";

/**
 * Which way this key moves, given what the group steers. 0 means "not ours",
 * and the caller must then leave the press alone rather than swallow it.
 */
export function stepFor(key: string, orientation: Orientation): number {
  const vertical = orientation !== "horizontal";
  const horizontal = orientation !== "vertical";

  if (
    (key === "ArrowDown" && vertical) ||
    (key === "ArrowRight" && horizontal)
  ) {
    return 1;
  }

  if ((key === "ArrowUp" && vertical) || (key === "ArrowLeft" && horizontal)) {
    return -1;
  }

  return 0;
}

/** Whether this key jumps to an end, and which. */
export function jumpFor(key: string): Jump | null {
  if (key === "Home") {
    return "first";
  }

  return key === "End" ? "last" : null;
}

/**
 * The index a press resolves to.
 *
 * `from` is -1 when focus is not on a member — the operator arrowed in from
 * outside the list, or focus was lost. That is not an error: the press enters
 * the list at the end it is arriving from, top for a downward step and bottom
 * for an upward one, which is what makes ArrowUp into a list select its last
 * row rather than its first.
 *
 * Returns null when there is nothing to move to, so the caller can leave the
 * press alone rather than act on an index into an empty list.
 */
export function targetIndex(
  from: number,
  step: number,
  jump: Jump | null,
  count: number,
  loop: boolean,
): number | null {
  if (count === 0) {
    return null;
  }

  if (jump === "first") {
    return 0;
  }

  if (jump === "last") {
    return count - 1;
  }

  if (step === 0) {
    return null;
  }

  if (from === -1) {
    return step > 0 ? 0 : count - 1;
  }

  const target = from + step;

  if (target < 0) {
    return loop ? count - 1 : 0;
  }

  if (target >= count) {
    return loop ? 0 : count - 1;
  }

  return target;
}
