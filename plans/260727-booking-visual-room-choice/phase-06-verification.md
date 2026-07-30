---
phase: 06
title: Verification, baselines and docs
status: done
depends_on: [01, 02, 03, 04, 05]
size: M
---

# 06 — Verification, baselines and docs

## Context

The acceptance criteria in `plan.md` are numbers, and numbers need something
that reads them. `apps/web/tests/visual-baseline/` covers the arrival's six acts
at two viewports; `/booking` has no frames at all. This phase adds the gates —
and prefers computed-style assertions over pixel diffs where the report's own
method showed them to be stronger.

## Files owned

- `apps/web/scripts/capture-visual-baseline.mjs` (extend)
- `apps/web/tests/visual-baseline/**` (new booking frames)
- `apps/web/features/booking/**/*.spec.ts` (new assertions only)
- `docs/screens.md`, `docs/architecture/design-foundations.md` §7

## Steps

1. **Unit assertions** — the cheap gates, in `vitest`:

   - Persistent card words ≤ 12 for every type (§3.2).
   - View B's total prose ≈ 100 words with all five available (§3.13). Assert a
     ceiling, not an exact count; day numbers and prices are data, not prose.
   - The measure line's accessible name, and one `role="img"` with every glyph
     `aria-hidden` (§2.6, §3.4).
   - Size-bar normalisation over the rendered subset (§3.4).
   - View A contains no room card; View B contains no `[role=grid]` (§3.1).

2. **Browser assertions** — in a real Chromium at 1440×900 and 375×812, the
   method the report itself used:

   - `.frame`'s computed `aspect-ratio` is `3 / 2` at both widths, and its
     `getBoundingClientRect()` ratio is 1.50 to two decimals.
   - `document.documentElement.scrollWidth === 375` at 375, both views. Firmdale
     overflows its own homepage by 53 px at 1440 (§1); this is the cheapest
     regression in the category and it should not be possible to merge one.
   - `Choose` and the date summary measure **≥ 48 px** tall at 375 — 48, not 44,
     because cal.com's 44 is a floor and Limehome ships a 40 px select on the
     control the guest actually taps (§3.11).
   - Every card `<img>` has a non-empty `alt` (§5, §7).
   - Scroll to the bottom of View B → `[Change]` → reselect the same range →
     `scrollY` is restored to within a few pixels (§3.1).

3. **Visual baselines.** Extend `capture-visual-baseline.mjs` with `/booking`
   View A and View B at both viewports — four frames, against a production
   server with the existing virtual clock so prices and the calendar's "today"
   are fixed. Two views mean **two baselines per viewport**, not one.

   Read `design-foundations.md` §10 before trusting any diff: these frames are
   machine-specific in practice, and the comparison that means something is a
   fresh capture of the branch against a fresh capture of its merge base on the
   same machine. For this screen a computed-style assertion is the stronger gate
   and the frames are the record.

4. **Bundle budget.** Confirm `/booking`'s chunks still contain no `gsap`,
   `lenis`, `three`, `WebGLRenderer` or `react-three`, and that nothing under
   `features/booking/` imports `features/arrival/`. The `motion` exits decision
   adds no new dependency — `motion` is already in this route's bundle.

5. **Docs**, and only these two:

   - `docs/screens.md`, the `/booking` row: the screen is photo-led and dated
     before it lists rooms, and **the rate plan is no longer chosen here** — it
     moves to `/details`. That is a user-visible contract change and it is the
     only one in this plan.
   - `docs/architecture/design-foundations.md` §7, one row in the alt-text
     table: booking room leads are **content** images with meaningful alt,
     referenced by hand from `public/images/booking/`, deliberately outside the
     arrival manifest for the same reason the `/login` plates are — and unlike
     the plates, never `alt=""`.

   Nothing else. `property-and-tariff.md` holds no new fact,
   `booking-state-machine.md` is untouched, and the funnel's backlog keys stay
   M7's.

6. **The two open items, stated rather than closed:**

   - **§5's acceptance test has not been run**, because the photographs it tests
     do not exist. Cover the text on five contact-sheet leads: a 28 m² courtyard
     room and a 68 m² sea-view suite must be tellable apart at a glance. Until
     that passes, `public/images/booking/rooms/` holds five interim frames from
     the arrival's library and two of them are not even bedrooms.
   - **The aspect words are ⚑** (§6 Q4). `courtyard / garden / city / corner /
     sea` come from `property-and-tariff.md` §1, where §1–§6 is flagged as the
     developer's call until the database holds it. The aspect is now one of
     three things on the card, so it wants a yes before it ships to a guest.

## Validation

`pnpm lint`, `pnpm --filter web lint:css`, `pnpm --filter web test`,
`pnpm --filter web build`, then the browser pass at both widths. Every
acceptance criterion in `plan.md` maps to one of the checks above; a criterion
with no check is not done.

## Risk and rollback

No product risk — this phase adds gates and edits two documents. The risk is the
opposite one: declaring the screen finished while its photographs are interim.
Step 6 exists so that cannot happen quietly.
