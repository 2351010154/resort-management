// The ribbon's shape, as a function of where it is and how far the reader has
// travelled.
//
// Everything is in page units: x in hundredths of the viewport's width, y in
// hundredths of its height, with y = 0 at the top of Act 2's section. The
// ribbon is drawn into an SVG whose user space is exactly that, so the numbers
// here are the numbers on screen and nothing in between converts them.
//
// Three things are computed:
//
//   the centreline   `centre(y, s)` — where the ribbon's middle is at a given
//                    height, for a given scroll. The base is a run of knots
//                    stepped between smoothly; over it rides a slow wave whose
//                    phase advances with scroll, which is what makes the S
//                    snake as the reader travels rather than sit still and be
//                    scrolled past.
//   the width        `width(y)` — the lobes and the waists between them. Only
//                    a function of height: the sway moves the ribbon, it does
//                    not breathe it.
//   the path         `ribbonPath(...)` — the two edges as one closed outline,
//                    with the apertures cut through it as further subpaths
//                    under an even-odd fill.
//
// The apertures and every block of copy are placed off the same `centre`, so
// the sway carries them with the sheet they are set in.

/** One knot of the base curve: where the middle is and how wide the sheet. */
export interface Knot {
  y: number;
  cx: number;
  w: number;
}

export type ApertureShape = "circle" | "lozenge" | "organic";

export interface ApertureGeometry {
  /** Height of the opening's centre. */
  y: number;
  /** Offset of the centre from the ribbon's centreline, in vw. */
  dx: number;
  /** Radius, in vh. The x radius is derived so the opening is round on screen. */
  r: number;
  /** How much wider than round the opening is: the x radius is multiplied by
   *  this. 1, or absent, is round. */
  stretch?: number;
  shape: ApertureShape;
  /** The lozenge's lean and the organic opening's variation, in radians. */
  seed?: number;
}

/**
 * The sway. A travelling wave of small amplitude and long wavelength; the
 * amplitude is in vw, the wavelength in vh, and `SLIP` is how far the wave
 * moves along the ribbon per unit of scroll. Below one, so the wave visibly
 * crawls against the page rather than being carried by it — carried with it,
 * the ribbon would be a fixed drawing the page slid under.
 *
 * The amplitude is bounded by the narrowest margin anything is placed with:
 * the keyword stacks stand a few vw off a lobe's flank, on the photograph, and
 * a sway that reached them would carry ivory under them.
 */
const SWAY = 1.8;
const WAVELENGTH = 320;
const SLIP = 0.32;

const TAU = Math.PI * 2;

/** The base curve's value at `y`: the knots stepped between with a
 *  smoothstep, so each knot is a flat — a lobe's apex, a waist's throat — and
 *  the curve leaves it without a corner. */
function stepBetween(knots: readonly Knot[], y: number, key: "cx" | "w") {
  const first = knots[0];
  const last = knots[knots.length - 1];
  if (y <= first.y) return first[key];
  if (y >= last.y) return last[key];
  for (let i = 0; i < knots.length - 1; i++) {
    const a = knots[i];
    const b = knots[i + 1];
    if (y <= b.y) {
      if (a[key] === b[key]) return a[key];
      const t = (y - a.y) / (b.y - a.y);
      const prev = knots[Math.max(0, i - 1)];
      const next = knots[Math.min(knots.length - 1, i + 2)];
      const span = b.y - a.y;
      const m0 = ((b[key] - prev[key]) / (b.y - prev.y)) * span;
      const m1 = ((next[key] - a[key]) / (next.y - a.y)) * span;
      return (
        (2 * t ** 3 - 3 * t ** 2 + 1) * a[key] +
        (t ** 3 - 2 * t ** 2 + t) * m0 +
        (-2 * t ** 3 + 3 * t ** 2) * b[key] +
        (t ** 3 - t ** 2) * m1
      );
    }
  }
  return last[key];
}

/** The wave's offset at height `y` for scroll `s`, in vw. */
export function sway(y: number, s: number): number {
  return SWAY * Math.sin((TAU * (y - s * SLIP)) / WAVELENGTH);
}

/** A travelling edge ripple continues while the reader pauses. The centre
 * drift stays smaller, so the paper feels alive without shaking the copy. */
export function edgeWave(y: number, scroll: number, time: number, phase = 0) {
  return (
    2.6 * Math.sin(y * 0.043 - scroll * 0.018 + time * 0.85 + phase) +
    0.65 * Math.sin(y * 0.087 + time * 1.1 + phase)
  );
}

/** The ribbon's middle at `y`, for scroll `s`; `sway = 0` gives the base. */
export function centre(
  knots: readonly Knot[],
  y: number,
  s: number,
  swaying = true,
): number {
  return stepBetween(knots, y, "cx") + (swaying ? sway(y, s) : 0);
}

export function width(knots: readonly Knot[], y: number): number {
  return Math.max(0, stepBetween(knots, y, "w"));
}

/** The screen's aspect as vh per vw, so an x radius can be given in vh. */
export const aspectOf = (w: number, h: number) => (w > 0 ? h / w : 1);

