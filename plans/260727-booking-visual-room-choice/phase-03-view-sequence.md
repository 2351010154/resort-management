---
phase: 03
title: Views A and B — dates, then rooms
status: done
depends_on: []
size: M
---

# 03 — Views A and B — dates, then rooms

## Context

`booking-screen.tsx:172-194` renders `RoomTypeList` unconditionally while
`search-band.tsx:65` opens the calendar on arrival. The first frame is a date
picker with five dead cards under it, each saying "Choose your dates for
prices." The band collapsing was never the problem — **the list never leaves.**

This phase makes the screen two views, and the inactive one is **not in the
DOM**. Unmounted, not hidden, not collapsed: that is how "one open decision at a
time" is guaranteed mechanically rather than by CSS discipline (§3.1).

## Files owned

- `apps/web/features/booking/components/booking-screen.tsx`
- `apps/web/features/booking/components/booking-screen.module.css`
- `apps/web/features/booking/components/search-band/**`
- `apps/web/features/booking/lib/booking-view.ts` (new, if the state needs a home)

Not touched: `stay-calendar/**` — reused untouched, per §P5. Its cost in this
plan is zero.

## Steps

1. **View A — When.** Title, one guidance sentence (`Choose the nights you are
   here.`), the calendar rendered at full page width. Two months side by side at
   1440, one month page-height at 375. **The date bottom sheet disappears**: at
   375 the calendar *is* the view, so there is nothing to put in a sheet.
   `bottom-sheet.tsx` survives for the room sheet (phase 04) only.

   Guests are a stated assumption with an escape, not a third open control:
   `For 2 guests. [Change]` swaps the calendar for `GuestFieldset` in place
   (view A2). Still one open decision.

2. **View B — Which room.** The date summary (§3.6), the hold sentence once
   (§3.10), then the grid.

   ```
   15 – 17 September · 2 nights · 2 guests            [ Change ]
   Prices include VAT and service.
   ```

   The whole row is the button, and the value **is** its accessible name — no
   second label that can drift from what the control holds. That is Google
   Flights' lesson (§2.7); its failure is the other half: at 375 its band grows
   to 220 px, 27 % of the viewport spent on the question before one answer is
   visible. So this is a *summary*, not a live control, and it stays one line.

   `Prices include VAT and service.` lives here, once, beside the prices it
   qualifies. That single move deletes 20 words from the view.

   The hold sentence — `Choosing a room holds it while you finish. Nothing is
   charged yet.` — appears once above the grid and is the same string every
   `Choose` button points at with `aria-describedby`. Round 1 rendered it five
   times: 60 words where 12 were needed.

3. **The transition.** A→B fires only on a **complete** range; an anchor without
   a departure keeps A. B→A on `[Change]`. Exits use `motion` inside the existing
   `LazyMotion` (`plan.md` §3.12 decision) — View A leaves on opacity, View B
   arrives on opacity plus `translateY(8px→0)`, both `DUR_UI` on the funnel's
   curve, both swapped for `stillMotion` under `useReducedMotion`. Under reduced
   motion the swap is an instant content replacement with no crossfade and the
   cascade is dropped, per §9's rule that the reduced path is its own
   composition.

4. **Scroll restoration.** Store View B's `scrollY` before it unmounts; restore
   it in a layout effect after B repaints. Without this, a guest who changes one
   date lands at the top of the list, and the report names it the single
   requirement most likely to ship subtly broken.

5. **The rate plan leaves.** Delete the `Rate` segment and
   `search-band/rate-plan-choice.tsx`; `/booking` quotes `STANDARD`.

   **Keep `plan` in `booking-search.ts` and keep reading it** — the URL contract
   and its tests are unchanged, `/details` will write it, and a link carrying
   `plan=NONREF` must not start quoting something else. What goes is the
   *control*, not the parameter.

6. **What survives.** `SummaryBar` and its motion; `useViewportMatch`;
   `readBookingSearch` / `writeBookingSearch` and the one-writer-to-the-URL rule;
   `I18nProvider locale="en-GB"`; `LazyMotion strict`; the `propertyToday()` /
   `PRICED_DAYS` quoting model. The screen's header sentence splits: View A takes
   `Choose the nights you are here.` (6 words), View B takes the tax note (5).

## Validation

- With no range in the URL, the tree contains no room card and no `Choose`
  button. With a complete range, the tree contains no `[role=grid]`.
- An incomplete range (anchor only) keeps View A.
- Scroll to the bottom of View B, `[Change]`, pick the same range: the list is
  restored at the same offset. Assert the number, not the feeling.
- `scrollWidth === 375` at 375 in both views.
- `booking-search.spec.ts` passes unchanged, including `plan`.
- Measure the A→B remount cost of the React Aria calendar. If it is visible,
  switch View A to `hidden` **and** `inert` and record why in the component's
  header — an `inert` subtree is not a second open decision, but it trusts an
  attribute rather than the tree.

## Risk and rollback

The riskiest phase. Two failure modes to watch:

- **A half-faded view.** Exits are `motion`'s job here precisely so no duration
  lives in both a stylesheet and a timer; if a CSS exit creeps back in, that
  invariant is gone.
- **Losing the URL as the single source of search state.** Every control still
  goes through `commit`. View identity is *derived* from `search.range`, not
  stored beside it — a `useState<"A" | "B">` that can disagree with the URL is
  the bug this screen was designed to be incapable of.

Rollback: `booking-screen.tsx`, its stylesheet and `search-band/**` from git.
