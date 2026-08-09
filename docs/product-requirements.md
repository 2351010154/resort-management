# Product requirements

What Mariva must do, for whom, and how each requirement is accepted — stated at
product altitude, one level above the architecture files and one level below
nothing. This file owns the **requirement statements, their IDs, the assumption
registry and the brief traceability matrix**. It does not own design facts (the
`architecture/` files do), status, or ticket granularity (both belong to the
execution authority named in [`README.md`](README.md)). Where a requirement here disagrees with an
architecture file about a design fact, the architecture file is right and the
requirement is stale — fix it here.

**Maintenance rule.** Change this file only when a requirement or external
assumption changes. Delivery status belongs to the execution authority named in
[`README.md`](README.md), while shipped behaviour is proved by source, tests,
schemas and generated artifacts.

**ID rules.** `FR-<MOD>-nn` for functional requirements, `NFR-nn` for
non-functional, `ASM-nn` for assumptions. IDs are stable forever: a dropped
requirement is struck through and kept, never renumbered, because subtasks and
the coursework report cite them.

**Depth asymmetry, on purpose.** Modules that are built or fully designed
(auth, identity, inventory, pricing, booking) carry tested or testable
acceptance criteria. Modules not yet designed (folio, payment, operations,
reporting) carry complete requirement lists but assumption-level criteria,
each citing the `ASM` rows that could change it. Precision is not pretended
where it does not exist.

---

## 1. Vision

A **property management system for one 40-room resort**, built from scratch,
plus the public website that sells its rooms. Two audiences that never meet: a
**guest** finds a free room, books it and pays online; **staff** — five roles
plus the guest realm — run the property: check people in, post charges, take
payment, issue the legal invoice, hand over the shift, read the numbers. One
database, one set of rules, two front doors.

The invariant everything protects: **two guests are never sold the same room
for the same night** — enforced in the database, not in application code
([`orientation.md`](orientation.md) §2).

It is also a coursework deliverable. The professor's twelve requirements (§8)
are a **subset** of what is built, never the target.

## 2. Users

| Actor | Realm | What they come for |
|---|---|---|
| Guest | `GUEST` | Book a room type, pay online, manage their own profile, stays and feedback. Every permission scoped to their own records |
| Receptionist | `RECEPTIONIST` | Check-in/out, room assignment, payments within policy, own shift handover |
| Housekeeping | `HOUSEKEEPING` | The cleaning board. Sees no money, no guest data |
| Accountant | `ACCOUNTANT` | Reversals, invoices, reconciliation, thu chi. Read-only on operations |
| Manager | `MANAGER` | Overrides, rates and rooms, KPI reports |
| Admin | `ADMIN` | Everything a manager has, plus accounts and system config |

Full capability grid: [`architecture/rbac-matrix.md`](architecture/rbac-matrix.md) §3.

## 3. Non-goals

Written to shut down scope drift while the PRD's blank corners whisper.

- **No offline writes, ever.** The correctness thesis lives in database
  constraints, which cannot hold across a partitioned database
  ([`architecture/infrastructure.md`](architecture/infrastructure.md) §Connectivity).
- **No OTA channel manager yet** — deferred to M11, knowingly the most
  expensive deferral in the project.
- **No PDF invoice engine.** The legal invoice is the e-invoice provider's
  output.
- **No points redemption engine.** Loyalty points accrue (`FR-GST-05`) but are
  spent nowhere in v1 — a reward is a manager-issued promotion (`FR-PRC-03`).
  Redemption, breakage liability and reversal logic wait until real usage
  earns them; the accrual ledger is already ledger-shaped, so adding them
  later is an extension, not a rewrite.
- **Guests book a room *type*, never a numbered room.** Room 301 is chosen at
  check-in.
- **No UI test-coverage target.** The test budget goes where defects cost
  money: inventory, folio, pricing (NFR-10).
- **MoMo only if measured VNPay-only abandonment demands it** (M6.5).
  **Overbooking only after real no-show data exists** (M9.5).
- **One property, one tenant.** No multi-property abstraction.

