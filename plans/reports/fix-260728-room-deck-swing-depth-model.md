# Room deck pointer swing — depth model

2026-07-28 · `apps/web/features/arrival/components/act-4-stay/room-deck.tsx`
Branch `chore/web-react19-next16`.

## What was wrong

The old swing was

```js
const swing = PERSPECTIVE / (PERSPECTIVE + yaw * (rayX - midX) + pitch * (rayY - midY));
const restX = midX + (rayX - midX) * swing;
```

Expand it for small angles and it comes out as `ΔSx ≈ −yaw · Sx² / PERSPECTIVE`,
where `Sx` is the card's screen offset from the stage centre. That is exactly
the *second-order* term of a real rotation — the foreshortening a card picks up
from being carried toward or away from the eye — with the *first-order* term,
the travel `θ · z` a point earns from standing at depth `z`, missing entirely.

Geometrically it is a rotation in which every card is its own pivot. Which is
why the cascade sheared instead of turning, and why near and far cards answered
the cursor by where they happened to have landed on screen rather than by how
near they are.

Measured, before the fix, at 1440 × 900, progress 0.85 — travel across a full
pointer sweep of the frame, per card, sorted by drawn scale (i.e. by depth):

| drawn scale | yaw sweep dx | pitch sweep dy |
|---|---|---|
| 0.255 | −19.5 | −3.7 |
| 0.329 | −7.4 | −2.5 |
| 0.422 | −10.0 | −6.2 |
| 0.507 | −21.0 | −10.9 |
| 0.668 | −150.8 | −25.4 |
| 0.715 | −82.1 | −34.4 |

Non-monotone in depth, and the whole pitch column is inside 35px: the deck
barely answered the vertical at all. Every card also moved the *same* way
(toward the stage centre), which is a squeeze, not a turn.

## What it does now

Each card is lifted out of the projection, turned with the rest of the group
about one axis, and projected again — five lines in the same ticker pass:

```js
const mx = (rayX - midX) / r;
const my = (rayY - midY) / r;
const mz = PIVOT_Z - PERSPECTIVE / r;
const tx = mx * cosY + mz * sinY;
const zy = mz * cosY - mx * sinY;
const ty = my * cosP + zy * sinP;
const tz = zy * cosP - my * sinP;
const rs = PERSPECTIVE / (PIVOT_Z - tz);
const restX = midX + tx * rs;
const restY = midY + ty * rs;
```

The rotation is exact (`cos`/`sin`, computed once per frame outside the card
loop), and it is the same pair the browser applies to each plate:
`rotateY(yaw) rotateX(-pitch)`, which is why `sinP` enters negated.

### The one constant, and why the suggested parametrisation could not work

The handoff suggested picking `Z0` in `r = Z0 / (Z0 + z)` so the focus slot's
swing is comfortable. `Z0` cannot do that job: write depth as `Z0 / r`, turn by
θ about an axis at depth `rp`, and the screen travel is

```
ΔSx  ≈  θ · ( PERSPECTIVE · (r / rp − 1)  −  Sx² / PERSPECTIVE )
```

`Z0` has cancelled — it only ever rescales a model space that is projected back
through the same factor. The single surviving parameter is `rp`, where the axis
stands, and it is the whole of the near/far spread: travel is zero at the axis,
grows without bound in front of it and saturates at `−PERSPECTIVE · θ` behind
it. So a quiet far end *forces* the axis to stand at or beyond the spawn depth,
and once it does, the front swing is whatever the cascade's own depth range
makes it.

`PIVOT_Z = PERSPECTIVE * GROWTH ** SPAN` stands it exactly at the spawn end.
Travel then reduces to `θ · PERSPECTIVE · (GROWTH^depth − 1)` — the same
exponential the sizes run on, no tuned number anywhere.

Measured, after, same viewport and progress:

| drawn scale | yaw sweep dx | pitch sweep dy |
|---|---|---|
| 0.255 | 83.3 | 52.2 |
| 0.328 | 218.6 | 118.4 |
| 0.416 | 379.1 | 201.6 |
| 0.499 | 402.9 | 257.6 |
| 0.643 | 746.6 | 369.6 |
| 0.694 | 619.2 | 432.9 |

Monotone in depth on both axes. Near/far ratio 9:1 on yaw, 8:1 on pitch. (The
two lowest rows swap on dx because they are in different halves — day's near
cards sit further from the axis laterally than night's at the same depth, so the
`Sx² / PERSPECTIVE` term takes more off one than the other. Within a half it is
monotone.)

