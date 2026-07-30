---
title: Mariva PMS — consolidated backlog
created: 2026-07-26
---

# Mariva PMS — consolidated backlog

This file owns the stable local requirement IDs and their durable definitions
of done. Jira project `SCRUM` owns execution state: issue status, assignee,
priority, sprint, dependencies, dates, and implementation evidence. A Jira
issue keeps the local key in its summary or description so the two surfaces
remain traceable without copying live state back here.

Precedence between this file, `docs/` and the report lives in one place:
[`docs/README.md`](../docs/README.md), the authority map. The conflicts with the
advisory reports were reconciled once, in §9; re-deriving them from the reports
will re-introduce corrections already made.

To decide *what to hand over next*, read [`work-orders.md`](work-orders.md) — the
same keys repackaged into handoff-sized units with file ownership and
acceptance boundaries. Confirm readiness and blockers in Jira before starting.

Archived rationale, read-only:

- Architecture: `plans/reports/archive/advise-260726-0939-resort-pms.md` (R1)
- Stack: `plans/reports/archive/advise-260726-1119-stack-selection.md` (R2) — distilled into `docs/architecture/tech-stack.md`
- Infra + money: `plans/reports/archive/advise-260726-1401-infra-money-rails.md` (R3) — distilled into `docs/architecture/infrastructure.md`
- Readiness assessment: `plans/reports/archive/advise-260726-1440-task-readiness.md`
- Report context: `plans/reports/archive/advise-260726-1452-project-report-context.md`

## How this maps to issues

| Level | This file | Notes |
|---|---|---|
| Milestone | `##` section | Dependency-ordered, matches R1 §14 phases |
| Epic | `###` section | |
| Story | Table row | Key column is the stable ID; keep it in the Jira issue summary or description |
| Definition of Done | DoD column | `R1#4` = report 1 §16 metric 4, etc. |

**Depth rule.** P−1, P0 and P1 are written to story level. P2 onward stay at
epic level until the preceding milestone is underway. Detailed tickets for P6
written today get rewritten before they are worked; MoMo is already conditional
on funnel data that does not exist.

---

## 0. Gates — blocking issues, not stories

| Key | Gate | Blocks | Detail |
|---|---|---|---|
| `G1` | ~~`@orpc/nest` spike — does it enforce the contract at compile time?~~ | ~~`P0-C*`~~ | **Passed.** Verdict, evidence and the ESM constraint it turned up: `docs/architecture/tech-stack.md` §"oRPC compile-time contract evidence" |
| `G2` | **The trigger** — the commit switching VNPay from sandbox to production credentials | Everything after P4 | Six-item checklist below. Nothing merges past it unticked. R3 §3.5 |
| `G3` | Paperwork lead time | `P3-*` | Weeks of someone else's process. Blocks nothing until it blocks everything |

### G2 — the trigger checklist

- [ ] Neon Free → Launch; 7-day history confirmed, no idle suspend
- [ ] Vercel Hobby → Pro (a booking site is commercial use)
- [ ] Uptime monitor on `/health` + heartbeat on the night audit, both paging a phone
- [ ] Weekly `pg_dump` → R2 live, **and one restore drill executed and timed**
- [ ] R2 ID-scan lifecycle rule verified against a real object
- [ ] Release tracking wired to deploys

---

## 1. Decisions

Previously one undifferentiated list owned by "Owner" / "Accountant", which read
as *blocked on somebody else*. Most of it was never blocked. Split below by who
actually has to answer.

### 1.1 Mine — written, ⚑, revisable

Mariva is a coursework property: no building constrains these, so waiting on
them was waiting on myself. Written down as ⚑ defaults, which cost nothing to
overturn — an undocumented wait does.