---

## 4. Functional requirements

Grouped by the fourteen API domain modules
([`architecture/repository-structure.md`](architecture/repository-structure.md)
§Domain modules), which are the product's feature map. `Lands` names the
milestone per the legend in §10; status per story lives in the execution
authority named in [`README.md`](README.md) and wins.

### 4.1 `auth` — two realms

| ID | Requirement | Acceptance criteria | Lands |
|---|---|---|---|
| `FR-AUTH-01` | Guest and staff authentication are two separate realms; no token opens both | Guest token on a staff route → 403, and the reverse — asserted by test in both directions | M2 |
| `FR-AUTH-02` | Guest account lifecycle: sign-up, email verification, sign-in, password reset, Google as the one social provider | Flows driven in a real browser against the running API; Google registered only when both credential halves are present, refused at boot in production when absent | M2 |
| `FR-AUTH-03` | Staff sign-in issues a token carrying exactly one staff role | Expired and tampered tokens both → 401, by named test | M2 |
| `FR-AUTH-04` | Signed-in credential management: password change by proving the current password; email change only through re-verification of the new address | The new address becomes the sign-in identifier only after its link is used — until then the old address signs in; a Google-only account is offered neither form — it has no password to change and its address belongs to Google. Screen intent in [`screens.md`](screens.md) §Account | M7 |

### 4.2 `identity` — roles and the guard

| ID | Requirement | Acceptance criteria | Lands |
|---|---|---|---|
| `FR-IDN-01` | Five staff roles plus the separate `GUEST` principal/realm are enforced by a fail-closed capability guard over the RBAC matrix; a route with no capability declaration is unreachable for everyone | Data-driven test iterates every matrix row asserting every allowed and every denied principal; anonymous → 401, wrong realm → 403 | M2 |
| `FR-IDN-02` | Staff account management (`ADMIN` only), with a CLI bootstrap for the first admin | `GET/POST /identity/staff-accounts` behind the guard; `staff:create` CLI exists because the first `ADMIN` cannot come from an API requiring one | M2 |
| `FR-IDN-03` | System configuration — the standard and reduced VAT rates and the window dividing them, whether the VAT base includes service charge, business-date rollover, gateway credentials — is data, editable by `ADMIN` without a deploy | No tax rate or tax-base rule compiled anywhere in the tree ([`architecture/property-and-tariff.md`](architecture/property-and-tariff.md) §8). Cites `ASM-01` | M6/M8 |

### 4.3 `guest` — profiles and personal data

| ID | Requirement | Acceptance criteria | Lands |
|---|---|---|---|
| `FR-GST-01` | Guest profile: personal data, VIP tier (derived — `FR-GST-04`), loyalty points (`FR-GST-05`), stay history — always scoped to the requester's own record | Ownership checked in the handler; role alone never grants access | M7 |
| `FR-GST-02` | An identity document is **checked, transcribed and discarded**: staff read the CCCD to complete the lưu trú declaration and the particulars land on the registration record, and the image is never persisted. No bucket, no stored object, no view path, nothing to delete | No object-storage key, path column or signed-URL route for a scan exists anywhere in the tree; the registration record carries the particulars and nothing else. Nghị định 96/2016/NĐ-CP Điều 44 obliges checking the document and recording the information before room handover — never holding the card, and never holding a picture of it | M7 |
| `FR-GST-03` | CCCD numbers are masked by default; unmasking is a distinct capability, audit-logged per call | Per [`architecture/rbac-matrix.md`](architecture/rbac-matrix.md) §3 Guest personal data | M4 |
| `FR-GST-04` | VIP tier is a **derived value**, never hand-set: computed from rolling-12-month stay count or net room revenue against configured thresholds (`FR-IDN-03`-style config, editable without deploy; ⚑ defaults in [`architecture/property-and-tariff.md`](architecture/property-and-tariff.md) §7), recomputed at business-date rollover; tier perks are fixed non-monetary benefits (late checkout, upgrade when available, welcome amenity) plus a member discount applied through the promotions path (`FR-PRC-03`) | Net room revenue **excludes VAT and service charge**, so a change to the `ASM-01` tax config cannot silently move tier boundaries; a tier change writes an audit row; tier matches recomputation from booking and folio history, asserted by test | M7/M9 |
| `FR-GST-05` | Loyalty points are real and **accrual-only in v1**: one append-only ledger row per closed folio, earned per configured unit of net room revenue (⚑ defaults in [`architecture/property-and-tariff.md`](architecture/property-and-tariff.md) §7), posted at **folio close** — never at booking or payment, so a cancelled or no-show booking structurally accrues nothing; points expire at a fixed configured calendar date; balance = Σ ledger rows, never a mutable counter | Accrual is idempotent per folio by unique constraint — the `FR-PAY-03` pattern; accrual reads the final settled folio total, so an early departure or discretionary refund cannot overstate points; no redemption endpoint exists (non-goal) | M7 |

