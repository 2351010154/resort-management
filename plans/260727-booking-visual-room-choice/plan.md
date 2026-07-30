---
title: /booking — the room choice as a picture
status: done
priority: P1
effort: medium
branch: chore/web-react19-next16
tags: [web, booking, design, images, a11y]
created: 2026-07-27
---

# /booking — the room choice as a picture

Round 1 shipped `apps/web/features/booking/` and it reads as broken for three
mechanical reasons, all readable in the code: both decisions are mounted from
the first paint, **there is no `<img>` anywhere in the room card**, and the card
copied Limehome — a reference whose own photographs are 100×100 placeholders
under a printed disclaimer.

This plan rebuilds the screen around a photograph and a sequence: **dates, then
rooms.** Persistent card text drops from 274 words across five cards to 57; the
view drops from ~302 words to ~100.

Design authority and every measurement behind it:
[`plans/reports/research-260727-2133-booking-visual-room-choice.md`](../reports/research-260727-2133-booking-visual-room-choice.md)
(§-numbers below refer to it). Round 1's verified references:
[`research-260726-2127-booking-screen-inspiration.md`](../reports/research-260726-2127-booking-screen-inspiration.md).
Standard: `docs/architecture/design-foundations.md`. Hotel facts:
`docs/architecture/property-and-tariff.md` §1.

Phase files carry the execution detail. They cite the report rather than
restating it — the report is the specification, this is the sequence.

## Decisions settled before planning

| § | Question | Decision |
|---|---|---|
| §6 Q1 | Rate plan on `/booking` or `/details`? | **Moves to `/details`.** `/booking` quotes `STANDARD`. The third segment, three cancellation-term sentences and the live re-pricing of five cards all leave. `rate-plan-choice.tsx` is retired here and re-homed at M7 |
| §6 Q3 | Do the five lead photographs exist? | **No — interim leads are re-exported from the arrival's library as files.** Five frames copied from `public/images/act-4-rooms/` to `public/images/booking/rooms/`. Files, not imports, so §5's bundle budget holds. §5's five-lead acceptance test is the gate the real shoot must pass before it swaps them |
| §3.12 | CSS-only exits, or `motion`? | **`motion` exits.** `design-foundations.md` §5 already permits `motion` in `(booking)` for exits, it is already in `/booking`'s bundle, so this costs zero new bytes and avoids one duration living in both a stylesheet and an unmount timer |
| §6 Q2 | Extra-bed control — sheet or `/details`? | **Sheet states it; `/details` controls it.** It posts as a service item, never a rate modifier (`property-and-tariff.md` §1), so it is not part of choosing a room. The open dot says *allowed* on the card; the sheet says what it costs. Reversible, and nothing else depends on it |
| §6 Q4 | Are the aspect words real? | Carried as ⚑, unchanged. `courtyard / garden / city / corner / sea` already live in `property-and-tariff.md` §1 and `room-types.ts`; the aspect is now one of three things on the card, so phase 06 asks for sign-off rather than shipping it silently |

## Acceptance criteria

Measured, not judged. Every number is from the report.

- **The card is a photograph.** Each available type renders one `<img>` in a
  `aspect-ratio: 3 / 2` frame over `--umber`, with `width`/`height`, `srcSet`,
  `sizes`, and **meaningful** `alt` — never `alt=""` (§5, §7).
- **1.500 at both widths.** The frame's computed aspect ratio is 3:2 at 1440
  and at 375, asserted from computed style, not from a pixel diff.
- **Two views, and the inactive one is not in the DOM.** With no complete range
  there is no room list in the tree; with a range there is no calendar in the
  tree (§3.1).
- **≤ 12 persistent words per card**, against a 15-word budget, asserted by a
  test that counts the card's rendered text (§3.2).
- **≈ 100 words in View B** with all five types available (§3.13).
- **The five types are distinguishable with all text covered** — 2/2/3/3/4
  filled dots, three of them with an open dot, five size bars at 41/50/62/76/100 %
  normalised over the *rendered* set, never a hardcoded 68 (§3.4).
- **One `role="img"` per measure line** with a complete accessible name; every
  glyph inside it `aria-hidden` — Booking.com's verified shape (§2.6).
- **`scrollWidth === 375` at 375**, asserted (§3.11).
- **Changing dates from View B and coming back lands where the guest was**, not
  at the top of the list (§3.1, §3.12).
- **`Includes VAT and service.` appears once per view**, not five times; the
  hold sentence appears once, not five times (§3.6, §3.10).