| Key | Decision | Blocks | Status |
|---|---|---|---|
| `D1` | **Property facts** — room count, type mix, floors, numbering, check-in/checkout, business-date rollover, max occupancy, physical bed capacity | `P1-INV-*`, `P1-SEED-*`, `P2`, `P6` | **Done** → `docs/architecture/property-and-tariff.md` §1–§2. All ⚑ |
| `D3` | **Cancellation / no-show grid** — deadline offsets, penalties, no-show charge, early-departure charge | `P2-CAN-*`, `P3-REF-*`, `P4` | **Done** → same file §4. All ⚑ |
| `D4` | **Rate structure at launch** — plan count, season calendar, weekend definition, child/extra-person pricing | `P1-RAT-*` | **Done** → same file §3. Season *dates* deliberately unset — `rate_calendar` is per-date, so they block nothing |
| `D7` | Service catalog — items, tax class | `P3-SVC-*`, `P5` | **Done** → same file §6, eight items seeded thin. Prices ⚑ |
| `D2a` | **Charge model structure** — service charge %, gross-or-net display, VND rounding, tax class per item | `P3-FOL-*` | **Done** → same file §5 |
| `D5` | RBAC matrix content | `P0-AUTH-*` | **Done** → `docs/architecture/rbac-matrix.md`, **six** ⚑ decisions await sign-off, counted in its §5 |
| `D6` | Booking state transitions | `P2-SM-*` | **Done** → `docs/architecture/booking-state-machine.md`, **two** ⚑ decisions await sign-off, counted in its §7 |

### 1.2 Genuinely external — somebody else's answer

Zero cost to ask, long latency. None blocks M2; `D9` blocks the affected M3
pricing acceptance work. Send the questions; do not invent the answers.

| Key | Decision | Whose | Blocks | Status |
|---|---|---|---|---|
| `D2b` | **VAT rate, reduced-VAT applicability/window, and whether the VAT base includes service charge** | Accountant | `P3-FOL-*`, every total | Open — `SCRUM-12`, `SCRUM-86`. Statutory and time-limited; never from memory |
| `D2c` | Statutory retention floor `N` and whether offshore ID-scan storage is lawful | Lawyer | `M10` retention, `R3#6` | Open — `SCRUM-13` |
| `D8` | Diagram notation — strict UML vs Mermaid-generated | Professor | `P0-DOC-03`, `P0-DOC-04` | Open — `SCRUM-16`. One email |
| `D9` | When an extra bed is mandatory, and whether its service line stacks with or replaces the extra-person charge | Owner | `P1-SCH-03`, pricing/booking acceptance tests | Open — `SCRUM-87`; no quote may infer the answer from bed capacity |

### 1.3 The four inputs that are never constants

The three inputs in `D2b` and the retention floor in `D2c` are
**configuration rows**, seeded from environment at boot and
editable by `ADMIN` without a deploy — the permission row already exists in
`rbac-matrix.md` §3 System. Reasoning and the failure mode:
`docs/architecture/property-and-tariff.md` §7.

A hardcoded VAT rate does not throw. It mis-invoices silently, and the invoice
is a legal document issued by a third party. A hardcoded `N` either deletes
records the law requires kept or keeps ID scans past the window `R3#6` asserts
is empty. Neither is caught by a test that does not know the right number.

---

## M0 — Paperwork and procurement · *parallel, scheduled per item*

Not code. Each needs a trigger rather than a sprint.

**Not "starts today" any more.** R3 §10 said *parallel, starts today* on the
assumption of a scheduled opening. There is no opening date, so the two items
that start a paid clock are deferred and the free ones go out now. Scheduling
change only — nothing left the milestone.

| Key | Story | DoD | Trigger |
|---|---|---|---|
| `M0-01` | Ask the accountant: existing e-invoice provider? do they work in MISA AMIS? | Answer recorded; provider chosen | **now** — free, long latency, decides an M6 API |
| `M0-02` | Buy **chữ ký số HSM / ký số từ xa** — explicitly *not* a USB token | Certificate issued, remote signing API reachable | **when M6 is in sight** — buying now starts a certificate validity clock against months of no invoices |
| `M0-03` | Buy the **hóa đơn điện tử khởi tạo từ máy tính tiền** SKU (Viettel S-Invoice by default) | Contract signed, sandbox credentials in hand | **when M6 is in sight** — annual subscription, same reason. Depends on `M0-01` |
| `M0-04` | Start VNPay merchant onboarding — **request refund sandbox access in the same application** | Application submitted · `R3#15` | **now** — weeks of latency, no recurring cost; the one place lead time genuinely bites |
| `M0-05` | Lawyer: offshore storage of CCCD scans + statutory retention floor | Written answer; `N` set in config | **now** — free, long latency |
| `M0-06` | Tax agent: does Nghị định 70/2025 bind this entity's activity codes? | Written answer | **now** — free, long latency |
| `M0-07` | Better Stack probe at the property the day the ISP line goes live | 60-day clock started · `R3#14` | **when the ISP line exists** |

