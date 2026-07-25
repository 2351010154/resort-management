# Act 4 — Stay: corridor, threshold, rooms

Status: **built.** `npx tsc --noEmit` and `next build` are clean; filmstrips at
desktop and mobile are in `plans/reports/screenshots/act-4-stay/`. See
"Remaining work" for what shipped and "Open observations" for what the frames
turned up.

Replaces the `act-4-first-impression` dark room (WebGL spotlight + floating cube
cards) with a three-movement chapter.

## Accepted decisions

| Question | Decision |
|---|---|
| Scope | Full inline chapter on the one-page ride |
| Build | Replace Act 4 directly (no prototype route) |
| Arch media | `design-materials/collabcapitolium-fr/media/capitole-arcades-a3ae1c42.mp4` |
| Movement III | Day → Night arc |
| Act 5 | **Folded into Stay entirely.** Delete `act-5-exhale`; its dining and spa beats become deck cards. Site goes 7 acts → 6; renumber. |
| Mobile | Compress all three movements to ~700vh total |
| Nav | Bar stays visible; `navDark` flips with the ground at the threshold |
| Copy voice | Plain promises — short, concrete, faintly wry |

### Revision — Movement III rebuilt on the open door

Supersedes the receding-deck spec below wherever the two disagree. Accepted
with the rework:

| Question | Decision |
|---|---|
| Movement III ground | The threshold's door, held open and still playing, full bleed |
| Deck geometry | Two mirrored perspective cascades, day then night, per `third.mp4` |
| Day → night | No longer a ground colour tween. One scrim, ivory copy throughout |
| Halves | Wipe, not cross-fade: one edge sweeps left to right |
| Loop | Cards wrap; the deck is full at every scroll position and drifts when idle |
| Nav | Act 4 is dark end to end and joins `DARK_ACTS` |

## Outcome

STAY becomes the chapter that sells the rooms: a dark horizontal corridor of
promises, an arch that opens onto daylight, and a receding deck of suites that
runs one day from waking to sleeping.

## Non-goals

- No new scroll axis. Every horizontal move is scrub-driven inside a GSAP pin on
  the single vertical scrollbar. Wheel/touch is never captured.
- No WebGL. This chapter is DOM + CSS transforms only; the GPU budget stays with
  Act 1.
- No booking UI. STAY shows; the Invitation act invites.

## Measured reference values

Read from `design-materials/STAY tab/*.mp4` by frame extraction.

**`first.mp4` (oryzo.ai horizontal filmstrip)** — normalised cross-correlation of
windows between full-resolution frames at t=2.90 and t=3.30 (source 2464px wide,
0.4s baseline; every window stays fully on-screen at the matched shift):

| window | shift | corr | rate vs track |
|---|---|---|---|
| panel edge (gutter straddle) | −334 px | 0.984 | 1.000 |
| headline glyphs | −334 px | 0.998 | 1.000 |
| photo — sky / milky way | −313 px | 0.999 | **0.937** |
| photo — mountain ridge | −313 px | 0.999 | **0.937** |
| photo — ground rocks | −313 px | 0.995 | **0.937** |
| photo — table + mug | −313 px | 0.999 | **0.937** |

**Two rates, not three.** The panel and its headline are locked together at
1.000; every photographic layer, near and far, moves at 0.937 — a flat 6.3% lag.
The headline is wider than its panel and clipped by it, so it reads out as the
panel crosses the viewport, but it does not slide within the panel.

A 6.3% lag is also the only rate that *fits*: a panel traverses roughly
`vw + panelWidth` of track, so the image slides about 6% of that — ~190px on a
1440px viewport, which an image at 116% of panel width absorbs with room to
spare. An earlier eyeball estimate of 0.84 implied ~500px of slide and could not
have been produced by an oversized-image mask, which is what prompted the
measurement.

Two caveats found while measuring, recorded so they are not repeated: a 1.0s
baseline is unusable — the layout travels ~780px, so windows fall off the frame
edge and the search clamps, returning rates above 1.0. And any window overlapping
the headline glyphs or the panel caption reports 1.000 regardless of what
photography is in it.

**`second.mp4` (arch)** — three arched apertures, semicircular tops. The centre
aperture's *mask* grows to full viewport; the media inside never scales. Flanks
translate outward and fade. Display line rises at roughly 0.6x the media.

**`third.mp4` (deck)** — measured by normalised cross-correlation on 180px
windows between full-resolution frames 0.4s apart, once inside each half.

