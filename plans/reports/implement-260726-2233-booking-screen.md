# `/booking` built

Implementation, 2026-07-26 22:33 ICT. Branch `chore/web-react19-next16`.

Executes `research-260726-2127-booking-screen-inspiration.md` §3. Four decisions
taken with the user before any code: install `motion`; use React Aria's headless
calendar hooks; real contract in `packages/shared` behind one clearly-named stub;
whole screen, all states.

## What the two named libraries actually contributed

**motion.dev (`motion` 12.42) — used, for four things, three of which are exits.**
The bottom sheet, its scrim, the summary bar, the price crossfade, and the card
stagger. It earns its place on one argument: **CSS has no exit.** `motion-tokens.ts`
had already named `EASE_UI_EXIT` for "the same micro-interaction leaving" and then
admitted it was GSAP-only because "nothing exits under CSS yet" — nothing could.
Everything Motion is *not* needed for stayed in CSS: the disclosure's
`grid-template-rows: 0fr → 1fr`, every cell hover, the range paint, the segment states.

Used as `m` inside `<LazyMotion features={domAnimation} strict>`, not `motion.*`.
`strict` makes it a build-time error to reach for the full bundle.

**reactbits.dev — inspected, not used, and this is the finding.** Its 40 Components
are `GlassSurface`, `SpotlightCard`, `TiltedCard`, `MagicBento`, `ChromaGrid`,
`Lanyard`, `FluidGlass`… It has **no calendar, no form control, no price element**.
Its house style is glass, spotlight and tilt, which is in direct conflict with
`design-foundations.md` §2 (one accent, nearly unspent) and §6 (never sell). The
three plausible candidates — `Counter`, `AnimatedList`, `OptionWheel` — each lose to
something already decided here: the report forbids animating the hold digits, the room
list is five items and needs no virtualised list, and Resy verifies that a native
`<select>` beats a custom wheel on a phone. Nothing was taken.

**Neither library solves the expensive part.** Report §4 is right that the date grid
is the whole cost. That went to **React Aria's headless hooks** —
`@react-aria/calendar` + `@react-stately/calendar` — which already speak
`@internationalized/date`, a dependency `packages/shared` has for the reason
`tech-stack.md` gives.

## Verified, not assumed

Driven in a real browser against a production build, DOM and computed styles read
back — the same method the research report used on its references.

| Claim | Measured |
|---|---|
| Real grid semantics | `table[role=grid]` × 2, own `<caption>` each, `td[role=gridcell] > button` |
| No `role="application"` | `0` on the page. React Aria sets it on the wrapper; `stay-calendar.tsx` strips it |
| Roving tabindex | exactly `1` tabbable cell of 61 |
| `aria-disabled`, never `disabled` | `realDisabled: 0` across every cell |
| Reason in the accessible name | `"Sunday, 2 August 2026 From 1.850 thousand đồng. 2-night minimum from 1 August 2026."` |
| Range paints nights, not days | 3-night stay → 4 cells: `range_start`, ×2 `range_inside`, `range_end`, fill `rgba(127,162,183,0.22)` |
| Keyboard | ← +1 day, ↓ +1 week, PageDown +1 month (Jul/Aug → Sep/Oct) |
| Cell floor at 375 px | `49 × 44` |
| No horizontal overflow at 375 px | `scrollWidth === clientWidth === 375` |
| Sheet enters and leaves | `role=dialog` labelled "Nights of your stay"; Escape → `0` dialogs |
| Reduced motion | all 5 cards `opacity: 1`, no cascade |
| Partly-free state | 4 of 5 types hold position with "Not free for these dates." |
| Empty state | "Nothing free for 14 – 16 August." + 2 party-aware alternatives |
| Console errors | none |

**Bundle budget holds.** `/booking` chunks contain no `gsap`, `ScrollTrigger`,
`lenis`, `WebGLRenderer` or `react-three`; `/` contains all five. `/booking` adds
**136 KB gz** over `/signup` — trimmed from 143 KB by a Gregorian-only
`createCalendar` and `LazyMotion`. That is real weight and it is recorded in
`design-foundations.md` §5 rather than left to be discovered.

## Four bugs the browser caught that reading would not have

1. **The fixture's `noise()` overflowed 2^53.** `seed * 2654435761` is 5.4e16 against
   a 9.0e15 safe integer, so `% 1000` read bits that no longer existed and the
   function was very nearly constant. **The calendar had no sold-out nights at all.**
   Replaced with a `Math.imul` 32-bit hash; now 2 sold-out and 2 arrival-closed in 61.
2. **The ₫ sign rendered small and off the baseline.** DM Mono has *no* Vietnamese
   coverage, and `next/font` appends its own metric-adjusted `"DM Mono Fallback"`
   immediately after it — so appending Literata to the stack never gets reached, and
   `size-adjust` drew the mark shrunken. Fixed properly: `splitVnd` in
   `packages/shared`, a `Money` component, and the mark set in Literata (which now
   carries the `vietnamese` subset).
3. **Past dates were labelled "Not yet priced."** They fall outside the priced window,
   so the no-data reason leaked onto last Tuesday. Suppressed for `isDisabled` cells.
4. **`Asia/Ho Chi_Minh`** — `replace` takes the first underscore, not both.

Two more found by reading the probe output: the extra-bed control was offered on
unavailable cards, and the per-night line disagreed with the total as printed
(2.756.000 × 2 = 5.512.000 against 5.513.000). The second is legitimate — weekend
nights and display rounding both cause it — so it now says "on average" whenever the
**printed** figures do not multiply. Testing the un-rounded values, which was the
first attempt, reports them as equal and says nothing.