---

## M1 — P−1 Web migration

One variable per commit. R2 §14.3.

| Key | Story | DoD |
|---|---|---|
| `P-1-01` | Playwright visual baseline of all six acts, committed | Six acts × five scroll positions captured; `compare-visual-baseline` exits 0 · `R2#8` |
| `P-1-02` | Remove unused `@react-three/drei` | Build green · `R2#2` |
| `P-1-03` | React 18.3 → 19.2 + types; absorb type churn | Screenshots green |
| `P-1-04` | `@react-three/fiber` 8.17 → 9.6 (two files, four APIs) | Screenshots green |
| `P-1-05` | Next 14.2 → 15; audit async `cookies()`/`headers()`/`params`/`searchParams` | Screenshots green |
| `P-1-06` | Next 15 → 16 | Screenshots green · `R2#1` 0px unexplained diff |
| `P-1-07` | Pin Node to one even LTS — `.nvmrc`, `engines`, CI matrix **together** | All three read the same major; `R2#4`. Node 20 is EOL since April 2026 |
| `P-1-08` | Extract tokens → `packages/tokens`; `apps/web` pixel-identical | `R2#7` — `grep '#f4efe6'` outside the package = 0 |
| `P-1-09` | Biome replaces `eslint.config.mjs`; delete it; update CI lint | `R2#6` — one lint config file |
| `P-1-10` | lefthook: format + typecheck on commit | Hook fires |

`three` stays at 0.169 — `R2#4`. Tokens and Biome land **after** the version
migration is green, never inside its diff — `R2#8`.

Two follow-ups have their own acceptance boundaries:

- **Biome does not lint `apps/api`.** `P0-CI-05` owns bringing it into the
  repository lint scope.
- Accessibility and correctness warnings in the arrival require product fixes,
  not broader lint suppression. `P0-CI-06` / `SCRUM-96` owns the work; WO-10
  packages it.

---

## M2 — P0 Foundations

Planning rationale and dependency boundaries:
`plans/260726-p0-foundations/plan.md`.

### P0-INF — Infrastructure skeleton

| Key | Story | DoD |
|---|---|---|
| `P0-INF-01` | Neon project `aws-ap-southeast-1`; production + staging branches; **spend alert** | `R3#1` ≤ $5/mo pre-trigger |
| `P0-INF-02` | Local Docker Postgres for development; Neon for deployed environments only | `R3#13` staging suspends when idle |
| `P0-INF-03` | Fly.io app in `sin`; Dockerfile for the Nest API; secrets via `fly secrets` | Never committed |
| `P0-INF-04` | Vercel project for `apps/web`, function region `sin1` | Deploy from the default branch green; function region reads `sin1`, not the `iad1` default |
| `P0-INF-05` | R2: **two** buckets — `mariva-assets`, `mariva-id-scans` (private, lifecycle rule) | `R3#7` — one bucket, one code path |
| `P0-INF-06` | Resend domain verified: SPF, DKIM, DMARC | Test send delivers |
| `P0-INF-07` | Better Stack: `/health` uptime monitor + error tracking in the Nest exception filter | A forced 500 reaches error tracking; stopping the API pages a phone. Both proven by drill, not by configuration screenshot |

### P0-API — API skeleton and database