| half | window row | dx across the row | dy |
|---|---|---|---|
| ON (t=3.0→3.4) | y = 0.45H | +0 → +64 px, rising left to right | +12 → +36 |
| ON | y = 0.62H | +28 → +112 px | +20 → +44 |
| OFF (t=9.0→9.4) | y = 0.45H | −100 → 0 px, rising right to left | +32 → 0 |
| OFF | y = 0.62H | −100 → 0 px | +40 → 0 |

**Two mirrored halves, not one deck.** Displacement is proportional to distance
from a point, and that point is on the side the list is on: the ON half runs
from an upper-*left* vanishing point down and to the right, the OFF half from an
upper-*right* one down and to the left. Cards *grow* as they travel; they spawn
small behind the text column and leave past the opposite bottom corner. Fitting
the three visible card sizes and centres in the OFF half puts its vanishing
point at ≈ (0.97 W, −0.09 H) and gives a size ratio of ≈ 1.24 per card.

An earlier reading of this clip as a single deck receding toward the upper left
had the direction of travel backwards; the shift table is what corrected it.

**The halves change with a wipe.** One vertical edge sweeps left to right over
about 2.5s (t≈4.6 → 7.1), night behind it and day ahead of it. Both halves keep
animating throughout — the outgoing list is clipped mid-word rather than faded.
It is not a slide: neither panel's own edge moves.

Side column dims every entry except the one in focus. Cursor response is
depth-weighted.

## Scroll budget

Three sibling sub-sections inside one `<section data-act={4}>`, each with its own
pin + scrub, matching the existing per-act pattern (`pinSpacing: false`, tail
fades across seams).

| movement | desktop | mobile | ground |
|---|---|---|---|
| I — Corridor | 480vh | 260vh | `--ink` |
| II — Threshold | 280vh | 180vh | `--ink` → arcade → open door |
| III — Rooms | 700vh | 340vh | the open door, scrimmed |

Total 1460vh desktop / 780vh mobile. Deleting Act 5 (300vh) roughly offsets this
against the previous total.

**Two of the pins outlive their own sections.** The threshold's stage and the
rooms' stage are both pinned to `[data-act="5"] top top`, not to their own
`bottom bottom`. Released at their own bottoms, the door would drop out from
under a deck that is still running, and the deck would then scroll away over the
last viewport before the Invitation starts — the one genuinely blank frame on
the ride. Each movement keeps a second, unpinned trigger on its own range for
its scrub, because the timeline still has to finish with the section.

Both stages also carry an explicit `z-index` (threshold 1, rooms 2). Pinning
makes them `position: fixed` with no stacking order of their own, and Act 5 is a
positioned section later in the document: without those, it climbs over both as
it rises and cuts the frame off from the bottom up.

## Movement I — Corridor  *(built)*

`corridor-track.tsx`. Horizontal track of 8 panels (6 photo, 2 tone), 78vh tall,
gutter `--space-2`, dark page band above and below.

Parallax is keyed to the panel's position relative to the viewport, not to total
track distance: each panel's image gets
`translateX(0.063 * (panelCentre − viewportCentre))`, which yields the measured
0.937 net rate and keeps the slide inside the image's overflow throughout.
The headline and caption take no counter-translation.

Copy — plain promises:

| panel | headline | caption |
|---|---|---|
| corridor-lounge | Nothing to do | And all day to do it. |
| tone | — | Twenty-four rooms. No two of them alike. |
| corridor-colonnade | Still water | 36°C, always. |
| corridor-shelf | — | Kept, not displayed. |
| corridor-steam | Warm stone | The bath is already drawn. |
| tone | — | The walk from the door is part of the room. |
| corridor-arva | — | The last table stays lit. |
| corridor-arch-hall | Your door | Suite 704. |

Foot of the stage: monogram in a hairline circle + SCROLL TO CONTINUE + dashed
progress rule (oryzo dashline motif), so the vertical scrollbar stays honest.

## Movement II — Threshold  *(built)*

`threshold-arches.tsx`. Three full-viewport `<video>` layers of the same arcade
clip at different `currentTime` offsets (1.5s / 8.5s / 15s), each clipped to its
own arch by
`clip-path: inset(var(--t) var(--r) var(--b) var(--l) round var(--rad) var(--rad) 0 0)`.

Clipping (not a moving mask box) guarantees the reference's defining property:
the mask grows, the media holds. GSAP tweens the CSS custom properties.

