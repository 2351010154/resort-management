# Property and tariff

Authority for seed data, the rate calendar, the cancellation calculation and the
folio's charge lines. Change this file first, then the code.

**Status:** proposed defaults. Mariva is *defined* here, not measured — there is
no building, so **every value in §1–§7 is ⚑**: the developer's call, revisable
at no cost until the code reads it. No count is quoted, because the file is
provisional in whole rather than in named rows. That is the difference from
[`rbac-matrix.md`](rbac-matrix.md) and
[`booking-state-machine.md`](booking-state-machine.md), where the surrounding
design is settled and only listed rows are open.

**§7's figures have stopped being revisable at no cost.** They are still the
developer's proposal and still nobody else's answer, but the code now reads them
and guests now hold points and tiers derived from them — so they are configuration
rows to be *tuned*, not values to be reconsidered. §7 records where each one is
stored.

**§8 is the exception and it is not ⚑.** Three inputs are somebody else's
answer, they are time-sensitive, and they are never fixed in this file or any
other — they are configuration. Read §8 before writing a tax calculation.

Supersedes backlog decisions `D1`, `D3`, `D4` and the structural half of `D2`
and `D7`.

## 1. The property

| Fact | Value |
|---|---|
| Rooms | 40 |
| Guest floors | 4, numbered 2–5. Ground floor is lobby, F&B and back-of-house |
| Rooms per floor | 10 |
| Numbering | `<floor><nn>` — 201–210, 301–310, 401–410, 501–510 |
| Room types | 5 |
| Address | 12 Trần Phú, Lộc Thọ, Nha Trang, Khánh Hòa |
| Timezone | `Asia/Ho_Chi_Minh`, UTC+7, no DST — a `StayDate` is never a timestamp |

**The address is read by the pre-arrival reminder and by nothing else.** It is
`PROPERTY_ADDRESS` in `apps/api/src/modules/notification/templates/guest-auth-emails.ts`,
beside the property's name, because a guest travelling tomorrow needs to know
where they are going. Like every value in §1 it is ⚑ — there is no building — and
it is a constant rather than configuration for that reason: nothing decides
anything by it, so the day the property is real this is one line to change and not
a migration. An invoice or a statutory record that needs a registered address is a
different fact with a different authority, and neither exists yet.

### Type mix

| Type | Rooms | Max occupancy | Beds sleep | Extra bed | Size | Bedding | Aspect |
|---|:-:|:-:|:-:|---|:-:|---|---|
| Superior | 12 | 2 | 2 | no | 28 m² | one queen bed (1.60 m) | courtyard |
| Deluxe | 10 | 2 | 2 | one | 34 m² | one king bed (1.80 m) | garden |
| Premier | 8 | 3 | 3 | no | 42 m² | one king bed (1.80 m) · one single bed (1.00 m) | city |
| Junior Suite | 6 | 3 | 2 | one | 52 m² | one king bed (1.80 m) | corner · two aspects |
| Panorama Suite | 4 | 4 | 4 | one | 68 m² | two queen beds (1.60 m) | sea |

40 rooms, and the mix sums to it — a seed that does not sum is a seed bug.

**Occupancy included in the rate is 2, for every type.** Double occupancy, stated
once rather than per type: §3 charges an extra person per night above it and up to
the maximum, and a per-type value would imply the property varies what "the rate"
covers when it does not.

**"Beds sleep" is not "max occupancy".** The columns describe physical capacity,
and the gap between them is exactly where an extra bed goes.

**An extra bed is mandatory exactly when the heads that need their own bedding
exceed what the bedding sleeps** — `bedsRequired = max(0, heads aged 6+ − beds
sleep)`. §3 already settles who needs bedding: a head under 6 is free, sharing
existing bedding, so an under-6 never puts a bed in a room. The rule keys on **beds
sleep** and never on the extra-bed column: that column says a bed *can* go in,
this rule says one *must*. Under the mix above it fires on the Junior Suite
alone — three bedding-needing heads against bedding for two. The Deluxe is 2/2
and the Panorama Suite 4/4, so no party that either can legally hold requires
one.