| Key | Story | DoD |
|---|---|---|
| `P0-API-01` | Scaffold `apps/api`: Nest 11 + Express 5, **ESM** (`"type": "module"`, `nodenext`), tsconfig, Turbo tasks | `pnpm build` green. ESM is not optional — `@orpc/*` is ESM-only, per `tech-stack.md` §"oRPC compile-time contract evidence" |
| `P0-API-02` | Drizzle + drizzle-kit + `pg`; **one pool** shared with pg-boss | `R2#13` — 1 pool |
| `P0-API-03` | Migration `0000`: `create extension btree_gist` | Applies clean |
| `P0-API-04` | Env schema parsed by zod at boot; fail fast | Missing var = startup failure |
| `P0-API-05` | nestjs-pino structured logging | Every request emits one JSON line carrying a correlation id; `console.log` outside bootstrap = 0 |
| `P0-API-06` | `/health` endpoint | 200 only after a real database round-trip; a stopped database returns 503, never 200 |
| `P0-API-07` | Deploy hello-world API to production | Reachable; R1 §8.1 |

`P0-API-07` depends on `P0-INF-03`: provisioning and the deployable artifact
must exist before the production reachability criterion can be exercised.

The migration is `0000`, not `0001`: drizzle-kit numbers from zero and owns the
`meta/_journal.json` that tracks them. Renaming it to match this table would
desynchronise the two.

The migration ledger under `apps/api/src/database/migrations/` owns the
executable numbering and SQL. Database-backed verification belongs to the
`P0-CI` acceptance criteria below rather than to a machine-specific narrative
here.

### P0-C — Contracts

| Key | Story | DoD |
|---|---|---|
| `P0-C-01` | `packages/shared`: keep zod 4.4.x, add drizzle-zod, `@internationalized/date` | `R2#3` — one zod version tree-wide |
| `P0-C-02` | Define `StayDate` (`CalendarDate`) and `VndAmount` (`bigint`) as the two primitive contract types | Mixing a stay date with a timestamp is a **compile** error |
| `P0-C-03` | `@orpc/contract` router in `packages/shared`; move `StaffRole` schema/type ownership there and import it from API RBAC | `packages/shared` typechecks standalone; one procedure declares inferred input/output types; the RBAC matrix remains green after the role import moves |
| `P0-C-04` | `@orpc/nest` binding in `apps/api`; implement `packages/api-client` with `@orpc/client` | `R2#2` — API and client consume one wire contract; a deliberate contract break fails the build |

The role vocabulary crosses the API/admin boundary, so `packages/shared` owns
and exports it; the API capability matrix remains in `apps/api`. The current
API-local role definition is the implementation gap closed by `P0-C-03`.
`packages/api-client` is part of P0 contract delivery; only `apps/admin` is
deferred.

### P0-AUTH — Two auth realms · *consumes `D5`*

| Key | Story | DoD |
|---|---|---|
| `P0-AUTH-01` | Staff realm on Passport-JWT | Login issues a token carrying one staff role; expired and tampered tokens both return 401 — asserted by test |
| `P0-AUTH-02` | Guest realm on Better Auth, strictly separate | Guest token → staff route = 403, and the reverse |
| `P0-AUTH-03` | `@RequiresCapability()` guard over five staff roles and the separate `GUEST` realm | **Fail-closed**: a route with no declaration is unreachable, per `rbac-matrix.md` §2. Row-by-row coverage is deliberately `P0-AUTH-04`'s DoD, not this one |
| `P0-AUTH-04` | Data-driven test asserting every matrix row's allowed and denied roles | Every `rbac-matrix.md` row covers allowed and denied identities |

The realm and capability decisions live in
[`rbac-matrix.md`](../docs/architecture/rbac-matrix.md). The executable owners
and their tests are under `apps/api/src/modules/auth/`,
`apps/api/src/common/auth/`, and `apps/api/test/`; this backlog does not mirror
their current inventory.

### P0-CI — Quality gates

