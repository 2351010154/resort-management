# /booking — the room choice as a picture. Round 2.

Research, 2026-07-27 21:33 ICT. Report only; no code written.

Round 1: [`research-260726-2127-booking-screen-inspiration.md`](research-260726-2127-booking-screen-inspiration.md).
Its seven verifications (Amadeus IBE, Trainline, Resy, cal.com, Limehome, Eventbrite, Aman)
stand and are cited, not repeated. Its **prototype is superseded by §3 here**.

Authority re-read: `docs/screens.md` /booking · `docs/architecture/property-and-tariff.md` §1–§3 ·
`docs/architecture/booking-state-machine.md` · `docs/architecture/design-foundations.md` §§2–7 ·
`apps/web/lib/motion-tokens.ts`. Round 1 was **built** — `apps/web/features/booking/` — so §4's
"what was removed" is measured against shipped code, not against a sketch.

**One contradiction, stated not hidden.** The brief says all motion is CSS. `design-foundations.md`
§5 has since been amended: `motion` 12.42 (`LazyMotion` + `domAnimation` + `m`) is permitted in
`(booking)` **for exits only**, because CSS has no exit. The shipped screen uses it. §3.9 below is
specified CSS-only per the brief, and names the one place that costs something.

---

## 0. The diagnosis — why round 1 read as broken

Not a taste failure. Three mechanical causes, each readable in the shipped code.

**a. Both decisions are mounted from the first paint.** `booking-screen.tsx:172-194` renders
`RoomTypeList` unconditionally. `search-band.tsx:65` opens the date panel on arrival when there is
no range. So the first frame is: calendar open, and **five room cards below it, each already saying
"Choose your dates for prices."** (`room-type-card.tsx:178`). The guest is asked "when" while five
dead cards compete for the same attention. The band already collapses to a summary
(`search-band.tsx:88-107`) — that was never the problem. The problem is that the list never leaves.

**b. There is no photograph.** `room-type-card.tsx` renders `h3` + three `<p>` + a disclosure +
a price block. **No `<img>` anywhere in the component.** R1's own prototype drew `[img 4:3]` in its
ASCII and the build shipped without one. So the owner is literally right: with the price covered
there is nothing left but four lines of near-identical prose.

**c. The card copied a card that has the same disease.** R1's card is Limehome's card, cited as its
model. Re-measured today (§2.3): Limehome's seven types are 28/29/29/30/31/31 m², 30–38 words each,
**three 100×100 placeholder images per card**, every one `alt=""`, under a printed disclaimer that
the photos may not match the room. R1 inherited the failure from its reference.

---

## 1. Method and discards

Every URL curl-checked first (`curl -s -o /dev/null -w "%{http_code} -> %{url_effective}" -L
--max-time 20`, desktop Chrome UA), then **loaded in a real Chromium via `agent-browser` and probed
from the DOM**. No screenshots — every number below is `getBoundingClientRect()`, `naturalWidth`,
`innerText.split(' ').length`, `getComputedStyle()` or `outerHTML`, read in the page. Measurements
taken at **1440×900** and repeated at **375×812** where stated. Round 1's lesson held again: curl
200 is not alive — three of the rejects below returned 200.