**Both still take one, and the column is doing its job there.** "Takes an extra
bed" means a bed fits and the desk may carry one in — not that the type reaches
its maximum with one. That is what gives §6's priced bed something to price: a
guest in a Deluxe who wants the second sleeping place the room does not have is
asking for a bed their occupancy never required, and pays for it. Read the
column the other way and those two rows look like seed bugs, which they are not.

**A mandatory bed carries no charge.** The Junior Suite's advertised maximum of
3 is a promise, and the bed is how the property keeps it; charging for it bills
the guest to receive the occupancy they were sold. §3's age-banded extra-person
charge is the entire price of that third head. §6's priced extra bed survives for
a bed a guest *requests* where occupancy does not require one — the desk posts
that line, and no quote reaches it.

An extra bed posts to the folio as a **service item**, never as a rate modifier.
That was always about representation, and it still is: what changed is that a
bed the party requires is now a line the property does not raise.

The last four columns were added when `/booking` was built: a room card that says
nothing concrete is five near-identical blocks, and
[`design-foundations.md`](design-foundations.md) §6 forbids a component inventing a
hotel fact. They are ⚑ like the rest of §1–§7 — the developer's call until the
database holds them — and `apps/web/features/booking/lib/room-types.ts` is the one
place the code reads them from.

### What each type says for itself

Two sentences per type, and they exist for the same reason the four columns above
do: the room step gives one chosen room a plate of its own, and a plate holding a
name and a cancellation clause is a plate that has not said what the room is.
§6's rule is that a component may not invent a hotel fact — not that the property
may not state one. This is the property stating one, here, where it can be
changed by an owner rather than by a stylesheet.

The register is §6's: short declaratives, concrete before evocative, and the
second sentence turns toward the reader. Nothing here quotes a number that is not
already a row above, so a size or a bed can be corrected in one place.

| Type | What it says |
|---|---|
| Superior | The courtyard side of the building, and the quiet one. A queen bed, a desk at the window, and room enough for two. |
| Deluxe | Six square metres more than the Superior, facing the garden. A king bed, and a chair you will actually sit in. |
| Premier | A king bed and a single, on the city side. The room a family of three stops having to negotiate. |
| Junior Suite | A corner room, so the light moves across it through the day. The sitting area is its own room in all but name. |
| Panorama Suite | The largest room in the house, facing the sea, with two queen beds. It is the one people come back for. |

### In every room

Twelve lines, identical across the five types, which is why they are one list here
and not a column on the table above. A type that ever differs takes an override
row at that point and not before — five copies of the same twelve lines is five
places to forget.

⚑ like the rest of §1–§7.

| | | |
|---|---|---|
| Air conditioning | Rain shower | Kettle, tea and coffee |
| Desk and reading light | Premium toiletries | Still water |
| In-room safe | Hairdryer | Wi-Fi |
| Daily housekeeping | Robes and slippers | Smart TV |

**This list was once deleted for being the wrong list, and the objection stands.**
A property that prints "Wi-Fi" as a *feature* is telling you it might not have had
it. So the room step prints these as what is in the room and never as what is
special about it: no heading selling them, no icons, no column of ticks — a plain
run of lines under a rule, at the smallest weight on the plate. What distinguishes
one type from another is the table above, and that is where the eye is sent.

## 2. The operating clock

| Fact | Value | Why this value |
|---|---|---|
| Check-in | 14:00 | Standard Vietnamese practice; leaves a housekeeping window after 12:00 |
| Checkout | 12:00 | |
| Business-date rollover | **04:00** | The night audit runs at rollover and closes the date that just ended. Late checkouts and midnight walk-ins land on the correct business date |

The business date is **not** the calendar date. A booking created at 01:30 on
15 August belongs to business date 14 August. This is the single most common
source of off-by-one-night reporting errors, which is why `StayDate` is
`CalendarDate` and never a `ZonedDateTime` — see
[`tech-stack.md`](tech-stack.md).