### 4.4 `inventory` — rooms and the correctness core

| ID | Requirement | Acceptance criteria | Lands |
|---|---|---|---|
| `FR-INV-01` | Room types carry beds, size m², view, balcony, amenities, max occupancy, photos; rooms carry number, floor, type | Every room number in [`architecture/property-and-tariff.md`](architecture/property-and-tariff.md) §1 exists exactly once; the 5-type mix sums to 40 | M3 |
| `FR-INV-02` | Two-layer inventory makes oversell and double-assignment **unrepresentable in storage**: type-level `CHECK (sold_rooms <= total_rooms)`, room-level `EXCLUDE USING gist` on overlapping stays; a booking writes all its nights in one transaction | 50 parallel bookings on the last room → exactly 1 success and 49 clean 409s, in CI (NFR-01) | M3 |
| `FR-INV-03` | Availability query: date range → available types with price, public and front-desk | p95 < 300 ms over a 12-month calendar (NFR-03); restriction-aware arrival search for an N-night stay | M3 |
| `FR-INV-04` | Room closure reduces sellable inventory for a date range — a commercial act, `MANAGER`+ only, distinct from housekeeping status | Closure changes `total_rooms`; housekeeping status never does | M3 |
| `FR-INV-05` | Reproducible seed: 40 rooms, 5 types, 12 months of rates, 500 synthetic bookings, Vietnamese-locale data | One command; a mix that does not sum to 40 is a seed bug | M3 |

### 4.5 `pricing` — rates and restrictions

| ID | Requirement | Acceptance criteria | Lands |
|---|---|---|---|
| `FR-PRC-01` | Three rate plans (`STANDARD`, `NONREF`, `BB`) priced off a per-type per-date rate calendar; seasons are names over data, never hardcoded ranges | Per [`architecture/property-and-tariff.md`](architecture/property-and-tariff.md) §3; `BB`'s breakfast posts as its own folio line | M3 |
| `FR-PRC-02` | Stay restrictions — min/max stay, closed-to-arrival, closed-to-departure — reject at **query** time, not at booking time | One test per restriction | M3 |
| `FR-PRC-03` | Promotions and discounts as rate modifiers | Brief bullet *giảm giá, khuyến mãi* covered | M3 |
| `FR-PRC-04` | Child and extra-person pricing per the age bands, charged cheapest-heads-first above included occupancy, never above the type maximum | Per [`architecture/property-and-tariff.md`](architecture/property-and-tariff.md) §3. §1 requires an extra bed when the heads needing bedding exceed what the bedding sleeps, and charges nothing for it, so these bands are the whole price of the extra head | M3 |

### 4.6 `booking` — lifecycle and front desk

