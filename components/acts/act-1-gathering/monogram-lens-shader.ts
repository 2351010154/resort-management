// The monogram lens: one fullscreen quad that paints the ivory sheet
// everywhere except through the mark.
//
// Three things happen to the coordinate on its way to the distance field, and
// the whole look comes from their order:
//
//   1. magnify — the screen point is divided back onto the glyph plane. The
//      plane is what moves; the sheet does not scale, so its colour stays flat
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
// The sheet's colour also spills back in across the outline, which is what
// gives the mark its shine. Two things about that spill matter: it is measured
// off the outline, never off the screen — keyed to screen position it reads as
// a wash laid over the frame rather than as light on the shape — and it starts
// outside the mark, so only its tail is visible and the light plainly comes
// from the page.

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
  uniform vec3 uSheet;

  varying vec2 vUv;

  /** Displace radially by a factor quadratic in the radius. */
  vec2 barrelPincushion(vec2 p, vec2 st, float strength) {
    return p * (1.0 + strength * dot(st, st));
  }

  /** Edge band width, in field units. A few pixels at rest. */
  const float EDGE = 0.0035;
  /** Erosion that holds the mark shut, in field units. Past its half-thickness. */
  const float CLOSED = 0.075;
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
    float shape = texture2D(uField, warped / uFieldPx + 0.5).r;
    // The mark opens by un-eroding, which on a distance field is one offset.
    // Held shut it is eaten back past its own half-thickness and nothing shows;
    // as the offset relaxes the strokes surface as rounded islands at their
    // widest points and close up into the letter. Morphing out of a circle
    // instead makes the thin strokes arrive as spikes.
    float d = shape + (1.0 - uReveal) * CLOSED;

    // The outline itself. Nothing softens it beyond this band, so the silhouette
    // stays a drawn edge; the band is in field units, so it is the plane
    // magnifying it that melts it late in the push, not a blur.
    float sheet = smoothstep(0.0, EDGE, d);

    // Spill: page light crossing the outline and dying away inside the mark.
    //
    // Its origin sits *outside* the outline, so the bright end of the ramp
    // falls on sheet that is already opaque and only the tail lands on the
    // mark. That is what makes it read as the page lighting the shape rather
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

    gl_FragColor = vec4(uSheet, (sheet + (1.0 - sheet) * glow) * uOpacity);
  }
`;