Rollover is a config value, not a constant: a property that runs its audit at
06:00 changes one row, not a deploy.

The check-in time is the opposite: a constant, `CHECK_IN_TIME` beside the address
in `guest-auth-emails.ts`, because no code path decides anything by it. The
pre-arrival reminder prints it so a guest does not arrive at 09:00 expecting a
room; early arrival is `BOOKING_EARLY_CHECK_IN_ENABLED` and §4's arrival window is
a comparison of business dates, neither of which reads a clock time.

## 3. Rate structure

**Three plans at launch.** More plans are a pricing exercise, not an
engineering one, and each added plan multiplies the cancellation grid.

| Plan | Price | Cancellation |
|---|---|---|
| `STANDARD` | the rate-calendar price | §4 grid |
| `NONREF` | `STANDARD` − 10% | none — 100% charged on cancel and on no-show |
| `BB` | `STANDARD` + breakfast for the booked occupancy | §4 grid |

`BB`'s breakfast posts as its own folio line. Baking it into the room rate makes
the revenue split unrecoverable at reporting time, and `M9`'s ADR is then wrong
in a way nobody notices.

### Seasons and weekends

| Fact | Value |
|---|---|
| Seasons | Three — Low, High, Peak. **Names only.** Dates are ⚑ and unset |
| Weekend | **Friday and Saturday nights** — an arrival date of Fri or Sat prices as weekend |

Seasons are a naming convenience over `rate_calendar`, which holds one row per
type per date (`P1-SCH-03`). No season date range is ever hardcoded; changing
the calendar is a data edit. This is why the season dates can stay ⚑ without
blocking `P1-RAT-*`.

Friday–Saturday rather than Saturday–Sunday: domestic leisure travel arrives
Friday evening and departs Sunday, so Sunday night is not premium.

### Child and extra person

| Age | Charge |
|---|---|
| < 6 | free, sharing existing bedding |
| 6–11 | 50% of the extra-person rate |
| 12+ | as an adult |

Extra person is charged per night, and only up to the type's max occupancy in
§1. Occupancy above the maximum is not a price, it is a rejection.

**The bed a party requires is not charged, so these bands are the whole price of
the extra head.** §1 decides when a bed has to be carried in and decides that the
property carries it in for nothing. Nothing here reads bed capacity: the same
third head costs the same in a Junior Suite that needs a bed as in a Premier that
does not.

Charging the bed *instead of* the head would contradict the table above. A bed is
one per room-night and cannot be halved, so a nine-year-old third head would pay
§6's 350,000 ₫ rather than half of the extra-person rate below — 300,000 ₫ — and
the child band would be inverted by the very rule meant to apply it.

**Extra person: 600,000 ₫ per night, gross.** ⚑ Proposed. The rate the bands above
are percentages *of*; without it none of them resolve to a number.

The database holds it now — one row in `property_tariff`, written by the seed —
so retuning it is a data edit rather than a change to this file. The figure is
still the developer's call; what is settled is that a service no longer decides
it. The bands themselves are priced by `@mariva/shared`, once, because the API
quotes against them and the funnel does too.

**The bands apply to whoever is beyond the included occupancy, cheapest heads
first.** Two adults and a nine-year-old pay one half-rate extra person, not one
full one — the child is the third head, not one of the two the rate covers.
Charging the adults would make a family with a small child more expensive than the
same family without them, which is not what the table says.

**Breakfast under `BB` follows the same under-6 line.** §3 says `BB` is breakfast
"for the booked occupancy" and does not say what a small child eats; a child too
young to be charged for a bed is not charged for breakfast either. This is an
assumption rather than a quotation, and it is the one the funnel implements.

## 4. Cancellation, no-show, early departure

Deadline is **18:00 ICT** on the cutoff date. All charges are computed by
`folio.refund-policy`; anything outside this table is `folio.refund-override`
and a different capability declaration — see
[`rbac-matrix.md`](rbac-matrix.md) §2.

