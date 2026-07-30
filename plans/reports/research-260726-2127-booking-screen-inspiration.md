# /booking — design inspiration, verified

Research, 2026-07-26 21:27 ICT. Report only; no code written.

Authority read first: `docs/screens.md`, `docs/architecture/property-and-tariff.md`,
`docs/architecture/booking-state-machine.md`, `docs/architecture/design-foundations.md`,
`docs/architecture/repository-structure.md` §`apps/web`, `apps/web/lib/motion-tokens.ts`.

**Contradiction in the brief, resolved toward the repo.** The task says "assume GSAP
is available". `design-foundations.md` §5 and `repository-structure.md` both state
`app/(booking)` must ship **zero bytes** of `three`, `gsap` or `lenis`, as a CI budget.
The prototype below is CSS-only. If GSAP is genuinely permitted in the funnel that is a
change to two documents, not a change to this report.

---

## 1. Method and discards

Every URL below was hit with `curl -L --max-time 15/20` under a desktop Chrome UA, then
loaded in the in-app browser and probed from the DOM. **Screenshots were never used** —
the screenshot path was not needed because every claim here is a DOM/computed-style read,
which is stronger evidence for control design than a picture. Probes returned
`document.title`, computed `body` font/background, canvas/video/img counts, every
`input`/`select`/`button`, `window` library detection, script filenames, ARIA roles, and
where relevant `getBoundingClientRect()` at 375 px.

Two sites required shadow-DOM traversal (`element.shadowRoot`) to see anything at all.

### Rejects

| Target | Evidence | Verdict |
|---|---|---|
| `citizenm.com` | curl 200 → `https://www.marriott.com/brands/citizenm.mi` | Brand absorbed. The self-built engine that made it a reference is gone. |
| `thestandard.com` | curl 200 → `https://www.infoworld.com/` | Domain no longer the hotel's. |
| `numa-stays.com` | curl 200; probed title `numa-stays.com/lander`, body text "parked free, courtesy of GoDaddy.com" | Dead. **curl alone would have passed this.** |
| `lasalaplazahotel.com`, `palazzosogni.com`, `tribestays.com` | curl `000` (connect/TLS fail) | 3 of 10 Awwwards hotel-category nominees unreachable — matches the ~40% stale warning. |
| `sixsenses.com`, `easyjet.com`, `sncf-connect.com`, `raileurope.com`, `klook.com`, `pathe.nl`, `ticketswap.com`, `canopybyhilton.com` | curl 403 to a scripted UA | Bot-walled. Not verifiable here, so not described. |
| `tock.com`, `eventim.de`, `cgv.vn`, `zoku.com`, `withcabana.com` | curl `000` | Unreachable. |
| `airbnb.com` | Loads (200, redirects to `.com.sg`). Probed: `a[href*="/rooms/"]` count 0 after 8 s; clicking the "Check in / Check out" control yields `[role=grid]` count 0 | **The canonical range picker, and I could not verify it in this environment.** Not described. Named here so its absence is deliberate. |
| Codrops | `?s=calendar` → 45 results, **0 demos, 0 tutorials** on date UI (39 articles, mostly "Advent calendar" roundups). `?s=booking` → 30 results, top hits are sponsored WordPress-plugin posts from 2020–21 | Off-brief. Codrops indexes scroll/WebGL craft, which constraint 1 excludes outright. It was not useful for this screen. |
| `here-away.com` | Probed: 1 canvas, 109 img, **inputs are only** `text:"Where ? Search Your Stay"` and `email` | Editorial directory. No dates, no booking. |
| Awwwards hotel category, as a class | 10 nominees resolved to external URLs; 3 dead. Of the live ones, `nilsamsee.at` probed: `flatpickr` + jQuery, and every "Book" link points at `reservations.travelclick.com/115506?roomtypeid=…` | **The award is for the marketing site. The booking is always somebody else's software.** Follow the outbound link, not the nominee. |
| `dsvn.vn` (Vietnam Railways) | Live. Probed: AngularJS 1.x + jQuery, `Verdana`, a "Giỏ vé / Chưa có vé" ticket cart. Could not drive the station autocomplete (no `[role=option]` appeared after typing "Hà Nội") | Regionally the closest analogue for a seat hold, but **unverified beyond the shell.** Worth a manual look by someone with a real journey to book. |

One useful positive from the reject pile: `nilsamsee.at`'s per-room-type "Book" links carry
`roomtypeid` into the engine. The type→hold handoff is a URL parameter, not session state —
which is the same argument `repository-structure.md` makes for putting the hold id in the path.

---

## 2. Verified references

### 2.1 Amadeus HOS Res IBE — `reservations.nilsamsee.at/book/dates-of-stay`
*Amadeus Hospitality (ex-TravelClick iHotelier). Reached via `nilsamsee.at`, Awwwards nominee.*

