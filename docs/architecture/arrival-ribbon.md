# The arrival's ribbon

Act 2 of the marketing arrival: one continuous sheet of ivory snaking down the
act over full-bleed photography, with openings cut through it and the copy set
on the ivory. Behaviour lives in
[`apps/web/features/arrival/components/act-2-ribbon/`](../../apps/web/features/arrival/components/act-2-ribbon/);
this file owns the decisions the code cannot state and the list the
photographic set is commissioned against.

The owner's decisions were taken on 2026-09-07 and are recorded in full in the
plan that produced the act (`plans/260907-1238-act-2-ivory-ribbon/vision.md`,
not versioned). The ones that shape the code:

- **The ribbon owns the act's scroll.** Every beat, opening and photograph is a
  position along the ribbon in page units, not a section with a height.
  Lengthening a beat moves everything after it. `ribbon-beats.ts` is the whole
  of that authoring.
- **One image spans Acts 1 and 2.** Act 1 holds its photograph pinned for
  `ACT2_OVERHANG` after the push, and the ribbon is born over it as a band
  edge to edge with a lobe under it. Act 2 paints no ground under that
  stretch, and draws nothing above the sheet's birth — the SVG does not clip,
  so a stretch drawn above it would paint over Act 1's opening screens.
- **The arrangement is the reference's.** Read top to bottom: the band with
  the first index, a right lobe with a small round opening and the first
  display beside it, a left lobe with the great room opening and the rooms copy
  at the page's edge, a passage where the sheet is a band on the right and the
  type stands in ivory on the photograph, a left lobe with the table opening
  and the copy in caps on its right, and a last lobe carrying its index at the
  page's edge, its display beside it and an opening that turns from day to dusk
  to the right of that — then the sheet widening for the lens. Five beats, four
  numbered; openings can be wider than round (`stretch`), a marker can stand
  away from its display (`marker`), and a stack states what it stands on (`on`).
- **Scale is a set of relations, not a set of numbers.** The reference keeps
  three, and every knot and placement answers to them: an opening is about a
  third of the width of the lobe it is cut in; a lobe leaves a quarter of the
  screen or more as photograph, so the sheet is only ever full width in
  passing; and a block of copy sits in the same lobe as the opening it belongs
  to. The pitch follows from them — a lobe and the crossing under it are
  sixty-four page units, so the reader always has a whole turn of the ribbon in
  front of them. Held widths and a slower pitch give the failure this act was
  first built with: one edge crawling across a screen of blank ivory with a
  small hole in it.
- **The exit is Act 3's frame.** Act 3's section reaches up under Act 2's by
  `ACT2_ACT3_OVERLAP` at a negative z-index, so its frame is pinned and
  fullscreen under the sheet while the last opening grows to the whole screen.
  Act 3 therefore opens fullscreen; its card swell did not survive.
- **Two seam constants, one file.** Both acts read
  [`lib/act-seams.ts`](../../apps/web/features/arrival/lib/act-seams.ts) rather
  than each other.
- **Apertures have declared roles.** `reading` openings hold their place while
  the photograph behind drifts; `feature` openings open from nothing and close
  again; the `exit` opening is the lens.
- **Props rest on the sheet and never enter the lobe below.** The small
  objects filling a lobe's spare ivory (`ribbon-props.ts`) are one still life
  per lobe, read as a day at the house: the tea that fell out of the first
  opening, stones under the rooms note, a ladle whose pour is drawn down the
  water passage's band, bread under the table's note. They are authored like
  beats, in page units, and ride the paper. Each sinks against it by its own
  rate to a bounded drop, turning a little, and settles; the bound is chosen
  so that at full drop the prop still clears every later opening and block of
  copy it shares a column with, on every common aspect, which
  `ribbon-props.spec.ts` checks. Nothing is pinned to the viewport — a prop
  that tracked the camera read as a sticker. Cutouts come from
  `design-materials/transparent-objects`, trimmed to 640px. Narrow screens
  have no spare ivory and get no props.
- **The gobo falls on everything.** Plates, then the sheet, then the leaf
  shadow, then the type. The section carries no z-index so the multiply reaches
  the neighbouring acts' pictures.

## Technique

The sheet is one SVG the size of the viewport, stuck to it for the act, whose
user space is the page (x in vw, y in vh from the act's top). Per scrolled frame
the viewBox is moved to the screen's page position and the path is rebuilt for
the visible stretch. The curve is knots stepped between by smoothstep with a
slow travelling wave over the centreline (`ribbon-geometry.ts`); the copy and
the openings' plates are translated by the same wave so they ride the sheet.
The paper edge is one CSS drop-shadow on the SVG.

Reduced motion renders the whole act once as a tall SVG at the resting curve,
with no sway, no lens and no entrances, and Act 3 does not overlap.

## Photography the composition needs

The frames in the act are placeholders from the existing manifest. The set to
be generated must supply, in this order along the ribbon:

| Slot | Crop | Placeholder now |
|---|---|---|
| Opening 01 and the ground beside it | Act 1's own photograph, seen through the sheet | — |
| Opening 02 | a room, wide — the opening is 1.85× wider than tall | `room-cedar` |
| Ground, the rooms lobe and the passage | wide landscape with water, room for ivory type at the left | `terrace-lunch-sea` |
| Opening 03 | a plate, wide detail — 1.9× | `patisserie-bread` |
| Ground, the table and the last lobe | wide landscape entering from the left | `sunset-hills` |
| Opening 04, day and dusk | the same water at two hours, wide — 1.32× | `pool-hills-day`, `ocean-pool-dusk` |

Grounds are shown one screen at a time at 100vw, so 1920 wide is the floor.
The wide openings are shown at up to four fifths of the width, so 1920 is
their floor too; the round one is safe at 1280.

## Verification

`node apps/web/scripts/capture-act-2-ribbon.mjs` shoots each beat entering and
holding at 1440×900 and 390×844, the two seams, the lens, three reduced-motion
frames, and records the whole passage as a video — the one artefact that can
say whether the snake reads.