| Event | `STANDARD` / `BB` | `NONREF` |
|---|---|---|
| Cancel ≥ 3 days before arrival, by 18:00 | free | 100% of stay |
| Cancel < 3 days before arrival | first night | 100% of stay |
| No-show — business date rolls past the arrival date | first night | 100% of stay |
| Early departure | remaining nights at 50% | remaining nights at 100% |

**Every cell is a penalty, not a settlement total.** The figure is what the
booking owes *on top of* whatever the folio already carries, and that is why the
last row is worded unlike the three above it. A cancellation and a no-show never
reached `CHECKED_IN`, so no room-night has been posted and the penalty is the
whole stay. An early departure has: the nights already slept were posted by the
night audit as ordinary room charges — `booking-state-machine.md` §3 — and only
the unspent nights are still open. So `NONREF`'s last cell charges the remaining
nights rather than the stay. The two come to the same money, because the slept
nights are already on the folio; charging the stay again would bill them twice,
and a five-night guest leaving after the third night would be invoiced for
eight.

The same reading makes the two columns comparable. Both charge the unspent
nights and differ only in the rate — 50% against 100% — where a cell that
switched from a penalty to a total would make the columns mean different things.

Waiving any cell is `MANAGER` or above, per `rbac-matrix.md` §5 decision 2. A
receptionist cannot waive a penalty; that is the ⚑ row there, and this table is
what it governs.

**"Any cell" is literal, and it is one authority rather than four.** All four
rows are waivable — a no-show and an early departure as much as the two
cancellations. The waiver is not a cell of this table and never becomes one: it
is a decision recorded on the *booking*, in `penalty_waived_at` and
`penalty_waived_by`, and the grid is read afterwards by whoever prices the stay.
A waived stay is priced at `NONE` — the same row a free cancellation writes — so
the account still says §4 was applied and came to nothing, and the money handed
back is whatever the folio is then over-paid by. This is why the calculator has
no waiver column: teaching it about an authority decision would make it and this
table disagree about what the grid is.

**The waiver and the event that triggered it are separate requests.** Cancelling
with the penalty waived is one act, and the desk has a route for it. A no-show
and an early departure are not — they are reached by the night audit and by an
early checkout, neither of which asks a manager anything. So waiving those two
cells means writing the waiver onto the stay on its own, under the same
`MANAGER`+ capability, before the grid is priced. ⚑ That route does not exist
yet; only the cancel-and-waive composite writes the columns today. Until it
does, a no-show or early-departure waiver is reachable only as a discretionary
refund with a typed figure — which is the one thing this table exists to
replace, and is the reason the gap is named here rather than left to be
discovered.

No-show is driven by the **business date**, not by a wall clock. The transition
is `booking-state-machine.md`'s, and this table supplies only the amount — which
is why that document's §7 says the grid is not a state-machine question.

## 5. Charges and the tax model — structure only

The structural half of `D2`. Rates live in §8.

| Fact | Value |
|---|---|
| Service charge | 5%, applied to room and service lines |
| Guest-facing display | **gross** — VAT and service charge included in the price shown |
| Folio display | **never gross** — charge, service charge and tax are separate posting lines |
| Money | `bigint`, whole đồng. No minor unit, no rounding inside a calculation |
| Display rounding | nearest 1,000 ₫ via `Intl.NumberFormat('vi-VN')` — presentation only, never persisted |
| Tax class | every room type and every service item carries one |

Gross display and a line-itemised folio are deliberately different views. A
Vietnamese guest expects the price they see to be the price they pay; an
accountant expects to see the components. Collapsing either into the other
breaks one of them.

Rounding is presentation-only for a reason: rounding inside a calculation makes
`Σ postings = Σ payments + outstanding` (`R1#3`) fail by a few đồng a night,
which is unprovable rather than merely wrong.

The tax **class** is structure and is decided here. The **rate** attached to a
class is not. See §8.

## 6. Service catalog — seeded thin

Eight items, enough to exercise posting, tax classes and `M8`'s reporting. Every
price is ⚑.

Breakfast · Laundry · Minibar · Airport transfer · Late checkout · Extra bed ·
Spa treatment · Local tour

