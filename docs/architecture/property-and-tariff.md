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

**§8 is the exception and it is not ⚑.** Four inputs are somebody else's
answer, they are time-sensitive, and they are never fixed in this file or any
other — they are configuration. Read §8 before writing a tax calculation or a
retention rule.

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
| Timezone | `Asia/Ho_Chi_Minh`, UTC+7, no DST — a `StayDate` is never a timestamp |

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

**"Beds sleep" is not "max occupancy".** The columns describe physical capacity;
they do not settle the commercial rule for a party above included occupancy.
The owner still has to decide when an extra bed is mandatory and whether its
service line stacks with or replaces the extra-person charge (§9).

When an extra bed is charged, it posts to the folio as a **service item**, never
as a rate modifier. The unresolved question is whether that line is mandatory
and cumulative, not how it is represented.

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

This does **not** decide the extra-bed rule. Until the owner answers the question
in §9, a quote must not assume that an extra-person charge either includes an
extra bed or automatically stacks with one.

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
`refund.policy`; anything outside this table is `refund.override` and a
different capability declaration — see
[`rbac-matrix.md`](rbac-matrix.md) §2.

| Event | `STANDARD` / `BB` | `NONREF` |
|---|---|---|
| Cancel ≥ 3 days before arrival, by 18:00 | free | 100% of stay |
| Cancel < 3 days before arrival | first night | 100% of stay |
| No-show — business date rolls past the arrival date | first night | 100% of stay |
| Early departure | remaining nights at 50% | remaining nights at 100% |

Waiving any cell is `MANAGER` or above, per `rbac-matrix.md` §5 decision 2. A
receptionist cannot waive a penalty; that is the ⚑ row there, and this table is
what it governs.

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

Two of the eight now have a price, because `/booking` cannot render a card without
them. Both ⚑ proposed, both gross:

| Item | Price | Why the funnel needs it |
|---|---|---|
| Breakfast | 250,000 ₫ per person per night | `BB` is `STANDARD` + breakfast, so the plan cannot be quoted without it |
| Extra bed | 350,000 ₫ per night | The card offers it as its own line on the three types that take one |

The other six are still unset and block nothing — nothing on the guest funnel
quotes them.

Thin on purpose: `P3-SVC` needs the posting path proven, not a real menu. Items
are data, so the catalog grows without a migration.

## 7. Loyalty and tiers

The structure is the PRD's (`FR-GST-04`, `FR-GST-05`): tier derived nightly,
points accrual-only, no redemption engine. The values are ⚑ proposed here and
live as system-configuration rows editable by `ADMIN` — like §8's inputs in
storage, unlike them in ownership: these are the developer's call until the
owner tunes them, and tuning one is a data edit, not a deploy.

| Value | Proposed | Why this value |
|---|---|---|
| Earn rate | **1 point per 10,000 ₫ of net room revenue** | Net — the room charge before VAT and service charge, service items excluded — so a §8 tax answer cannot silently change what a stay earns |
| Accrual moment | folio close | A cancelled or no-show booking never closes a folio, so it earns nothing and no clawback logic needs to exist |
| Tier ladder | Member → Silver → Gold | Three levels; Vietnamese small-hotel practice is a flat percentage per tier, not point redemption |
| Silver | 2 stays **or** 15,000,000 ₫ net room revenue, trailing 12 months | Reachable by a twice-a-year guest — a first milestone almost nobody reaches is a program nobody uses |
| Gold | 4 stays **or** 40,000,000 ₫, trailing 12 months | |
| Member discount | Silver 5% · Gold 10%, applied as a promotions rate modifier (`FR-PRC-03`) | Rides the existing pricing path; never a folio adjustment |
| Fixed perks | Silver: late checkout to 14:00 when the room is unsold. Gold: that, plus upgrade at check-in when available and a welcome amenity | Only perks a 40-room house can honor on a full night — a printed perk that gets withheld costs more goodwill than no perk at all |
| Expiry | points earned in year `Y` expire 31 December of `Y+1` | A fixed calendar date needs no rolling-inactivity job |

Tier is recomputed at business-date rollover from the trailing window and is
never hand-set; a change writes an audit row (`FR-GST-04`). The earn rate is
decided now, before any redemption exists, because it defines what a point
*is*: reseeding balances after guests already hold them is a support incident,
not a data edit.

## 8. Never a constant

Four inputs are not the developer's and not this document's. They are
**system-configuration rows**, seeded from environment at boot, editable by
`ADMIN` without a deploy — the row already exists in `rbac-matrix.md` §3 System.

| Value | Whose answer | Tracked as |
|---|---|---|
| VAT rate | Accountant | `D2`; [SCRUM-12](https://hungphat2018-1785053353783.atlassian.net/browse/SCRUM-12) |
| Reduced-VAT applicability, and the period it applies to | Accountant — **statutory and time-limited** | `D2`; [SCRUM-12](https://hungphat2018-1785053353783.atlassian.net/browse/SCRUM-12) |
| Whether the VAT tax base includes service charge | Accountant — this changes every gross/net calculation | `D2`; [SCRUM-86](https://hungphat2018-1785053353783.atlassian.net/browse/SCRUM-86) |
| Statutory retention floor `N` for registration records and CCCD scans | Lawyer | `D2`, `M0-05`; [SCRUM-13](https://hungphat2018-1785053353783.atlassian.net/browse/SCRUM-13); the R2 lifecycle rule reads it (`R3#6`) |

**`const VAT_RATE = 0.08` anywhere in the tree is a defect,** and the expensive
kind: it does not throw, it silently mis-invoices, and the invoices are legal
documents issued by a third party that cannot be quietly reissued. Vietnam's
reduced-VAT relief has been extended by successive resolutions with end dates;
whatever the rate is on the day this is read, it is not permanent.

The same argument applies to `N`. A hardcoded retention window either deletes
records the law requires kept, or keeps ID scans past the window `R3#6` asserts
is empty.

## 9. Still open

| Question | Whose | Tracked as |
|---|---|---|
| Season date ranges | mine, ⚑ unset — data, blocks nothing | §3 |
| Service prices | mine, six of eight still ⚑ unset — data | §6 |
| Room sizes, bedding and aspects | mine, ⚑ proposed for `/booking` — data | §1 |
| Extra-person and breakfast rates | mine, ⚑ proposed — now stored and editable, in `property_tariff` and `rate_plan` rather than in this file | §3, §6 |
| Loyalty earn rate, tier thresholds, perks and expiry | mine, ⚑ proposed — config | §7 |
| When an extra bed is mandatory, and whether its service line stacks with or replaces the extra-person charge | owner — no pricing path may infer this from bed capacity | §1, §3, §6; [SCRUM-87](https://hungphat2018-1785053353783.atlassian.net/browse/SCRUM-87) |
| Whether minimum-stay and closed-to-arrival are a **public** contract | mine — §3 lists them under admin **Rates** only, and the guest calendar's restricted-cell state depends on reading them from `/booking` | §3 |
| The four §8 inputs | accountant, lawyer — written answers required | `D2`, `M0-05` |
| Diagram notation | professor | `D8`; [SCRUM-16](https://hungphat2018-1785053353783.atlassian.net/browse/SCRUM-16) |
