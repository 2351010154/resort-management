// The leaf shadow thrown across Act 2's wall — GLSL for the two passes.
//
// Follows the oryzo.ai gobo: a small offscreen pass draws the foliage mask and
// wiggles it, then the screen pass samples that mask with a golden-angle spiral
// blur whose radius grows the further the branch reaches from the window, so a
// frond reads crisp where it enters frame and dissolves as it comes inboard.
// Their mask is a baked RGBA plate (r = shadow, gba = sway amplitude/phase) fed
// through a three-harmonic sine sum; ours is generated here, so the same sine
// sum rotates each leaf about its own stem instead of only pushing a baked
// value around — which is what buys the leaves their independent flutter.
//
// Two layers, as the comp has: the cast branch coming in at the top right, and a
// near mass hanging into the bottom left, close enough to the light that it
// blurs to nothing but soft shape. They ride the red and green channels of the
// one mask, since they only differ in how hard the screen pass blurs them.
//
// Everything lives in "gobo units": y spans 0..1 bottom to top of the frame, x
// is scaled by the frame aspect so a leaf is the same shape on any screen.

export const quadVertex = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Sprays in each layer, and leaf nodes per spray (two leaves hang off a node). */
const BRANCHES = 4;
const NEAR_BRANCHES = 2;
const NODES = 6;
/** Out-of-focus flower heads dropped into the near mass. */
const BLOBS = 4;

export const maskFragment = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform float uTime;
uniform float uAspect;
/** 0 parks the foliage (reduced motion), 1 is a full breeze. */
uniform float uSway;
/** Pointer in gobo units. */
uniform vec2 uPointer;
/** 0 when the pointer isn't over the act at all. */
uniform float uPointerReach;
/** Pointer speed, so a flick stirs the leaves it passes through. */
uniform float uGust;

#define BRANCHES ${BRANCHES}
#define NEAR_BRANCHES ${NEAR_BRANCHES}
#define NODES ${NODES}
#define BLOBS ${BLOBS}

const float PI = 3.14159265359;
const float TAU = 6.28318530718;

/**
 * How far the pointer's influence carries, in gobo units — about a third of the
 * frame height. Outside it a leaf keeps its own quiet breeze and nothing more.
 */
const float POINTER_RADIUS = 0.40;
/** Ceiling on the local response: directly under the cursor, sway times this. */
const float POINTER_GAIN = 4.0;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

vec2 bezier(vec2 p0, vec2 p1, vec2 p2, float t) {
  float u = 1.0 - t;
  return u * u * p0 + 2.0 * u * t * p1 + t * t * p2;
}

vec2 bezierTangent(vec2 p0, vec2 p1, vec2 p2, float t) {
  return 2.0 * (1.0 - t) * (p1 - p0) + 2.0 * t * (p2 - p1);
}

/** Soft capsule, for the woody stem between two nodes. */
float stem(vec2 p, vec2 a, vec2 b, float width) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return 1.0 - smoothstep(width * 0.35, width, length(pa - ba * h));
}

/**
 * One lanceolate leaf: widest a third of the way along, pointed at the tip,
 * blunt where it meets the stem. rel is measured from that joint.
 */
float leaf(vec2 rel, float angle, float len, float width) {
  float c = cos(angle);
  float s = sin(angle);
  vec2 local = vec2(rel.x * c + rel.y * s, -rel.x * s + rel.y * c);
  float t = local.x / len;
  if (t < 0.0 || t > 1.0) return 0.0;
  float w = width * pow(sin(PI * pow(t, 0.72)), 0.6);
  return 1.0 - smoothstep(w * 0.45, w, abs(local.y));
}

/**
 * Local pointer weight at a point on the wall: 1 directly under the cursor,
 * nothing beyond POINTER_RADIUS. This is why the response is local — the boost
 * is evaluated per leaf joint rather than mixed into a single global amplitude.
 */
