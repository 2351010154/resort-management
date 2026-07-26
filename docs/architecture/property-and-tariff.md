# Property and tariff

Authority for seed data, the rate calendar, the cancellation calculation and the
folio's charge lines. Change this file first, then the code.

**Status:** proposed defaults. Mariva is *defined* here, not measured — there is
no building, so **every value in §1–§6 is ⚑**: the developer's call, revisable
at no cost until the code reads it. No count is quoted, because the file is
provisional in whole rather than in named rows. That is the difference from
[`rbac-matrix.md`](rbac-matrix.md) and
[`booking-state-machine.md`](booking-state-machine.md), where the surrounding
design is settled and only listed rows are open.

**§7 is the exception and it is not ⚑.** Three values are somebody else's
answer, they are time-sensitive, and they are never written into this file or
any other — they are configuration. Read §7 before writing a tax calculation.

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

| Type | Rooms | Max occupancy | Extra bed |
|---|:-:|:-:|---|
| Superior | 12 | 2 | no |
| Deluxe | 10 | 2 | one |
| Premier | 8 | 3 | no |
| Junior Suite | 6 | 3 | one |
| Panorama Suite | 4 | 4 | one |

40 rooms, and the mix sums to it — a seed that does not sum is a seed bug.

An extra bed posts to the folio as a **service item**, never as a rate modifier.
It is a thing the guest bought, not a different price for the room.

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

## 4. Cancellation, no-show, early departure

Deadline is **18:00 ICT** on the cutoff date. All charges are computed by
`refund.policy`; anything outside this table is `refund.override` and a
different `@Roles()` — see [`rbac-matrix.md`](rbac-matrix.md) §2.

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

The structural half of `D2`. Rates live in §7.

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
class is not. See §7.

## 6. Service catalog — seeded thin

Eight items, enough to exercise posting, tax classes and `M8`'s reporting. Every
price is ⚑.

Breakfast · Laundry · Minibar · Airport transfer · Late checkout · Extra bed ·
Spa treatment · Local tour

Thin on purpose: `P3-SVC` needs the posting path proven, not a real menu. Items
are data, so the catalog grows without a migration.

## 7. Never a constant

Three values are not the developer's and not this document's. They are
**system-configuration rows**, seeded from environment at boot, editable by
`ADMIN` without a deploy — the row already exists in `rbac-matrix.md` §3 System.

| Value | Whose answer | Tracked as |
|---|---|---|
| VAT rate | Accountant | `D2` |
| Reduced-VAT applicability, and the period it applies to | Accountant — **statutory and time-limited** | `D2` |
| Statutory retention floor `N` for registration records and CCCD scans | Lawyer | `D2`, `M0-05`; the R2 lifecycle rule reads it (`R3#6`) |

**`const VAT_RATE = 0.08` anywhere in the tree is a defect,** and the expensive
kind: it does not throw, it silently mis-invoices, and the invoices are legal
documents issued by a third party that cannot be quietly reissued. Vietnam's
reduced-VAT relief has been extended by successive resolutions with end dates;
whatever the rate is on the day this is read, it is not permanent.

The same argument applies to `N`. A hardcoded retention window either deletes
records the law requires kept, or keeps ID scans past the window `R3#6` asserts
is empty.

## 8. Still open

| Question | Whose | Tracked as |
|---|---|---|
| Season date ranges | mine, ⚑ unset — data, blocks nothing | §3 |
| Service prices | mine, ⚑ unset — data | §6 |
| The three §7 values | accountant, lawyer | `D2`, `M0-05` |
| Diagram notation | professor | `D8` |