const fmt = (n: number) => n.toFixed(4);

/**
 * Catmull-Rom through a run of points, as cubic Béziers. Open runs are drawn
 * as they are; closed ones wrap, so the last point curves into the first.
 */
function spline(
  points: readonly (readonly [number, number])[],
  closed: boolean,
) {
  const n = points.length;
  if (n < 2) return "";
  const at = (i: number) =>
    closed
      ? points[((i % n) + n) % n]
      : points[Math.min(Math.max(i, 0), n - 1)];
  const segments = closed ? n : n - 1;
  let d = "";
  for (let i = 0; i < segments; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${fmt(c1x)} ${fmt(c1y)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(p2[0])} ${fmt(p2[1])}`;
  }
  return d;
}

/** Height between samples along an edge. Fine enough that the spline through
 *  them is the smoothstep curve itself rather than a polygon of it, and that
 *  the knots packed into the sheet's first few units are each sampled. */
const EDGE_STEP = 4;

/**
 * The radius of an opening's outline at angle `t`, as a share of its nominal
 * radius. A circle is a circle; a lozenge is an ellipse leaning on its seed; an
 * organic opening is a circle with two slow ripples on it, which is enough to
 * read as cut by hand and not enough to read as damaged.
 */
function outline(shape: ApertureShape, t: number, seed: number): number {
  switch (shape) {
    case "circle":
      return 1;
    case "lozenge":
      return 1 + 0.3 * Math.cos(2 * (t - seed));
    case "organic":
      return (
        1 + 0.045 * Math.sin(3 * t + seed) + 0.025 * Math.cos(2 * t + seed)
      );
  }
}

/** Points around an opening, for the spline. */
const OUTLINE_POINTS = 18;

/**
 * One opening as a closed subpath, at centre (cx, cy) in page units and
 * radius `r` in vh scaled by `open` (0 shut, 1 as declared). The x radius is
 * corrected by the screen's aspect so the opening is round on screen.
 */
export function aperturePath(
  aperture: ApertureGeometry,
  cx: number,
  open: number,
  aspect: number,
): string {
  if (open <= 0.001) return "";
  const { y, r, shape, seed = 0, stretch = 1 } = aperture;
  const points: [number, number][] = [];
  for (let i = 0; i < OUTLINE_POINTS; i++) {
    const t = (i / OUTLINE_POINTS) * TAU;
    const radius = r * open * outline(shape, t, seed);
    points.push([
      cx + Math.cos(t) * radius * aspect * stretch,
      y + Math.sin(t) * radius,
    ]);
  }
  return `M${fmt(points[0][0])} ${fmt(points[0][1])}${spline(points, true)}Z`;
}

export interface RibbonPathOptions {
  knots: readonly Knot[];
  /** Height range to draw. Anything outside it is not on screen. */
  from: number;
  to: number;
  /** Scroll, in the units `sway` takes. */
  s: number;
  swaying: boolean;
  /** Elapsed active animation time, in seconds. */
  time?: number;
  edgeMotion?: boolean;
  edgeScale?: number;
  aspect: number;
  /** Each opening with how far open it is. */
  apertures: readonly { aperture: ApertureGeometry; open: number }[];
}

/**
 * The whole ribbon between two heights: the left edge down, the right edge
 * back up, closed, with the openings as further subpaths. The caps at either
 * end are straight and are only ever off screen — the range drawn reaches a
 * little past the viewport in both directions — except where the range
 * starts at the first knot, whose width is nothing: there the cap is the
 * point the sheet is born as. An empty range is no sheet at all.
 */
export function ribbonPath({
  knots,
  from,
  to,
  s,
  swaying,
  time = 0,
  edgeMotion = swaying,
  edgeScale = 1,
  aspect,
  apertures,
}: RibbonPathOptions): string {
  if (to <= from) return "";
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (let y = from; y <= to + EDGE_STEP; y += EDGE_STEP) {
    const yy = Math.min(y, to);
    const c = centre(knots, yy, s, swaying);
    const half = width(knots, yy) / 2;
    const envelope = Math.min(1, half / 12);
    const leftWave = edgeMotion
      ? edgeWave(yy, s, time, 0) * envelope * edgeScale
      : 0;
    const rightWave = edgeMotion
      ? edgeWave(yy, s, time, 1.7) * envelope * edgeScale
      : 0;
    left.push([c - half + leftWave, yy]);
    right.push([c + half + rightWave, yy]);
    if (yy === to) break;
  }
  right.reverse();

  let d = `M${fmt(left[0][0])} ${fmt(left[0][1])}${spline(left, false)}`;
  d += `L${fmt(right[0][0])} ${fmt(right[0][1])}${spline(right, false)}Z`;

  for (const { aperture, open } of apertures) {
    const reach = aperture.r * 1.4;
    if (aperture.y + reach < from || aperture.y - reach > to) continue;
    const cx = centre(knots, aperture.y, s, swaying) + aperture.dx;
    d += aperturePath(aperture, cx, open, aspect);
  }
  return d;
}
