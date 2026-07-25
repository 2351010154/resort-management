# Intro push retiming — measured against podium-global

Status: done — filmstrips in `plans/reports/screenshots/intro-push/`

## What the reference actually does

Read from `design-materials/podium-global/js/0sj4kuf__6z9l.js` (config) and
`081f64dmupv9q.js` (hero + mosaic scenes), cross-checked against
`podium-intro-reference.mp4`.

**Two scroll ranges, not one.**

| range | trigger | span |
|---|---|---|
| mark ("hero") | hero section `h-svh`, `top top` → mosaic `top top` | **100vh** |
| images ("mosaic") | mosaic section `h-[200svh]`, `top bottom` → projectGrid `top center` | **250vh** |

Both start at scroll 0. The mark owns the first 100vh (40% of the intro); the
image field keeps travelling for the remaining 150vh.

**Both pushes are constant velocity.** The mark is a plane translated toward the
camera by `plane.z = progress * camera.z` (camera at z=5), so its apparent size
is `1/(1 - progress)` — hyperbolic, accelerating, and it passes the camera
exactly at progress 1. The image field is a group translated by
`group.z = progress * totalDepth` where `totalDepth` spans the whole stack, so
the deepest plane arrives at the camera exactly at progress 1 too.

Nothing eases out. That is the whole difference.

## What ours was doing

`cameraAdvance(p) = 1 - e^(-3.9p)` over 380vh. The advance asymptotes at 0.98,
so:

- 86% of the camera's travel happens in the first half of the act;
- the deepest card (depth 3.6) magnifies **1.37x across the entire act** — the
  field is visually frozen for the back half;
- nothing past depth 1.16 ever reaches the camera, so no image ever sweeps by;
- the mark only reaches 11x, which does not clear the frame, so the act ends by
  blooming to ivory *while the M is still on screen*. You never get past it.

The filmstrip confirms all four: the M's strokes are legible from p=0.19 to
p=0.94.

## Targets

1. Advance linear in progress — constant forward velocity, `z = TRAVEL * p`.
2. Mark clears the frame at ~p=0.38 and its plane passes the camera at ~p=0.42,
   matching the reference's 40% split.
3. Total act 260vh, so the mark is done in ~99vh — the reference's 100vh.
4. Image field spread so cards arrive continuously from p=0.40 to p=1.0, deeper
   than the reference (the hotel has more to show): 19 cards, deepest tier still
   growing when the bloom lands.
5. Stronger aerial-perspective fog, so distant cards read as distant.

## Non-obvious constraints found while tuning

- **The sheet has to be retired explicitly.** It is a fullscreen quad with no
  camera, so unlike the reference's plane it cannot leave frame. Past the pass
  point the sample converges to one texel and the glow term leaves a flat ivory
  wash over everything.
- **The zoom must stay centred, and it can be.** The clean exit depends on the
  point the frame converges on being *inside* the mark — otherwise the frame
  fills with ivory at the moment it should be opening. Measured: the field's
  midpoint sits 0.019 field units inside the middle apex joint, against a stroke
  half-thickness of about 0.02, and the deepest point anywhere within 4% of the
  midpoint is only 0.026 away from it. So zooming about the midpoint is already
  safe, and no aim is needed. An earlier attempt anchored the zoom on the field's
  deepest-inside texel instead; that texel is the M's bottom-left vertex, 224px
  off centre at desktop size, which visibly slid the mark as it grew and gave the
  monogram plane a projection origin none of the cards shared. Removed.
- **Deep cards must sit near the world centre or they never pay off.** A forward
  push moves everything radially outward, so a card's on-screen offset grows as
  `x/apparent` — faster than its size does. Anything more than ~7vmin off centre
  at rest has left the frame before it finishes growing. The last three cards
  are placed centrally for that reason.
- **A card that passes the camera grows without bound**, so the fade has to be
  keyed to the fraction of the frame it covers, not to its depth. One
  apparent-depth threshold either lets the wide cards black out the frame or
  retires the narrow ones while they are still small.