float pointerWeight(vec2 at) {
  float d = length(at - uPointer);
  float fall = 1.0 - smoothstep(0.0, POINTER_RADIUS, d);
  // Slightly sharpened, so the core is decisive and the edge still tapers —
  // squaring it made the influence too tight to notice on a whole cluster.
  return uPointerReach * pow(fall, 1.4);
}

/**
 * Leaves along one bezier spray. size scales the whole frond (the near layer
 * sits closer to the light, so it casts bigger), swayScale how much of the
 * breeze it takes.
 */
float sprayLeaves(
  vec2 p, vec2 p0, vec2 p1, vec2 p2, float seed, float size, float swayScale
) {
  float mask = 0.0;
  vec2 prev = p0;

  for (int i = 0; i < NODES; i++) {
    float hn = hash11(seed * 31.0 + float(i) * 5.9);
    // Uneven node spacing, or the spray reads as a machined fern rather than
    // something that grew.
    float ft = (float(i) + 0.55 + 0.55 * hn) / float(NODES);
    vec2 node = bezier(p0, p1, p2, ft);
    mask = max(mask, stem(p, prev, node, 0.007 * size * (1.0 - 0.5 * ft)));
    prev = node;

    vec2 rel = p - node;
    if (dot(rel, rel) > 0.075 * size * size) continue;

    vec2 tangent = bezierTangent(p0, p1, p2, ft);
    float stemAngle = atan(tangent.y, tangent.x);
    // Every leaf on this node shares the cursor's weight at the joint. A cursor
    // simply resting over them already stirs them; moving through does more.
    float local = pointerWeight(node) * (0.7 + 0.3 * min(uGust, 2.0));

    for (int s = 0; s < 2; s++) {
      float side = float(s) * 2.0 - 1.0;
      float id = seed * 17.0 + float(i) * 2.0 + float(s);
      float h = hash11(id * 1.13);
      float phase = (hash11(id * 2.37) - 0.5) * TAU;
      // A fifth of the nodes carry only one leaf — real sprays have gaps.
      if (hash11(id * 3.91) < 0.2) continue;

      // oryzo's three-harmonic sway, per leaf: one slow swing plus two fast
      // ripples an octave and a fifth up, phase-offset off the leaf id.
      vec3 waves = sin(
        uTime * vec3(1.0, 2.0, 3.0) * (0.9 + 0.35 * h) + phase * vec3(1.0, 2.0, 0.5)
      );
      // Resting swing is about two degrees — present if you watch the wall, not
      // if you're reading the line in front of it.
      float amp1 = 0.032 + 0.020 * h;
      float amp23 = 0.016 * h;
      float motion = amp1 * waves.x + amp23 * 0.5 * waves.y + amp23 * 0.3 * waves.z;
      // Under the cursor a leaf doesn't just swing wider, it trembles quicker.
      float tremble = local * (0.05 + 0.03 * h) * sin(uTime * 4.3 + phase * 1.7);

      float splay = side * (0.52 + 0.62 * h);
      // Tips flutter more than the leaves back at the joint.
      float flutter =
        (motion * (1.0 + POINTER_GAIN * local) + tremble) * uSway * swayScale * (0.35 + 0.9 * ft);
      float len = (0.10 + 0.045 * h) * (1.0 - 0.35 * ft) * size;

      mask = max(mask, leaf(rel, stemAngle + splay + flutter, len, len * (0.21 + 0.07 * h)));
    }
  }

  return mask;
}