| Key | Story | DoD |
|---|---|---|
| `P0-CI-01` | Vitest across api/shared; one runner repo-wide | `R2#12` — one test runner |
| `P0-CI-02` | `@testcontainers/postgresql` with `.withReuse()` — **not** a CI service container | Local and CI tests boot Postgres through the same helper; no manually provisioned `.env.test` database is required; `R2#5` warm boot < 5s on Windows |
| `P0-CI-03` | fast-check wired | One property test runs in CI and, given a deliberately broken invariant, fails with a shrunk counterexample |
| `P0-CI-04` | CI runs `pnpm test` with Docker available; Turbo test caching cannot hide an unavailable runtime dependency | A cache-bypassed repository test run passes from clean-machine prerequisites, and the cache policy cannot substitute an earlier green result for database-backed execution |
| `P0-CI-05` | Bring `apps/api` under the repository Biome scope (`SCRUM-85`) | `pnpm lint` reads API source with no broad `apps/api` exclusion; findings are fixed or narrowly justified |
| `P0-CI-06` | Resolve arrival lint findings without weakening repository rules (`SCRUM-96`) | `pnpm lint` reports no warning or info findings from `apps/web/features/arrival/**`; no broad suppression or ignore expansion |

### P0-DOC — Docs and academic pipeline · *consumes `D8`*

| Key | Story | DoD |
|---|---|---|
| `P0-DOC-01` | `drizzle-dbml-generator` → `docs/erd.dbml`; **CI fails on drift** | `R1#16`, `R2#10` |
| `P0-DOC-02` | `@orpc/openapi` → `docs/openapi.json`, served via Scalar | `R2#11` — every endpoint represented |
| `P0-DOC-03` | Generate the use-case diagram from `rbac-matrix.md` | Regenerates in CI |
| `P0-DOC-04` | Generate the state diagram from `booking-state-machine.md` §2 | Regenerates in CI |
| `P0-DOC-05` | Traceability table skeleton in `docs/` — 12 brief bullets → issue key | `R1#12` |
| `P0-DOC-06` | Pre-submission sync check: reconcile every `docs/bao-cao/` chapter against the canonical files named in `docs/README.md`; fix the report side | Run immediately before the report is submitted; no unexplained mismatch, and every fix is recorded |

### P0-PAY — Payment port, sandbox only

| Key | Story | DoD |
|---|---|---|
| `P0-PAY-01` | `PaymentGateway` port: `createPayment` / `verifyCallback` / `refund` / `queryTransaction` | One interface, no gateway types leaking past it |
| `P0-PAY-02` | VNPay **sandbox** implementation using the `vnpay` library — never hand-rolled HMAC | Signature verified via `verifyIpnCall` |
| `P0-PAY-03` | IPN idempotency: unique constraint on gateway txn id; replay one callback 10× | `R1#6`, `R3#8` — one payment posted |

---

## M3 — P1 Inventory and availability · **the correctness core**

`D1` and `D4` are decided — `docs/architecture/property-and-tariff.md`. Write
the concurrency test **before** the booking UI.

The M3 tables are a requirements and DoD catalog, not a status record. Jira
project `SCRUM` owns their workflow state, assignment, sprint, estimates,
dependencies, and delivery evidence.

### P1-SCH — Schema

| Key | Story | DoD |
|---|---|---|
| `P1-SCH-01` | `room_type` — beds, area m², view, balcony, amenities, max occupancy, photos | Brief bullet 2 |
| `P1-SCH-02` | `room` — number, floor, type, housekeeping status | Every number in `property-and-tariff.md` §1 exists exactly once; housekeeping status stays distinct from room closure (`P1-INV-04`) |
| `P1-SCH-03` | `rate_plan` + `rate_calendar` (per type per date), min-stay, cancellation policy | Three plans per `property-and-tariff.md` §3; one calendar row per type per date, so no season range is hardcoded |
| `P1-SCH-04` | Stay restrictions: min/max stay, closed-to-arrival, closed-to-departure | Each of the four rejects at **query** time, not at booking time — one test per restriction |
| `P1-SCH-05` | Promotions and discounts as rate modifiers | Brief bullet: *giảm giá, khuyến mãi* |