At 2560 × 1440 the same sweep runs 70 → 493px on yaw and 29 → 386px on pitch.

## Invariants

1. **Continuity through the recycle.** Every new quantity is a function of
   `depth`, `r` and the frame. No pool slot, no node identity. `PIVOT_Z` is a
   constant.
2. **Paint order.** `zIndex` still reads `r` alone, so ordering is depth
   ordering by construction. Checked that the *drawn* order agrees too — no card
   painted in front is drawn smaller than the one behind it — at all five
   pointer positions × three viewports: **0 inversions**.
3. **Hit testing.** The pointer is still tested against `restX/restY`, which now
   includes the swing, and `hw/hh` still come from `rs`. The front card travels
   747px for a 1424px pointer sweep, i.e. ∂rest/∂pointer ≈ 0.52 < 1 on x and
   0.49 on y, so the cursor always gains on a card it is approaching and the
   loop the long comment there warns about cannot close. Empirically: cursor
   parked exactly on the largest card's edge for 4s → **0 hover flips, hover
   held on** throughout.
4. **Identity at rest.** Algebraically exact: at `yaw = pitch = 0`,
   `cos = 1, sin = 0` ⟹ `tx = mx`, `ty = my`, `tz = mz` ⟹
   `rs = PERSPECTIVE / (PIVOT_Z − mz) = r` and `restX = midX + mx·r = rayX`, the
   old rest layout to the last bit. Empirically: with the pointer dead centre
   (ndc 0,0) the drawn scales form a geometric progression of ratio 1.3296 –
   1.3307 against `GROWTH = 1.33` — worst deviation 0.002, which is rect
   rounding. Mobile and touch never move the pointer, so that is the mobile
   layout unchanged.
5. **`PERSPECTIVE` level with the stylesheet.** Unchanged at 1400, and
   `.deck { perspective: 1400px }` untouched. No CSS change was needed; the
   stylesheet is not in this diff.
6. **One writer.** Everything is still written in the single `gsap.ticker`
   callback.
7. **Direction.** Unchanged sign. Cursor right → the right of the group goes
   back and the near end swings right after the cursor; cursor at the bottom →
   the bottom goes back and the near end comes down. Same sense on both axes,
   and it mirrors correctly because `turn` is untouched.

## Divisor headroom

The one new divisor is `PIVOT_Z − tz`, which is `PERSPECTIVE / rs`, i.e. the
card's distance from the eye after the turn. Expanded, it is
`PIVOT_Z(1 − cosY·cosP) + (PERSPECTIVE / r)·cosY·cosP + mx·sinY·cosP + my·sinP`:
the second term dominates and the turn perturbs it by at most ~15% at these
angles, so it stays within a sixth of `PERSPECTIVE / r`. Since cards at
`depth ≥ SPAN` are parked before this runs, `r < 1` and the divisor never falls
below ~1200px against a pole at 0. Observed largest drawn scale over every
sample was 1.01, i.e. a smallest divisor of 1386px. Card boxes over all
positions and viewports stayed in 144–2012px; **no NaN, negative or degenerate
box anywhere**.

## Verification run

| check | result |
|---|---|
| `tsc --noEmit` | clean |
| `biome check room-deck.tsx` | clean |
| `stylelint act-4-stay.module.css` | clean |
| `pnpm --filter @mariva/web test` | 80 passed / 5 files |
| `capture-act-4-stay.mjs … 8 rooms` | desktop 9 frames, mobile 9 frames |
| `capture-room-hover.mjs 0.15 0.85` | hovered at 950,663 and 414,723 — pull, scrim off, caption parked |

Screenshots:

- `plans/reports/screenshots/room-swing/before/` and `…/after/` — five pointer
  positions (left, right, top, bottom, centre) × three viewports.
- `plans/reports/screenshots/room-hover/` — rest/hover pairs, day and night.
- `plans/reports/screenshots/act-4-stay-rooms/` — the resting filmstrip.

The measurement harness (`apps/web/scripts/probe-room-swing.mjs`) was throwaway
and has been deleted. Its method, if it is wanted again: the deck drifts
~0.11 depth-steps/sec, so each axis was sampled **A B A** with equal waits and
the swing read as `B − mean(A₁, A₂)`. Drift is linear over the window, so the
mean of the two A samples sits at the same clock as B and the difference is the
swing alone.

## Second pass: making it heavy

