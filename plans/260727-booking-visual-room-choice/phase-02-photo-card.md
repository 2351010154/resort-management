---
phase: 02
title: The photo card and the measure line
status: done
depends_on: [01]
size: M
---

# 02 — The photo card and the measure line

## Context

`room-type-card.tsx` renders an `h3`, three `<p>`, a disclosure, an extra-bed
checkbox and a price block — 42 to 64 words per card, no image. This phase
replaces it with a photograph, a name, one glyph line and two price lines: 11–12
words, against a 15-word budget (§3.2, §4).

The component **shrinks**. Most of this phase is deletion, and every deleted
string has a destination in §4's table — nothing is lost, three things move.

## Files owned

- `apps/web/features/booking/components/room-type-list/room-type-card.tsx`
- `apps/web/features/booking/components/room-type-list/measure-line.tsx` (new)
- `apps/web/features/booking/components/room-type-list/room-type-list.module.css`

Reads: `lib/room-images.ts`, `lib/room-types.ts`, `lib/stay-quote.ts`.

## Steps

1. **The frame.** §3.2 and §5's under-layer rule, verbatim:

   ```css
   .frame { aspect-ratio: 3 / 2; background: var(--umber); overflow: hidden; }
   .frame img { width: 100%; height: 100%; object-fit: cover; display: block; }
   ```

   `588×392` at 1440 (2-up with a `--space-3` gutter), `375×250` at 375.
   Explicit `width`/`height` so the box reserves its space, `srcSet` + `sizes`,
   `loading="lazy"` below the fold, `decoding="async"`. **3:2 because it is the
   only ratio measured to survive a breakpoint unchanged** — Hoxton holds 1.500
   at 1440 and at 375 (§2.1).

   `--umber`, not `--ivory-warm`. §5 gives the warm ivory to the `/login` plates
   because a fade must land on the colour it fades into; a photo card is not
   fading into anything, and an undecoded image should be a warm dark rectangle
   rather than a hole.

2. **Two buttons, two jobs.** The photograph and the name together are one
   button that opens the room sheet (phase 04 — wire it to a no-op prop here and
   connect in 04). `Choose` stays the primary action. Look closer, and take it.

3. **The measure line** (`measure-line.tsx`, §3.4). One strip, three fixed slots
   at the same x-position on every card so the column reads down:

   - **Occupancy dots** — one filled dot per `maxOccupancy`, plus **one open dot
     when `takesExtraBed`**. Filled and open *circles*: squares or stars read as
     a rating. This one glyph system carries two of the five differences, and
     `property-and-tariff.md` §1's beds-sleep-versus-max-occupancy distinction is
     exactly the filled/open pair.
   - **The size bar** — a fixed track filled `squareMetres ÷ max(squareMetres
     across the rendered set)`. 28/34/42/52/68 → 41/50/62/76/100 %.
     **Normalise over the set the list actually renders, never a hardcoded 68**:
     a sixth type would silently break every bar. The number sits at the bar's
     end. This slot is the report's own proposal and is unreferenced — §1 says so
     plainly, and it is the one part of the card with no verified precedent.
   - **The aspect** — one word from `room-types.ts`.

   Semantics are Booking.com's verified pattern (§2.6): the whole line is a
   single node with a complete accessible name, and every glyph inside it is
   `aria-hidden`. Not a label per dot.

   ```html
   <div role="img" aria-label="Sleeps 3, extra bed available. 52 square metres. Corner, two aspects.">
   ```

4. **Price — two lines and nothing else** (§3.7). Stay total in
   `--text-display-sm` / `--ink`, per-night below it in `--text-sm` / `--stone`.
   The `printedFiguresMultiply` check at `room-type-card.tsx:204-207` survives
   **verbatim**: it is the honest answer to a weekend-priced stay and it is
   already right. No strikethrough, no "was", no percentage, no rooms-remaining.

5. **Delete, with destinations** (§4):

   | Removed | Where it goes |
   |---|---|
   | `type.bedding` line | room sheet (04) |
   | `What's in the room ▾` + `ROOM_AMENITIES` | room sheet (04) |
   | `Includes VAT and service.` ×5 | date summary, once (03) |
   | `Choosing a room holds it…` ×5 | above the grid, once (03) |
   | `N nights · N guests` ×5 | date summary, once (03) |
   | `Sleeps N · extra bed available` | the dots |
   | The extra-bed checkbox | sheet states the price; `/details` controls it |
   | `Choose your dates for prices.` ×5 | deleted — View B does not exist without dates |
   | `Not free for these dates.` / `Sleeps 2. You are three.` on a full card | one demoted row (05) |

   `28 m² · courtyard` is the only spec that stays, and it labels the size bar.

6. **Motion.** Hover and focus stay CSS — `border-color`, `background-color`,
   `0.4s`, `var(--ease-ui)`. The chosen wash is `--ocean` at 0.1. The cascade
   keeps `cardListMotion` / `cardMotion` and `useReducedMotion` at every call
   site. **No photo motion**: no hover zoom, no Ken Burns. A `transform` on a
   `cover` image re-rasterises its layer, and a moving photograph is marketing.

## Validation

- A test counts the card's rendered persistent text and asserts **≤ 12 words**
  per type, all five types, dates present and available.
- The measure line has exactly one `role="img"`; every descendant glyph node is
  `aria-hidden`; the accessible name contains occupancy, extra-bed availability,
  square metres and the aspect.
- A test renders a four-type subset and asserts the largest bar is 100 % of the
  track — normalisation over the rendered set, not over `ROOM_TYPES`.
- Computed `aspect-ratio` of `.frame` is `3 / 2` at 1440 and at 375.
- `pnpm --filter web test`, `pnpm lint`, `pnpm --filter web lint:css`.

## Risk and rollback

The card is the screen's most-read component and this rewrite touches all of it.
Rollback is one file plus its stylesheet from git.

Watch for: an `alt` that repeats the name the `h3` already carries (noise to a
screen reader), and the dots reading as a rating — check with a colleague who
has not read this plan, which is the only test that catches it.
