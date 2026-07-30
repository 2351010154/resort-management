---
phase: 04
title: The room sheet
status: done
depends_on: [01, 02]
size: M
---

# 04 — The room sheet

## Context

The card holds 12 words because everything that does **not** distinguish the
five types moved one tap deeper. This phase builds that tap.

The division is the rule, not a convenience (§3.3): **nothing that differs
between the five types is behind the tap**, and everything behind it is either
identical across types (amenities) or a detail of a difference already shown on
the card.

## Files owned

- `apps/web/features/booking/components/room-sheet/room-sheet.tsx` (new)
- `apps/web/features/booking/components/room-sheet/room-sheet.module.css` (new)

Reads and reuses: `bottom-sheet/bottom-sheet.tsx` (narrow), `lib/room-images.ts`,
`lib/room-types.ts`. Consumes the photo/name button phase 02 left wired to a
no-op.

## Steps

1. **Two presentations, one component.** Desktop: a centred `<dialog>` about
   880 px, focus-trapped, `Escape` closes and **returns focus to the photo
   button that opened it**. Narrow: the existing full-height `BottomSheet`,
   which already carries the sheet and scrim exits and their reduced-motion
   variants.

2. **Contents, in this order** (§3.5):

   - Gallery — the same 3:2 crop as the card, so the frame the guest tapped is
     the frame they land on. Counter `2 / 5` **only when there is more than one
     image**: a one-slide carousel with `1 / 1` reads as broken, and Hoxton's
     `1 / 5` is honest only because there are five (§2.1, §5 fallback).
   - Bedding, with dimensions — `one king bed (1.80 m)`, from
     `room-types.ts`. The fact Limehome gets right.
   - Floor and aspect in full — `corner · two aspects`.
   - The extra bed: what it costs, and that it posts as a **service item**, never
     a rate modifier (`property-and-tariff.md` §1). Stated here, controlled at
     `/details` (`plan.md` §6 Q2). The price is ⚑ unset — if it is still unset
     when this ships, say what it is *for*, not a number nobody agreed to.
   - Amenities, grouped by subject. Apple's one transferable idea (§2.5): the 20
     row-headers on its compare page are categories — "Size and Weight" — not
     specs. The guest opens a *subject*, not a list. `ROOM_AMENITIES` is
     deliberately the same for every type and stays that way; a per-type list
     would imply the Superior has no hairdryer, which is fact-invention under §6.
   - Cancellation terms for the plan.

3. **One `Choose` at the bottom**, the same action as the card's, so the guest
   who came here to look closer does not have to close and hunt.

4. **The fallback path** (§5). When a type has one photograph, the gallery
   renders it with no counter and no carousel controls. The measure line carries
   the difference on its own. The design degrades; it does not fail.

## Validation

- Focus is trapped while open; `Escape` closes; focus returns to the opening
  button. Assert the active element, not the visual.
- The counter is absent for a single-image type and reads `1 / N` otherwise.
- Nothing in the sheet duplicates a card fact except the lead photograph, whose
  job is continuity.
- Reduced motion renders the sheet in place — `useReducedMotion` read at the
  call site, because the `globals.css` kill-switch cuts CSS durations and does
  not reach a JS animation.
- `pnpm --filter web test`, `pnpm lint`, `pnpm --filter web lint:css`.

## Risk and rollback

Self-contained; rollback is deleting the folder and reverting the card's button
to a no-op.

The one thing to resist: the sheet is where every fact that "might be useful"
will want to live. Its contents are the six items above. A seventh needs a
reason written down, because the card's 12 words are only defensible while the
tap is short.