**Correction made mid-probe, recorded because it changes a claim.** My first Hoxton pass read
DOM-order image 0 and concluded the lead frame was a bathroom on three types. Re-probing by
*rendered position* (the image whose left edge sits at the card's carousel origin) showed the lead
is a bedroom on all eight. The bathroom is slide 2. The corrected probe is what §2.1 reports.

### Rejects

| Target | Evidence | Verdict |
|---|---|---|
| `celebritycruises.com/…/staterooms` | curl 200; probed title **"Celebrity Cruises - Under Maintenance"**, 0 buttons, 0 inputs | Dead behind a 200. Cruise cabin pickers were the best structural analogue (cabins differ by view/size/occupancy) and I lost the whole category to this plus two 404s. |
| `designhotels.com/hotels/vietnam/`, `onefinestay.com/destination/france` | curl 200; probed title **"Just a moment…"**, scripts `['v1','api.js']`, 1 hidden input | Cloudflare interstitial. Never rendered. |
| `be.synxis.com/?chain=5154&config=firmdale` (Firmdale's real engine) | Probed after 12 s: title `""`, 0 img, 0 input, one script named `o-Of-dready-beene-Banquo-Of-King-and-shall-now-I` | Anti-bot challenge. **The loss that hurts** — SynXis is the other half of the hotel-IBE duopoly (R1 covered Amadeus) and I could not see it. |
| `hyatt.com/shop/rooms/saigz?checkinDate=…` | Browser (not curl): 0 img, 0 button, 0 scripts, blank | Bot wall survives a real browser. |
| `traveloka.com/en-en/hotel` | Browser: title `traveloka.com`, `Times New Roman`, one script `i.js`, empty body | Bot wall. **The brief called Traveloka especially relevant and I could not verify one pixel of it.** Not described. |
| `airbnb.com/rooms/33571268?check_in=…` | Shell loads (Circular font, `metroRequire.js`) but 0 buttons, 2 img, no listing | Same failure R1 hit. Two rounds, unverified. |
| `21cmuseumhotels.com`, `standardhotels.com`, `klook.com`, `sonner.com`/`sonder.com` | curl 403 | Not verifiable here, so not described. |
| `app.mews.com/distributor/<guid>` | I **guessed** a distributor GUID. curl 200; iframe body read `"Sorry, an unexpected error has occurred."` | My error, recorded: a 200 from Mews is the shell, not a property. Did not pursue a real ID. |
| `editionhotels.com/dubai/gallery/rooms-and-suites` | curl 200, page renders — but the only images with layout are four logos (110×20, 240×71, 350×63, 250×46) and the only `[role=tab]` set is the **cookie consent panel** | Room gallery never rendered in this environment. Not described. |
| `acehotel.com/new-orleans/rooms/` | curl 200 → redirects to `acehotel.com/` | Property page gone; Brooklyn used instead. |
| `firmdalehotels.com` (marketing) | Renders. Probed `scrollWidth 1493 @ innerWidth 1440` | **53 px of horizontal overflow on the homepage of a luxury group.** Not a reference; recorded because it is the cheapest regression in this category and §3.11 asserts against it. |

**No verified reference was found for a size bar or a floor-plan chip.** I looked (Dwell, IKEA,
cruise cabins, Apple). Booking.com gave me the occupancy half (§2.6). The size bar in §3.4 is
therefore **my proposal, unreferenced** — said plainly rather than dressed in a citation.

---

## 2. Verified references

Photography handling first, as instructed. Every figure is measured.

### 2.1 The Hoxton, Holborn — rooms — `thehoxton.com/london/holborn/rooms/`
*The best verified answer to "the image does the comparing". Eight room types, photo-led.*

**Probe.** `GT America Thin`, bg `rgb(254,242,227)`, 0 canvas, 0 video, 79 img (69 laid out),
`window.jQuery` + `Swiper` + `dataLayer`. 12 `[role=grid]` / 365 gridcells — a full date picker is
inline on the same page. `scrollWidth 1440 @ 1440`.

Lead frame per type, measured by rendered position at 1440:

```
Shoebox      imgs=5  650x433  ar 1.50  alt="A bedroom with a small amount of space either side of the be…"
Snug         imgs=5  650x433  ar 1.50  alt=(empty)
Cosy         imgs=5  650x433  ar 1.50  alt="A large leather headboard is a big feature of the room"
Cosy • Up    imgs=7  650x433  ar 1.50  alt=(empty)
Roomy        imgs=7  650x433  ar 1.50  alt="A desk sits in front of the window, with the large double be…"
Roomy • Twin imgs=7  650x433  ar 1.50  alt=(empty)
Biggy        imgs=7  650x433  ar 1.50  alt="Biggy Room in Holborn hotel"
Biggy • Twin imgs=6  650x433  ar 1.50  alt=(empty)
```

`object-fit: cover`. `currentSrc` empty and `naturalWidth 0` at probe time — lazy, undecoded.
At **375 px**: lead frame `375×250`, **ar 1.50 held exactly**, `scrollWidth 375` — no overflow.

Word counts, carousel chrome (`View 360` ×n) stripped, `1 / 3` counter left in:
`Shoebox 38 · Snug 35 · Cosy 36 · Cosy•Up 57 · Roomy 40 · Roomy•Twin 43 · Biggy 53 · Biggy•Twin 53`.

Card text shape, verbatim: `Snug` / `Up to 2 Adults • Double Bed • 150 sq ft / 14 sq m • Dog Friendly`
/ `Comfy and cleverly designed to make the most of the space.` / `Check availability`.

**Solves.** P1 primarily. P8 (aspect held across widths).

**Take.**
- **3:2, exactly, at every width.** 650×433 desktop, 375×250 mobile. Not "roughly landscape" —
  1.500 on both. An aspect that survives the breakpoint is what lets five photos stay comparable.
- **One frame visible, 5–7 behind it.** The gallery exists and does not spend card height.
- **The lead frame is always the bedroom from the door.** Eight types, eight of the same
  photograph. That sameness is what makes the differences legible.
- The counter `1 / 5` is honest about how much is behind the tap.

**Don't take.**
- **Four of eight lead images have `alt=""`.** A content image hidden from the accessibility tree —
  exactly what `design-foundations.md` §7 forbids.
- **35–57 words per card.** Two to nearly four times our 15-word budget. The prose sentence
  ("Comfy and cleverly designed…") adds nothing the photo has not said.
- Badges — `Guest Favourite`, `Top Choice for Families`. §6 forbids the register.
- The date grid and the room list are on one page. This is round 1's mistake at scale.

---

### 2.2 Plum Guide — London — `plumguide.com/d/gb-england-london`
*The reading-budget proof. Measured 7–8 words per card, and it does not feel thin.*

**Probe.** `HalyardDisplay`, Next.js (`__NEXT_DATA__`), 0 canvas, 0 video, 37 img, **30 `<picture>`**,
0 window motion library. `scrollWidth 1440 @ 1440`.

Card anatomy, measured:

```
box 371x673   1 image, visible   ar 0.77 (371x482)  object-fit cover  natural 1258x838
words 8       "KNIGHTSBRIDGE, LONDON  ELEGANTLY KNIGHTSBRIDGE  View this home"
box 269x540   1 image, visible   ar 0.77 (269x349)  natural 0x0 (undecoded)
words 7       "MAYFAIR, LONDON  REFINED URBANITY  View this home"
```

Every card in the grid: **one image, seven or eight words, no exceptions.** The source frames are
landscape (`1258×838`) and `cover`-cropped to portrait.

**Solves.** P1, and R3 outright.

**Take.**
- **Seven words is enough** when the photograph is 482 px tall. This is the existence proof the
  brief asked for, and it is measured, not asserted.
- **Portrait 3:4 crops from landscape originals.** One shoot serves both a 3:2 card and a 3:4 tile;
  the crop is a CSS decision, not a second photograph.
- The three text slots are fixed — where / what / action — so the eye compares down a column.

**Don't take.**
- **No price anywhere on the card.** `/booking` cannot do this; P4 requires a stay total. Plum
  Guide is a discovery grid, not a chooser, and the 7-word budget is partly bought by that.
- Portrait 0.77 at 269 px wide gives a 349 px image. Our five types need width to show a room's
  proportions; §3.3 takes the word count and rejects the aspect.

---

### 2.3 Limehome, re-measured on the axis round 1 never measured
`limehome.com/suites?city=167&property=451&checkin=2026-09-15&checkout=2026-09-17`

R1 verified this site's *text and price* and adopted its card. Here is its *photography*.

**Probe.** `Inter`, 29 img, 22 `<picture>`, `scrollWidth 1440 @ 1440`. Seven room categories:

```
Studio with private patio        631x273  3 imgs  300x305 ar 0.98  natural 100x100  alt=(empty)  37 words
Comfort Studio with sofa bed     631x273  3 imgs  300x305 ar 0.98  natural 100x100  alt=(empty)  36 words
Family Studio                    631x273  3 imgs  300x305 ar 0.98  natural 100x100  alt=(empty)  33 words
Family Studio with private patio 631x273  3 imgs  300x305 ar 0.98  natural 100x100  alt=(empty)  38 words
Studio (wheelchair accessible)   631x234  3 imgs  300x266 ar 1.13  natural 100x100  alt=(empty)  30 words
Studio with sofa bed             631x234  3 imgs  300x266 ar 1.13  natural 100x100  alt=(empty)  31 words
```

Sizes: 28 / 29 / 29 / 30 / 31 / 31 m². Card text, verbatim and near-identical across all seven:
`1 Room 1 Queen-size bed (1.50 m) 1 Sofa bed (1.40 m) 1 Air Conditioning ROOM AMENITIES TV
Fully-equipped kitchen Hairdryer Digital access Show more Optional add-ons Flexible cancellation`.

Section header, verbatim: **"The design and layout of our suites may vary slightly from the photos."**
Elsewhere on the page: `Save 15%`, `You've found the best price!`.

**Solves.** Nothing new. It is here as the **instructive negative that explains round 1**.

**Don't take — and this is the whole finding.**
- **`naturalWidth` is 100 on every card image, rendered at 300 px.** These are placeholders upscaled
  3×. The photography is not doing any work; it cannot.
- **Every card image `alt=""`.** Seven types, twenty-one content images, none in the a11y tree.
- **The header disclaims the photographs in writing.** A page that tells you not to trust the picture
  has conceded that its text must carry the choice — and its text is the same 30 words seven times.
- Six categories separated by 3 m² is not a difference a guest can act on. **Ours are 28→68 m² and
  sleep 2/2/3/3/4** — R1 noted this and then shipped Limehome's card anyway.

---

### 2.4 Ace Hotel, Downtown Brooklyn — `acehotel.com/brooklyn/rooms/`
*Nine types, real photography, and the copy still fails. The negative that isolates the variable.*

**Probe.** `Bianco Sans`, `window.flatpickr`, 0 canvas, 0 video, 40 img (27 laid out).
Card 573×644–716; image **573×400, ar 1.43, `object-fit: cover`**, natural 996×711 (real photos,
decoded). 1–2 images per card. Words per card: `Queen 51 · Cozy 34 · Medium 43 · Accessible Medium 31
· Medium Skyline 66 · Double 46 · Accessible Double 34 · Loft 65`.

The prose, verbatim, across cards:

```
Queen          "…a curated minibar, casting-compatible hi-def television, a custom Tivoli radio…"
Cozy           "…a curated minibar, casting-compatible hi-def television and a custom Tivoli radio."
Medium         "…a curated minibar, casting-compatible hi-def television and a custom Tivoli radio."
Medium Skyline "…a curated minibar, casting-compatible hi-def television and a custom Tivoli radio."
Double         "…curated minibar, casting-compatible hi-def television and…"
Loft           "…a curated minibar, casting-compatible hi-def television, a custom Tivoli radio…"
```

Alt text shows the frames repeat too: `"A room with multiple seating options, …"` is an image on
**Cozy, Accessible Medium and Medium Skyline**; Cozy's second frame is a bathroom.

**Solves.** Nothing. Cited as the sharpest available demonstration of round 1's exact failure mode
on a site with a real photographer.

**Don't take.**
- **~15 of every card's 31–66 words are identical boilerplate on six of nine types.** Cover the
  price and Queen, Cozy, Medium and Medium Skyline are the same card.
- **Photographs shared between types.** The moment one frame appears under two names, the image has
  stopped comparing and started decorating.
- 1.43 rather than 1.50 — close, and not held anywhere else on the page. Pick one ratio and hold it.

---

### 2.5 Apple — iPhone compare — `apple.com/iphone/compare/`
*The strongest possible negative for R4: the best product photography in the industry does not compare.*

**Probe.** `SF Pro Text`, `window.Vue`. `[role=table]` ×1, **`[role=row]` 181**, `[role=rowheader]` 20,
`cell gridcell` 537, `[role=columnheader]` 4. Three `<select>`, **39 options each** — the model
pickers. Column headers measured `0×100` / `0×50` with **`imgs: 0`**.

Total `<img>` on the page: **four**. Three are `2×2` spacers; one is a `960×540` video poster.
`<picture>`/`<source>`: **zero**.

Row-header categories, in order: `Finish · Summary · Capacity · Display · Size and Weight ·
Splash, Water, and Dust Resistant · Apple Intelligence · Chip · Camera · Video Recording ·
Front Camera · …` (20 total).

**Solves.** It is the reference for what **not** to do, and it is worth more than a positive here.

**Don't take.**
- **181 rows.** Apple has one product photograph per model that everyone on earth can identify, and
  it still answers "which one" with a spec table. That is the gravitational pull round 1 fell into.
- Three 39-option `<select>`s to choose what to compare — a configuration step before the comparison.
- The rendered product images carry no `<img>` at all, so a comparison built on them would be
  invisible to assistive tech.

**One thing to take.** The 20 row-headers are **categories, not specs** — "Size and Weight", not
"148.0 × 71.5 × 8.25 mm". §3.5's sheet uses the same grouping: the guest opens *a subject*, not a list.

---

### 2.6 Booking.com — Park Hyatt Saigon, dated
`booking.com/hotel/vn/park-hyatt-saigon.html?checkin=2026-09-15&checkout=2026-09-17&group_adults=2`
*The one verified occupancy-pictogram implementation, and the ARIA pattern §3.4 copies.*

**Probe.** 59 img, 36 `<picture>`, `[role=meter]` ×7, `scrollWidth 1440 @ 1440`. Room table
`#hprt-table`, **1110×1091, 13 rows**. Column headers: `Room Type`, `Number of guests`.

The occupancy cell, read as `outerHTML`:

```html
<div class="f3e8df388a aa7d246d7d" aria-label="2 adults, 1 child" role="img">
  <span class="fbaa916c86" aria-hidden="true">…</span>   <!-- ×6 glyph spans -->
</div>
```

`"3 adults, 2 children"` renders 8 glyph spans. Per row: **`imgs: 0`**, 7–11 words
(`"King Room with Garden View 1 king bed + Show prices"`).

**Solves.** R4's occupancy half, and P1 negatively.

**Take.**
- **A glyph group is one `role="img"` with a complete accessible name; the glyphs inside are
  `aria-hidden`.** Not one image per person, not a label per glyph. This is the correct and verified
  pattern and §3.4 uses it verbatim in shape.
- Occupancy earns its own column header — it is a first-class axis of the choice, not a spec.

**Don't take.**
- **Zero images in thirteen room rows**, on a page carrying 59 images elsewhere. The photographs are
  in the hotel gallery; the choice is made in a table. Same failure as Apple, in our exact category.
- 7–11 words is inside our budget and still tells you nothing, because the words are bed counts.
  **A low word count is necessary and not sufficient — R2 is what makes R3 survivable.**

---

### 2.7 Google Flights — `google.com/travel/flights?q=flights from SGN to HAN on 2026-09-15`
*Sequencing, measured at both widths. Half a lesson, and an honest failure at 375.*

**Probe.** `Roboto`, **0 images on the entire results page**, `[role=search]` ×1, 8 `<input>`.
The answered values live **inside the controls**, not as separate text:
`textbox "Departure" : "Tue, Sep 15"`, `combobox "Where from? Ho Chi Minh City SGN"`.

| Width | `[role=search]` box | words in band | `scrollWidth` |
|---|---|---|---|
| 1258 | **1024×148** | 25 | 1258 (no overflow) |
| 375 | **375×220** | 25 | 375 (no overflow) |

**Solves.** P2, partly. P8.

**Take.**
- **The summary and the control are the same object.** The date is the input's *value*; there is no
  separate "10–12 August" label that can drift from what the control holds. §3.6 takes this.
- No horizontal overflow at 375 on a page this dense — the bar to clear.

**Don't take.**
- **At 375 the band grows from 148 px to 220 px — 27% of an 812 px viewport spent on the question
  before one answer is visible.** Google does not collapse; it stacks. That is the failure R1
  demands we avoid, and it is why §3.6 replaces the persistent band with a **one-line summary that
  is not the control** and reopens into a full view.
- Zero images is correct for flights and is the whole disease for rooms.

---

## 3. Prototype — "Dates, then rooms."

Satisfies R1–R5. Desktop is the design target; 375 is the adaptation.

### 3.1 View sequence (R1, P2)

One route, `/booking`, state in the URL exactly as today (`booking-search.ts` unchanged). **Two
views, and the inactive one is not in the DOM** — not hidden, not collapsed, unmounted. That is how
R1 is guaranteed mechanically rather than by CSS discipline.

```
VIEW A — When                          VIEW B — Which room
─────────────────────────              ─────────────────────────
Your stay                              Your stay
Choose the nights you are here.        15 – 17 September · 2 nights · 2 guests   [Change]
                                       Prices include VAT and service.
For 2 guests.  [Change]                ─────────────────────────
                                       Choosing a room holds it while you
   [ Sep 2026 ]  [ Oct 2026 ]          finish. Nothing is charged yet.
   two <table role=grid>, R1 spec
                                       [ five photo cards ]
   free · sold out · arrival closed
   Cursor keys move between dates.     NOT FREE FOR THESE NIGHTS
                                       Deluxe — not free for these nights.
```

- **A → B** fires only on a *complete* range. An anchor without a departure keeps A.
- **B → A** on `[Change]`. The room list unmounts; **View B's `scrollY` is stored and restored** when
  B remounts. This is the "without losing place" requirement and it is the fiddly part (§3.12).
- Guests are a **stated assumption with an escape**, not a third open control: `For 2 guests.
  [Change]` swaps the calendar for the guest fieldset in place (view A2). Still one open decision.
- **The rate plan leaves `/booking`.** See §6 Q1 — this is a scope decision for the owner, not a
  silent cut. It removes a segment, three cancellation-term sentences, and the live re-pricing of
  five cards. `/booking` quotes `STANDARD`.

The date bottom-sheet disappears entirely: at 375 the calendar *is* View A, so there is nothing to
put in a sheet. `bottom-sheet.tsx` is then used only by the room sheet (§3.5).

### 3.2 Room-card anatomy (R2, R3)

```
┌───────────────────────────────────────┐
│                                       │
│      photograph   588 × 392           │   aspect-ratio: 3 / 2
│      object-fit: cover                │   background: var(--umber)
│                                       │
├───────────────────────────────────────┤
│  Junior Suite                         │   --text-lg, --font-display
│  ●●● ○   ▬▬▬▬▬▬▬▬▬▬░░░  52 m² · corner│   the measure line — one role="img"
│                                       │
│  3.940.000 ₫                          │   --text-display-sm, --ink
│  1.970.000 ₫ a night                  │   --text-sm, --stone
│                              [ Choose ]│  --dusk-amber, the only amber thing
└───────────────────────────────────────┘
```

Whole photo + name is a second button → the room sheet (§3.5). Two targets, two jobs: **look closer**
and **take it**.

**Persistent words, counted:**

| Type | Card text | Words |
|---|---|:-:|
| Superior | `Superior` · `28 m² · courtyard` · `3.700.000 ₫` · `1.850.000 ₫ a night` · `Choose` | **11** |
| Deluxe | `Deluxe` · `34 m² · garden` · … | **11** |
| Premier | `Premier` · `42 m² · city` · … | **11** |
| Junior Suite | `Junior Suite` · `52 m² · corner` · … | **12** |
| Panorama Suite | `Panorama Suite` · `68 m² · sea` · … | **12** |

Ceiling 12, budget 15. Occupancy and extra-bed are **glyphs, not words**. Suite-vs-room is carried
by the name and costs nothing.

**Image spec.** `588×392` at 1440 (2-up, `--space-3` gutter). `aspect-ratio: 3/2`, `object-fit:
cover`, explicit `width`/`height` so the 3:2 box reserves space and the cascade cannot reflow.
`loading="lazy"` below the fold, `decoding="async"`, `srcSet`+`sizes`. **3:2 chosen because it is the
only ratio measured to survive a breakpoint unchanged** (Hoxton: 1.50 at 1440 and at 375).

### 3.3 What is on the card and what is one tap deeper (P3)

| On the card | One tap deeper (the room sheet) |
|---|---|
| Lead photograph | The other 3–5 frames |
| Name | Bedding, with dimensions (`one king bed (1.80 m)`) |
| Occupancy dots + extra-bed dot | What the extra bed costs, and that it posts as a service item |
| Size bar + `52 m² · corner` | Floor, aspect in full (`corner · two aspects`) |
| Stay total, per-night | Cancellation terms for the plan |
| `Choose` | Amenities, grouped by subject (Apple's 20 categories, §2.5) |

Nothing that differs between the five types is behind the tap. Everything behind the tap is either
identical across types (amenities) or a detail of a difference already shown.

### 3.4 The one visual difference system — the measure line (R4)

A single strip under the name, three fixed slots, same x-position on every card so the column reads
down:

**Slot 1 — occupancy dots.** Filled dot per person of maximum occupancy; **one open dot when an
extra bed is allowed.**

```
Superior        ● ●            sleeps 2
Deluxe          ● ●   ○        sleeps 2, extra bed
Premier         ● ● ●          sleeps 3
Junior Suite    ● ● ●  ○       sleeps 3, extra bed
Panorama Suite  ● ● ● ●  ○     sleeps 4, extra bed
```

One glyph system carries **two** of the five differences. `property-and-tariff.md` §1's
beds-sleep-vs-max-occupancy distinction is exactly the filled/open pair.

**Slot 2 — the size bar.** A rule of fixed track width filled `m² ÷ max(m² across types)`. 28 → 41%,
34 → 50%, 42 → 62%, 52 → 76%, 68 → 100%. **Normalise to the computed max of the rendered set, never
a hardcoded 68** — a sixth type would silently break every bar. The number sits at the bar's end.

**Slot 3 — the aspect.** One word: `courtyard · garden · city · corner · sea`.

**Semantics — Booking.com's verified pattern (§2.6).** The whole line is one node:

```html
<div role="img" aria-label="Sleeps 3, extra bed available. 52 square metres. Corner, two aspects.">
  <span aria-hidden="true">…dots…</span>
  <span aria-hidden="true">…bar…</span>
  <span aria-hidden="true">52 m² · corner</span>
</div>
```

One name, complete, glyphs hidden. Not a label per dot.

**Test.** Cover all text on five cards. What remains: 2/2/3/3/4 dots, three of them with an open
dot, and five bars at 41/50/62/76/100%. The five types are distinguishable with the text covered —
which is R2's stated pass condition, met by the glyph system and the photograph together.

### 3.5 The room sheet

Desktop: a centred `<dialog>` ~880 px, focus-trapped, `Escape` closes and returns focus to the photo
button. Mobile: full-height sheet. Contents in order: gallery (3:2, same crop as the card, counter
`2 / 5` only when there is more than one — a one-slide carousel reads as broken), bedding, floor and
aspect, extra bed and its price, amenities by subject, cancellation terms. One `Choose` at the
bottom, the same action as the card's.

### 3.6 The collapsed date summary and reopening (P2)

```
15 – 17 September · 2 nights · 2 guests            [ Change ]
Prices include VAT and service.
```

Nine words plus a five-word note. The whole row is the button:

```html
<button aria-label="15 to 17 September 2026. 2 nights, 2 guests. Change your dates.">
```

Taking Google Flights' lesson **and** its failure: the value is stated once and is the button's own
accessible name (no second label to drift), but it is a *summary*, not a live control, so at 375 it
is one line — not the 220 px Google spends (§2.7).

`Prices include VAT and service.` appears **here, once**, next to the prices it qualifies. Not per
card. That single move deletes 20 words from the view.

### 3.7 Price (P4)

Per card, two lines, nothing else:

```
3.940.000 ₫              stay total — --text-display-sm, --ink, the emphasised number
1.970.000 ₫ a night      --text-sm, --stone
```

`a night` becomes `a night on average` only when the printed figures do not multiply — the shipped
`printedFiguresMultiply` check in `room-type-card.tsx:204-207` is correct and survives verbatim; it
is the honest answer to a weekend-priced stay. **The `N nights · N guests` multiplier line moves to
the date summary**, where it is stated once for the whole view. No strikethrough, no "was", no
percentage, no rooms-remaining. Round 1 had all of this right and said it five times.

Before dates exist there is no View B, so Limehome's "refuse to quote" is enforced by the sequence
rather than by a string. `Choose your dates for prices.` is deleted — five copies of it were what
the guest saw first.

### 3.8 Sold out and misfit (R5)

Below the available cards, no photo, no button, ~28 px per row:

```
NOT FREE FOR THESE NIGHTS
Deluxe — not free for these nights.
Premier — not free for these nights.

TOO SMALL FOR THREE GUESTS
Superior — sleeps 2.
```

Two caps labels; §3.13 budgets three. Round 1's misfit card ("Sleeps 2. You are three." with a dead
`Choose`) demotes by the same rule — a full-height card with a disabled primary action reads as
broken whichever reason produced it.

If **every** type demotes, the view is replaced by the empty state.

### 3.9 Empty and partial availability (P6)

Unchanged from round 1 and from shipped `no-availability.tsx` — Resy's three moves, verified: state
the fact naming the dates; offer the nearest range **parameterised by the same party size**; offer
to be told later. Only the wording tightens:

```
Nothing free for 15 to 17 September.
The next two nights free for 2 are 22 to 24 September.   [ Show those nights ]
We can write to you if these nights open.                [ Tell me ]
```

Partial availability is §3.8 and is the common case at 5 types and 40 rooms.

### 3.10 The hold pre-announcement (P7)

`booking-state-machine.md` starts the TTL at room choice; `/booking` is stateless. So no clock —
one sentence, **once per view**, directly above the card grid, and the same string as every
`Choose` button's `aria-describedby`:

> Choosing a room holds it while you finish. Nothing is charged yet.

Round 1 rendered this under all five buttons: 60 words where 12 were needed.

### 3.11 Layout

**Desktop (1440).** Content column 1208 px centred (= 2 × 588 + `--space-3`; a composition value,
commented). `grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3)`. Five cards fill
two rows and a half — the Panorama Suite sits alone in row three, last, which reads as the top of
the range rather than as a gap. Below 1100 px, one column.

**Mobile (375), same model, no new decisions.**

| | Desktop 1440 | Mobile 375 |
|---|---|---|
| Views | A then B, unmounted | identical |
| Calendar | 2 months side by side | 1 month, page-height, no sheet |
| Card grid | 2 columns, 588 px | 1 column, full-bleed |
| Photo | 588×392, ar 1.50 | 375×250, **ar 1.50** (Hoxton, measured) |
| `Choose` | inline right | full width, **min-height 48 px** |
| Date summary | one line + note | wraps to two, whole row tappable, min-height 48 |
| Sold-out rows | one line each | identical |
| Horizontal scroll | none | **assert `scrollWidth === 375`** in the baseline |

48 px, not 44: cal.com measures 44×44 (R1's floor), Limehome measures a 40 px Select — under target
on the control the guest actually taps.

### 3.12 Motion — CSS only, named tokens only

`var(--ease-ui)` = `EASE_UI_CSS` = `cubic-bezier(0.23, 1, 0.32, 1)`, emitted by `motionTokensCss()`.

| Move | Property | Duration | Ease |
|---|---|---|---|
| View A leaves | `opacity` 1→0 | `0.4s` | `var(--ease-ui)` |
| View B arrives | `opacity`, `translateY(8px→0)` | `0.5s` | `var(--ease-ui)` |
| Card cascade | `opacity`, `transform` | `0.5s` | `var(--ease-ui)` |
| Cascade stagger | `transition-delay: calc(var(--i) * 0.1s)` | — | `STAGGER_CASCADE` |
| Card hover / focus | `border-color`, `background-color` | `0.4s` | `var(--ease-ui)` |
| Chosen wash (`--ocean` 0.1) | `background-color` | `0.4s` | `var(--ease-ui)` |
| Room sheet in/out | `transform: translateY()` | `0.5s` | `var(--ease-ui)` |
| Summary bar in | `transform: translateY()` | `0.5s` | `var(--ease-ui)` |

Five cards × 0.1 s caps the cascade at 0.4 s of delay.

**The one honest cost.** A CSS exit needs the leaving view mounted for its 0.4 s. So the container
carries `data-phase="leaving"`, and the unmount is deferred by a timer that must match the duration
— two places holding one number. `design-foundations.md` §5 already permits `motion` in `(booking)`
for exactly this reason ("CSS has no exit"), and `EASE_UI_EXIT` is the curve it names. The brief
says CSS only, so the table above is CSS only and the timer is the price. **If the owner would
rather not pay it, the exit is four lines of `m` inside the existing `LazyMotion` and costs zero new
bytes** — `motion` is already in `/booking`'s bundle.

**No photo motion.** No hover zoom, no Ken Burns. A `transform` on a `cover` image re-rasterises its
layer, and a moving photograph is marketing. The photographs hold still.

**Reduced motion** is a composition, not a frozen frame (§9): the view swap is an instant content
replacement with no crossfade, the cascade is dropped and all five cards paint at once, the sheet is
rendered in place. The global kill-switch's `0.01ms` would otherwise *snap* the sheet across a
viewport height.

### 3.13 Per-view text budget

| | View A | View B |
|---|:-:|:-:|
| Guidance sentences | 1 | 1 (the hold sentence, doing double duty) |
| `Includes VAT and service.` | 0 | **1** |
| Caps labels (`.caps-label`) | 1 (legend) | 2 (`NOT FREE…`, `TOO SMALL…`) |
| Persistent words per card | — | ≤ 12 |
| Total prose, all five available | ≈ 40 | **≈ 100** |

Day numbers and prices in the grid are data, not prose, and are excluded.

---

## 4. What was removed from round 1 — measured against shipped code

Per-card persistent text, round 1 as built (`room-type-card.tsx`, `room-types.ts`,
`property-and-tariff.md` §1):

| Type | Round 1, words | Round 2, words | Δ |
|---|:-:|:-:|:-:|
| Superior | 42 | 11 | −31 |
| Deluxe | 60 | 11 | −49 |
| Premier | 47 | 11 | −36 |
| Junior Suite | 64 | 12 | −52 |
| Panorama Suite | 61 | 12 | −49 |
| **Five cards** | **274** | **57** | **−217** |
| Header + band | 28 | 14 | −14 |
| **View total** | **≈ 302** | **≈ 100** | **−67 %** |

Removed, line by line, with where each went:

| Round 1 string | ×5? | Round 2 |
|---|:-:|---|
| `one queen bed (1.60 m)` (bedding, 5–10 words) | per card | → room sheet |
| `What's in the room ▾` + amenity list | per card | → room sheet |
| `Includes VAT and service.` | **5×** | → date summary, **once** |
| `Choosing a room holds it while you finish. Nothing is charged yet.` | **5×** | → above the grid, **once** (60 → 12 words) |
| `2 nights · 2 guests` | **5×** | → date summary, once |
| `Sleeps 2 · extra bed available` | per card | → **glyphs** (filled + open dots) |
| `28 m² · courtyard` | per card | **kept** — the only spec that survives, and it labels the size bar |
| `Choose your dates for prices.` | **5×** | deleted — View B does not exist without dates |
| `Extra bed, 350.000 ₫ a night — your party fits the beds in the room` | 3 cards | → room sheet / `/details` (§6 Q2) |
| `Sleeps 2. You are three.` + disabled `Choose` | as needed | → one demoted line (§3.8) |
| `Not free for these dates.` on a full card | as needed | → one demoted line (§3.8) |
| `Choose the nights you are here, and the room you would like. Prices include VAT and service.` (17 words, both decisions in one sentence) | 1 | split: View A `Choose the nights you are here.` (6) / View B tax note (5) |
| Rate-plan segment + 3 cancellation terms (~30 words) | 1 | → `/details` (§6 Q1) |

**Added:** one photograph per card, and the measure line. The photograph is the only thing on the
card that grew.

---

## 5. Image production

### Per room type

| # | Frame | Required? | Where it appears |
|:-:|---|:-:|---|
| 1 | **The lead** — from inside the door, bed in frame, window light. 3:2. | **Yes** | Card, and sheet slide 1 |
| 2 | Bed detail / headboard | No | Sheet |
| 3 | Bathroom | No | Sheet |
| 4 | The aspect — what the window actually shows (courtyard / garden / city / sea) | Strongly | Sheet. It is the one word on the card that a photograph can prove |
| 5 | Seating, suites only | Suites | Sheet |

**Minimum: 5 photographs — one lead per type. Full: 5 × 4–5 ≈ 22.**

### The production rule that the design rests on

> **The five lead frames must be the same photograph of five different rooms.** Same focal length
> (~24–28 mm equiv), same eye height, same time of day, same bed dressing, same door-side position.

This is not a style preference. Ace Hotel (§2.4) has real photography, a real photographer, and
nine types — and its frames are interchangeable between types, so the images stopped comparing. If
the five leads differ in lens or light, the guest reads the *photography* as the difference and the
room becomes invisible. Cover the text on the five leads: a 28 m² courtyard room and a 68 m² sea-view
suite must be told apart at a glance. That is the acceptance test for the shoot.

### Fallback — one photograph exists

Card renders it. Sheet renders it once with **no counter and no carousel controls** — a `1 / 1`
counter reads as broken (Hoxton's `1 / 5` is honest only because there are five). The measure line
carries the difference on its own; the design degrades, it does not fail.

### The `--umber` under-layer rule

Every photo frame:

```css
.frame {
  aspect-ratio: 3 / 2;
  background: var(--umber);        /* #3a332b — §2: not a surface, an under-layer */
  overflow: hidden;
}
.frame img { width: 100%; height: 100%; object-fit: cover; display: block; }
```

An undecoded image is then a warm dark rectangle, never a hole. **Verified need, not theory:** the
Hoxton lead frames probed with `currentSrc: ""` and `naturalWidth: 0`, and Limehome's probed at
`naturalWidth: 100` rendered at 300 px. Both would show a hole for the first paint of a card list.

`--ivory-warm` is *not* the fallback here. `design-foundations.md` §5 gives that to the `/login`
plates for a specific reason — a fade must land on the colour it fades into — and a photo card is
not fading into anything.

### Alt text

Content images, so meaningful `alt`, per §7. Not the arrival manifest — importing
`features/arrival/` into `(booking)` breaks §5's budget. So `public/images/booking/rooms/`, alt
written inline like the login plates but **meaningful, not empty**: `"Junior Suite, the corner
window and the bed."` Four of eight Hoxton leads measured `alt=""` (§2.1) — a content image outside
the a11y tree is the exact defect §7 exists to prevent.

---

## 6. Cost, risks, open questions

### Cost

| Item | Size |
|---|---|
| **The photography** | The real cost. A shoot, or the design does not work. No code substitutes. |
| Room card rewrite | Small — the component shrinks; three `<p>` and a disclosure come out |
| Measure line (dots + bar + one `role="img"`) | Small, ~60 lines CSS + a `<figure>` |
| View A/B sequencing + scroll restoration | **Medium, and the risky part.** See below |
| Room sheet (dialog, focus trap, gallery) | Medium — new component, reuses `bottom-sheet.tsx` at 375 |
| Calendar | **Zero.** R1's `stay-calendar.tsx` is reused untouched, per P5 |
| Removals (rate segment, extra-bed checkbox, disclosure) | Negative cost |

### Risks

- **The photographs are now load-bearing and the code cannot rescue them.** If the five leads are
  not shot as a set, this design fails exactly as round 1 did, with a bigger image budget. §5's
  acceptance test should be run on contact sheets before any card is built.
- **Scroll restoration on reopen.** B unmounts → A → B remounts. Store `scrollY` before unmount,
  restore in a layout effect after B paints, or the guest who changes one date lands at the top of
  the list. This is the single requirement most likely to ship subtly broken.
- **Unmounting the React Aria calendar on every A→B.** The 136 KB chunk is already downloaded, so
  this is a remount, not a refetch — but it should be measured, not assumed. If remount cost is
  visible, keep A mounted with `hidden` **and** `inert`, which still satisfies R1 (an `inert`
  subtree is not a second open decision) at the price of trusting an attribute instead of the tree.
- **Size-bar normalisation.** Computed from the rendered set, never hardcoded to 68.
- **The dots must not read as a rating.** Filled/open circles, not stars, not squares. One
  `role="img"` name, glyphs `aria-hidden` — Booking.com's verified shape.
- **Two views mean two baselines per viewport**, not one. `design-foundations.md` §10's warning that
  baselines are machine-specific applies doubly; a computed-style assertion on the 3:2 box and on
  `scrollWidth === 375` is a stronger gate than a pixel diff on a photograph.
- **`--ocean` / `--dusk-amber` division holds** (§2): `--ocean` 0.1 wash = what the guest has chosen;
  `--dusk-amber` = the one thing they can do next. Five `Choose` buttons are five instances of one
  control, not five accents.

### Open questions

1. **Rate plan — `/booking` or `/details`?** §3.1 moves it. It removes a segment, three terms
   sentences and the live re-pricing of five cards, and `/booking` then quotes `STANDARD`. R1
   assumed step 1 so the guest meets `NONREF`'s 100%-on-cancel term before the hold — a real
   argument the other way. **Owner's call; nothing else in §3 depends on it.**
2. **The extra-bed control — sheet or `/details`?** It posts as a service item, never a rate modifier
   (§1), so it is not part of choosing a room. The open dot says *allowed* on the card either way.
3. **Do the five lead photographs exist?** If not, §5 is a shoot, and it is on the critical path.
4. **Are the aspect words real?** `courtyard / garden / city / corner / sea` come from
   `property-and-tariff.md` §1, where **all of §1–§6 is ⚑** — the developer's call until the database
   holds them. §6 forbids a component inventing a hotel fact, and the aspect is now one of three
   things on the card. Confirm before it ships.
5. **Round 1's unresolved four remain unresolved:** hold TTL length, whether minimum-stay rules are a
   public contract at M7, whether a waitlist entity exists, and the extra-bed price (⚑ unset).
6. **Traveloka and Airbnb are still unverified after two rounds.** Both are bot-walled here. If
   either matters to the decision, it needs a manual pass on a real device.

---

Status: DONE_WITH_CONCERNS
Summary: Seven references verified live by DOM probe — The Hoxton (3:2 lead frame held exactly at
1440 and 375), Plum Guide (7–8 words per card, measured), and five negatives that between them
explain round 1: Limehome's 100×100 placeholder images and printed photo disclaimer, Ace Hotel's
shared frames and boilerplate prose, Apple's 181-row table with four images, Booking.com's imageless
room table (whose occupancy-pictogram ARIA pattern is the one thing worth taking), and Google
Flights' search band growing to 27% of a 375 viewport. Prototype sequences dates then rooms with the
inactive view unmounted, leads each card with a 3:2 photograph, holds persistent card text to 11–12
words against a 15-word budget, and carries occupancy, extra-bed and size in one glyph system —
cutting the view from ~302 words to ~100.
Concerns/Blockers: The design now rests on photography that may not exist, and no code substitutes
for it — §5's five-lead acceptance test is on the critical path. Firmdale's SynXis engine, Hyatt,
Traveloka and Airbnb were all bot-walled, so the two largest hotel IBEs are half-covered (Amadeus
from round 1 only) and the brief's named mobile references are unverified for a second round. No
verified reference was found anywhere for a size bar or floor-plan chip; that part of §3.4 is my own
proposal and is labelled as such. Two scope decisions (rate plan and extra bed moving to `/details`)
need the owner before implementation.
