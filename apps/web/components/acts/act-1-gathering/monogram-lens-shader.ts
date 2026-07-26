// The monogram lens: one fullscreen quad that paints the sea backdrop
// everywhere except through the mark.
//
// Three things happen to the coordinate on its way to the distance field, and
// the whole look comes from their order:
//
//   1. magnify — the screen point is divided back onto the glyph plane. The
//      plane is what moves; the sheet does not scale, so the backdrop stays put
//      while the opening grows past the frame.
//   2. barrel  — a lens pinch normalised against the plane's own extent, so it
//      is strongest when the plane is still small in frame and relaxes as the
//      plane swallows the viewport. Near the edges it compresses the field,
//      which both bends the silhouette and smears the edge band wider there
//      than in the middle. That uneven smear is the effect worth having.
//   3. sample  — the band is a smoothstep over *distance*, fixed in field
//      units. Because those units magnify with the plane, an edge that is a
//      few pixels at rest is tens of pixels by the end. The melt is free; it
//      is the same smoothstep the whole way.
//
// The backdrop also spills back in across the outline, which is what gives the
// mark its shine. Three things about that spill matter: it is measured off the
// outline, never off the screen — keyed to screen position it reads as a wash
// laid over the frame rather than as light on the shape; it starts outside the
// mark, so only its tail is visible and the light plainly comes from the sky;
// and it carries the backdrop's *own* colour at that pixel, so the sea leaks
// into the strokes it touches and the sky into the ones it touches.