void main() {
  vec2 p = vec2(vUv.x * uAspect, vUv.y);
  // Everything here is measured against frame height, which on a phone is most
  // of the screen — so a spray sized for a laptop swallows a portrait frame.
  // Pull it in with the aspect.
  float scale = clamp(0.55 + 0.45 * uAspect, 0.72, 1.0);

  // Far layer: the cast branch, hung off an anchor just outside the top-right
  // corner so it arrives already in frame rather than growing out of a point.
  vec2 anchor = vec2(uAspect + 0.06, 1.08);
  float branches = 0.0;

  for (int b = 0; b < BRANCHES; b++) {
    float fb = float(b);
    float hb = hash11(fb * 1.71 + 0.3);

    // The fan: branch 0 falls straight down the right edge, the last one
    // reaches left along the top. Reach is held short on purpose — the comp
    // keeps every frond inside the right third or so of the frame.
    float angle = -1.98 - 0.40 * fb - 0.16 * hb;
    // The first branch runs longest: in the comp one spray carries on down the
    // right edge well past where the others stop.
    float taper = 1.0 + 0.30 * (1.0 - fb / float(BRANCHES - 1));
    float reach = (0.52 + 0.34 * hb) * taper * scale;
    vec2 dir = vec2(cos(angle), sin(angle));
    vec2 perp = vec2(-dir.y, dir.x);

    vec2 p0 = anchor + vec2(-0.03 * fb, -0.09 * fb - 0.05 * hb);
    vec2 p2 = p0 + dir * reach;
    vec2 p1 = mix(p0, p2, 0.5) + perp * (0.30 * (hb - 0.35));

    // Cheap reject: skip the spray entirely unless the sample is near its span.
    if (length(p - mix(p0, p2, 0.5)) > reach * 0.62 + 0.24) continue;

    // Slow carrier the leaves ride on: the whole branch leaning in the breeze,
    // hinged at the anchor so the tip travels furthest. Leaning is a bigger
    // move than a leaf's flutter, so it stays smaller and only opens up where
    // the cursor is actually near the branch.
    float bend = sin(uTime * 0.45 + hb * TAU) * (0.015 + 0.012 * hb) * uSway;
    bend *= 1.0 + 1.8 * pointerWeight(mix(p0, p2, 0.7));
    p1 += perp * bend;
    p2 += perp * bend * 2.4;

    branches = max(branches, sprayLeaves(p, p0, p1, p2, fb, scale, 1.0));
  }

  // Near layer: foliage hanging into the bottom left, close enough to the light
  // that the screen pass blurs it to soft mass. Anchored off-frame on the left
  // and swept inboard, which is where the comp carries its weight.
  float near = 0.0;

  for (int b = 0; b < NEAR_BRANCHES; b++) {
    float fb = float(b);
    float hb = hash11(fb * 5.13 + 2.7);

    // One spray falls in from the left edge above centre, the other climbs out
    // of the bottom-left corner; they cross low and left.
    float angle = mix(-0.62, 0.66, fb) + (hb - 0.5) * 0.3;
    float reach = (0.78 + 0.22 * hb) * scale;
    vec2 dir = vec2(cos(angle), sin(angle));
    vec2 perp = vec2(-dir.y, dir.x);

    // Both start clear of the wall's foot, so the taper down there trims their
    // edge rather than eating the body of the mass.
    vec2 p0 = vec2(-0.14 + 0.06 * fb, mix(0.68, 0.10, fb));
    vec2 p2 = p0 + dir * reach;
    vec2 p1 = mix(p0, p2, 0.5) + perp * (0.34 * (hb - 0.45));

    float bend = sin(uTime * 0.38 + hb * TAU) * (0.018 + 0.012 * hb) * uSway;
    bend *= 1.0 + 1.8 * pointerWeight(mix(p0, p2, 0.7));
    p1 += perp * bend;
    p2 += perp * bend * 2.2;

    // Nearer the light, so it casts larger — but not so large that the leaves
    // stop reading as leaves once the screen pass softens them.
    near = max(near, sprayLeaves(p, p0, p1, p2, 40.0 + fb, 1.55 * scale, 0.7));
  }

  // Out-of-focus flower heads tucked into that mass, low and left.
  for (int i = 0; i < BLOBS; i++) {
    float fi = float(i);
    float h = hash11(fi * 4.7 + 1.1);
    vec2 c = vec2(-0.08 + 0.30 * h, 0.14 + 0.40 * hash11(fi * 9.1));
    float r = (0.12 + 0.11 * h) * scale;
    vec2 wobble =
      0.02 * vec2(sin(uTime * 0.31 + fi), cos(uTime * 0.24 + fi * 1.7)) * uSway;
    near = max(near, 1.0 - smoothstep(r * 0.25, r, length((p - c - wobble) * vec2(1.0, 0.85))));
  }

  gl_FragColor = vec4(branches, near, 0.0, 1.0);
}
`;

/** Spiral blur taps. oryzo runs 16 for its hero; 10 is plenty behind a wall. */
const BLUR_SAMPLE = 10;

export const compositeFragment = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform sampler2D uMask;
uniform float uMaskTexel;
uniform float uAspect;
/** Act-level fade on the cast branch. */
uniform float uOpacity;
/** The near mass is far fainter than the branch — measured off the comp. */
uniform float uNearOpacity;
/** Eased pointer, in frame units: the window swinging a little. */
uniform vec2 uTilt;
/** What the wall goes to under full shadow, as a multiply. */
uniform vec3 uTint;

#define BLUR_SAMPLE ${BLUR_SAMPLE}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

/**
 * oryzo's sampleBlur: golden-angle spiral, radius sqrt(i) so taps spread evenly
 * over the disc, start angle jittered per pixel so ten taps read as a smooth
 * penumbra instead of ten ghosts.
 */
vec4 sampleBlur(sampler2D tex, vec2 uv, vec2 texelSize, float blurAmount, float n) {
  const float G = 2.39996323;
  float gc = cos(G);
  float gs = sin(G);
  mat2 rot = mat2(gc, gs, -gs, gc);
  float initialAngle = n * 6.28318530718;
  vec2 d = vec2(cos(initialAngle), sin(initialAngle));
  float sn = 1.0 / sqrt(float(BLUR_SAMPLE));
  vec2 s = texelSize * blurAmount * sn;
  vec4 c = vec4(0.0);
  for (int i = 0; i < BLUR_SAMPLE; i++) {
    float r = sqrt(float(i + 1));
    c += texture2D(tex, uv + d * r * s);
    d = rot * d;
  }
  return c / float(BLUR_SAMPLE);
}

void main() {
  float n = hash12(gl_FragCoord.xy);
  vec2 texel = vec2(uMaskTexel);
  vec2 uv = vUv + uTilt;

  // How far inboard the sample sits from the corner the light comes through.
  // Stands in for oryzo's getGoboBlurRatio, which reads the same falloff off
  // the gobo's projected depth — here the geometry is flat, so distance is it.
  float inboard = length(
    (vec2(vUv.x * uAspect, vUv.y) - vec2(uAspect, 1.0)) / vec2(uAspect, 1.0)
  );
  float penumbra = mix(2.5, 13.0, smoothstep(0.12, 0.95, inboard));

  float branch = sampleBlur(uMask, uv, texel, penumbra, n).r;
  // Softer than the branch but still legible as leaves: enough blur to sit
  // behind the line without competing, not so much that it washes out.
  float near = sampleBlur(uMask, uv * 1.01, texel, 19.0, n).g;

  float shade = clamp(branch * uOpacity + near * uNearOpacity, 0.0, 1.0);
  // The wall ends at the act boundary, so the shadow has to be gone before its
  // own foot is: any shade still on that last row draws a straight line across
  // the act below, which shares this wall tone and shows it plainly. Fading by
  // scroll position instead only hides it at the very end of the act — mid-act
  // the line is dimmer but still a line.
  shade *= smoothstep(0.0, 0.16, vUv.y);
  vec3 color = mix(vec3(1.0), uTint, shade);
  // A shadow this shallow bands badly over a wide penumbra, so dither it — but
  // only where there is shadow. Off the shadow the pass has to leave exactly
  // white, or the multiply stops being an identity and the canvas's own edges
  // show up as a rectangle on the wall.
  color += (n - 0.5) * (1.6 / 255.0) * min(shade * 12.0, 1.0);

  gl_FragColor = vec4(color, 1.0);
}
`;
