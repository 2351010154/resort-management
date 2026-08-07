// The ground the monogram is cut into: a warm ivory plaster wall.
//
// Act 1 used to stand the mark in open sea, which put two pictures on the first
// screen — a scenic backdrop outside the letter competing with the interior
// imagery inside it. The wall is deliberately not a picture. It is near-solid
// ivory with a tooth you have to look for and one broad raking light that drifts
// slowly enough to read as the light changing rather than as an animation, so
// the only thing on screen with a subject is what shows through the mark. It
// also makes the act self-coherent: the act ends by blooming to the page's own
// ivory, and now that is the tone it opened on — the mark was cut into the
// page's wall all along.
//
// Two paths draw it: the WebGL lens builds it per fragment, the flat canvas
// sheet paints it once per resize. Neither can read a CSS custom property
// without a layout read it would have to repeat, so the tones live here as
// numbers and both paths take them from here rather than each carrying a copy.

type Rgb = readonly [number, number, number];

/**
 * The lit tone. Exactly the `--ivory` token, and that is the point: it is the
 * tone the act blooms to and the tone Act 2 opens on, so the wall, the bloom and
 * the next screen are one surface rather than three near-misses.
 *
 * If the brand ivory moves, this moves with it — it is the palette written out
 * as a number, not a colour of its own, and it lives here only because a shader
 * cannot reach the stylesheet.
 */
const PLASTER_LIT: Rgb = [244, 239, 230];

/**
 * The same plaster out of the light. Deeper and warmer than `--ivory-warm`,
 * which is a flat wall tone rather than a shadow: at only the eight levels that
 * separates the two ivories, the raking light and the corner falloff quantise
 * into bands instead of reading as light. Sixteen levels is still under a 7%
 * swing across the whole frame — near-solid, as intended — but it is enough for
 * the light to have somewhere to travel.
 */
const PLASTER_DEEP: Rgb = [228, 220, 207];

const glslRgb = ([r, g, b]: Rgb) =>
  `vec3(${(r / 255).toFixed(4)}, ${(g / 255).toFixed(4)}, ${(b / 255).toFixed(4)})`;

const cssRgb = ([r, g, b]: Rgb) => `rgb(${r} ${g} ${b})`;

/**
 * The wall, as GLSL. Prepended to the lens fragment shader, which calls
 * `plasterGround()` with a centred, aspect-corrected screen coordinate.
 *
 * Written raw, in the same sRGB numbers the tones above are: the lens material
 * writes `gl_FragColor` without the renderer's output-encoding include, so what
 * is written here is what reaches the frame. Feeding it linear values instead
 * would put the wall several shades off the ivory the bloom lands on.
 */
export const plasterChunk = /* glsl */ `
  /**
   * Value noise, not a per-pixel hash. The wall creeps toward the camera across
   * the act, so its texture is resampled at a drifting scale every frame; a raw
   * hash under that sparkles, and sparkle on a still wall is the one thing that
   * would pull the eye off the mark. Interpolating between lattice points costs
   * three more mixes and moves like material instead.
   */
  float plasterHash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float plasterNoise(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = plasterHash(cell);
    float b = plasterHash(cell + vec2(1.0, 0.0));
    float c = plasterHash(cell + vec2(0.0, 1.0));
    float d = plasterHash(cell + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  const vec3 PLASTER_LIT = ${glslRgb(PLASTER_LIT)};
  const vec3 PLASTER_DEEP = ${glslRgb(PLASTER_DEEP)};

  /**
   * Where the light comes from, as a unit direction across the wall, and how
   * broad the band it lays down is. Broad on purpose: a narrow band is a
   * highlight, and a highlight is a shape — something for the eye to read as a
   * second subject. This one is wider than the frame's short side, so what
   * registers is that one side of the wall is fractionally brighter.
   */
  const vec2 RAKE_DIR = vec2(0.86, 0.51);
  const float RAKE_WIDTH = 0.42;
  /**
   * The drift. Sixty seconds of travel for a quarter of the frame's width is
   * far below the threshold at which motion is legible as motion — nobody
   * watches this happen, they come back to a wall that is lit slightly
   * differently. That is the whole intended effect; anything faster becomes the
   * animation the mark is supposed to be.
   */
  const float RAKE_SWEEP = 0.26;
  const float RAKE_RATE = 0.105;

  /** The wall falling away from the light, toward the corners. */
  const float VIGNETTE = 0.34;
  /**
   * Trowel mottle — the low-frequency unevenness that separates plaster from a
   * gradient. Folded into the tone rather than added as luminance, so a thin
   * patch is warm as well as dark, which is what a thin patch of plaster is.
   */
  const float MOTTLE_SCALE = 13.0;
  const float MOTTLE = 0.5;
  /**
   * Two grades of tooth, added as luminance after the tone mix so their depth is
   * set here rather than inherited from the gap between the two tones. The
   * coarser one is the surface; the finer one is paper grain, and it is also
   * what dithers a near-solid fullscreen field that would otherwise band in
   * eight bits.
   */
  const float TOOTH_SCALE = 190.0;
  const float TOOTH_DEPTH = 0.016;
  const float PAPER_SCALE = 520.0;
  const float PAPER_DEPTH = 0.009;

  vec3 plasterGround(vec2 wall, float time) {
    float rake = dot(wall, RAKE_DIR) - RAKE_SWEEP * sin(time * RAKE_RATE);
    float light = exp(-rake * rake / RAKE_WIDTH);
    float mottle = plasterNoise(wall * MOTTLE_SCALE) - 0.5;

    float tone = clamp(
      0.62 + 0.46 * (light - 0.42) - VIGNETTE * dot(wall, wall) + MOTTLE * mottle,
      0.0,
      1.0
    );
    vec3 surface = mix(PLASTER_DEEP, PLASTER_LIT, tone);

    surface += TOOTH_DEPTH * (plasterNoise(wall * TOOTH_SCALE) - 0.5);
    surface += PAPER_DEPTH * (plasterNoise(wall * PAPER_SCALE) - 0.5);
    return surface;
  }
`;