**Probe.** Title `IBE - Dates of stay | Nils Am See`. `Montserrat`, 0 canvas, 0 video, 1 img.
Script `amadeus-hos-res-ibe-wc-sdk.bundle.js`. `window` has `jQuery`, `flatpickr`.
Four shadow roots: `AMADEUS-HOS-RES-WC-BOOKING-MASK`, `…-IBE-DATE-PICKER` (180 KB of shadow
HTML), `…-SPINNER`, `…-ADVERTISEMENT-BANNER`. Date fields in light DOM are
`INPUT:text` with placeholder `MM/DD/YYYY` — US format on an Austrian hotel's English site.

Inside the picker's shadow root, two months side by side, 35 selectable days, cells read:

```
"July 26, 2026 :: 26548 €   :: flatpickr-day today"
"July 27, 2026 :: 27! Check-out only This date is unavailable
                :: flatpickr-day cta-restricted-day check-out-only-closed-day
                   restricted-day has-restriction-tooltip"
"July 30, 2026 :: 30289 €   :: flatpickr-day"
```

Legend text in the same root: `"Rates are based on your selection, showing prices in EUR (€)"`,
`"! Restrictions apply"`, `"Lowest Available Rate"`.

**Solves.** #2 availability legibility, #3 price transparency, and #1's hardest sub-problem —
communicating an arrival restriction *in the cell, before the guest clicks it*.

**Take.**
- Per-night price rendered inside the day cell. It is the only way to answer "which nights
  are cheap" without a second control.
- **One price per night across the whole property** ("Lowest Available Rate"), not a price
  per room type. This is what keeps a 31-day grid to 31 numbers instead of 155.
- The restriction is a *cell state with its own name* — "Check-out only" — not a generic
  "unavailable". A guest who reads it learns the rule.
- Two months side by side on desktop.

**Do not take.**
- `role="application"` on the picker (confirmed: `roles: {application: 1, …}`). It suppresses
  the screen reader's browse mode, which is exactly the mode needed to read a price inside a cell.
- Days are `<span class="flatpickr-day">`. `tables: 0`. No `role="grid"`, no `<button>`,
  no `disabled` attribute — unavailability is a class only.
- `aria-label` is date-only: `"July 1, 2026"`. **The price, the "Check-out only" rule and the
  "This date is unavailable" text are all visual-only.** A screen-reader user gets an
  undifferentiated list of dates.
- `MM/DD/YYYY` placeholders in a non-US locale.
- The `…-ADVERTISEMENT-BANNER` custom element. An ad slot in the booking funnel.

---

### 2.2 Trainline date picker — `thetrainline.com/en-us`
*Trainline. The strongest verified accessibility model for a calendar.*

**Probe.** Opened via `#jsf-outbound-time-input-toggle`
(`aria-label="Date and time of departure. Thu, Jul 23, 2026 3:30 PM selected."`).
After open: `[role=grid], table` count **1** — a real `<table>`. Day cells are
`<button>` inside `<td>`, with `aria-selected` present. Sampled label:

```
"Choose Wednesday, July 1, 2026, it's available.  Prices unavailable."   aria-selected=false
```

`aria-live` regions present: `polite :: "July 2026"`. Visible text inside the picker:
**"Cursor keys can navigate dates"**.

**Solves.** #1 date selection, keyboard and screen-reader half.

**Take.**
- Real `<table>` + `<button>` per day. Every other picker probed for this report uses
  `<div>` or `<span>`, and every one of them loses state to assistive tech.
- The accessible name is a **sentence carrying every state the pixel carries**: weekday,
  full date, availability ("it's available"), and a price slot. The slot said "Prices
  unavailable" only because no route was selected — the label is *designed* to hold the price.
- `aria-live="polite"` announcing the month on navigation. Cheap, and it is the only way a
  keyboard user knows an arrow key crossed a month boundary.
- Rendering the keyboard hint as **visible** text. Sighted keyboard users need it too.

**Do not take.** The homepage widget is a date *and time* control with an origin/destination
typeahead bolted on; the whole assembly is dense. Steal the grid, not the band around it.
I could not verify the results-page fare strip — my synthetic station input did not reach
React state, and I did not fake it.

---

### 2.3 Resy, a fully-booked venue — `resy.com/cities/new-york-ny/venues/carbone?date=2026-07-27&seats=2`
*Resy (American Express). The best verified no-availability state in the category.*

**Probe.** `GT America`, 0 canvas, 0 video, 14 img, `window.moment`, `datadog-rum.js`.
Search state is in the URL: `?date=2026-07-26&seats=2`, written by the site itself on load.
Party size and time are plain `<select>` elements — no custom stepper.

Body text, verbatim:

> "At the moment, there's no online availability for Tomorrow. The next availability for 2
> is Tue., Aug. 25."