### P1-INV — Two-layer inventory · *the load-bearing wall*

| Key | Story | DoD |
|---|---|---|
| `P1-INV-01` | `room_type_inventory` with `CHECK (sold_rooms <= total_rooms)` | Oversell unrepresentable |
| `P1-INV-02` | `room_assignment` with `EXCLUDE USING gist (room_id =, stay_range &&)` | Overlap unrepresentable |
| `P1-INV-03` | Booking writes all nights in **one** transaction | Partial night-range writes impossible |
| `P1-INV-04` | Out-of-order closure reduces `total_rooms` for its date range | Per `rbac-matrix.md`: `MANAGER` only |
| `P1-INV-05` | **50 parallel bookings on the last room → exactly 1 success, 49 clean 409s** | `R1#1`, `R2#6` — in CI |

### P1-AVL — Availability

| Key | Story | DoD |
|---|---|---|
| `P1-AVL-01` | Availability query: date range → available types + price | Brief bullet 5 |
| `P1-AVL-02` | Stay-restriction search — valid arrival dates for an N-night stay under CTA/CTD/min-stay | R1 §10.2 |
| `P1-AVL-03` | Availability p95 over a 12-month calendar | `R1#5` — < 300ms |

### P1-SEED — Seed data

| Key | Story | DoD |
|---|---|---|
| `P1-SEED-01` | 40 rooms, 5 types, 12 months of rates, 500 synthetic bookings, `@faker-js/faker` `vi` locale | Reproducible from a command; room count and type mix match `property-and-tariff.md` §1 exactly — a seed whose mix does not sum to 40 is a seed bug |

---

## M4 — P2 Booking lifecycle and front desk

`D3` and `D6` are decided — `property-and-tariff.md` §4 and
`booking-state-machine.md`. Epic level until M3 is underway.

- **P2-SM** — state machine per `booking-state-machine.md`; illegal-transition rejection tests; TTL hold expiry job
- **P2-OPS** — check-in with assignment, room move, extend stay, early checkout, no-show
- **P2-CAN** — cancellation with reason code + policy-driven refund calculation, per the `property-and-tariff.md` §4 grid; waiver is `MANAGER`+
- **P2-HK** — housekeeping board; room state vs room closure kept distinct
- **P2-SRC** — search by room number, type, status, date range, guest name/phone *(brief bullet 6)*
- **P2-KEY** — keyboard primitives **before screens multiply**: `cmdk` palette, global hotkeys, focus management, text date parsing (`1408` → 14 Aug)
- **P2-UI** — scaffold `apps/admin`: Next + Tailwind 4 `@theme` over Mariva tokens, shadcn, TanStack Table + Query

DoD: `R1#15` keyboard-only check-in E2E with 0 mouse events · `R1#14` admin
interaction feedback < 150ms, no entrance animation on operational screens.

---

## M5 — P2.5 Assignment optimizer · optional, does not block the spine

- Greedy / best-fit-descending baseline, kept in the codebase as the reference oracle
- Optimizer (constraint solver or local search) — **never moves a checked-in guest**
- Shuffle-to-fit on would-be-rejected bookings
- Differential tests against the oracle on random states; property tests via fast-check
- Published before/after benchmarks

DoD: `R1#14` — optimizer never worse than greedy, improvement quantified.

---

## M6 — P3 Folio, payments, invoicing · **where the money is**

`D7` and the charge-model structure (`D2a`) are decided —
`property-and-tariff.md` §5–§6. **`D2b` — the VAT rate, reduced-rate
applicability/window, and VAT-on-service-charge tax base — is not decided, and
all three inputs are configuration, never constants** (§7 there).
Blocked on `G3` for the production halves.