## Two deliberate departures from React Aria

**`role="application"` dropped.** `useCalendarBase` sets it. Amadeus's picker does the
same and report §5 names it the worst thing about it — it suppresses browse mode,
which is the mode that reads a price inside a cell.

**`allowsNonContiguousRanges: true`, with contiguity enforced in
`stay-availability.ts` instead.** React Aria walks outward from the anchor to the
first unavailable date and clamps selection to that run. Correct for a date picker,
wrong for a hotel: a two-night minimum makes the night *after* the arrival
unselectable, which React Aria reads as a wall one day out and would forbid the whole
stay. The local version asks the question in nights, and correctly exempts the
departure date — a departure buys no night, so a sold-out morning is not in the way.

## Files

`packages/shared/rate-calendar.ts` (contract) · `money.ts` +`roundVndForDisplay`,
`formatVndThousands`, `splitVnd` · `packages/tokens` +`--ocean-rgb`
`features/booking/lib/` — `booking-motion`, `booking-search`, `stay-quote`,
`room-types`, `nearest-availability`, `use-viewport-match`, `rate-calendar-fixture`
(the stub)
`features/booking/components/` — `booking-screen`, `money`, `search-band/`
(+`guest-fieldset`, `rate-plan-choice`), `stay-calendar/` (+`month-grid`, `day-cell`,
`stay-availability`), `room-type-list/` (+`room-type-card`), `no-availability/`,
`summary-bar/`, `hold-timer/`, `bottom-sheet/`
`app/(booking)/booking/page.tsx` · `app/layout.tsx` (font subset) · `app/globals.css`

**Gates:** `pnpm lint` 0 (Biome + stylelint, which got wired mid-task — booking CSS
passes it) · `pnpm build` clean · **505 tests pass** (api 414, shared 33, web 58 new).
`apps/web` had no test runner; added `vitest` + `vitest.config.ts` for the funnel's
pure logic. Components verified in a browser instead — jsdom is not evidence about a
computed style or an accessible name.

**Docs changed, then code:** `design-foundations.md` §2 (`--ocean` spent, count 0→9),
§5 (the CSS-only rule replaced with the `motion` terms and the measured weight), §8
(three new don'ts) · `repository-structure.md` (the `booking/` feature, the budget
clarified, the fixture named) · `property-and-tariff.md` §1 (size, bedding, aspect,
beds-sleep), §3 (extra-person rate, cheapest-heads-first, the breakfast assumption),
§6 (two of eight prices set), §8 · `screens.md` (`/booking` 🟡).

## What is not done

- **`Continue` does not continue.** It should take a hold and route to
  `/booking/<hold>/details`; the booking module is M7 and does not exist. The button
  states that plainly rather than 404ing or appearing to hold a room.
- **`hold-timer.tsx` is built and unrendered.** It belongs to `/details` onward —
  `/booking` is stateless. Specified here because the countdown is one funnel-wide
  decision.
- **No waitlist offer in the empty state.** Resy's third move needs an entity that
  does not exist, and a button answering "Noted." while recording nothing is a lie
  told to a guest who was just disappointed. Report open question 5 sanctions dropping
  it; the nearest-dates query carries the page instead.
- **`/booking` is not in the visual-baseline suite.** Per §10 those baselines are
  machine-specific, and a dense type grid will be the noisiest frame in it. A
  computed-style assertion on cell size and state classes is the stronger gate here.
- **The extra-bed checkbox does not yet change the total.** It posts as a service item
  at the folio, and there is no folio to post to.

## Unresolved

1. **Hold TTL length.** `design-foundations.md` §6 says "15 minutes" in a copy
   example; `booking-state-machine.md` §3 starts a TTL and names no number. Which is
   authoritative, and is it configurable like the 04:00 rollover?
2. **Are minimum-stay and closed-to-arrival a public contract at M7?** The calendar's
   restricted-cell state depends on reading them from `/booking`; §3 lists them under
   admin **Rates** only. Now tracked in §8.
3. **Whose lowest price goes in the cell** — lowest across all five types (assumed,
   and the legend says "From"), or lowest across the types that fit the party? The
   second is more honest and costs a per-party calendar read.
4. **The ⚑ numbers I set** need your sign-off: extra person 600,000; breakfast 250,000
   per person per night; extra bed 350,000; the five base rates 1.85M–6.8M; and the
   room sizes, bedding and aspects in §1.
5. **Breakfast for a 6-to-11-year-old** is charged in full under `BB`. §3's bands are
   about the extra-person rate, not about food, so a half-price breakfast is equally
   defensible.
6. **`en-GB` is hardcoded** as the funnel's locale, for a deterministic week start and
   date spelling. A Vietnamese-language funnel is a larger decision than a locale
   string.

Status: DONE
Summary: `/booking` built to report §3 in full — two-month accessible date grid with
price-in-cell and three restriction states, five room cards with round-once gross
pricing, both empty states, guest ages, rate plans, mobile sheets and summary bar —
on React Aria's headless calendar and `motion` for exits, with the
`three`/`gsap`/`lenis` budget verified intact and 58 new tests.
Concerns: six ⚑ tariff values and the room facts in §1 are my proposals and need your
call; the funnel stops at `Continue` because the booking module is M7; `/booking`
costs 136 KB gz, which is the most expensive screen in the funnel and should stay the
only one.