with a `<button class="ReservationButtonList__notify" aria-label="Notify for Dinner">`.

Above it, a horizontal date strip (`div.VenuePage__calendar__quick-picker__date`),
day cells are `<button class="ResyCalendar-day ResyCalendar-day--sold-out">`.

**Solves.** #7 no-availability — the state everyone forgets.

**Take.** Three moves, in this order, and all three are needed:
1. **State the fact plainly**, naming the dates the guest asked for.
2. **Offer the nearest date that works, parameterised by the same party size** — "The next
   availability *for 2*". Not a generic "try other dates".
3. **Offer to be told later.** One button, no form.

Also: search state lives in the URL and the page rewrites it. That is exactly
`repository-structure.md`'s "`/booking` is stateless and its state is search params".

**Do not take.** The sold-out cells are a visual-only state. Probed across 11 consecutive days:

```
cls=ResyCalendar-day--sold-out   aria-label="Sunday, July 26, 2026."   disabled=false   aria-pressed=null
cls=ResyCalendar-day--selected__unavailable  aria-label="Monday, July 27, 2026. Selected date."
```

Selection is announced. **Availability is not.** Every sold-out day carries the same label as
an available one and stays `disabled=false` with no `aria-disabled`. A screen-reader user
tabs the whole strip learning nothing.

---

### 2.4 Cal.com booker — `cal.com/rick/get-rick-rolled`
*Cal.com. Included for the two-pane layout, the timezone line, and honest mobile numbers.*

**Probe.** Next-gen Next.js build (`turbopack-11ua0b_64qy0s.js`), 0 canvas, 0 video, 2 img,
no motion library on `window`. Visible: `"10m  Link meeting  Asia/Bangkok"` — the timezone is
auto-detected and stated next to the duration. Controls: `"Switch to monthly view"`,
`"Switch to weekly view"`, `"Switch to column view"`, `12h`/`24h`.

At 375 px on a **fresh load** (measured after `navigate`, not after a resize):
`document.documentElement.scrollWidth = 375` — no horizontal overflow. Day cell
`44 × 44` px. Time-slot button `327 × 36` px.

**Solves.** #1 layout of a date control beside a narrower second choice; the timezone half of
the stay-date problem.

**Take.**
- **Two panes: the calendar picks the coarse thing, the list beside it picks the fine thing.**
  This maps one-to-one onto dates → room type, and it is why the room list should sit *beside*
  the calendar on desktop rather than under it.
- **Naming the timezone next to the thing it governs.** Our stays are `Asia/Ho_Chi_Minh`
  calendar dates; a guest booking from Seoul should see which clock the dates belong to.
- `44 × 44` day cells. Use as the floor.

**Do not take.**
- `[role=grid], table` count **0**. No grid semantics.
- Unavailable days are `<button disabled>` with **no `aria-label`** (probed: `al=` empty,
  `aria-disabled=null`). A `disabled` button is skipped by tab and by a roving grid, so the
  user cannot land on it and cannot learn why the day is gone.
- 36 px slot height is under the 44 px touch target on the control the guest actually taps.

---

### 2.5 Limehome suites — `limehome.com/suites?city=167&property=451&checkin=2026-08-10&checkout=2026-08-12`
*Limehome. The closest live analogue to what `/booking` has to be, and the best verified answer to problem #4.*

**Probe.** Next.js (`window.__NEXT_DATA__`), `Inter`, 0 canvas, 0 video. Calendar is
ng-bootstrap (`div.ngb-dp-day`), two months stacked in one popover, `[role=grid]` count 2.
Dates are URL params — `&checkin=&checkout=` round-trips, which is how I priced the page.

Before dates: **"Add dates for prices  --/--/--"**. It refuses to quote anything.

After dates, each room-type card renders in a fixed order:

```
Studio with sofa bed
31 m²  ·  1 Room  ·  1 Queen-size bed (1.50 m)  ·  1 Single bed (1.00 m)  ·  1 Air Conditioning
ROOM AMENITIES  TV · Fully-equipped kitchen · Hairdryer · Digital access   [Show more]
Optional add-ons
Flexible cancellation
€44.00  €38.00 /night
1 guest · 2 nights
Total €75.22
[Select]
```

Sticky/fixed elements measured: `div.bg-primary.fixed.bottom-0.left-0.w-full`,
height **82 px**, content `"€0.00 | 0 guests · 0 rooms | Reserve"`. At 375 px:
`scrollWidth = 375` (no overflow), Select button `335 × 40` px.

**Solves.** #3 price transparency, #4 comparing types, #8 mobile price summary.

**Take.**
- **Per-night and stay-total, both, on the card, before any click**, with the multiplier
  spelled out between them (`1 guest · 2 nights`). This is the whole answer to late-revealed
  fees: there is nothing left to reveal.
