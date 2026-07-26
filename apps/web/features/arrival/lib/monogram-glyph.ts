// The Mariva monogram as the intro draws it: a drawable Path2D, the ink bounds
// that place it, and the point the camera flies into.
//
// This is the heavy intro cut of the mark (scripts/build-intro-monogram.mjs),
// not the hairline one the concierge bar carries. It is drawn at its own
// weight — the strokes are already wide enough to hold a photograph, so unlike
// the hairline mark it needs no dilation pass before the world can show
// through it.

/** Where in the mark the lens converges — see FOCUS_X/FOCUS_Y. */
export interface MonogramGlyph {
  path: Path2D;
  /** Ink bounds of the mark, in viewBox units. */
  box: { x: number; y: number; width: number; height: number };
}

/**
 * The point the mark is centred on, as a fraction of its ink box.
 *
 * Not the box's middle. The lens is a pure scale about this point, so past a
 * certain magnification every pixel on screen resolves to somewhere within a
 * few units of it — and if that neighbourhood is background, the frame fills
 * with backdrop at the exact moment it should be opening into the letter. The
 * middle of this M's box sits four units under the tip of the central counter,
 * which is far too close to that notch.
 *
 * This point instead sits in the belly of the V, ~35 units clear of the nearest
 * stroke edge in every direction — enough that the frame is inside solid mark
 * by the time the sheet starts retiring. Its side effect is compositional and
 * wanted: centring here lifts the mark to sit a little high in the frame, which
 * is where it sits in the artwork, with the water carrying the space beneath.
 */
export const FOCUS_X = 0.504;
export const FOCUS_Y = 0.613;

/** Ink bounds of a path, by rasterising once and scanning the alpha channel. */
function measureInk(path: Path2D, viewW: number, viewH: number): MonogramGlyph["box"] {
  const probe = 512;
  const scale = probe / Math.max(viewW, viewH);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = probe;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.scale(scale, scale);
  ctx.fill(path, "evenodd");
  const { data } = ctx.getImageData(0, 0, probe, probe);
  let minX = probe, minY = probe, maxX = -1, maxY = -1;
  for (let y = 0; y < probe; y++) {
    for (let x = 0; x < probe; x++) {
      if (data[(y * probe + x) * 4 + 3] < 8) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return {
    x: minX / scale,
    y: minY / scale,
    width: (maxX - minX + 1) / scale,
    height: (maxY - minY + 1) / scale,
  };
}

let pending: Promise<MonogramGlyph> | null = null;

/** Loads and measures the mark once per document. */
export function loadMonogramGlyph(): Promise<MonogramGlyph> {
  pending ??= fetch("/brand/mariva-monogram-intro.svg")
    .then((r) => r.text())
    .then((source) => {
      const viewBox = (/viewBox="([-\d.\s]+)"/.exec(source)?.[1] ?? "0 0 486 465")
        .trim()
        .split(/\s+/)
        .map(Number);
      const d = /\sd="([^"]+)"/.exec(source)?.[1] ?? "";
      const path = new Path2D(d);
      return { path, box: measureInk(path, viewBox[2], viewBox[3]) };
    });
  return pending;
}

/**
 * Draws the mark into the current context, scaled so its height is `height` and
 * positioned so its focus point — not its centre — lands on the origin.
 */
export function traceMonogram(
  ctx: CanvasRenderingContext2D,
  glyph: MonogramGlyph,
  height: number,
): void {
  const { box } = glyph;
  const scale = height / box.height;
  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(-(box.x + box.width * FOCUS_X), -(box.y + box.height * FOCUS_Y));
  ctx.fill(glyph.path, "evenodd");
  ctx.restore();
}