Two of the eight now have a price. Both ⚑ proposed, both gross:

| Item | Price | Why it carries one |
|---|---|---|
| Breakfast | 250,000 ₫ per person per night | `BB` is `STANDARD` + breakfast, so the plan cannot be quoted without it |
| Extra bed | 350,000 ₫ per night | The desk posts it when a guest asks for a bed their occupancy does not require |

**The extra bed is desk-posted and never quoted.** §1 charges nothing for the bed
a party's occupancy requires, so neither the guest funnel nor the availability API
carries an extra-bed price at all — no field, not a null one. This row prices a
bed somebody asked for, on a folio, posted by a receptionist. It is the one of
the two above that `/booking` does *not* need.

The other six are still unset and block nothing — nothing on the guest funnel
quotes them.

Thin on purpose: `P3-SVC` needs the posting path proven, not a real menu. Items
are data, so the catalog grows without a migration.

A ninth item is a row, and the row has two rules the database keeps: the code is
upper-case letters, digits and underscores — `AIRPORT_TRANSFER` — up to 64
characters, and the name is not blank. Nothing edits the catalog over HTTP at
this milestone, so the hand that adds an item writes it directly, and the list
the desk reads is parsed against exactly that shape. A row outside it would not
hide itself as one missing item; it would be the whole list failing to answer.

**The posting path is built, and it is what makes the two columns above mean
something.** The desk reads the sellable items and posts one against a stay; the
folio line names the catalog row, which is what gives `M8` something to group a
revenue report by and what stops a minibar being an amount whose tax class is
whatever the poster believed. The two cases split on the price:

- an item with a price posts **the catalog's figure**, times the count, and a
  caller sending an amount of their own is refused rather than quietly ignored;
- an item without one **requires** an amount, because six of these eight are
  unpriced by intent — a minibar and a laundry bill are what was consumed, not a
  list price — and the count then says what the line is for rather than scaling
  it.

A withdrawn item stops being offered and stays nameable by every line that ever
sold it, which is `is_active` doing the job a delete could not.

## 7. Loyalty and tiers

The structure is the PRD's (`FR-GST-04`, `FR-GST-05`): tier derived nightly,
points accrual-only, no redemption engine. The values below were ⚑ proposed and
are **now implemented as data**: every one of them is a row an `ADMIN` edits
without a deploy — like §8's inputs in storage, unlike them in ownership. These
were the developer's call until the owner tunes them, and tuning one is a data
edit rather than a release.

Two different tables hold them, and which one holds what is the load-bearing
part of this section.

| Value | Running value | Stored as | Why this value |
|---|---|---|---|
| Earn rate | **1 point per 10,000 ₫ of net room revenue** | `system_config.loyalty_points_per_unit`, `.loyalty_earn_unit_vnd` | Net — the room charge before VAT and service charge, service items excluded — so a §8 tax answer cannot silently change what a stay earns |
| Accrual moment | folio close | — behaviour, not a figure | A cancelled or no-show booking never closes a folio, so it earns nothing and no clawback logic needs to exist |
| Tier ladder | Member → Silver → Gold | — the three the derivation can answer | Three levels; Vietnamese small-hotel practice is a flat percentage per tier, not point redemption |
| Silver | 2 stays **or** 15,000,000 ₫ net room revenue, trailing 12 months | `system_config.tier_silver_stays`, `.tier_silver_revenue_vnd` | Reachable by a twice-a-year guest — a first milestone almost nobody reaches is a program nobody uses |
| Gold | 4 stays **or** 40,000,000 ₫, trailing 12 months | `system_config.tier_gold_stays`, `.tier_gold_revenue_vnd` | |
| Member discount | Silver 5% · Gold 10% | `promotion` rows `LOYALTY_SILVER` and `LOYALTY_GOLD`, each carrying `requires_loyalty_tier` | Rides the existing pricing path (`FR-PRC-03`); never a folio adjustment |
| Expiry | points earned in year `Y` expire 31 December of `Y+1` | `loyalty_ledger.expires_at`, computed at the accrual | A fixed calendar date needs no rolling-inactivity job |
| Fixed perks | **deferred — see below** | nothing | |