- **Refuse to show a price until dates exist.** "Add dates for prices" is more honest than a
  "from €X" that turns out to be a Tuesday in February.
- **The differentiators are size, room count and bed configuration with dimensions** —
  `1 Queen-size bed (1.50 m)`. Not a feature matrix. Amenities sit behind "Show more".
- The rate-plan name ("Flexible cancellation") is on the card, next to the price it explains.
- A fixed bottom summary bar, ~80 px, carrying total + the forward action.

**Do not take.**
- The calendar. `div.ngb-dp-day`, `aria-label="1 - 7 - 2026"` — a machine string, not a date.
  No `aria-live`, no `<button>`.
- 40 px Select button at 375 px — under target.
- The five types differ by 31/30/29/28 m². When the deltas are that small a card list is
  five near-identical blocks. **Our deltas are real** (sleeps 2/2/3/3/4, extra bed on three
  of five) and must be the thing the card leads with.
- The struck-through `€44.00 → €38.00` and "Save 15%". `design-foundations.md` §6 forbids it.

---

### 2.6 Eventbrite checkout timer — `eventbrite.com/checkout-external?eid=775219842417`
*Eventbrite. The reference for problem #6, and the only one I found that gets the accessibility of a countdown right.*

**Probe.** Reached by opening the external checkout URL directly and clicking `Register`.
The timer element, read verbatim from the DOM:

```html
<div id="timerRegion" class="eds-timer eds-text--center" role="timer">
  Time left&nbsp;<label id="timerLabel" for="timerRegion">19:56</label>
  <div role="alert" aria-live="polite" aria-atomic="true" class="eds-is-hidden-accessible">
    Time left 20 minutes
  </div>
</div>
```

Computed style on the wrapper and the label: `font-size: 12px`, `font-weight: 400`,
`color: rgb(111, 114, 135)`, `background: rgba(0,0,0,0)`, `position: static`.
Also `aria-live="polite"` on the order total (`"Total $0.00"`).

**Solves.** #6 the hold timer, done as courtesy.

**Take.**
- **Two representations of one countdown.** The visual label ticks `MM:SS` every second.
  A visually-hidden `aria-live="polite"` region carries a **coarsened** "Time left 20 minutes"
  — because a live region that fires every second makes the page unusable with a screen reader.
  This is not obvious and it is the single most valuable thing in this report.
- `role="timer"` on the wrapper.
- **The styling is the argument.** 12 px, muted grey, transparent background, static, no
  weight change, no red. Measured, not inferred. A hold timer that shouts is a dark pattern;
  this one reads as a receipt line.
- Copy is a noun phrase — "Time left" — with no verb telling the guest to hurry.
- `aria-live` on the total, so a price change is announced.

**Do not take.**
- `<label for="timerRegion">` points at a `<div>`. Invalid label target.
- `role="alert"` and `aria-live="polite"` on the same element contradict each other
  (`alert` implies assertive).
- Elsewhere on the same page: `"Few tickets left"`. Scarcity badge, forbidden by §6.

---

### 2.7 Aman booking engine — `aman.com/book/aman#/booking/destination/dates`
*Aman. Included as an instructive negative: the most expensive brand in the set, the worst date control.*

**Probe.** `[role=grid], table` count 2, but day cells are custom elements:

```
MWL-CALENDAR-MONTH-CELL  cls="cal-cell cal-day-cell azds-calendar-day-…"  aria-label=""  disabled=undefined
MWL-CALENDAR-MONTH-CELL  cls="cal-cell cal-day-cell expired cal-past …"   aria-label=""
```

`window.jQuery` present. An input's accessible name reads literally
`"Currency currency.aria_label.null popup menu input"` — an untranslated i18n key shipped to
production. URL state is an obfuscated blob:
`#/booking/destination/dates?data=('h6hd*a5dt*fs-~r6at!2~cn!0~cg-~al3po*co*gp*rn4ry*rk*re-~…`

**Take.** Nothing.

**Do not take.** All of it, specifically: no accessible name on any day cell (worse than
Amadeus, which at least gives the date); past days marked by class only; and a compressed,
unreadable URL state — the exact opposite of the shareable `/booking?from=…&to=…` that
`repository-structure.md` §`(booking)` commits to. A marketing call-to-action cannot link
into this.

---

## 3. Prototype concept — `/booking`

One search band, one list, one summary. No third region.

### 3.1 Structure