| ID | Requirement | Acceptance criteria | Lands |
|---|---|---|---|
| `FR-BOOK-01` | Booking lifecycle follows the six-state machine; illegal transitions → `409 IllegalTransition`; every transition idempotent | Transition-table tests generated from [`architecture/booking-state-machine.md`](architecture/booking-state-machine.md) §2 | M4 |
| `FR-BOOK-02` | The public funnel starts at `HELD` with a TTL that releases inventory on expiry; the front desk creates `CONFIRMED` directly for walk-ins and phone bookings | TTL job cancels with reason `HOLD_EXPIRED`; only the funnel can create `HELD` | M4 |
| `FR-BOOK-03` | Front-desk operations: check-in (room assigned and ready), check-out (folio settled), room move, extend, early departure, night-audit no-show, `NO_SHOW` → `CHECKED_IN` reinstate (`MANAGER`, fails if resold) | Guards per [`architecture/booking-state-machine.md`](architecture/booking-state-machine.md) §4–§5 | M4 |
| `FR-BOOK-04` | Cancellation always carries a reason code; the refund is policy-computed from the cancellation grid; waiving any cell is `MANAGER`+ | [`architecture/property-and-tariff.md`](architecture/property-and-tariff.md) §4 grid; `refund.policy` and `refund.override` are separate endpoints with separate roles | M4 |
| `FR-BOOK-05` | Search by room number, type, status, date range, guest name/phone | Brief bullet 6, verbatim | M4 |
| `FR-BOOK-06` | Guest funnel: six logical steps — search → room choice → details → payment → gateway return → confirmation — across five URL patterns because search and room choice share `/booking`; confirmation and stay detail are one route | Route map per [`architecture/repository-structure.md`](architecture/repository-structure.md) §`(booking)`; 0 bytes of `three`/`gsap`/`lenis` in the funnel bundle (NFR-05) | M7 |

### 4.7 `housekeeping` — room condition

| ID | Requirement | Acceptance criteria | Lands |
|---|---|---|---|
| `FR-HK-01` | Housekeeping status `CLEAN`/`DIRTY`/`INSPECTED`/`OUT_OF_ORDER`, orthogonal to occupancy; checkout sets `DIRTY`; check-in guard rejects a room not `CLEAN`/`INSPECTED` (⚑ owner decision 2 in the state machine) | A checked-out room is not sellable until housekeeping returns it to `CLEAN`; `INSPECTED` is an optional quality pass, never a prerequisite — asserted by the check-in guard test | M4 |
| `FR-HK-02` | Housekeeping board for `HOUSEKEEPING`, `RECEPTIONIST`, `MANAGER`+; setting `OUT_OF_ORDER` status never reduces sellable inventory (that is `FR-INV-04`) | Role rows per [`architecture/rbac-matrix.md`](architecture/rbac-matrix.md) §3 Housekeeping | M4 |

### 4.8 `folio` — the money ledger

| ID | Requirement | Acceptance criteria | Lands |
|---|---|---|---|
| `FR-FOL-01` | One folio per stay: an **append-only** posting ledger in integer VND — charges, payments, refunds, reversals. A mistake is corrected by a reversing entry, never an `UPDATE` or `DELETE` | Nightly: Σ postings = Σ payments + outstanding (NFR-02); no rounding inside any calculation | M6 |
| `FR-FOL-02` | VAT and service charge post as separate lines; guest-facing prices display gross; rates and the rule for whether VAT applies to service charge are read from config at posting time, never compiled in | Cites `ASM-01`; structure per [`architecture/property-and-tariff.md`](architecture/property-and-tariff.md) §5 | M6 |
| `FR-FOL-03` | Service catalog items post to folios with their tax class; catalog grows as data, no migration | Eight seeded items per [`architecture/property-and-tariff.md`](architecture/property-and-tariff.md) §6 | M6 |
| `FR-FOL-04` | If written tax-agent advice confirms `ASM-03`, closing a folio enqueues an **idempotent e-invoice job keyed on folio id** for *hóa đơn điện tử khởi tạo từ máy tính tiền*, signed by an HSM certificate; the provider's number is the legal reference; *điều chỉnh/thay thế* map onto folio reversals; a provider timeout never rolls back a checkout. If applicability differs, the written ruling replaces this invoice subtype before implementation | The confirmed invoice workflow is covered end to end; no manual dongle step enters checkout. Cites `ASM-03`, `ASM-04` | M6 |