| p | beat |
|---|---|
| 0 → 0.16 | arches rise in, staggered |
| 0.18 → 0.50 | held drift |
| 0.50 → 0.82 | flanks translate outward + fade; centre inset → 0, radius → 0 |
| 0.82 → 1.00 | line rises, then clears; the door's scrim comes up |

There is no ivory bloom any more. The door does not hand off to Movement III —
it *is* Movement III's ground, so the last thing this timeline does is bring up
the scrim the rooms read on. That scrim belongs to this stage rather than to the
rooms' own: the rooms' stage slides up into the frame before it pins, and a
scrim living there would drag a hard horizontal edge across the door on the way
in. The flanks' videos are paused past p = 0.72 — they have left the frame, and
the stage stays pinned for another 700vh.

`navDark` stays true throughout; Act 4 is now dark end to end.
Mobile renders the centre arch only, at the 760px tier.

## Movement III — Rooms  *(built)*

`room-deck.tsx`. No ground of its own — it plays on the door the threshold left
open, under that stage's scrim. Two mirrored cascades, day then night.

**One factor, not four.** A card at depth `d` has
`r = GROWTH^(d − SPAN)`, and `r` scales *both* its size and its offset from the
vanishing point:

- `centre = vp + (exit − vp) * r`
- `width = exitW * r`
- `opacity = smoothstep(0, 1.4, d) * (1 − smoothstep(SPAN−0.9, SPAN, d))`
- `z-index` ascends with `r`

Deriving position and size from the same factor is what makes the stack read as
one perspective rather than a fan of separately scaled photos, and it is what
the shift table above actually measures.

`GROWTH = 1.24`, `SPAN = 8`, `CARD_ASPECT = 3/2`. Night frame, in viewport
widths / heights: `vp = (0.97, −0.09)`, `exit = (−0.53, 1.33)`, `exitW = 0.80`;
narrow tier `(1.04, −0.05)` / `(−1.0, 1.24)` / `1.5`. The day frame is the night
one reflected in x. The exit has to be far enough out that a card at `r = 1` is
entirely off-frame — that is what makes the recycle invisible.

**The loop.** Card ordinals are integers; ordinal `m` is visible while
`d = k − m` is in `[0, SPAN)`. Because `r` is exponential in `d`, the
composition is self-similar under a shift of exactly one step: advance every
card one depth, move the one that fell off the near end back to the far end, and
the frame is the same frame with the next room in it. So there is no seam to
hide, and the stage is full at *every* `k` — which is what lets the movement
reach the Invitation without ever emptying.

`POOL = 12` card nodes per half, a multiple of the 6 rooms on purpose: a node's
recycle slot is `m mod POOL` and its room is `m mod 6`, so when POOL is a
multiple of HALF a node keeps one room for the life of the page and no `src`
ever changes under a visible card. The four nodes past SPAN park at opacity 0 —
the cost of that guarantee.

**Depth advances two ways.** `k = FOCUS_D + run(p) * STEPS + elapsed * DRIFT`,
with `STEPS = 6.2` (one step is one room through focus, so a scroll of a half is
very nearly one pass of its six) and `DRIFT = 0.11` steps/second. The drift is
the "keeps sliding on its own" half of the brief; it is also why the room the
deck ends on is not fixed.

`FOCUS_D = 5`; focus is `round(k − FOCUS_D) mod 6`, written straight to the list
DOM nodes. Do **not** put per-frame focus in React state.

**The wipe.** Day runs over p = 0 → 0.56, night over p = 0.40 → 1.0, so the
night cascade is already mid-run when it is uncovered. One edge sweeps
left to right over p = 0.46 → 0.64 and the two clips are complements —
`night: inset(0 (1−e)·100% 0 0)`, `day: inset(0 0 0 e·100%)`. Complements, not
one clip: with only the incoming half clipped, the outgoing half shows through
the gaps between the incoming cards and the frame reads as two decks at once.

At phone width both lists sit on the same strip across the foot, so a vertical
wipe leaves them printing over each other mid-sweep. The stage carries
`data-half`; the breakpoint fades the half that does not own the strip.