```
┌─ search band  (sticky top, ivory)────────────────────────────────┐
│  10 – 12 August · 2 nights    2 guests    Standard · B&B · Saver │
└──────────────────────────────────────────────────────────────────┘
┌─ month strip (only while the date sheet is open) ────────────────┐
│  August · 24 of 31 nights free                                   │
│  [ table role=grid ]   [ table role=grid ]      ← 2 up ≥720px    │
│  legend: free · sold out · arrival closed                        │
└──────────────────────────────────────────────────────────────────┘
┌─ room types (single column, fixed order) ────────────────────────┐
│  [img 4:3]  Superior                                             │
│             Sleeps 2 · one queen bed · 28 m² · courtyard         │
│             What's in the room ▾                                 │
│                                    1,850,000 ₫ / night           │
│                                    2 nights · 3,700,000 ₫        │
│                                    Includes VAT and service.     │
│                                                        [ Choose ]│
│  … Deluxe · Premier · Junior Suite · Panorama Suite              │
└──────────────────────────────────────────────────────────────────┘
┌─ summary  (right rail ≥1200px; fixed bottom bar below) ──────────┐
```

Ordering is fixed — Superior, Deluxe, Premier, Junior Suite, Panorama Suite — ascending by
max occupancy then price. Five items do not need a sort control.

**Rooms remaining is never shown.** "2 rooms left" is scarcity; §6 forbids it.

### 3.2 The date control

**One control, two months.** Two `<table role="grid">`, each with its own `<caption>`, side by
side at ≥720 px; one month at a time below that, in a full-height bottom sheet with months
stacked vertically and a sticky weekday header.

