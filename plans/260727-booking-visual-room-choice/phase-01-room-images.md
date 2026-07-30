---
phase: 01
title: Room images and the booking manifest
status: done
depends_on: []
size: S
---

# 01 — Room images and the booking manifest

## Context

The card has no `<img>` and the design has nothing to stand on until it does.
The real shoot does not exist yet (`plan.md` decision §6 Q3), so this phase puts
**structure** in place with interim frames re-exported from the arrival's
library, and defines the seam the real leads drop into.

**The frames are copied as files, never imported.** `design-foundations.md` §5
forbids `features/arrival/` in `(booking)`'s import path — everything under it
reaches `three` eventually — and §7 records the same reasoning for the `/login`
plates, which live under `public/images/auth/` and are referenced by hand. The
booking leads follow that precedent exactly, with one difference: they are
**content**, so their `alt` is meaningful, never `""`.

## Files owned

- `apps/web/public/images/booking/rooms/**` (new)
- `apps/web/features/booking/lib/room-images.ts` (new)

Reads but does not modify: `apps/web/features/booking/lib/room-types.ts`.

## Steps

1. **Copy five interim leads.** From `apps/web/public/images/act-4-rooms/`,
   every tier that exists for each pick, renamed to the type it stands for:

   | Type | Source | Tiers present | Why this frame |
   |---|---|---|---|
   | `SUPERIOR` | `room-cedar` | 1920, 1280, 640 | The only true bed-from-the-door frame in the library |
   | `DELUXE` | `room-mori` | 1920, 1280, 640 | Opens onto planting — the `garden` aspect |
   | `PREMIER` | `room-premier` | 1920, 640 | "Room at dusk above the city" — the `city` aspect |
   | `JUNIOR_SUITE` | `room-park` | 1920, 1280, 640 | "Corner room looking over park canopy" — the `corner` aspect |
   | `PANORAMA_SUITE` | `room-sky-lounge` | 1920, 1280, 640 | The widest daylight frame available |

   Two of the five are not bedrooms and none of them is a sea view. That is the
   point of calling them interim: §5's production rule is that the five leads
   are *the same photograph of five different rooms*, and these are five
   different photographs. They prove the layout, not the hotel.

2. **Write `room-images.ts` by hand.** One entry per `RoomTypeCode`: `src`,
   `tiers`, intrinsic `width`/`height`, `alt`. Shape it like the arrival
   manifest's entries so the real shoot's export can be dropped in without a
   consumer changing, but **do not import the manifest and do not generate this
   file from `prepare-arrival-images.mjs`** — that script curates the arrival's
   library and writes the arrival's manifest, and sweeping a booking image into
   it puts an arrival import in the funnel's path.

3. **Export `tierSrcSet` / `tierSrc` equivalents local to booking**, or reuse
   `lib/` if the helper already sits outside `features/arrival/`. Check before
   duplicating: `lib/motion-tokens.ts` and `lib/use-in-view.ts` are the complete
   list of shared things the funnel may reach for today, so a third one is a
   decision, not a convenience.

4. **Write the `alt` text.** Meaningful, in the arrival's register, naming the
   room and what the frame shows: `"Junior Suite, the corner window and the
   bed."` Not `""`. Four of eight Hoxton leads measured `alt=""` (§2.1) and that
   is the exact defect §7 exists to prevent.

5. **Mark the interim status where it will be read.** A header comment in
   `room-images.ts` naming the five sources, the swap procedure, and §5's
   acceptance test — cover the text on the five leads and a 28 m² courtyard room
   must be tellable from a 68 m² sea-view suite at a glance.

## Validation

- `rg "features/arrival" apps/web/features/booking` returns nothing.
- `pnpm --filter web build` succeeds; `/booking`'s chunks still contain no
  `gsap`, `lenis`, `three`, `WebGLRenderer` or `react-three`.
- Every entry's `tiers` matches files that actually exist on disk —
  `room-premier` has no 1280 tier, and a `srcSet` naming a missing file is a 404
  the browser recovers from silently.

## Risk and rollback

Low. The phase adds files and one module; nothing consumes it until phase 02.
Rollback is deleting both.

The real risk is downstream and social: interim frames make the screen *look*
finished. §5's acceptance test is the gate that stops these shipping to a guest,
and phase 06 restates it as an open item rather than letting it pass as done.