/**
 * Peak alpha of one grain pixel on the flat canvas path, and the tile it
 * repeats from.
 *
 * The tile is drawn in CSS pixels rather than device pixels, so on a retina
 * screen it is smoothed up rather than resolved 1:1. That is deliberate: it puts
 * the flat path's grain at the same visual scale as the shader's smoothed value
 * noise, and sensor-fine noise is the wrong texture for a wall anyway.
 */
const GRAIN_TILE = 128;
const GRAIN_PEAK = 0.55;

let grainTile: HTMLCanvasElement | null = null;

/**
 * Grain, as pixels of the wall's own two tones at random alpha.
 *
 * A single grey tile at low opacity cannot do this: composited over the wall it
 * pulls the whole surface toward grey, so the tooth arrives with a flat tint
 * attached. Drawing the wall's own light and shadow tones instead means the
 * average pixel lands between them — which is where the wall already is — and
 * only the deviation shows.
 */
function grainSource(): HTMLCanvasElement | null {
  if (grainTile) return grainTile;
  if (typeof document === "undefined") return null;
  const tile = document.createElement("canvas");
  tile.width = tile.height = GRAIN_TILE;
  const ctx = tile.getContext("2d");
  if (!ctx) return null;
  const pixels = ctx.createImageData(GRAIN_TILE, GRAIN_TILE);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const tone = Math.random() < 0.5 ? PLASTER_DEEP : PLASTER_LIT;
    pixels.data[i] = tone[0];
    pixels.data[i + 1] = tone[1];
    pixels.data[i + 2] = tone[2];
    pixels.data[i + 3] = Math.round(255 * GRAIN_PEAK * Math.random());
  }
  ctx.putImageData(pixels, 0, 0);
  grainTile = tile;
  return tile;
}

/**
 * The wall for the flat canvas sheet — the reduced-motion and no-WebGL path.
 *
 * One radial gradient stands in for the shader's raking light and corner
 * falloff together: this path never animates, so the light only has to be
 * somewhere plausible, and a wide off-centre radial is exactly what a broad
 * light band plus a vignette resolves to at one instant. The caller's transform
 * is left in force, so `width`/`height` are CSS pixels.
 */
export function paintPlaster(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  const light = ctx.createRadialGradient(
    width * 0.36,
    height * 0.3,
    0,
    width * 0.36,
    height * 0.3,
    Math.hypot(width, height) * 0.86,
  );
  light.addColorStop(0, cssRgb(PLASTER_LIT));
  light.addColorStop(1, cssRgb(PLASTER_DEEP));
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, width, height);

  const tile = grainSource();
  if (!tile) return;
  const grain = ctx.createPattern(tile, "repeat");
  if (!grain) return;
  ctx.fillStyle = grain;
  ctx.fillRect(0, 0, width, height);
}