**The discount is a `promotion` row and deliberately not a configuration
column.** A copy in `system_config` would be a second authority for one figure,
and the copy the pricing path did not read would be a number nobody could change
the price with. Both rows are written once at boot, `on conflict do nothing`, so
a property that retuned Gold to 12% keeps that across every later deploy.

**How the discount reaches a guest.** The tier is derived at the moment of sale,
the `promotion` row that tier is gated on is read beside the rate plan, and the
discount it produced is **frozen onto the booking** — code, type and value —
alongside the plan's percentage. §8 of
[`booking-state-machine.md`](booking-state-machine.md) is why: a booking records
what it was quoted and never re-derives it, so a guest who was sold a Gold rate
keeps it if their tier later falls, and the night audit bills the figure they
agreed to.

Three consequences follow, and each is a rule rather than an accident:

- **It moves the room rate and nothing else.** Breakfast and the extra-person
  charge stand at full price — a tier discount reaching the meal would post a
  folio line the menu does not price.
- **The gate is a floor.** A Gold guest qualifies for a Silver-gated row too, and
  gets whichever takes the most off. One promotion applies; tier discounts do not
  stack.
- **Only tier-gated promotions apply.** A `promotion` row open to everyone —
  `requires_loyalty_tier` null — is a campaign, and the funnel cannot yet show
  one. Applying it only at the point of sale would show a guest one price and
  sell them another, so nothing applies it until the search path can price it.
  The tier discount has no such problem: an anonymous search has no tier.

The earn rate was decided before any redemption exists, because it defines what
a point *is*: reseeding balances after guests already hold them is a support
incident, not a data edit.

### Current tier, and the record of a change

These are two different facts and they live in two different places. Confusing
them is the failure this subsection exists to prevent.

| | What it is | Where it lives | Who reads it |
|---|---|---|---|
| **Current tier** | Derived on every read from the guest's own trailing 12 months against the thresholds above | **Nowhere.** No table carries a tier column | Whoever asks — the sale, and the sweep below |
| **Tier history** | An observation that a recomputation found a guest on a different rung from the one it last recorded | `guest_tier_change` — one append-only row per change | Only the sweep that writes it |

`FR-GST-04` makes the tier a **derived value, never hand-set**, and a stored one
would be a second authority that goes stale the moment a stay ages out of the
window — silently, because nothing recomputes it on the way past. So the tier is
recomputed from booking and folio history every time it is asked.

`guest_tier_change` is **not** that answer. It is the trail `FR-GST-04` asks for
when it says "a tier change writes an audit row", and a change is only observable
across two recomputations — which is what the hourly sweep performs. Reading its
latest row as a guest's current tier is reading the wrong column of the wrong
table, and it would be right often enough to survive review. No row for a guest
means the guest was Member: Member is the absence of a match, so silence about an
account says what a derivation would.

It is its own table rather than an `audit_entry` row because that table addresses
subjects by `uuid` (a guest account id is text), requires an actor (a rollover
sweep has none), and records whole-row snapshots (a derived tier has no row).

**Retention: these rows are permanent, and there is no purge.** Nothing expires
them and nothing should. A guest's previous tier is recovered from this trail, so
a purge makes the next sweep record a promotion that already happened — the
history is corrupted where the tier is not, because the tier is derived. The
rows are three enum-ish values and an instant, one per rung a guest ever crosses,
so a 40-room property accumulates tens of them a year; there is no volume
argument for a retention rule and no statutory one — `ASM-02`'s floor is about
the registration record and is a *do-not-delete-before*, never a delete trigger.
A delete is refused outright by the table's append-only trigger, so a future
retention policy would have to disable that guard or truncate the table
wholesale. Either is deliberate, which is the intent.

### Fixed perks — deferred

`FR-GST-04` names three non-monetary perks: late checkout to 14:00 when the room
is unsold, upgrade at check-in when available, and a welcome amenity. **None of
them is built, and none is scheduled inside the milestone that landed the tier
ladder.** They are recorded here as deferred rather than left to look
outstanding:

- Nothing in the tree represents a perk entitlement. `LATE_CHECKOUT` exists only
  as a priced §6 service item the desk posts; an upgrade is a manager-only rate
  operation; a welcome amenity has no representation at all.
- Each of the three is an operational judgement at a moment — is the room unsold,
  is a better type free, has the amenity been placed — rather than a figure the
  pricing path can apply. They need a desk screen to be honoured on, and the
  console screens that would carry them are not built.
- `FR-GST-04` lands across M7/M9. The derived tier, its trail and the member
  discount are the parts the booking engine needs; the perks are desk workflow
  and belong with the screens.

The requirement is not satisfied until they exist. What is settled is only that
they are not silently missing.

## 8. Never a constant

Five inputs are not the developer's and not this document's. They are
**system-configuration rows**, seeded from environment at boot, editable by
`ADMIN` without a deploy — the row already exists in `rbac-matrix.md` §3 System.

| Value | Whose answer | Seeded as | Tracked as |
|---|---|---|---|
| Standard VAT rate | Accountant | ⚑ 10% | `D2`; [#30](https://github.com/2351010154/resort-management/issues/30) |
| Reduced VAT rate | Accountant — **statutory and time-limited** | ⚑ 8% | `D2`; [#30](https://github.com/2351010154/resort-management/issues/30) |
| The period the reduced rate applies to | Accountant — **statutory and time-limited** | ⚑ 1 Jul 2025 → 31 Dec 2026 | `D2`; [#30](https://github.com/2351010154/resort-management/issues/30) |
| Whether the VAT tax base includes service charge | Accountant — this changes every gross/net calculation | ⚑ yes | `D2`; [#30](https://github.com/2351010154/resort-management/issues/30) |
| Service charge rate | Owner — a commercial rate, not statutory | ⚑ 5% | `D2` |

**`const VAT_RATE = 0.08` anywhere in the tree is a defect,** and the expensive
kind: it does not throw, it silently mis-invoices, and the invoices are legal
documents issued by a third party that cannot be quietly reissued. The **Seeded
as** column above records what the property runs on; the value itself reaches the
row from the environment at boot, so it lives in `.env.example` as a commented
seed and in test fixtures, and in neither `.ts` source nor migration SQL. A
`.default(800)` on the column and a `DEFAULT 800` in a migration are the same
defect as the constant, wearing a schema's clothes.

**Both rates are configured, because relief lapses into a rate and not into
nothing.** This section once listed a single VAT rate, and the table behind it
held one — on the reasoning that a second would settle `ASM-01` by guessing.
That reasoning had the failure mode backwards. Statutory relief is a temporary
reduction from a standard rate that never went away, so a reduced-VAT period
with an end date has a rate on the far side of it by construction. With only one
rate stored, a posting on a date outside a window that was set had to be refused
— which made *correctly* recording the relief period a scheduled outage at the
front desk on the day it lapsed. Two rates cost nothing on the dates the window
covers and cover the day it ends. Neither is a guess: both are `NOT NULL` with no
default and arrive from the environment, so a deployment that supplied one and
not the other does not boot.

**Provenance of the seeded figures, as at 2026-08-09.** A 10% standard rate with
an 8% reduction that accommodation services are in scope for, running 1 July 2025
to 31 December 2026 — National Assembly Resolution 204/2025/QH15 (17 June 2025)
and Decree 174/2025/NĐ-CP (30 June 2025). **Researched from published sources and
not confirmed by a practising accountant.** `ASM-01` is therefore answered
provisionally rather than closed: the figures are good enough to run on and are
exactly the kind of answer that must stay a data edit. Vietnam's relief has been
extended by successive resolutions with end dates; whatever the period is on the
day this is read, it is not permanent.

**What the lapse does to the property's own revenue, which the owner should
know before the date arrives.** `decomposeGross` holds the **gross** figure fixed
and derives net as the residual — §5 requires the guest to pay the price they
were quoted, so the tax rise cannot be added on top. When the window closes and
VAT goes 8% → 10%, the guest pays exactly what they paid the night before and the
property's **net room revenue falls**, because a larger VAT line is subtracted
from the same gross. That is not only an accounting line: §7 accrues loyalty
points on net room revenue, so the same night earns a guest slightly fewer points
after the lapse than before it. Neither effect is a defect — both follow from
quoting gross — but a property that wants to hold net revenue flat across the
lapse has to raise its **rates**, and that is a `MANAGER` decision in
`rate_calendar`, made deliberately and in advance, not a consequence of the tax
edit.

**The argument does not extend to the retention floor, and it used to.** While
an R2 lifecycle rule read `N` to expire identity-document images, it belonged in
the table above for exactly the reason given there: a number compiled into the
tree would have deleted on a schedule the lawyer never set. `FR-GST-02` stores no
image, so that consumer is gone and nothing else ever read the value. What is
left is a floor on the registration record — a *do-not-delete-before*, not a
delete trigger — and nothing in the tree deletes a registration, so the floor is
honoured by the absence of a delete path rather than by a setting. Reportedly 36
months under Nghị định 96/2016/NĐ-CP Điều 44, **from secondary sources this
repository has not checked against the primary text**; that is a number to
confirm with the lawyer, not to seed. A configuration row nothing reads is worse
than its absence, which is the case `pricing.ts` and `schema/config.ts` already
make: a reader cannot tell an unset value from an unbuilt one.

## 9. Still open

| Question | Whose | Tracked as |
|---|---|---|
| Season date ranges | mine, ⚑ unset — data, blocks nothing | §3 |
| Service prices | mine, six of eight still ⚑ unset — data. Not a blocker: the posting path takes the desk's figure for an unpriced item, so pricing one is a row edit that changes who decides the amount | §6 |
| Room sizes, bedding and aspects | mine, ⚑ proposed for `/booking` — data | §1 |
| Extra-person and breakfast rates | mine, ⚑ proposed — now stored and editable, in `property_tariff` and `rate_plan` rather than in this file | §3, §6 |
| Loyalty earn rate, tier thresholds and the two member discounts | mine, ⚑ proposed — **now stored and editable**, in `system_config` and in the two `LOYALTY_*` `promotion` rows rather than in this file. Open only as figures to tune | §7 |
| The three fixed tier perks | mine — **deferred, not open**: late checkout, upgrade when available and a welcome amenity are specified and unbuilt, and each needs a desk screen to be honoured on. §7 records why | §7 |
| Expiry of loyalty points | settled — not a figure at all. §7 states one rule with no alternative, and the accrual computes each row's `expires_at` from the year it earned in | §7 |
| Whether the Deluxe (2) and the Panorama Suite (4) are capped too low, now that the bed closing a gap is free | owner — a raised maximum is extra-person revenue with no bed charge against it, but a Deluxe holding three undercuts the Premier the mix positions for a family of three | §1; [#35](https://github.com/2351010154/resort-management/issues/35) |
| Whether minimum-stay and closed-to-arrival are a **public** contract | mine — §3 lists them under admin **Rates** only, and the guest calendar's restricted-cell state depends on reading them from `/booking` | §3 |
| Whether §8's seeded tax figures are right | accountant — the four are seeded from published statutory sources as at 2026-08-09 and run the property today; what is still owed is a written confirmation, not a value | `D2` |
| A VAT rate per **tax class**, once one item needs one | accountant — §8 prices the *time* axis (standard against reduced, by business date) and that half is built. The *item* axis is not, and the condition that will force it is named: the relief excludes goods subject to excise tax, so §6's **Minibar** line stays at the standard rate even on a date inside the window. The day that line is priced and sold, one rate per date stops being enough and `service_catalog.tax_class` gains a rate behind it. Not work to do now — there is one class, and no item yet carries a price that would be taxed differently | §6, §8 |
| Diagram notation | professor | `D8`; [#34](https://github.com/2351010154/resort-management/issues/34) |
