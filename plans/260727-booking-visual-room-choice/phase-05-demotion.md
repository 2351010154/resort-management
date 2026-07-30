---
phase: 05
title: Demotion and the empty state
status: done
depends_on: [02, 03]
size: S
---

# 05 — Demotion and the empty state

## Context

Round 1 keeps a sold-out type in place as a full-height card with a disabled
`Choose`, and a too-small type as a card saying "Sleeps 2. You are three." A
full-height card with a dead primary action reads as broken whichever reason
produced it — and now that every card carries a photograph, five of them with
three unbuyable is a wall of pictures the guest cannot act on.

Partial availability is the **common case** at five types and forty rooms, not
the edge. This phase gives it a shape: available types keep photographs, the
rest become one line each (§3.8).

## Files owned

- `apps/web/features/booking/components/room-type-list/room-type-list.tsx`
- `apps/web/features/booking/components/room-type-list/demoted-rows.tsx` (new)
- `apps/web/features/booking/components/room-type-list/demoted-rows.module.css` (new)
- `apps/web/features/booking/components/no-availability/**`

A separate stylesheet rather than an addition to `room-type-list.module.css`, so
this phase and phase 02 never edit the same file.

## Steps

1. **Split the list.** `room-type-list.tsx` partitions the five types into
   available cards and demoted rows, preserving `ROOM_TYPES`' order within each
   group — ascending by maximum occupancy then price, which is what lets the eye
   compare one fact down a column.

2. **The demoted rows.** Below the cards. No photograph, no button, about 28 px
   per row, under two caps labels (§3.13 budgets three per view; this uses two):

   ```
   NOT FREE FOR THESE NIGHTS
   Deluxe — not free for these nights.
   Premier — not free for these nights.

   TOO SMALL FOR THREE GUESTS
   Superior — sleeps 2.
   ```

   Hiding a type is still forbidden — a guest who cannot see the Superior thinks
   the hotel has no such room. It is demoted, not removed.

3. **All five demoted → the empty state.** If nothing is available, the view is
   replaced by `NoAvailability` rather than showing eight caps-labelled lines.
   The existing `fitsNobody` check moves or extends to cover occupancy misfit as
   well as availability.

4. **Tighten the empty state's wording** (§3.9), and **do not add a third
   move**:

   ```
   Nothing free for 15 to 17 September.
   The next two nights free for 2 are 22 to 24 September.   [ Show those nights ]
   ```

   The report's §3.9 lists Resy's third move — "We can write to you if these
   nights open." — as unchanged from what shipped. It is not: the shipped
   component implements two moves and its header says why the third is absent.
   No waitlist entity exists, and a button that answers "Noted." and records
   nothing is a lie told to a guest who has just been disappointed. **That
   omission stands.** Revisit it when the waitlist exists, not before.

   What does stay is Resy's real detail: the alternative is parameterised by the
   same party size — "the next nights free **for 2**", not a generic "try other
   dates".

## Validation

- Two of five sold out: three photo cards, one caps label, two lines.
- A party of three against `SUPERIOR` and `DELUXE`: both demoted under
  `TOO SMALL FOR THREE GUESTS`, both still visible.
- All five unavailable: `NoAvailability` renders and no demoted rows do.
- No demoted row contains a `<button>` or an `<img>`.
- `no-availability` still renders exactly two moves.
- `stay-quote.spec.ts` and `stay-availability.spec.ts` pass unchanged.

## Risk and rollback

Low. The partition is presentation over data that already exists — `occupancyFit`
and `offer.isAvailable` are unchanged.

One thing to keep honest: the demoted rows must not accumulate a reason per
type. Two labels cover both reasons the system can produce today. A third label
means a new rejection reason exists, and that is a `stay-quote.ts` change, not a
copy change.