### 4.9 `payment` — gateways

| ID | Requirement | Acceptance criteria | Lands |
|---|---|---|---|
| `FR-PAY-01` | One internal `PaymentGateway` port — `createPayment` / `verifyCallback` / `refund` / `queryTransaction`; no gateway type leaks past it | Two implementations at most, one folio | M6 |
| `FR-PAY-02` | VNPay first — sandbox at M6, production at M7 behind gate `G2` — signatures verified by the maintained library, never hand-rolled | One successful real production transaction before opening; the `G2` six-item checklist green before the credential flip | M6/M7 |
| `FR-PAY-03` | Webhook idempotency: unique constraint on the gateway transaction id | One IPN replayed 10× posts exactly 1 payment — by test | M6 |
| `FR-PAY-04` | Refunds are reversing entries; policy-computed and discretionary refunds are separate endpoints with separate roles | Cites `ASM-05` for sandbox refund testability | M6 |
| `FR-PAY-05` | Daily reconciliation against the gateway's own report; discrepancies page a phone | Alert proven by drill | M6 |
| `FR-PAY-06` | MoMo slots behind the same port, **only if** measured VNPay-only abandonment is material; its IPN is ACKed < 15 s with the work in the job queue | NFR-06; abandonment measurable because every funnel step is a route (`FR-BOOK-06`) | M6.5 |

### 4.10 `operations` — shifts and money movement

| ID | Requirement | Acceptance criteria | Lands |
|---|---|---|---|
| `FR-OPS-01` | Shift open/close with cash-drawer count and variance; handover notes and pending items, including services posted during the shift. Every cash payment belongs to an open shift — taking cash with none open prompts opening one in place, so variance stays computable; gateway payments are outside the drawer | Receptionist scoped to own shift; a cash payment posted with no open shift is impossible by test; brief bullet 8 | M8 |
| `FR-OPS-02` | Income/expense (*thu chi*) with categories | Brief bullet 11 | M8 |
| `FR-OPS-03` | Excel export of management data, streamed | Brief bullet 10; library re-evaluated at M8 per [`architecture/tech-stack.md`](architecture/tech-stack.md) §Still open | M8 |

### 4.11 `reporting` — night audit and KPIs

| ID | Requirement | Acceptance criteria | Lands |
|---|---|---|---|
| `FR-RPT-01` | Night audit at business-date rollover: posts room charges, rolls the date, freezes an immutable snapshot — reports read snapshots, so history never changes. It does **not** issue invoices (`FR-FOL-04` does) | Runs exactly once per business date, provable from job history; a missed audit pages within 30 min | M9 |
| `FR-RPT-02` | Revenue and room-status reports with charts, by day/month/quarter/arbitrary range | Brief bullet 7 | M9 |
| `FR-RPT-03` | Occupancy, ADR and RevPAR — from snapshots | The three numbers a hotel is judged on, not gross revenue alone | M9 |
| `FR-RPT-04` | Overbooking limits per type/date against a no-show model, with a walk/relocation policy — optional, data-gated | Needs real no-show data first | M9.5 |

### 4.12 `audit` — the change log

| ID | Requirement | Acceptance criteria | Lands |
|---|---|---|---|
| `FR-AUD-01` | Every state-changing action records actor, action, before → after, with a database-trigger backstop | 100% of state-changing endpoints audited, asserted by test (NFR-09) | M8 |
| `FR-AUD-02` | Audit log viewer; `ACCOUNTANT` sees financial entries only | Brief bullet 9 covers booking changes, cancellations with reason, invoice adjust/cancel | M8 |

### 4.13 `feedback` — post-stay

| ID | Requirement | Acceptance criteria | Lands |
|---|---|---|---|
| `FR-FBK-01` | Post-stay feedback, tied to the guest's own `CHECKED_OUT` booking | Cannot be left on someone else's stay or an unfinished one — by test | M7 |

### 4.14 `notification` — transactional email