- **P3-FOL** — append-only posting ledger in `bigint` VND: charge / payment / refund / reversal. Tax and service charge as separate lines; the rate read from config, never compiled in
- **P3-SVC** — service catalog posting to folios, eight seeded items
- **P3-JOB** — **pg-boss installed here, not at P6.** First consumers are e-invoice issuance and webhook ACK
- **P3-PAY** — VNPay production terminal, IPN URL separate from staging, unique constraint on gateway txn id
- **P3-REF** — refunds as reversing entries; `refund.policy` and `refund.override` as separate endpoints
- **P3-INV** — e-invoice at folio close as an **idempotent pg-boss job keyed on folio id**; the provider's number is the legal reference; adjust/replace maps onto folio reversals
- **P3-REC** — daily gateway reconciliation; discrepancy alerts to a phone

DoD: `R1#3` nightly Σ postings = Σ payments + outstanding · `R1#17` 100% of
closed folios carry a provider invoice number · `R1#18` / `R3#11` **0** manual
dongle steps in the checkout path · `R3#9` MoMo IPN ACK < 15s if built.

---

## M6.5 — P3.5 MoMo · conditional

Do not start until VNPay-only payment-step abandonment is measured and material.
Slots behind the existing `PaymentGateway` port. R3 §5.1.

---

## M7 — P4 Guest booking engine · **`G2` lands here**

- `app/(booking)/` route group — plain layout, no shared WebGL providers. Route map decided: `repository-structure.md` §`apps/web`
- Search → type selection → guest details → payment → **gateway return** →
  confirmation: six logical steps across five URL patterns, because search and
  type selection share `/booking`. The redirect back remains separate from
  confirmation because the IPN that decides the outcome is asynchronous and
  may land after it
- Confirmation and stay detail are one route, `/bookings/<reference>` — one RBAC row, one renderer
- Guest register/login, profile, stay history, VIP tier, loyalty points *(brief bullet 3)*
- ID upload to the private bucket; short-TTL signed URLs issued after the role check, issuance audit-logged
- Post-stay feedback tied to a completed booking *(brief bullet 4)*
- Transactional email: confirmation, cancellation, pre-arrival reminder

DoD: `R1#13` — **0 bytes** of `three`/`gsap`/`lenis` in the `/booking` bundle,
CI budget enforced · `R1#11` / `R3#6` — 0 ID scans older than `N` days, enforced
by the R2 lifecycle rule and verified by a job · `R1#9` — one successful real
production transaction before opening.

**The `G2` checklist must be green before the credential flip.**

---

## M8 — P5 Operations

- Shift open/close with cash drawer count and variance; handover notes and pending items *(brief bullet 8)*
- Income/expense (thu chi) with categories *(brief bullet 11)*
- Audit interceptor — actor / action / before → after, with a DB trigger backstop; audit log viewer *(brief bullet 9)*
- Excel export, streamed *(brief bullet 10)* — re-evaluate `exceljs` here, unpublished since Dec 2024

DoD: `R1#7` — 100% of state-changing endpoints audited, asserted by test.

---

## M9 — P6 Reporting

- Night audit job: post room charges, roll the business date, write an immutable snapshot
- Snapshot tables: occupancy, ADR, RevPAR, revenue, room-status counts
- Report API: day / month / quarter / arbitrary range *(brief bullet 7)*
- Bklit dashboards in `apps/admin` — audit keyboard/screen-reader behaviour before committing (R2 §13 Q4)
- Evaluate channel-manager options for P8 — long lead time, start here

DoD: `R2#15` — night audit runs exactly once per business date, provable from
pg-boss history · `R3#12` — a missed audit pages within 30 min.

---

## M9.5 — P6.5 Overbooking · needs real no-show data

No-show rate model, overbooking limits per type/date, walk/relocation policy.

---

## M10 — P7 Hardening

Genuinely hardening only — retention, backups and the restore drill moved to
`G2`.

- Registration-record retention per the statutory floor *(needs `M0-05`)*
- Rate limiting, CORS, security headers, dependency and secret scan
- Load test the availability endpoint
- Paper-fallback runbook, written as though it will be used
- Evaluate 60 days of property uptime data against R3 §4; decide replica / no replica; **write the decision down** · `R3#14`

---

## M11 — P8 OTA channel manager · *deferred*

