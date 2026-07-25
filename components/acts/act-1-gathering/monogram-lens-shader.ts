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
  /** 0 draws the opening dot, 1 the monogram. */
  uniform float uReveal;
  /** How far the sheet leaks back over the opening. */
  uniform float uTint;
  uniform vec3 uSheet;

  varying vec2 vUv;

  /** Podium's warp: displace radially by a factor quadratic in the radius. */
  vec2 barrelPincushion(vec2 st, float strength) {
    return st * (1.0 + strength * dot(st, st));
  }

  /** Extent the barrel is normalised against, as a multiple of the viewport. */
  const float PLANE_SPAN = 1.4;
  /** Edge band width, in field units. */
  const float EDGE = 0.0035;
  /** Radius of the dot the mark opens out of, in field units. */
  const float DOT = 0.006;
  /** How quickly the tint's distance term saturates away from the outline. */
  const float TINT_SPREAD = 6.0;
  /** Tint floor — the sheet's reach even hard against the outline. */
  const float TINT_BASE = 0.3;
  /** Falloff of the tint. High, so the leak stays a whisper until it is not. */
  const float TINT_FALLOFF = 4.0;

  void main() {
    vec2 px = (vUv - 0.5) * uResolution;
    // the same screen point, expressed on the glyph plane in rest pixels
    vec2 plane = px / uMagnify;

    vec2 warped = barrelPincushion(plane / uResolution * PLANE_SPAN, uBarrel)
      * uResolution / PLANE_SPAN;

    float shape = texture2D(uField, warped / uFieldPx + 0.5).r;
    float dot_ = length(warped) / uFieldPx - DOT;
    // linear blend of two distance fields is a morph between their outlines
    float d = mix(dot_, shape, uReveal);

    float mask = smoothstep(0.0, EDGE, d);

    // The sheet bleeds back through the opening with distance from the screen
    // centre, so the mark reads solid where you are looking and dissolves into
    // the page toward the edges — and haloes faintly on the outside of its own
    // outline. Scaling the distance term by the magnification keeps that halo a
    // constant width on screen rather than swelling with the plane.
    float bleed = length(vUv - 0.5)
      + smoothstep(-1.0, 1.0, d * uMagnify * TINT_SPREAD)
      + TINT_BASE;
    mask = pow(clamp(mix(mask, bleed, uTint), 0.0, 1.0), TINT_FALLOFF);

    gl_FragColor = vec4(uSheet, mask);
  }
`;
