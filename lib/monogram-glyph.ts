// The Mariva monogram as a drawable Path2D, plus the ink bounds the intro needs
// to place it.
//
// The mark is a hairline M. Anything that shows the world through it — the
// canvas cut-out sheet, the WebGL lens — has to widen the strokes first, or the
// opening carries almost no image. Widening is an outward stroke with round
// joins and caps, which is exactly morphological dilation by a disc: `fill()`
// plus `stroke()` at twice the offset. That is where the rounded stroke ends
// come from.

/** Outward offset, as a fraction of the mark's own height. */
export const MONOGRAM_DILATE = 0.047;

export interface MonogramGlyph {
  path: Path2D;
  /** Ink bounds of the undilated mark, in viewBox units. */
  box: { x: number; y: number; width: number; height: number };
}

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
  pending ??= fetch("/brand/mariva-monogram.svg")
    .then((r) => r.text())
    .then((source) => {
      const viewBox = (/viewBox="([-\d.\s]+)"/.exec(source)?.[1] ?? "0 0 340 260")
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
 * Draws the dilated mark into the current context, centred on the origin and
 * scaled so the *dilated* height is `height`. Targeting the dilated height
 * keeps the opening the same size on screen however the offset is tuned.
 */
export function traceDilatedMonogram(
  ctx: CanvasRenderingContext2D,
  glyph: MonogramGlyph,
  height: number,
): void {
  const { box } = glyph;
  const offset = MONOGRAM_DILATE * box.height;
  const scale = height / (box.height + offset * 2);
  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(-(box.x + box.width / 2), -(box.y + box.height / 2));
  ctx.lineWidth = offset * 2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke(glyph.path);
  ctx.fill(glyph.path, "evenodd");
  ctx.restore();
}

/** Aspect ratio (w/h) of the dilated mark. */
export function dilatedAspect({ box }: MonogramGlyph): number {
  const offset = MONOGRAM_DILATE * box.height;
  return (box.width + offset * 2) / (box.height + offset * 2);
}
