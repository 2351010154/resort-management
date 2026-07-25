// A signed distance field for the monogram, built in the browser at mount.
//
// The lens magnifies the mark by ~25x. A distance field is the only cheap
// representation that survives that: it stays exact under magnification, and
// the mask's soft edge is one `smoothstep` over the distance rather than a blur
// pass. It also gives the shader a real distance either side of the outline,
// which is what the gradient tint reads.
//
// Built at runtime rather than shipped as an image because 8-bit distances band
// visibly once magnified this far, and the whole field costs one rasterisation
// plus two linear-time passes — cheap enough to run behind the intro curtain.

import { loadMonogramGlyph, traceDilatedMonogram } from "./monogram-glyph";

/** Field resolution. Leaves a ~4-texel edge band at full magnification. */
const SIZE = 1024;

/**
 * Fraction of the field's height taken by the dilated mark. The rest is
 * headroom for the outside distances the tint samples.
 */
export const GLYPH_FRACTION = 0.42;

export interface MonogramField {
  /** Signed distance per texel in field-UV units; positive outside the mark. */
  data: Float32Array;
  size: number;
  glyphFraction: number;
}

const INF = 1e20;

/**
 * Felzenszwalb & Huttenlocher's 1D squared-distance transform: the lower
 * envelope of the parabolas rooted at each sample. Linear time, and separable,
 * so running it down the columns and then along the rows gives the exact
 * Euclidean transform of the whole grid.
 */
function edt1d(
  f: Float64Array,
  d: Float64Array,
  v: Int32Array,
  z: Float64Array,
  n: number,
): void {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

/** In-place squared Euclidean distance transform of a size x size grid. */
function edt2d(grid: Float64Array, size: number): void {
  const f = new Float64Array(size);
  const d = new Float64Array(size);
  const v = new Int32Array(size);
  const z = new Float64Array(size + 1);

  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) f[y] = grid[y * size + x];
    edt1d(f, d, v, z, size);
    for (let y = 0; y < size; y++) grid[y * size + x] = d[y];
  }
  for (let y = 0; y < size; y++) {
    const row = y * size;
    for (let x = 0; x < size; x++) f[x] = grid[row + x];
    edt1d(f, d, v, z, size);
    for (let x = 0; x < size; x++) grid[row + x] = d[x];
  }
}

/**
 * Rasterise the dilated mark centred in a square field, returning coverage.
 *
 * Centred on the mark's ink box, which for this M puts the field's midpoint
 * inside the middle apex joint — measured at 0.019 field units deep, against a
 * stroke half-thickness of about 0.02. The lens leans on that: it zooms about the
 * field's midpoint, so once magnification passes ~48x every pixel on screen
 * resolves to a point inside that joint and the sheet clears itself. A glyph
 * whose ink-box centre falls *outside* the strokes would instead fill the frame
 * with sheet at the moment it should be opening, so that distance is worth
 * re-measuring if the mark is ever redrawn.
 */
async function rasteriseCoverage(size: number): Promise<Float32Array> {
  const glyph = await loadMonogramGlyph();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#fff";
  ctx.translate(size / 2, size / 2);
  traceDilatedMonogram(ctx, glyph, size * GLYPH_FRACTION);

  const { data } = ctx.getImageData(0, 0, size, size);
  const coverage = new Float32Array(size * size);
  for (let i = 0; i < coverage.length; i++) coverage[i] = data[i * 4 + 3] / 255;
  return coverage;
}

/**
 * Builds the field. Values are in field-UV units, so a distance of 0.01 is one
 * hundredth of the field's width whatever resolution it was rasterised at.
 */
export async function buildMonogramField(): Promise<MonogramField> {
  const size = SIZE;
  const coverage = await rasteriseCoverage(size);
  const n = size * size;

  // Two transforms: distance from each texel to the mark, and from each texel to
  // the ground. Their difference is the signed field.
  //
  // Seeded from the rasteriser's antialiasing, not from a threshold. A texel
  // the outline crosses is not a whole texel away from it — it is (0.5 - a)
  // away, and that is the only information about where inside the texel the
  // outline actually runs. Thresholding throws it away and quantises every
  // distance to whole texels, which magnifies into a visible scallop along
  // every edge. Seeding keeps it, and the transform carries it outward.
  const outside = new Float64Array(n);
  const inside = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = coverage[i];
    if (a <= 0) {
      outside[i] = INF;
      inside[i] = 0;
    } else if (a >= 1) {
      outside[i] = 0;
      inside[i] = INF;
    } else {
      const edge = 0.5 - a;
      outside[i] = edge > 0 ? edge * edge : 0;
      inside[i] = edge < 0 ? edge * edge : 0;
    }
  }
  edt2d(outside, size);
  edt2d(inside, size);

  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    data[i] = (Math.sqrt(outside[i]) - Math.sqrt(inside[i])) / size;
  }

  return { data, size, glyphFraction: GLYPH_FRACTION };
}