| ID | Requirement | Acceptance criteria | Lands |
|---|---|---|---|
| `FR-NTF-01` | Transactional email: booking confirmation, cancellation, pre-arrival reminder, plus the auth realm's verification and reset mail | Sent through the provider when configured, logged locally when not; domain verified SPF/DKIM/DMARC before production | M2–M7 |

---

## 5. Non-functional requirements

| ID | Requirement | Target | Proven by |
|---|---|---|---|
| `NFR-01` | Double-booking | **0** — unrepresentable at the storage layer | 50-parallel-bookings test in CI (`FR-INV-02`) |
| `NFR-02` | Ledger integrity | Σ postings = Σ payments + outstanding, nightly | Night-audit check (`FR-RPT-01`) |
| `NFR-03` | Availability p95, 12-month calendar | **< 300 ms** | Load test at M10 |
| `NFR-04` | Admin console interaction feedback | **< 150 ms**, no entrance animation on operational screens | E2E timing at M7 |
| `NFR-05` | `/booking` funnel bundle | **0 bytes** of `three`/`gsap`/`lenis` | CI bundle budget |
| `NFR-06` | MoMo IPN ACK (if built) | **< 15 s** p100 | Handler ACKs, work queued |
| `NFR-07` | Realm separation | Cross-realm request → 403, both directions | Guard suite (`FR-AUTH-01`) |
| `NFR-08` | Identity-document images at rest | **0** — no bucket, key, path column or view route exists to hold one | Structural, not a measurement: `FR-GST-02` keeps the storage path from ever existing |
| `NFR-09` | Audit coverage of state-changing endpoints | **100%** | Asserted by test (`FR-AUD-01`) |
| `NFR-10` | Test coverage on `inventory` + `folio` + `pricing` | **≥ 85%**; UI coverage deliberately untargeted | Coverage report |
| `NFR-11` | Keyboard-only check-in | **0** mouse events end to end | Playwright E2E at M7 |
| `NFR-12` | Type-level money and dates | Integer-VND `bigint`; `StayDate` ≠ timestamp is a **compile** error | `@ts-expect-error` type tests |

---

## 6. Internal assumptions — the ⚑ system, not this file

Every ⚑ mark in the architecture files is a developer default written down so
it stops being a blocker: the whole of
[`architecture/property-and-tariff.md`](architecture/property-and-tariff.md)
§1–§7, **five** RBAC decisions
([`architecture/rbac-matrix.md`](architecture/rbac-matrix.md) §5), **two**
state-machine decisions
([`architecture/booking-state-machine.md`](architecture/booking-state-machine.md)
§7). Those files are the registry of internal assumptions; re-listing them here
would be a second source. This section exists so nobody adds one.

## 7. Assumption registry — external answers

Assumptions resting on **somebody else's answer**. Each is built as if true;
when the answer lands, resolve the row and re-read the requirements it names.
None of them blocks M2 or M3.