The first pass was too free — 747px of travel on the front card is about half
the viewport, and the deck went wherever the cursor went. Asked for a heavier
arrangement: far end near-dead, near end moderate, and the whole thing resisting
the pointer rather than tracking it. Two changes, both amplitude and response:

**Angle.** `YAW 0.1 → 0.04`, `PITCH 0.05 → 0.02`, keeping the reference's 2:1
between them. Lifting its figures directly was the error: what an angle buys is
the angle times the arm it turns on, and the arms are not comparable. The
reference turns a scene about an axis standing *inside* it; this trail stands
wholly in front of its axis and spans `GROWTH ** SPAN`, so the front card rides
an arm of `PERSPECTIVE * (GROWTH ** SPAN - 1)` = 6349px, four and a half times
the perspective itself. Same angle, several times the travel.

**Response.** `SecondOrderSpring2(1.1, 0.55, 1.4)` → `(0.6, 1, 0)`. The old one
was 1.1Hz, under-damped and *leading* the pointer by its own velocity — quick,
overshooting, eager, which is what a light thing does. It is now half way to a
new answer in about half a second, critically damped so it does not overshoot on
arrival, and with no anticipation at all. Removing the overshoot also stops
every hit box travelling past its mark and back on each flick of the cursor.

At 0.04 / 0.02 and 0.6Hz that came out a little *too* heavy on both counts, so
the shipped figures are one step back from it: **`YAW 0.05`, `PITCH 0.025`** —
exactly half the reference's, keeping its 2:1 — and **`SecondOrderSpring2(0.85,
1, 0)`**, half way to a new answer in about a third of a second rather than
half. Critical damping and zero anticipation stay: the overshoot and the lead
were what read as eagerness, and the overshoot is also what carried every hit
box past its mark and back on a flick.

Measured shipped, 1440 × 900, progress 0.85, travel across a full pointer sweep:

| drawn scale | yaw sweep dx | pitch sweep dy |
|---|---|---|
| 0.25 | 40.4 | 20.2 |
| 0.33 | 108.4 | 51.7 |
| 0.43 | 189.4 | 91.3 |
| 0.55 | 284.4 | 141.9 |
| 0.71 | 374.5 | 202.3 |

Monotone in depth on both axes, 9:1 far-to-near. The front card travels a
quarter as far as the pointer that moved it — against half at `YAW 0.1` — so the
cursor gains on a card three times faster than the card can retreat.

(One card per run reads off the trend — e.g. a 77.8 where ~230 was due. That is
the A-B-A window, not the render: a node that recycles from the near end to the
far end between two samples has its position matched across a jump of `POOL`
depth steps. It shows in every run, at a different node each time.)

Every invariant was re-checked at 1280 × 720, 1440 × 900 and 2560 × 1440 after
the change: **0 paint-order inversions**, boxes 160–1985px with no degenerate
value, smallest divisor 1332px, **0 hover flips** with the cursor parked on a
card's edge for 5s (hover held on throughout), and rest-scale steps of
1.3292–1.3305 against `GROWTH = 1.33` at the first two viewports. At 2560 the
worst rest step was 1.3376 — 0.5% — which is measurement noise in the rect, not
a residual swing: at ndc (0, 0) the turn is the identity by algebra, not by
tuning.

Full gate re-run clean: `tsc`, biome, stylelint, 80 tests, filmstrip (9 desktop
+ 9 mobile frames), room-hover (hovered at 917,586 and 447,641 — pull, scrim
off, caption parked).

Screenshots for this pass: `plans/reports/screenshots/room-swing/heavy/` (the
0.04 / 0.6Hz pass) and `…/tuned/` (shipped).

## Where the dials are

Three independent numbers, if this wants moving again:

- `YAW` / `PITCH` — how far it goes. Keep the 2:1; the pair is the whole
  amplitude and both ends scale together.
- `SecondOrderSpring2`'s first argument — how fast it gets there. 0.6Hz was
  slow, 1.1Hz was the original quick one, 0.85 is shipped.
- `PIVOT_Z` — the near/far spread alone, at constant amplitude. Standing the
  axis nearer than the spawn end puts the far end in motion and flattens the
  contrast.

```
Status: DONE
Summary: The swing is a rigid rotation of the trail about an axis standing at
the spawn depth — travel exponential in depth, 9:1 far-to-near, far end near
still and the front card 375px across a full pointer sweep — carried by an
unhurried, critically damped, non-anticipating spring, so the deck resists the
cursor rather than goes with it.
```