**Cell.** A `<button>` inside `<td>`, minimum `44 × 44` (cal.com's measured floor). Two lines:
the day number at `--text-base`, and under it the night's price at `--text-xs`, rounded to the
nearest 1,000 ₫ per `property-and-tariff` §5 and shown in thousands with the ₫ in the legend
only. **One price per night — the lowest across all five types** (Amadeus's "Lowest Available
Rate", verified). 31 numbers, not 155.

**Three cell states, each with a shape, none colour-only:**

| State | Visual | Semantics |
|---|---|---|
| Free | day number + price | normal button |
| Sold out | day number at reduced opacity, thin diagonal rule, no price | `aria-disabled="true"` — **not** `disabled` |
| Arrival closed / min-stay | day number + price + a marker glyph | `aria-disabled="true"`, reason in the accessible name |

`aria-disabled` rather than `disabled` is the correction to cal.com: a `disabled` button is
skipped by the roving grid, so the guest can never land on the date and never learns why it is gone.

**Range, in nights not days.** The range paints from the *middle* of the check-in cell to the
*middle* of the check-out cell, so a 2-night stay shows two filled gaps rather than three
filled boxes. This is the commonest off-by-one in hotel calendars and it is exactly the
`StayDate`/nights distinction `property-and-tariff` §2 is built on. The paint is a
`::before` on the button — never a separate focusable element.

**In-progress range.** After the first click the control is in "choosing departure" mode:
the anchor cell keeps a persistent marker, every day at or before the anchor becomes
`aria-disabled`, and hover/focus paints a provisional range.

**Minimum stay, communicated before the guest trips.** Once the anchor is set, any departure
that would produce an illegal stay is `aria-disabled` and its accessible name says why:
`"11 August 2026. Two-night minimum from 10 August."` Amadeus proves the cell-level restriction
state works ("Check-out only"); the improvement is putting the reason in the *name*, which
Amadeus does not.

**One live region above the grid**, `aria-live="polite" aria-atomic="true"`, holding a whole
sentence:

- rest → "Choose the night you arrive."
- anchor set → "10 August. Now choose the night you leave."
- complete → "10 to 12 August. Two nights."
- month change → "August 2026." (Trainline, verified)
- rule violation → "Two-night minimum from 10 August."

It never fires on hover.

**Keyboard hint rendered visibly** as a `.caps-label` line under the grid — Trainline's
"Cursor keys can navigate dates", visible rather than visually hidden.

### 3.3 Availability and price

Prices appear **only once both dates exist**. Before that the cards read "Choose your dates
for prices." — Limehome's verified refusal, and the honest one.

Each card shows, together and never one without the other:

```
1,850,000 ₫ / night
2 nights · 3,700,000 ₫
Includes VAT and service.
```

Displayed prices are **gross** per `property-and-tariff` §5, so nothing can be added after
this screen except an extra bed the guest chooses. Compute the total from the un-rounded sum
and round **once**; never derive the total from the rounded per-night figure, or the two lines
disagree by a few thousand đồng.

The rate plan is a three-way segmented control in the search band (`STANDARD` / `BB` /
`NONREF`). Changing it re-prices all five cards; the price block carries `aria-live="polite"`
(Eventbrite, verified). `NONREF`'s term — "Nothing is refunded if you cancel." — sits under
its label, not in a tooltip, because the guest should meet it before the hold, not after.

**No struck-through prices, no "was", no percentage saved.**

### 3.4 Comparing five types

Four facts per card, fixed order, so the eye compares down a column:

1. **Name** — `--text-lg`
2. **Sleeps N** — plus "· extra bed available" on Deluxe, Junior Suite, Panorama Suite
3. **Bed configuration**, with dimensions (Limehome, verified)
4. **One concrete distinguishing fact** in the arrival's voice: `"28 m² · courtyard"`

Everything else lives behind a `What's in the room ▾` disclosure that expands in place
(`grid-template-rows: 0fr → 1fr`).

**Occupancy is a fit test, not a filter.** If the party exceeds a type's maximum, the card
stays in place, in order, and its price block is replaced by "Sleeps 2. You are three." with
`Choose` disabled. Hiding it makes the guest think the hotel does not have that room.

**The extra bed is not a room variant.** `property-and-tariff` §1 is explicit — it posts as a
service item, never a rate modifier. So it is a checkbox under the price on the three types
that allow it, with its own per-night price, enabled only when the party exceeds standard
bedding. It never changes the room's rate line.

### 3.5 Guests

A `<fieldset legend="Who is staying">` with two steppers — Adults, Children — and, per child,
an age field. Ages are not optional: §3 prices `<6` free, `6–11` at half the extra-person rate,
`12+` as an adult, and a number that changes the price cannot be collected later.

Native `<select>` is acceptable on mobile (Resy uses it, verified, and it gets the platform
picker for free). Steppers on desktop.

### 3.6 The hold timer

**There is no hold on `/booking`, and the screen must say so rather than show a clock.**
`booking-state-machine.md` §3 starts the TTL on entry to `HELD`; `repository-structure.md`
puts the hold id in the path "from step three on". `/booking` is stateless. So:

- Under the `Choose` button, at `--text-sm`: *"Choosing a room holds it while you finish.
  Nothing is charged yet."* Same string as the button's `aria-describedby`.
- The countdown itself belongs to `/booking/<hold>/details` onward. Specified here because it
  is one funnel-wide decision:

```html
<div role="timer" class="hold">
  Held for <span class="hold__digits">14:32</span>
  <span class="visually-hidden" aria-live="polite" aria-atomic="true">
    Your room is held for 15 more minutes.
  </span>
</div>
```

  - Visual digits tick every second at `--text-sm` in `--stone`. Eventbrite's measured
    treatment: quiet weight, no background, no red, no size change, **no threshold colour
    change at all**.
  - The live region announces in **whole minutes only** (Eventbrite, verified). Never per second.
  - Driven off a server `expiresAt`, recomputed against `Date.now()` on every tick **and on
    `visibilitychange`** — never a client-side duration, or a skewed device clock lies.
  - At two minutes the supporting line changes once: *"A few minutes left. We can start again
    if you need longer."* Nothing else changes.
  - On expiry the page does not empty. It returns to `/booking` with the same search params and
    one line: *"Your hold ran out. The dates are still here."*
  - The digits never animate.

### 3.7 The empty state

Resy's three moves, in the house voice.

**Nothing free at all:**

> **Nothing free for 10 to 12 August.**
> The next two nights free are 15 to 17 August.  `[ Show those dates ]`
> Two nights from 11 August.  `[ Show ]`
> One night on 10 August.  `[ Show ]`
> We can write to you if these dates open.  `[ Tell me ]`

The nearest-dates offer must be parameterised by the *same party size* — that is the detail
Resy gets right ("The next availability **for 2**").

**Partly free — the common case, and the one that actually matters.** With 5 types and 40
rooms, four-of-five sold out will happen far more often than zero. Sold-out types stay in the
list, in position, greyed, with "Not free for these dates" where the price was. The guest sees
the property is nearly full without being told to hurry.

### 3.8 Mobile

- Search band collapses to one tappable line: `10–12 Aug · 2 nights · 2 guests`. Each segment
  opens its own full-height bottom sheet — dates, guests, plan.
- Sheet enters on `translateY`, `0.5s var(--ease-ui)`. It leaves on the same curve:
  `EASE_UI_EXIT` is GSAP-only per `motion-tokens.ts` and has no CSS counterpart, so the exit
  is not the "accelerate away" curve. Stated, not hidden.
- Cards stack: image 16:9 full-bleed, four facts, price block, then `Choose` at full width,
  **min-height 48 px** (Limehome's measured 40 px is under target; cal.com's 44 px is the floor).
- Two months are never side by side below 720 px.
- Summary bar: hidden until a type is chosen, then a fixed 80 px bar with total + `Continue`
  (Limehome measured 82 px), entering on `translateY`, `0.5s var(--ease-ui)`.
- No horizontal overflow at 375 px — assert it in the visual baseline, since both cal.com and
  Limehome pass it and it is the cheapest regression to catch.

### 3.9 Motion — named tokens only

From `apps/web/lib/motion-tokens.ts`. No new values.

| Move | Property | Duration | Ease |
|---|---|---|---|
| Cell hover / focus | `background-color`, `border-color` | `0.4s` | `var(--ease-ui)` |
| Range paint | `background-color` on `::before` | `0.4s` | `var(--ease-ui)` |
| Card cascade on first paint | `opacity`, `transform` | `DUR_UI` = `0.5s` | `var(--ease-ui)` |
| Card cascade delay | `transition-delay: calc(var(--card-index) * 0.1s)` | — | `STAGGER_CASCADE` = `0.1` |
| "What's in the room" disclosure | `grid-template-rows: 0fr → 1fr` | `0.5s` | `var(--ease-ui)` |
| Bottom sheet in/out | `transform: translateY()` | `0.5s` | `var(--ease-ui)` |
| Summary bar in | `transform: translateY()` | `0.5s` | `var(--ease-ui)` |
| Price re-quote on plan change | `opacity` | `0.4s` | `var(--ease-ui)` |

`var(--ease-ui)` is `EASE_UI_CSS` = `cubic-bezier(0.23, 1, 0.32, 1)`, emitted by
`motionTokensCss()` from the root layout. Five cards × `STAGGER_CASCADE` caps the cascade at
`0.4s` of delay.

**Month change does not slide.** Content swap only. A grid sliding under a 0.5 s ease is
unreadable mid-transition and races the live region.

**Reduced motion.** Per §9 the reduced path is a composition, not a frozen frame. The global
kill-switch cuts durations to `0.01ms`, which would make the bottom sheet *snap* into place —
so under `prefers-reduced-motion` the sheet is rendered as an in-place panel that was never
translated, the card cascade is dropped and all five render at once, and the range paint has
no transition on hover at all. Nothing here advances on time alone except the hold countdown,
which is content.

---

## 4. Cost and risk

**Expensive.**

- **The date grid is the whole cost.** A range calendar with two months, price-in-cell,
  min-stay and closed-to-arrival states, a roving-tabindex grid, and a live region is more
  code than the other four funnel steps' controls combined. There is no component library
  allowed, so all of it is hand-built and hand-tested. Budget it as its own phase.
- The disclosure, the steppers and the summary bar are cheap.

**Depends on API work that may not exist.**

| Need | Exists? |
|---|---|
| Per-date lowest price across all types, for a month, before a room is chosen | Needs a `rate_calendar` read joined to an availability aggregate. Not in `plans/backlog.md` as a public endpoint. |
| Per-date restriction flags (min stay, closed-to-arrival, closed-to-departure) | `property-and-tariff` §3 names minimum stays only under the admin **Rates** family. Whether they are a public contract at M7 is unresolved. |
| "Nearest range of N nights that is free", party-size aware | Does not exist. Non-trivial query. Without it the empty state degrades to "nothing free", which is the state that loses the booking. |
| Waitlist storage | No entity. |

**What could go wrong.**

- **Price-in-cell payload.** Naive design is 31 days × 5 types × 3 plans. The lowest-across-types
  decision reduces it to 31 numbers per plan — but it also means the number in the cell is not
  necessarily the number on the card the guest picks. The legend must say so, in one line.
- **Rounding drift.** Nearest-1,000 display rounding with `Intl.NumberFormat('vi-VN')` makes
  `per-night × nights ≠ total` unless the total is summed un-rounded and rounded once.
  `property-and-tariff` §5 already warns this breaks `Σ postings = Σ payments + outstanding`.
- **Timezone.** Never construct a `Date` from a stay date. Carry `YYYY-MM-DD` strings; format
  with an explicit `timeZone: 'Asia/Ho_Chi_Minh'`. A browser at UTC+9 parsing `"2026-08-10"`
  and formatting locally renders the wrong day, silently, for exactly the guests most likely
  to book us.
- **The device clock.** Covered in §3.6 — server `expiresAt` only.
- **Bundle budget.** Everything above is CSS-only and passes the zero-`gsap`/`three`/`lenis`
  CI budget. If the range paint later "needs" `Flip`, that is the signal the move is wrong,
  not the signal to import GSAP.
- **Visual baselines.** `docs/architecture/design-foundations.md` §10 warns baselines are
  machine-specific. A calendar is dense type; expect it to be the noisiest frame in the suite.
  A computed-style assertion on cell size and state classes is a stronger gate here than a
  pixel diff.

---

## 5. Accessibility — the date picker specifically

Where custom calendars fail is keyboard range selection and announcing range state. Four of
the five pickers probed for this report fail one or both. Concretely:

**Structure.** `<table role="grid">`, one `<caption>` per month naming month and year, one
`<button>` per day inside `<td>`. Verified precedent: Trainline. Verified counter-examples:
Amadeus (`<span>` inside `role="application"`, `tables: 0`), Limehome (`div.ngb-dp-day`),
Aman (`<mwl-calendar-month-cell>`, no accessible name at all), cal.com (no grid role).

**Never `role="application"`.** Amadeus uses it and it turns off the screen reader's browse
mode — the exact mode needed to read a price line inside a cell.

**Roving tabindex.** Exactly one day is tabbable.

| Key | Moves |
|---|---|
| ← → | one day |
| ↑ ↓ | one week |
| Home / End | start / end of week |
| PageUp / PageDown | one month |
| Shift+PageUp / PageDown | one year |
| Enter / Space | select |
| Escape | close, return focus to the trigger |

**The accessible name carries every state the pixel carries.** This is the single failure
shared by Amadeus (`"July 1, 2026"` — no price, no restriction) and Resy (`"Sunday, July 26,
2026."` — identical on sold-out and available days). Ours:

```
"12 August 2026. 1,850,000 ₫."
"12 August 2026. Not free."
"12 August 2026. 1,850,000 ₫. Arrival closed — you cannot start a stay on this date."
"11 August 2026. Two-night minimum from 10 August."
"10 August 2026. You arrive. Night 1 of 2."
"12 August 2026. You leave."
```

**`aria-disabled`, never `disabled`.** cal.com uses real `disabled` (verified) and its
unavailable days are unreachable by keyboard — the user cannot land on the date and cannot
learn why it is gone. Ours stay focusable and announce the reason. Click and Enter are no-ops.

**One live region, one sentence, `aria-atomic="true"`.** Fires on: month change, anchor set,
range complete, rule violation. **Never on hover** — a hover-driven region fires continuously
and is worse than silence. Trainline verified: `polite :: "July 2026"`.

**Two months = two grids.** Do not merge them into one table. Each `<table>` gets its own
`<caption>`; when arrow navigation crosses from one to the other, the live region says the new
month, because the visual gap carries no announcement.

**Range paint is decorative.** `::before` on the button. Never a separate focusable element,
or the tab order doubles and the count of days stops matching what is announced.

**Touch and target.** ≥44×44 (cal.com measured exactly 44×44 at 375 px). The price line lives
*inside* the button so it does not shrink the hit area.

**Visible keyboard hint.** Trainline renders "Cursor keys can navigate dates" as visible text.
Do the same as a `.caps-label` line — sighted keyboard users need it as much as screen-reader users.

**Reduced motion.** No transition on the range paint on hover. Per §9 the reduced path is its
own composition; a 0.01 ms flicker across 14 cells as the pointer moves is worse than the
motion it replaced.

---

## 6. Open questions

1. **Hold TTL length.** `design-foundations.md` §6 uses "held for 15 minutes" in a copy
   example; `booking-state-machine.md` §3 says a TTL starts but never names a number. Which
   is authoritative, and is it configurable like the 04:00 rollover?
2. **Are minimum-stay rules a public contract at M7?** `property-and-tariff` §3 lists them
   under the admin **Rates** family only. The calendar's restricted-cell state depends on them
   being readable from `/booking`.
3. **Prices before dates — show a "from" figure, or refuse?** Limehome refuses and it is more
   honest, but it loses the hook. Refusing is assumed above.
4. **Rate plan on step 1 or step 2?** On `/booking` it re-prices five cards live; on
   `/details` it keeps step 1 to one number per type. `NONREF`'s 100%-on-cancel term argues for
   step 1 — the guest should meet it before the hold. Assumed step 1.
5. **Is there a waitlist entity?** If not, the empty state's fourth offer drops and the
   nearest-dates query becomes load-bearing.
6. **Extra-bed price.** `property-and-tariff` §6 has every service price ⚑ unset. The card
   cannot render "+X ₫ / night" until one exists.
7. **Whose lowest price goes in the cell** — lowest across all five types, or lowest across
   the types that fit the chosen occupancy? The second is more honest and more expensive.
8. **GSAP in `(booking)`.** The brief said assume it is available; `design-foundations.md` §5
   and `repository-structure.md` both forbid it as a CI budget. Assumed the repo wins. If not,
   two documents need changing before any tween is written.
9. **Airbnb.** The canonical mobile range picker, and it would not hydrate in this browser.
   Worth one manual pass on a real device before the calendar is built.

---

Status: DONE_WITH_CONCERNS
Summary: Seven references verified live by DOM/computed-style probe — Amadeus IBE, Trainline,
Resy, cal.com, Limehome, Eventbrite's checkout timer, and Aman as a negative — plus a
concrete `/booking` prototype specified against the repo's own motion, spacing and type
tokens, with accessibility for the date grid worked out against four verified failure modes.
Concerns/Blockers: Airbnb would not hydrate in this browser, so the most canonical mobile
range picker in the category is unverified and deliberately undescribed. Codrops turned out to
have nothing on this problem and the Awwwards hotel category resolved to marketing sites whose
booking is third-party software — 3 of 10 nominees were also dead. Four of the eight open
questions (TTL length, min-stay contract, waitlist entity, extra-bed price) are API or data
decisions the design depends on and cannot answer itself.