- **`/booking` still ships zero bytes of `three`, `gsap` or `lenis`**, and
  imports nothing from `features/arrival/` (`design-foundations.md` §5).

## Phases

| # | Phase | Depends on | Owns | Size |
|---|---|---|---|---|
| 01 | [Room images and the booking manifest](phase-01-room-images.md) | — | `public/images/booking/**`, `features/booking/lib/room-images.ts` | S |
| 02 | [The photo card and the measure line](phase-02-photo-card.md) | 01 | `room-type-list/room-type-card.tsx`, `room-type-list/measure-line.tsx`, `room-type-list/room-type-list.module.css` | M |
| 03 | [Views A and B](phase-03-view-sequence.md) | — | `booking-screen.tsx`, `booking-screen.module.css`, `search-band/**`, `lib/booking-view.ts` | M |
| 04 | [The room sheet](phase-04-room-sheet.md) | 01, 02 | `room-sheet/**` | M |
| 05 | [Demotion and the empty state](phase-05-demotion.md) | 02, 03 | `room-type-list/room-type-list.tsx`, `room-type-list/demoted-rows.*`, `no-availability/**` | S |
| 06 | [Verification, baselines and docs](phase-06-verification.md) | 01–05 | `tests/**`, `scripts/**`, `docs/**` | M |

**01 and 03 may run in parallel** — disjoint file ownership, and 03 does not
touch the card. Everything else is sequential on the table above. 02 and 03 both
end at `booking-screen.tsx`'s render, so 03 lands the view shell and 02 lands
inside the list it renders; if they run together, 03 owns the file.

## Risks

- **The photographs are load-bearing and no code rescues them.** Interim leads
  from the arrival keep the build honest about structure but not about the
  hotel. If the real five leads are not shot as a *set* — same focal length, eye
  height, time of day, bed dressing, door-side position — this fails exactly as
  round 1 did, with a bigger image budget. Ace Hotel (§2.4) has a real
  photographer and interchangeable frames; that is the failure mode.
- **Scroll restoration is the single requirement most likely to ship subtly
  broken.** Phase 03 carries it and asserts it.
- **Unmounting the React Aria calendar on every A→B** is a remount of an
  already-downloaded 136 KB chunk, not a refetch — but measure it. If the cost
  is visible, keep View A mounted with `hidden` **and** `inert`, which still
  satisfies "one open decision" at the price of trusting an attribute rather
  than the tree.
- **Two views mean two baselines per viewport.** `design-foundations.md` §10's
  warning that baselines are machine-specific applies doubly. A computed-style
  assertion on the 3:2 box and on `scrollWidth` is a stronger gate than a pixel
  diff over a photograph.
- **The dots must not read as a rating.** Filled and open circles. Not stars,
  not squares.
- **`--ocean` / `--dusk-amber` division holds.** `--ocean` at 0.1 is what the
  guest has chosen; `--dusk-amber` is the one thing they can do next. Five
  `Choose` buttons are five instances of one control, not five accents.

## One correction to the report

§3.9 says the empty state is "unchanged from round 1 and from shipped
`no-availability.tsx` — Resy's three moves". The shipped component deliberately
implements **two**, and says so in its header comment: the notify-me move is
absent because no waitlist entity exists, and a button that answers "Noted." and
records nothing is a lie told to a guest who has just been disappointed. That
omission stands. Phase 05 tightens the wording of the two moves that exist and
does not add a third.

## Docs impact

Only where behaviour or a durable decision changed:

- `docs/screens.md` — the `/booking` row: the rate plan is no longer chosen
  here, and the screen is photo-led.
- `docs/architecture/design-foundations.md` §7 — one row in the alt-text table
  for the booking room leads: content images, meaningful alt, referenced by hand
  from `public/images/booking/`, deliberately outside the arrival manifest for
  the same reason the `/login` plates are.

Not touched: `property-and-tariff.md` (no hotel fact changes; the ⚑ on §1 is
unchanged), `booking-state-machine.md`, `plans/backlog.md` (the funnel's keys
stay M7's — this is a rebuild of a screen already standing ahead of its
milestone, not new scope).

## Out of scope

The rate plan and the extra-bed control at `/details`; the hold, its TTL and any
clock; a waitlist; per-type amenities; the real photography shoot. Round 1's
four unresolved questions (hold TTL length, minimum-stay rules as a public
contract, whether a waitlist entity exists, the extra-bed price ⚑) remain
unresolved and block none of the phases below.