/** Fullscreen by construction — no camera involved. */
export const lensVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const lensFragment = /* glsl */ `
  precision highp float;

  uniform sampler2D uField;
  /** The sea loop. Sampled raw: no colour-space decode, so what was encoded is
      what reaches the frame. */
  uniform sampler2D uBackdrop;
  /** Viewport in CSS px — the unit uFieldPx is also measured in. */
  uniform vec2 uResolution;
  /** On-screen size of the field square with the plane at rest. */
  uniform float uFieldPx;
  /** Plane magnification, 1 at rest. */
  uniform float uMagnify;
  /** Pincushion strength; 0 at rest, negative through the push. */
  uniform float uBarrel;
  /** 0 holds the mark shut, 1 opens it fully. */
  uniform float uReveal;
  /** Retires the sheet as the plane arrives at the camera. */
  uniform float uOpacity;
  /** Screen uv -> backdrop uv: cover fit, with the waterline placed. */
  uniform vec2 uBackdropScale;
  uniform vec2 uBackdropOffset;
  /** Far-plane creep, shared with the interior plate inside the mark. */
  uniform float uBackdropDrift;
  /** v of the mark's baseline in field uv — where the water starts. */
  uniform float uBaseV;
  /** 0-1 strength of the mark's reflection in that water. */
  uniform float uReflect;

  varying vec2 vUv;

  /** Displace radially by a factor quadratic in the radius. */
  vec2 barrelPincushion(vec2 p, vec2 st, float strength) {
    return p * (1.0 + strength * dot(st, st));
  }

  /** Edge band width, in field units. A few pixels at rest. */
  const float EDGE = 0.0035;
  /**
   * Erosion that holds the mark shut, in field units, and how much further it
   * bites with distance from the focus point.
   *
   * CLOSED is set just over the widest part of the letter *at the focus* — the
   * belly of the V, half a stroke thick. Any higher and the opening spends the
   * front of its tween with nothing on screen: this mark is four times the
   * weight of the hairline one these numbers were first cut for, and at 0.075
   * the whole letter surfaced inside the last fifteen percent of a 2.4s
   * animation, which reads as a snap rather than an opening.
   *
   * SPREAD is what makes it open outward instead of everywhere at once, and it
   * has to be large enough to *outrank* thickness. A uniform erosion reveals the
   * letter in order of stroke weight, and every stroke in this mark is within a
   * third of every other — so they all surface within a few frames of each
   * other and a two-second opening reads as a pop. At four times CLOSED, radius
   * decides instead: the belly of the V is through by a fifteenth of the tween,
   * the right stem two thirds in, the far cap later still. Both terms relax to
   * nothing at uReveal = 1, so the gate leaves no trace on the finished mark.
   */
  const float CLOSED = 0.036;
  const float SPREAD = 0.6;
  /**
   * Where the spill starts, in field units *outside* the outline. Kept under
   * EDGE so its brightest part always falls on already-opaque sheet.
   */
  const float GLOW_ORIGIN = 0.003;
  /** Bright rim hard against the outline, and the distance it decays over. */
  const float GLOW_RIM = 0.42;
  const float GLOW_RIM_REACH = 0.008;
  /** Faint haze carrying on across the stroke, and its far longer decay. */
  const float GLOW_HAZE = 0.22;
  const float GLOW_HAZE_REACH = 0.055;

  /**
   * The reflection. Flat water returns a near-mirror, so this is the mark's own
   * silhouette rather than a blur of it — but it returns it as light, not as
   * image: the strokes are full of pale stone and sand, so what the water gets
   * back is a lift, which keeps the sea's own ripple readable through it. The
   * edge is softened over a band far wider than the sheet's, since the one
   * thing flat water never gives back is a hard outline.
   */
  const float REFLECT_FALL = 0.13;
  const float REFLECT_SOFT = 0.02;
  const vec3 REFLECT_LIFT = vec3(0.16, 0.145, 0.118);

  /** How far the mark is still eaten back at a point of the field. */
  float shutter(vec2 at) {
    return (1.0 - uReveal) * (CLOSED + SPREAD * length(at - 0.5));
  }

  void main() {
    vec2 st = vUv - 0.5;
    // the screen point, expressed on the glyph plane in rest pixels
    vec2 plane = st * uResolution / uMagnify;

    // The pinch is measured against the screen rather than against the plane,
    // so it holds its strength as the plane swallows the viewport instead of
    // thinning out with the square of the magnification.
    vec2 warped = barrelPincushion(plane, st, uBarrel);

    // A pure scale about the middle of the field, which is also the middle of the
    // frame and the point every other plane in the scene projects from. Anchoring
    // the mark's zoom anywhere else gives it an origin the cards do not share, and
    // the one shared projection is the whole reason these read as one space.
    vec2 field = warped / uFieldPx + 0.5;
    float shape = texture2D(uField, field).r;
    // The mark opens by un-eroding, which on a distance field is one offset.
    // Held shut it is eaten back past its own half-thickness and nothing shows;
    // as the offset relaxes the strokes surface as rounded islands at their
    // widest points and close up into the letter, the middle of the letter
    // first. Morphing out of a circle instead makes the thin strokes arrive as
    // spikes.
    float d = shape + shutter(field);

    // The outline itself. Nothing softens it beyond this band, so the silhouette
    // stays a drawn edge; the band is in field units, so it is the plane
    // magnifying it that melts it late in the push, not a blur.
    float sheet = smoothstep(0.0, EDGE, d);

    // The backdrop creeps forward at the interior plate's rate. Left static it is
    // the one plane in the scene that does not move, and a still sky behind a
    // letter rushing at the viewer reads as a photograph the mark is pasted on.
    vec2 drifted = (vUv - 0.5) / uBackdropDrift + 0.5;
    vec3 sea = texture2D(uBackdrop, drifted * uBackdropScale + uBackdropOffset).rgb;

    // The mark, given back by the water below its baseline. Measured in the
    // same magnified field the sheet is cut from, so it belongs to the letter
    // and not to the screen — and retired early, because once the mark is
    // rushing past there is no longer a whole letter to reflect.
    float under = uBaseV - field.y;
    vec2 image = vec2(field.x, uBaseV + under);
    float mirrored = texture2D(uField, image).r + shutter(image);
    float inMark = 1.0 - smoothstep(-REFLECT_SOFT, REFLECT_SOFT, mirrored);
    float depth = exp(-max(under, 0.0) / REFLECT_FALL) * step(0.0, under);
    sea += REFLECT_LIFT * inMark * depth * uReflect;

    // Spill: sky light crossing the outline and dying away inside the mark.
    //
    // Its origin sits *outside* the outline, so the bright end of the ramp
    // falls on sheet that is already opaque and only the tail lands on the
    // mark. That is what makes it read as the sky lighting the shape rather
    // than the shape lighting itself — a spill that starts at the outline
    // reads as the mark's own emission.
    //
    // Exponential, not a smoothstep. A smoothstep is flat at both ends, which
    // parks a plateau against the outline and then stops dead where it runs
    // out; both ends read as the edges of a band rather than as a gradient.
    // Exponential decay has its steepest point at the origin and no end at all.
    //
    // Two of them, because one cannot do both jobs. Measured off the reference,
    // the spill drops steeply for the first few pixels and then carries on
    // almost flat for ten times that distance. A single decay tuned bright
    // enough at the rim has died by the middle of a stroke; tuned long enough
    // to cross one, it floods the mark and drowns the imagery inside it.
    // Its reach belongs to the screen, not to the plane. Left in field units it
    // magnifies along with everything else, and by the end of the push what was
    // a shine along the outline is a flat wash across the whole frame — which
    // over the darkened interior reads as grey fog rather than as light.
    float t = max(0.0, -d + GLOW_ORIGIN) * max(uMagnify, 1.0);
    float glow = GLOW_RIM * exp(-t / GLOW_RIM_REACH)
      + GLOW_HAZE * exp(-t / GLOW_HAZE_REACH);

    gl_FragColor = vec4(sea, (sheet + (1.0 - sheet) * glow) * uOpacity);
  }
`;