| # | slug | name | note |
|---|---|---|---|
| 0 | room-cedar | Cedar Suite | 68 m² · garden |
| 1 | room-mori | Mori Pavilion | 94 m² · forest |
| 2 | room-park | Park Suite | 72 m² · canopy |
| 3 | room-sky-lounge | Sky Lounge Suite | 110 m² · skyline |
| 4 | room-washigamine | Washigamine Suite | 88 m² · standing forest |
| 5 | room-bath | The Bath House | lap pool · 06:00–22:00 |
| 6 | room-onsen | Onsen Villa | private spring · 41°C |
| 7 | room-table | The Table | eight seats · one sitting |
| 8 | room-library | Library Suite | 76 m² · reading room |
| 9 | room-premier | Premier Room | 58 m² · city |
| 10 | room-lantern | Lantern Suite | 82 m² · lantern court |
| 11 | room-autumn | Autumn Suite | 96 m² · dusk terrace |

0–5 are the day half, 6–11 the night half. Each list sits on the side its
cascade recedes toward, so the cards spawn behind the list and grow away from
it. There is no day → night ground tween any more: the door is the ground, one
scrim, ivory copy throughout.

The card is the frame — no caption rides with it. A per-card caption would scale
with the depth and be illegible at the far end; the side list carries the names,
which is also what the reference does.

**Seam into the Invitation.** `tailFade` is the whole frame rather than a bottom
gradient, and it runs on `[data-act="5"]` from `top bottom` to `top top` — that
is exactly the window between the deck's last full frame and Act 5 taking the
viewport. It closes on `#100e0c`, which is the value Act 5's section opens on
and the value its steam rises out of. Act 5's own bridge is gone with it: it
used to open on ivory and fade its imagery in at 16% of a 350vh act, which put
roughly a viewport and a half of flat black between the two.

Cursor: `SecondOrderSpring2` (f=1.1, z=0.55, r=1.4) on normalised pointer;
per-card offset scales with that card's current `r` — up to ~26px at the near
end — plus `rotateY` up to 4deg. One field response, not per-card hover. Drive
all DOM writes from a single `gsap.ticker` callback that reads a scroll-progress
ref; do not write from both ScrollTrigger and the ticker.

`roomScrollTarget(index)` solves the same transform for the progress that puts a
given room in the focus slot, so the island menu can aim at a room. It reads the
drift from the same clock the ticker does; the ~0.15 step the deck moves during
the scroll animation is under a sixth of a card and is not corrected for.

## Assets  *(done)*

- Curation map rewritten: `act-4-room` and `act-5-breathe` dropped;
  `act-4-corridor` (6) and `act-4-rooms` (12) added. Manifest regenerated.
  `prepare-arrival-images.mjs` `ImageRole` union updated to include
  `corridor-panel` and `room-card`.
- `scripts/encode-threshold-video.mjs` → `public/video/threshold/`.
  Crop `1160:1080:0:0` clears the shop signage on every frame of all 20s
  (swept and checked). Grade desaturates the primary-colour ceiling murals into
  the sand/umber family. Source is HEVC, which browsers will not decode, so the
  re-encode is mandatory.

## Remaining work  *(all done)*

0. **Unbreak the build.** ✅ `act-4-first-impression/` and `act-5-exhale/`
   deleted.
1. ✅ `room-deck.tsx` and the `act-4-stay.tsx` orchestrator.
2. ✅ `page.tsx` wired.
3. ✅ Renumber: Invitation 6 → 5, Turndown 7 → 6. Component directories renamed
   with them (`act-5-invitation/`, `act-6-turndown/`); the generated image
   buckets keep their `act-6-invite` names, which are curation-map keys rather
   than act numbers. `NAV_LINKS` drops the folded act and is now
   Welcome / The Approach / Stay / Begin. `DARK_ACTS` is `{4, 5, 6}` since the
   Movement III rework.
4. ✅ Stay / Dine / Restore resolve to deck cards 0, 7, 6 through
   `roomScrollTarget()`, which solves the deck transform for the progress that
   puts a given card in the focus slot. Verified to land on three distinct
   offsets with the right entry focused. The footer's "The resort" column had
   the same three-labels-two-destinations defect *and* would have pointed Dine
   and Restore at the Invitation after the renumber; it uses the same helper.
5. ✅ VP9 fixed. Two faults, not one: crf 40 was too rich, and `-b:v 0 -crf` run
   as two passes is not constant quality — the second pass redistributes bitrate
   and came back *larger* than one pass at the same crf (4.17 MB vs 2.67 MB).
   Now single-pass, per-tier crf (1160 → 44, 760 → 48) because the x264 side
   uses one fixed crf for both tiers. 1160: 2.53 MB webm / 3.16 MB mp4. 760:
   1.12 / 1.51. The script now throws if a webm is not smaller than its mp4 —
   `<source>` order means a heavier webm is the one that gets fetched.