Evaluate during M9. The most expensive deferral in the project — new resorts
take most first-year bookings through OTAs, and manual inventory blocking is the
one double-booking source the database constraints cannot prevent.

---

## 9. Reconciliation log — what this file changed

Transcribing the three reports literally would re-introduce these. Recorded so
the question is not reopened.

| Superseded | Correct here | Source |
|---|---|---|
| pg-boss at P6 | **P3** (`P3-JOB`) | R1 §19 #1 |
| Retention, backups, restore drill, monitoring at P7 | **Before the trigger** — `G2`, lands at M7 | R1 §19 #3, R3 §3.5 |
| MoMo at P3 alongside VNPay | **Conditional M6.5** | R3 §5.1 |
| Ordinary e-invoice, batch issuance | **Máy tính tiền SKU + HSM, issued at folio close** | R3 §6 |
| CI Postgres service container | **Testcontainers** (`P0-CI-02`) | R1 §19 #7 |
| `<3 min` to *invoice* | `<3 min` to invoice **enqueued** | R1 §19 #4 |
| Auto-delete "verified by scheduled job" | **Lifecycle rule enforces, job verifies** | R1 §19 #6 |
| Three overlapping P0 checklists (R1 §15, R2 §10, R3 §10) | **One**, deduplicated, above | — |
| M0 "parallel, starts today" | **Per-item triggers** — `M0-02`/`M0-03` wait for M6, the free questions go now | R3 §10 assumed a scheduled opening; there is none |
| `P-1-01` closed by `b80e902` | **`f4fc9c1`** + `b138dfc` — `b80e902` is not in this history | `git log` |

## 10. Traceability — professor's 12 bullets

`R1#12` requires 12/12 before the coursework is claimed complete. **Issue** is
the story key that closes the bullet — filled the moment its milestone reaches
story depth, never afterwards. Three of twelve have one today; the other nine
are still at epic level by the depth rule, which is correct, not a gap.

| # | Brief bullet | Milestone / epic | Issue |
|---|---|---|---|
| 1 | RBAC ≥3 levels | `P0-AUTH` | `P0-AUTH-03` + `P0-AUTH-04` |
| 2 | Room types and attributes | `P1-SCH-01` | `P1-SCH-01` |
| 3 | Guest accounts | M7 | — epic |
| 4 | Post-stay feedback | M7 | — epic |
| 5 | Availability display | `P1-AVL-01` | `P1-AVL-01` |
| 6 | Search | `P2-SRC` | — epic, stories at M4 |
| 7 | Reports with charts | M9 | — epic |
| 8 | Shift handover | M8 | — epic |
| 9 | Audit log | M8 | — epic |
| 10 | Excel export | M8 | — epic |
| 11 | Income / expense | M8 | — epic |
| 12 | Online payment | `P3-PAY` | — epic. `P0-PAY-02` is sandbox; one **production** gateway closes this |

## 11. Unresolved

`D1`, `D3`, `D4`, `D7` and `D2a` graduated to
`docs/architecture/property-and-tariff.md` as ⚑ defaults. The staff-role owner
and P0 client boundary are also settled in `P0-C-03`/`P0-C-04`; they are not
open decisions.

`G1` is settled — `tech-stack.md` §"oRPC compile-time contract evidence"
records the verdict and its measured boundary.

1. `D2b` — VAT rate, reduced-rate applicability/window, and whether VAT applies
   to service charge. Accountant; `SCRUM-12` and `SCRUM-86`; **config from day
   one**.
2. `D2c` / `M0-05` — lawful offshore storage and statutory retention floor `N`.
   Lawyer; `SCRUM-13`; config.
3. `D8` — diagram notation. Professor; `SCRUM-16`; affects
   `P0-DOC-03`/`-04` only.
4. `D9` — extra-person/extra-bed stacking. Owner; `SCRUM-87`; blocks the
   affected M3 pricing acceptance work.
5. Carried from the reports: NĐ 70/2025 applicability (`M0-06`), VNPay refund
   sandbox access (`M0-04`), Bklit accessibility (M9), `exceljs` replacement
   (M8), channel manager (M11).