| ID | Assumption | Whose answer | Tracked as | Requirements affected |
|---|---|---|---|---|
| `ASM-01` | The VAT rate, reduced-VAT window and whether the VAT base includes service charge are **configuration**; every seeded value is provisional pending the accountant's written answer | Accountant | `D2b`; [SCRUM-12](https://hungphat2018-1785053353783.atlassian.net/browse/SCRUM-12), [SCRUM-86](https://hungphat2018-1785053353783.atlassian.net/browse/SCRUM-86) | `FR-IDN-03`, `FR-FOL-02`, `NFR-02` |
| `ASM-02` | A statutory retention floor `N` exists for registration records and CCCD scans, and offshore (Singapore) storage is permissible; neither claim is accepted until written legal advice arrives | Lawyer | `D2c` / `M0-05`; [SCRUM-13](https://hungphat2018-1785053353783.atlassian.net/browse/SCRUM-13) | `FR-GST-02`, `FR-IDN-03`, `NFR-08` |
| `ASM-03` | If Nghị định 70/2025/NĐ-CP binds this operating entity and activity, the invoice is *hóa đơn điện tử khởi tạo từ máy tính tiền*, issued at folio close and signed by HSM; applicability awaits the tax agent's written answer | Tax agent | `M0-06`; [SCRUM-12](https://hungphat2018-1785053353783.atlassian.net/browse/SCRUM-12) | `FR-FOL-04` |
| `ASM-04` | The e-invoice provider is Viettel S-Invoice; switches to MISA meInvoice if the accountant works in MISA AMIS | Accountant | `M0-01`; [SCRUM-12](https://hungphat2018-1785053353783.atlassian.net/browse/SCRUM-12) | `FR-FOL-04` |
| `ASM-05` | VNPay grants refund sandbox access during merchant onboarding, so `refund` is testable before production | VNPay | `M0-04`; [SCRUM-14](https://hungphat2018-1785053353783.atlassian.net/browse/SCRUM-14) | `FR-PAY-02`, `FR-PAY-04` |
| `ASM-06` | Generated Mermaid diagrams satisfy the coursework's notation requirement (vs strict UML) | Professor | `D8`; [SCRUM-16](https://hungphat2018-1785053353783.atlassian.net/browse/SCRUM-16) | none — affects the docs pipeline (`P0-DOC-03/04`), no product requirement |

## 8. Traceability — the professor's twelve requirements

The brief itself is the reference; no restatement of it is kept in this
repository, because a copy is one more thing to drift.
Each bullet is closed by at least one requirement here. The bullet → issue-key mapping
lives in the execution authority named in [`README.md`](README.md); this table
adds the requirement layer between them.

| # | Brief bullet | Closed by | Lands |
|---|---|---|---|
| 1 | RBAC ≥ 3 levels | `FR-IDN-01`, `FR-AUTH-01` | M2 |
| 2 | Room types and attributes | `FR-INV-01` | M3 |
| 3 | Guest accounts | `FR-AUTH-02`, `FR-GST-01`, `FR-GST-04`, `FR-GST-05` | M2/M7 |
| 4 | Post-stay feedback | `FR-FBK-01` | M7 |
| 5 | Availability display | `FR-INV-03` | M3 |
| 6 | Search | `FR-BOOK-05` | M4 |
| 7 | Reports with charts | `FR-RPT-02`, `FR-RPT-03` | M9 |
| 8 | Shift handover | `FR-OPS-01` | M8 |
| 9 | Audit log | `FR-AUD-01`, `FR-AUD-02` | M8 |
| 10 | Excel export | `FR-OPS-03` | M8 |
| 11 | Income / expense | `FR-OPS-02` | M8 |
| 12 | Online payment | `FR-PAY-02` — one **production** gateway closes it; MoMo (`FR-PAY-06`) is optional | M7 |

All twelve are demonstrable by M9 without building for the rubric.

## 9. Delivery evidence

This requirements document does not carry a status snapshot. For current work
state, follow the execution authority named in [`README.md`](README.md). For
release claims, inspect the owning source, tests, schemas, workflows and
generated artifacts; a planned milestone or accepted architecture is not proof
that a requirement has shipped.

## 10. Milestone legend

The `Lands` column, the non-goals and the assumption registry name delivery
milestones. The names and their scope are durable vocabulary and are defined
here; ordering detail, dates and completion state belong to the execution
authority named in [`README.md`](README.md).

| Milestone | Scope |
|---|---|
| `M0` | Paperwork and procurement — external answers and credentials, each on its own trigger |
| `M1` | Web migration |
| `M2` | Foundations — auth realms, identity guard |
| `M3` | Inventory and availability — the correctness core |
| `M4` | Booking lifecycle and front desk |
| `M5` | Assignment optimizer — optional, does not block the spine |
| `M6` | Folio, payments, invoicing |
| `M6.5` | MoMo — only if measured VNPay-only abandonment demands it |
| `M7` | Guest booking engine and the admin console — production gate `G2` lands here |
| `M8` | Operations — shifts, thu chi, Excel export |
| `M9` | Reporting — night audit, snapshots, KPI reports |
| `M9.5` | Overbooking — only after real no-show data exists |
| `M10` | Hardening |
| `M11` | OTA channel manager — deferred |