## Validation  *(done)*

- ✅ `npx tsc --noEmit` and `next build` clean.
- ✅ Filmstrip at 5% steps, desktop + mobile, in
  `plans/reports/screenshots/act-4-stay/`. `scripts/capture-act-4-stay.mjs`
  also takes a movement name (`corridor` | `threshold` | `rooms`) — 5% of the
  whole act is far too coarse to read the threshold, which is only ~4 frames of
  it.
- ✅ Reduced motion: no pins, no fixed elements, no `<video>`; 19 stills across
  the three movements.
- ✅ **The arch reads as a door, not a zoom.** Confirmed on
  `act-4-stay-threshold/desktop-08-p050` → `-10-p063` → `-13-p081`: the columns
  and the arch inside the footage hold the same screen position and scale while
  the clip grows around them. Only the source's own slow walk moves.

## Fixed while wiring up

The two pre-built movements had not been rendered; the filmstrip found these.

- **Corridor panel widths were desktop-only.** `--w` is in vw, so the 24vw tone
  panel was 346px of filmstrip on a laptop and a 94px sliver on a phone, with
  its copy setting one word per line. Panels now carry a separate `mw`.
- **The nav stayed light over the dark corridor when jumped to.** The "Stay"
  nav link scrolls to the act's exact top, which is the corridor pin's own
  `start` — a jump that lands *on* a boundary does not reliably cross it, so
  neither `onEnter` nor an `onUpdate` progress change fires. A dedicated
  `navDark` trigger at `top top+=4` opens before that landing. (`top-=2` moves
  the start *later*, not earlier — the offset is applied to the scroller edge.)
- **`navDark` had no owner during the corridor.** `DARK_ACTS` no longer contains
  4, and the threshold only flipped it *off*. The corridor now asserts it on,
  and only on, so the ink tail between the two pins stays dark; Movement III
  flips it back at the midpoint of the day → night crossing.
- **Reduced-motion captions overflowed onto the row below** — `height: 100%` on
  a grid figure's image left no room for the caption.
- **Both mobile room lists pinned their titles to the same strip**, so DAY and
  NIGHT overlapped. The titles are hidden at that width; the ground already
  says which half of the day it is.

## Fixed in the Movement III rework

- **The deck no longer empties.** The old translate ran card 11 off the left
  edge at p = 1, leaving the closing ~70vh bare. The wrapping cascade is full at
  every `k` by construction, so this cannot recur without changing SPAN.
- **The three worst pin seams are gone**, all by the same move: hold the pin to
  the *next* thing rather than to the section's own bottom. Threshold → rooms
  was a full ivory frame; rooms → Invitation was roughly a viewport and a half of
  flat black. Both now hand over with the frame full.
- **`navDark` no longer flips mid-threshold.** Act 4 is dark end to end and sits
  in `DARK_ACTS`, which also gets the bar right under reduced motion, where no
  scroll trigger runs at all.

## Open observations

Not acted on — each is either a spec value or outside this act's scope.

- **The grade does not neutralise the ceiling murals.** `saturation=0.74` pulls
  the stone and brick into the palette, but the frescoes still read as saturated
  green/blue/red pop art at full bleed, and the rooms now play on that footage
  for 700vh rather than passing it in four frames. The scrim sinks it a long
  way — it reads as shadowed masonry more than as fresco — but this is still the
  most legible tell that the footage is a Toulouse arcade.
- **The corridor → threshold seam is still ~40vh of near-black**, between the
  corridor stage clearing the top of the frame and the arches rising
  (`desktop-07-p035`). Ground-on-ground, so it reads as a passage rather than a
  cut; the same extended-pin fix would close it, but the corridor is outside the
  scope of this rework.
- **The wipe is vertical at phone width too.** On a 390px frame the edge crosses
  a single column of cards, which is legible but is not what a mirrored pair of
  cascades is for. A horizontal wipe, or a straight cross-fade, may read better
  at that width.
- **Four of the twelve card nodes per half are always parked** at opacity 0,
  because POOL has to be a multiple of the six rooms for a node to keep one
  image and SPAN is 8. Six nodes and a coarser GROWTH would waste none, but at
  `GROWTH = 1.35` only about three cards fall inside the reference's visible
  band instead of five.
