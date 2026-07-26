// Builds public/brand/mariva-monogram-intro.svg — the heavy, photo-carrying M
// the intro cuts its window out of.
//
// Constructed rather than traced. Every edge in the mark is a straight line or
// a circular cap, and the four contours are defined by six lines that recur
// throughout the letterform; expressing those lines once and intersecting them
// keeps the joints exact, which a trace of the 486px comp could not. The intro
// magnifies this mark ~45x, so a wobble of one comp pixel would arrive as a
// visible kink in a stroke.
//
// The mark is used at its drawn weight — unlike the hairline nav monogram, it
// gets no dilation pass (see INTRO_MONOGRAM in lib/monogram-glyph.ts).
//
// Usage: node apps/web/scripts/build-intro-monogram.mjs

import { writeFile } from "node:fs/promises";
import path from "node:path";

/** Comp units. The mark is drawn to fill the box exactly. */
const W = 486;
const H = 465;

/**
 * The two families of angle in the mark. `DIAG` is the M's own diagonal, near
 * enough 39° off vertical; `SLASH` is the cut that separates the lower-left
 * strokes, and is the perpendicular of the diagonal rather than a parallel of
 * it — which is why the slashes read as cuts across the letter instead of as
 * more of the same stroke.
 */
const DIAG = 0.817;
const SLASH = 1.27;

/** x at a given y for a line of the given slope through an x-intercept. */
const line = (slope, at0) => (y) => slope * y + at0;

// Left diagonal, right and left edges.
const ldiagR = line(DIAG, 57);
const ldiagL = line(DIAG, -33);
// Right diagonal, left and right edges.
const rdiagL = line(-DIAG, 430);
const rdiagR = line(-DIAG, 523);
// The two slashes, each given by its upper-right and lower-left edge.
const slash1Hi = line(SLASH, -188);
const slash1Lo = line(SLASH, -239.5);
const slash2Hi = line(SLASH, -381);
const slash2Lo = line(SLASH, -432.5);

/** Right stem's inner edge — the only vertical the letter needs stated. */
const STEM_R = 378;
/** Left stem's inner edge. Only bounds the lowest stroke; see contour 3. */
const STEM_L = 86;

/** Caps. Both sit on the top edge, so each centre is its own radius deep. */
const CAP_L = { x: 43, y: 43, r: 43 };
const CAP_R = { x: 447, y: 39, r: 39 };

/** y where two lines meet. */
function meet(a, b, lo = -1000, hi = 2000) {
  // both are affine in y, so one secant step is exact
  const f = (y) => a(y) - b(y);
  const y0 = lo, y1 = hi;
  return y0 - (f(y0) * (y1 - y0)) / (f(y1) - f(y0));
}

/** y where a line crosses a vertical. */
function meetX(a, x, lo = -1000, hi = 2000) {
  return meet(a, () => x, lo, hi);
}

/**
 * Where a line enters a cap circle — the point the outline hands over from the
 * stroke edge to the arc. Both edges approach their cap from below, so it is
 * always the lower of the two crossings that the outline actually reaches.
 */
function enterCap(lineFn, cap) {
  // (slope*y + at0 - cx)^2 + (y - cy)^2 = r^2
  const at0 = lineFn(0);
  const slope = lineFn(1) - at0;
  const k = at0 - cap.x;
  const a = slope * slope + 1;
  const b = 2 * (slope * k - cap.y);
  const c = k * k + cap.y * cap.y - cap.r * cap.r;
  const y = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  return [lineFn(y), y];
}

const vInner = meet(ldiagR, rdiagL);
const vOuter = meet(ldiagL, rdiagR);
/** Where the first slash leaves the letter's lower-right edge. */
const slashOut = meet(slash1Lo, ldiagL);

const n = (v) => Number(v.toFixed(2));
const pt = ([x, y]) => `${n(x)} ${n(y)}`;

// 1 — the body: left stem head, the M's diagonals and counter, the right stem.
//     Closed along the first slash, which is what detaches the strokes below.
const capLExit = enterCap(ldiagR, CAP_L);
const capREnter = enterCap(rdiagL, CAP_R);
const body = [
  `M 0 ${n(CAP_L.y)}`,
  `A ${CAP_L.r} ${CAP_L.r} 0 0 1 ${pt(capLExit)}`,
  `L ${pt([ldiagR(vInner), vInner])}`,
  `L ${pt(capREnter)}`,
  `A ${CAP_R.r} ${CAP_R.r} 0 0 1 ${W} ${n(CAP_R.y)}`,
  `L ${W} ${H}`,
  `L ${STEM_R} ${H}`,
  `L ${STEM_R} ${n(meetX(rdiagR, STEM_R))}`,
  `L ${pt([ldiagL(vOuter), vOuter])}`,
  `L 0 ${n(meetX(slash1Hi, 0))}`,
  "Z",
].join(" ");

// 2 — the long stroke below the first slash. Its lower-right edge is the
//     letter's own diagonal, so it reads as the M continuing under the cut
//     rather than as a bar laid across it.
const bar = [
  `M 0 ${n(meetX(slash1Lo, 0))}`,
  `L ${pt([slash1Lo(slashOut), slashOut])}`,
  `L ${n(ldiagL(H))} ${H}`,
  `L ${n(slash2Hi(H))} ${H}`,
  `L 0 ${n(meetX(slash2Hi, 0))}`,
  "Z",
].join(" ");

// 3 — the foot: what is left of the left stem under the second slash. It stops
//     at the stem's own width, not at the slash, which is what keeps the two
//     lower strokes from reading as one wedge.
const foot = [
  `M 0 ${n(meetX(slash2Lo, 0))}`,
  `L ${STEM_L} ${n(meetX(slash2Lo, STEM_L))}`,
  `L ${STEM_L} ${H}`,
  `L 0 ${H}`,
  "Z",
].join(" ");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" fill="currentColor" aria-label="Mariva monogram" role="img">
  <path fill-rule="evenodd" d="${[body, bar, foot].join(" ")}"/>
</svg>
`;

const dest = path.resolve(
  import.meta.dirname, "..", "public", "brand", "mariva-monogram-intro.svg",
);
await writeFile(dest, svg);
console.log(`mariva-monogram-intro.svg: ${svg.length} bytes`);
console.log(`  V inner ${n(ldiagR(vInner))},${n(vInner)}  outer ${n(ldiagL(vOuter))},${n(vOuter)}`);
