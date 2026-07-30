# Advise — Resort Booking & Management System (Mariva)

- Date: 2026-07-26. **Amended 2026-07-26 14:29** — see §19 for what changed and why.
- Repo: `C:/Users/tamla/Downloads/khach-san` (authored on `chore/add-ci-workflow`, amended on `chore/web-react19-next16`)
- Input: professor's coursework brief (VN) + user intent to make it a complete real system
- Mode: advisory only. No code changed.
- Successors, both binding: `advise-260726-1119-stack-selection.md` (tools, contracts, versions), `advise-260726-1401-infra-money-rails.md` (hosting, payments, e-invoice). Where they name a specific tool or vendor, they win — this report owns the architecture, they own the parts list.

---

## 0. Scout findings

*State at authoring, 09:39. Superseded — recorded so the reasoning below is readable.*

- README said `resort-management`; `package.json` said `mariva-landing`. Mismatch.
- Actual content = luxury-resort **marketing landing page**. Next.js 14 App Router, single route `app/page.tsx`.
- 6 scrollytelling "acts": Three.js + `@react-three/fiber` + GSAP + Lenis + Zustand.
- **Zero backend**: no API routes, no DB, no auth, no ORM, no server actions.
- 307 tracked files, mostly components + WebP + Playwright capture scripts.
- CI (`.github/workflows/ci.yml`) = lint + build only. No tests.
- Conclusion: repo and brief share only the domain word "hotel".

**Current state, verified 14:29:** monorepo landed — `apps/{web,api,admin}`, `packages/{shared,api-client}`, pnpm 11.1.2 + Turborepo 2.10.7. Root `package.json` is `mariva`; README rewritten and accurate. Only `apps/web` (`@mariva/web`) and `packages/shared` (zod 4.4.3) carry code; the rest are reserved boundaries. CI reads `.nvmrc` and runs lint + typecheck + build — still no tests. `apps/web` is mid-migration to React 19 + Next 16 behind a committed Playwright visual baseline.

---

## 1. Interview outcomes (user decisions, binding)

| # | Question | Decision |
|---|---|---|
| 1 | Real goal | **Real property will use it.** Correctness on money/bookings > rubric |
| 2 | Property status | **Not open yet / planned.** Mariva landing = its marketing front |
| 3 | Build vs buy | **Build everything custom.** No rented PMS |
| 4 | Capacity | **Solo, long runway** (6–12+ mo). Not a semester. Resort opening = real deadline |
| 5 | Stack | **NestJS API + Postgres + Next.js frontends**, monorepo, shared TS types |
| 6 | Payments | **VNPay/MoMo, business entity exists.** Real gateway, real refunds |
| 7 | Guest ID data | **Store scans, encrypted + expiring** (private storage, signed URLs, audit log, auto-delete) |

Follow-ups (round 2):

| # | Question | Decision |
|---|---|---|
| 8 | Scale/optimization appetite | **Ambitious — wants hard problems + learning** |
| 9 | Admin UX | **Keyboard-driven admin** confirmed |
| 10 | Booking URL | **`/booking` on same domain** as marketing site |
| 11 | ID retention | 30d accepted, **reason required** (see §7) |
| 12 | Academic deliverables | **Required** — report, ERD, use-case diagrams |

---

## 2. Problem (reframed, confirmed by user)

Building operational software for a **real resort not yet open**, using the professor's brief as starting checklist. Brief is a database-course exercise: every bullet is a table + a report. Missing the load-bearing concern — **selling finite, perishable, date-indexed inventory without ever selling it twice**.

"Complete system" = professor's 12 bullets **plus** the operational core that makes it survivable for a property taking real money.

---

## 3. Requirements

### A. From the brief (restated verifiably)

1. **RBAC ≥3 levels.** Proposed 6: `GUEST`, `RECEPTIONIST`, `HOUSEKEEPING`, `ACCOUNTANT`, `MANAGER`, `ADMIN`. Every route guarded; matrix documented + tested.
2. **Room types & attributes.** Type (Standard/Deluxe/Suite/VIP) with bed config, area m², view/direction, balcony, amenities (AC, fridge, minibar), max occupancy, photos. Rooms belong to a type; carry floor + number.
3. **Guest accounts.** Register/login, profile, stored ID data, VIP tier, loyalty points, own stay history.
4. **Feedback** post-stay, tied to a completed booking.
5. **Availability display** — free/sold-out per date range, public + front desk.
6. **Search** by room number, type, status, date range, guest name/phone.
7. **Reports with charts** — revenue + room status by day/month/quarter/arbitrary range.
8. **Shift handover** incl. service charges raised during shift (laundry, F&B).
9. **Audit log** — every booking change, cancellation w/ reason, invoice edit/void. Who, when, before→after.
10. **Excel export** of booking management data.
11. **Income/expense** (thu chi).
12. **Online payment**, real merchant account. **VNPay at P3; MoMo conditional at P3.5**, gated on measured abandonment at a VNPay-only payment step. Both sit behind one `PaymentGateway` port. The brief's bullet is satisfied by one production gateway — MoMo may never ship and the bullet still closes.

### B. Missing — added for real-property survivability

13. **Availability engine.** Date-range inventory per type, concurrency-safe holds, double-booking structurally impossible (DB constraint, not app check). *Hardest part; brief omits it.*
14. **Rate plans & seasonality.** Base rate per type per date; weekend/holiday/season overrides; min-stay; cancellation policies (refundable / non-refundable / deadline). Brief's "giảm giá, khuyến mãi" is a thin slice.
15. **Booking lifecycle state machine.** `HELD → CONFIRMED → CHECKED_IN → CHECKED_OUT` + `CANCELLED`, `NO_SHOW`; ops: room move, extend stay, early checkout. Illegal transitions rejected.
16. **Housekeeping status.** `CLEAN / DIRTY / INSPECTED / OUT_OF_ORDER`, orthogonal to occupancy. Checked-out ≠ sellable until inspected.
17. **Folio / billing.** Per-booking ledger: room-nights + services + taxes; VAT + service charge as separate lines; deposits, refunds. Invoice void = reversing entry, never delete.
18. **Hóa đơn điện tử khởi tạo từ máy tính tiền.** Not ordinary e-invoice — **Nghị định 70/2025/NĐ-CP** (eff. 01/06/2025) names khách sạn among businesses that must create, sign and transmit the invoice to the tax authority **at the point of sale**. Your checkout screen *is* the máy tính tiền. Requires an HSM / remote-signing certificate, never a USB token. Procurement, not code — start it now. Detail: report 3 §6.
19. **Night audit / business date.** Nightly close: post room charges, roll business date, freeze daily snapshot. **Does not issue invoices** — see req 18.
20. **Hotel KPIs** — occupancy %, ADR, RevPAR. Not just gross revenue.
21. **Payment webhook idempotency + reconciliation.** Duplicate callbacks must not double-credit; daily reconciliation vs gateway settlements.
22. **Guest ID protection.** Private object storage, encrypted at rest, short-lived signed URLs, role-gated, access logged, auto-deleted (see §7).
23. **Transactional notifications.** Confirmation / cancellation / reminder email. Zalo ZNS optional later.

---

## 4. Goals / Non-goals / Constraints

### Goals (measurable)

- **G1** Zero double-bookings under concurrency — N parallel bookings on last room → exactly 1 success.
- **G2** Walk-in → check-in → post service → checkout → invoice in **<3 min**, keyboard only. Clock stops when the folio closes and the invoice job is enqueued — **not** when the e-invoice provider answers. Req 18 puts a third party on this path; the checkout must never block on it (§6.2).
- **G3** Financial integrity: Σ folio postings = Σ payments + outstanding, asserted every night.
- **G4** Every state-changing action reconstructible from audit log.
- **G5** Public booking flow works end-to-end vs gateway sandbox, then production.
- **G6** All 12 brief bullets map to a demonstrable screen/endpoint.

### Non-goals (explicit)

- Multi-property / chain. Single resort, no tenant abstraction.
- **OTA channel manager** — deferred to P8 (user decision; cost in §9).
- **Khai báo lưu trú / ASM police portal** integration — manual for now (user decision).
- Native mobile apps. Responsive web only.
- Standalone F&B POS. Services post to folios only.
- Dynamic pricing / revenue-management algorithms. Manual rate plans.

### Constraints (non-negotiable)

- **C1** Solo dev, long runway. Resort opening = real deadline.
- **C2** NestJS API + Postgres + Next.js frontends, monorepo, shared TS types. Refined by report 2: Drizzle, oRPC contract-first out of `packages/shared`, pg-boss for jobs, Vitest + Testcontainers.
- **C3** Existing `apps/web` (Three.js/GSAP marketing acts) must keep working — now guarded by a committed Playwright visual baseline, which is what makes the in-flight React 19 + Next 16 migration safe.
- **C4** Full custom, no rented PMS.
- **C5** Real VNPay/MoMo, entity exists.
- **C6** ID scans stored, encrypted, expiring.
- **C7** Professor's brief must be a satisfied subset.

---

## 5. Verdict

Brief is a **database exercise wearing a hotel costume**. Requirements 13–19 aren't extras, they're the load-bearing wall. Build the brief literally → demos beautifully, double-books in week one.

Constraints are favorable: long runway, one decision-maker, real property to design against, and Postgres can enforce the hardest invariant *structurally*. Solo single-property PMS over 6–12 months is achievable. Chain-grade is not — so the non-goals list does as much work as the goals list. Guard it.

Recorded disagreement, then dropped: I'd have rented a PMS and built only the direct-booking engine. User chose full custom; defensible given runway + learning value. Cost in §9.

---

## 6. Core design decisions

### 6.1 Two-layer inventory — hotels sell *types*, not rooms

Guest books "a Deluxe for 3 nights". Specific room assigned at check-in. Assigning room 301 at booking time makes every room move, maintenance closure, and upgrade a manual crisis.

**Layer 1 — type-level per night (what you sell):**

```sql
create table room_type_inventory (
  stay_date    date not null,
  room_type_id uuid not null references room_type(id),
  total_rooms  int  not null,           -- physical count minus OOO
  sold_rooms   int  not null default 0,
  primary key (stay_date, room_type_id),
  constraint no_oversell check (sold_rooms <= total_rooms)
);
```

Booking = one txn incrementing `sold_rooms` for every night. The CHECK is the double-booking guarantee: concurrent bookings for the last room → one fails **at the database**. Row locks serialize; no app-level locking, no race window.

**Layer 2 — room-level at assignment (what you operate):**

```sql
create extension if not exists btree_gist;

alter table room_assignment add constraint room_never_double_occupied
  exclude using gist (
    room_id    with =,
    stay_range with &&          -- daterange, '[)' bounds
  ) where (status in ('ASSIGNED','CHECKED_IN'));
```

Overlapping occupancy becomes **impossible to represent**. Not checked-for — impossible.

Write the concurrency test **before** the booking UI. 50 parallel requests at the last room → exactly 1 success, 49 clean 409s.

### 6.2 Five invariants to get right early

- **Dates are dates.** Stay boundaries = `date`. Events = `timestamptz`. Property pinned to `Asia/Ho_Chi_Minh`. Mixing = #1 source of off-by-one-night bugs. Report 2 makes this a **compile error** rather than a convention: `@internationalized/date` `CalendarDate` ≠ `ZonedDateTime` at the type level.
- **Money is integer VND (`bigint`).** No floats, no decimals. Tax/service charge as separate posting lines, never baked into totals. No money library — VND has no minor unit.
- **Folio is append-only.** "Sửa/xóa hóa đơn" = reversing entry + corrected entry. Never UPDATE/DELETE. Gives req 9 nearly free; makes G3 provable.
- **Booking status ⊥ housekeeping status.** Room can be `VACANT`+`DIRTY` (unsellable) or `OCCUPIED`+`CLEAN`. One enum for both is a classic trap.
- **Night audit is a job, not a report.** Nightly: post room charges, roll business date, write immutable snapshot. All reporting reads snapshots → fast, stable, reproducible. Req 7 collapses to simple queries.
- **The job runner arrives at P3, not P6.** pg-boss is first needed for e-invoice issuance at folio close and for acknowledging payment webhooks inside the gateway's deadline — both P3. The night audit is the *third* consumer, not the first. Sequencing correction: do not plan job infrastructure as a P6 concern.
- **Slow third parties never sit inside a request.** Folio close enqueues an idempotent job keyed on the folio id; the screen subscribes and shows the result. A provider timeout must never roll back a completed checkout, and the provider's invoice number — not yours — is the legal reference stored beside the folio.

### 6.3 Repo topology

```
apps/api            NestJS + Postgres         ← all business logic, single source of truth
apps/web            marketing acts + /booking route group
apps/admin          new Next.js, plain UI     ← front desk + management, no Three.js
packages/shared     zod schemas + oRPC contract + inferred TS types
packages/api-client oRPC client + TanStack Query hooks
packages/tokens     tokens.css + TS mirror    ← one definition of Mariva, both apps import
```

pnpm workspaces + Turborepo — both landed. `packages/shared` = highest ROI: schemas once → API validation + frontend types from one source. `packages/api-client` and `packages/tokens` were added by report 2; `api-client` exists as a reserved boundary, `tokens` does not exist yet.

---

## 7. ID data retention — the reasoning

**Split one thing into two.** The scan image and the registration record are different data classes with different retention drivers.

| Class | Contents | Driver | Retention |
|---|---|---|---|
| **ID scan image** | JPEG/PNG of CCCD/passport | Operational only — proving identity *was* verified | **30d post-checkout, hard delete** |
| **Registration record** | Name, DOB, nationality, CCCD number, stay dates | Statutory — lodging + accounting law | **Statutory minimum, years** |

Image carries nearly all breach liability, nearly none of the legal obligation. Fields carry the obligation, far less liability (encrypted + masked).

**Why 30d not 7d for the image** — the window insured against is *late-surfacing disputes*; 7d sits inside ordinary dispute latency:

- **Damage/theft claims** surface at deep clean or next-guest complaint — days to weeks.
- **Payment disputes** land after the card statement, up to a month. (Chargeback windows run ~120d, but the evidence there is folio + signed registration card, not the photo. First-response window still commonly weeks 2–4.)
- **Police / inspection requests** arrive on their own timetable.
- **Insurance claims** attach to incident reports filed weeks out.

Past ~30d the image's marginal operational value collapses (record fields answer later questions) while liability accrues linearly. 30 clears a full billing cycle + practical dispute tail; 7 does not.

**Defensible rule:** `retention = max(operational need, legal minimum)`, evaluated **per data class**, reason documented per class. Framework survives audit; a bare number doesn't.

**Must verify:** VN lodging law (Luật Cư trú + lodging-notification regs) and accounting-record retention set floors **not verified in this session**. Check official text / lawyer; statutory floor overrides 30 if higher. Make retention a **config value**, not a constant.

**Who enforces N** — settled by report 3 §3.3, and worth stating flatly because it is the kind of thing that silently ends up in two places:

- **Enforcement** is the R2 bucket lifecycle rule. Not a cron job you can forget to deploy.
- **Verification** is a scheduled job that asserts no object is older than N. It proves the rule works; it does not do the deleting.
- **N is declared once**, and changing it means changing the bucket rule. If the app also carries a retention constant, they will drift and the bucket wins silently. Keep the app's copy as a displayed value read from config, never as a second enforcement path.
- ID scans live in their **own bucket**, never beside room photos.

---

## 8. Recommendations

### 8.1 Do

- Two-layer inventory + DB constraints (§6.1) before anything else.
- The five invariants (§6.2) baked into schema from day one.
- Repo topology (§6.3) with `packages/shared` as the contract source.
- Seed realistic data early: 40 rooms, 5 types, 12 months of rates, 500 synthetic bookings.
- Deploy a hello-world API to production in P0, not later.
- Separate auth realms — guest token must never open `/admin`.

### 8.2 Don't

- **Don't reuse scrollytelling for the booking funnel.** Act-based Three.js/GSAP = right for seduction, poison for conversion.
- **Don't build the admin UI first.** Most visible, least informative.
- **Don't build a generic permission engine.** 6 roles, hardcoded matrix, `@Roles()` guard.
- **Don't microservice.** One Nest app, modules by domain (`inventory`, `booking`, `folio`, `payment`, `report`).
- **Don't event-source everything.** Ledger for money, audit table for changes. Enough.
- **Don't duplicate business logic into Next.js server actions.** Frontends call the API. One brain.
- **Don't soft-delete invoices.** Reverse them.
- **Don't build loyalty/VIP/feedback before bookings+folio+payments work.** Easiest features, zero operational contribution.
- **Don't hand-roll the availability calendar UI early.** Table of dates × types is fine for a year.
- **Don't self-host Postgres, object storage, or SMTP** while solo.

### 8.3 Efficiency wins (ranked, effort→impact)

| Instead of | Do | Saves |
|---|---|---|
| App-level availability locking | Postgres CHECK + EXCLUDE (§6.1) | Weeks of race bugs you'd never find in testing |
| Live aggregation for reports | Nightly snapshot tables | Query complexity + "why did last month change?" |
| Hand-rolled Excel writer | `exceljs`, streamed from a Nest controller — ⚠ unpublished since 2024-12; re-evaluate at P5 | Req 10 → an afternoon |
| Custom charts | Bklit (shadcn registry), copied in and restyled to tokens; Recharts is the fallback | Req 7's chart half |
| Hand-rolled guest auth | Better Auth (guest realm) + Passport-JWT (staff) | Days + classic session/reset bugs |
| Self-managed infra | Neon `ap-southeast-1`, Cloudflare R2, Resend, Fly.io `sin` | Ongoing ops tax |
| Building an e-invoice module | Licensed VN provider — **Viettel S-Invoice by default**, MISA meInvoice if the accountant uses MISA AMIS. Buy the *máy tính tiền* SKU | Months; not legally yours to build |
| Prisma fighting `daterange` | **Drizzle** — closed by report 2. Hand-edited SQL migrations keep `EXCLUDE`/`daterange` in version control | Friction exactly where correctness matters |
| Hand-rolled VNPay HMAC + param sorting | The maintained `vnpay` Node library | The signature bug everyone ships once |

---

## 9. Trade-offs (incl. cost of user decisions)

- **Full custom, no PMS** *(user decision)*: you own uptime for a business that loses money when down. No vendor support at 11pm on Tết. Budget for monitoring, alerting, and a documented **paper fallback** the front desk can run.
- **OTA sync deferred** *(user decision)*: the expensive one. New resorts get most first-year bookings via OTAs. Until P8, someone manually blocks inventory across Booking.com/Agoda/Traveloka — error-prone, and the classic source of real double-bookings your DB constraints **cannot** prevent because they happen outside your DB. Start P8 evaluation during P6; prefer a channel-manager service over direct OTA APIs.
- **Storing ID scans** *(user decision)*: highest-liability data in the system. Cheapest mitigation is aggressive retention (§7).
- **No ASM integration**: manual declaration workload + compliance gap. Reconsider before opening.
- **Solo ~9 months**: no review, no bus factor. Compensate with tests on money/inventory paths (not UI) + honest docs. Monitoring is no longer an open budget line — Better Stack's free tier covers uptime, heartbeats and error tracking at this scale (report 3 §3).
- **Deferring MoMo to P3.5** *(report 3's recommendation, narrowing your stated scope)*: if wallet-only guests are a meaningful share you launch with a gap. The counter is that the funnel data will show it, and MoMo drops behind the existing port in ~2 weeks whenever you decide.
- **Two-layer inventory is more complex** than assigning at booking time. Worth it, but P1 will feel slow.
- **Nightly snapshots** trade storage + one moving part for report stability. Correct at this scale.

---

## 10. Ambition track (user wants hard problems)

**Honest framing:** at 40–100 rooms the availability query path has **no bottleneck**. A year × 5 types = 1,825 rows. Optimizing it is theater and endangers the correctness core. But "ambitious" ≠ "premature optimization" — there are genuinely hard problems worth the runway.

### 10.1 Room-assignment optimization (P2.5) — the interesting one

Layer 1 says "3 Deluxes free tonight". But a badly packed assignment map **strands inventory**: three free rooms across three nights, yet no single room free for all three. This is **interval graph coloring / bin packing over time**.

Two features:

- **Optimal assignment** — assign rooms to maximize future sellable stays, honoring preferences (high floor, sea view, adjoining for families).
- **Assignment shuffle** — when a booking would be rejected, search for a re-assignment of *already-assigned, not-yet-checked-in* stays to free a contiguous room. Hotels do this manually daily. Automating it converts refused bookings into revenue.

Approach: greedy + best-fit-descending baseline → constraint solver or local search → benchmark against each other on the seeded dataset.
**Hard constraint: never move a guest who has checked in.**

### 10.2 Stay-restriction search (folded into P1/P2)

Real rate rules: min-stay, max-stay, closed-to-arrival, closed-to-departure. "Every valid arrival date in August for a 4-night Deluxe" under those constraints is a search problem, not a `WHERE` clause. Also what makes rate management usable.

### 10.3 Overbooking policy (P6.5)

Deliberately sell above 100% against a modeled no-show rate. Real revenue management; forces a walk/relocation policy. Only after P6 yields no-show data.

### 10.4 Discipline that makes ambition safe

- **Naive implementation stays in the codebase as reference oracle.** Every optimized path **differential tested** against it — random inventory states, assert equivalent-or-better. Best learning artifact in the project.
- **Property-based tests** (fast-check): no assignment map may ever contain an overlap; optimizer output never worse than greedy.
- **Benchmark before/after, publish numbers.** "p95 340ms → 22ms at 10k bookings, here's the flame graph" — not "I optimized it".
- **§6.1 constraints untouched.** Optimization may change *which* room is chosen — never *whether* overlap is possible.

Neither P2.5 nor P6.5 blocks the spine.

---

## 11. Keyboard-driven admin (architectural, not styling)

Build as shared primitives in **early P2**, before screens multiply. Retrofitting keyboard-first onto 20 mouse-first screens is a rewrite.

- **Command palette (`cmdk`) as primary navigation.** `Ctrl+K` → "checkin 301", "folio 4821", "arrivals today".
- **Global hotkeys** for the 5 dominant actions: new booking, check-in, check-out, post charge, search guest.
- **Check-in flow completes with zero mouse events** — assert via Playwright keyboard-only test (Playwright already in devDependencies).
- **Text date entry, not pickers.** `1408` → 14 Aug. Parse liberally, show interpretation inline.
- **Room number numeric-first** with digit autocomplete.
- **ID/passport scanners are keyboard wedges** (type + Enter). Forms must just work; don't build upload-only.
- **Explicit focus management** after every action (post charge → focus returns to amount). Getting this wrong makes fast UIs feel slow.
- **Optimistic UI with rollback** on posting screens.

---

## 12. `/booking` on the same domain

Right call: one origin, one cookie, no CORS for guest auth, no subdomain cookie scoping. Simpler where auth bugs live.

**Hard rule: `/booking` must never load Three.js, GSAP, or Lenis.** Route groups: `app/(marketing)/` keeps `LenisScrollProvider` + acts; `app/(booking)/` gets a plain layout, no shared WebGL providers. Verify with bundle analyzer; set a **CI budget** on `/booking` JS payload. A shared root-layout provider that drags `three` into every route silently makes the conversion path ~400kB heavier.

---

## 13. Academic deliverables — generate, don't draw

Cheapest win available, but only if set up in **P0**. Retrofitted = a miserable week.

| Deliverable | Source of truth | Tool |
|---|---|---|
| ERD | Live schema | `drizzle-dbml-generator` → `docs/erd.dbml` → dbdocs. Never hand-drawn |
| Use-case diagram | Role × feature permission matrix | Mermaid, generated from the same table `@Roles()` uses |
| Sequence diagrams | Booking hold→confirm, payment webhook, check-in, night audit | Mermaid `sequenceDiagram`, hand-written once (4–5 flows) |
| Class/module diagram | NestJS module graph | Mermaid, or generated from module imports |
| State machine diagram | Booking transition table | Mermaid `stateDiagram-v2`, generated from the table code enforces |
| Traceability table | 12 bullets → endpoint + screen + test | Markdown in `docs/`, kept current while building |

Two rules that make it pay:

- **CI job regenerates the ERD and fails if stale.** Drifted diagrams are worse than none — a professor will find the mismatch.
- **Everything in `docs/`, written as you go.** Report becomes assembly, not authorship.

Bonus: §10.4 differential tests + benchmarks give the report an **evaluation chapter** — measured results, not screenshots. Difference between passing and distinguished.

---

## 14. Route (phases)

Build the spine before the skin. Each phase ends demonstrable; a stall at any point still leaves a coherent system.

| Phase | Est. | Content |
|---|---|---|
| **P−1** Migration *(in flight)* | 1w | Visual baseline committed, drei removed, React 19, R3F 9, Next 15 → 16, `packages/tokens`, Biome. One variable per commit. Precedes `apps/api` so the API scaffolds on stable ground |
| **P0** Foundations | 2–3w | Monorepo, Postgres, auth + RBAC, `packages/shared` + oRPC contract, CI w/ tests, **docs/ERD pipeline**, hello-world API in prod, **infra provisioned**, **VNPay sandbox behind the `PaymentGateway` port** |
| **P1** Inventory & availability | 3–4w | Room types + attributes, rooms, rate plans + seasonality + stay restrictions, two-layer inventory, **50-way concurrency test green** |
| **P2** Booking lifecycle & front desk | 4w | State machine, room assignment, housekeeping board, search, **keyboard primitives**, first admin screens |
| **P2.5** Assignment optimizer | 2–3w | Greedy baseline → optimizer, shuffle-to-fit, differential tests vs oracle, published benchmarks |
| **P3** Folio, payments, invoicing | 3–4w | Posting ledger, VAT/service charge, **pg-boss**, VNPay + idempotent webhooks, refunds, **e-invoice at folio close**, reconciliation |
| **P3.5** MoMo *(conditional)* | ~2w | Only if VNPay-only abandonment proves material |
| **P4** Guest booking engine | 3w | `/booking` route group, search→select→pay→confirm, guest account, stay history, ID upload, feedback |
| **P5** Operations | 2–3w | Shift handover + cash reconciliation, service posting, thu chi, audit log viewer, Excel export |
| **P6** Reporting | 2–3w | Night audit job, snapshots, occupancy/ADR/RevPAR + revenue dashboards |
| **P6.5** Overbooking | 1–2w | No-show model, overbooking policy, walk/relocation flow |
| **P7** Hardening | 2–3w | Security audit, load test, runbook. **Retention, backups and the restore drill are no longer here** — see the trigger below |
| **P8** Deferred | — | OTA channel manager. Evaluate during P6 — long lead time, gates occupancy |

Running in parallel with everything, starting **now**: VNPay merchant onboarding, the HSM signing certificate, the e-invoice contract, and the lawyer's answer on offshore ID storage. All are weeks of someone else's process. They block nothing until they block everything.

### The trigger supersedes part of P7

Report 3 §3.5 defines the moment the system becomes real:

> **Trigger = the commit that switches VNPay from sandbox credentials to production credentials.**

Several items this report filed under P7 must be **done before that commit**, not after — the trigger lands around P4, when the system first takes real money. Moved out of P7:

- Weekly `pg_dump` → R2, and **one restore drill executed and timed**
- R2 ID-scan lifecycle rule, verified against a real object
- Uptime monitor on `/health` + heartbeat on the night audit, alerting to your phone
- Neon Free → Launch, Vercel Hobby → Pro

P7 keeps what is genuinely hardening: the security audit, the load test, and the paper-fallback runbook.

At **P4** the system can take a real booking — and by then the trigger checklist must be green. All 12 brief bullets covered by **P6** — the coursework deliverable arrives naturally, without ever optimizing for the rubric.

---

## 15. Work checklist

### Paperwork — starts immediately, runs beside every phase
- [ ] VNPay merchant onboarding; **request refund sandbox access in the same application** (refund is restricted in sandbox by default — discovering that at P3 costs a fortnight)
- [ ] Buy **chữ ký số HSM / ký số từ xa** — explicitly *not* a USB token
- [ ] Buy the **hóa đơn điện tử khởi tạo từ máy tính tiền** product (Viettel S-Invoice unless the accountant uses MISA AMIS)
- [ ] Tax agent: confirm Nghị định 70/2025 binds this entity's activity codes
- [ ] Lawyer: offshore storage of CCCD scans + the statutory retention floor (closes §18 Q2)

### P0 — Foundations
- [x] pnpm workspaces + Turborepo: `apps/api`, `apps/web`, `apps/admin`, `packages/shared`
- [x] Fix `package.json` name + `README.md` to match reality
- [ ] Provision Neon (`aws-ap-southeast-1`, prod + staging branches, spend alert), Fly.io `sin`, Vercel, **two** R2 buckets (assets / id-scans), Resend with SPF+DKIM+DMARC; secrets via env, never committed
- [ ] NestJS 11 + Express 5 skeleton; **Drizzle** + `pg`, one pool shared with pg-boss; `btree_gist` enabled by migration
- [ ] `packages/shared`: zod schemas + `@orpc/contract` router as single contract source
- [ ] Auth: staff realm (Passport-JWT) + guest realm (Better Auth), strictly separate
- [ ] `@Roles()` guard + documented 6-role matrix + test asserting each role's allowed/denied routes
- [ ] Extend `.github/workflows/ci.yml`: `pnpm test` with **Testcontainers** (Docker in CI), not a service container — local and CI must boot the same Postgres
- [ ] Docs pipeline: `drizzle-dbml-generator` ERD + CI staleness check; `@orpc/openapi`; `docs/` skeleton
- [ ] VNPay **sandbox** behind the `PaymentGateway` port; IPN idempotency test replaying one callback 10×
- [ ] Deploy hello-world API to production

### P1 — Inventory & availability
- [ ] Schema: `room_type` (m², view, balcony, beds, amenities, max occupancy, photos)
- [ ] Schema: `room` (number, floor, type, housekeeping status)
- [ ] Schema: `rate_plan`, `rate_calendar` (per type per date), min-stay, cancellation policy
- [ ] Stay restrictions: min/max-stay, closed-to-arrival, closed-to-departure
- [ ] Promotions/discounts as rate modifiers (brief's "giảm giá, khuyến mãi")
- [ ] `room_type_inventory` with `sold_rooms <= total_rooms` CHECK
- [ ] `room_assignment` with `EXCLUDE USING gist` overlap constraint
- [ ] Availability query API: date range → types available + price
- [ ] **Concurrency test: 50 parallel bookings on last room → exactly 1 success**
- [ ] Seed: 40 rooms, 5 types, 12 months rates, 500 synthetic bookings

### P2 — Booking lifecycle & front desk
- [ ] Booking state machine + illegal-transition rejection tests
- [ ] Hold with TTL (expire abandoned carts, release inventory)
- [ ] Check-in w/ room assignment; room move; extend stay; early checkout; no-show
- [ ] Cancellation with reason code + policy-driven refund calculation
- [ ] Housekeeping board `CLEAN/DIRTY/INSPECTED/OUT_OF_ORDER`; OOO reduces `total_rooms`
- [ ] Search: room number, type, status, date range, guest name/phone
- [ ] Keyboard primitives: `cmdk` palette, global hotkeys, focus management, text date parsing
- [ ] Playwright keyboard-only check-in E2E

### P2.5 — Assignment optimizer
- [ ] Greedy / best-fit-descending baseline
- [ ] Optimizer (constraint solver or local search); never moves checked-in guests
- [ ] Shuffle-to-fit on would-be-rejected bookings
- [ ] Differential tests vs naive oracle on random states
- [ ] Property tests: no overlap ever; optimizer ≥ greedy
- [ ] Benchmark report with before/after numbers

### P3 — Folio, payments, invoicing
- [ ] Posting ledger (`bigint` VND): charge / payment / refund / reversal
- [ ] Tax + service charge as separate posting lines
- [ ] Service catalog (laundry, F&B, minibar) posting to folios
- [ ] pg-boss installed and running — first needed here, not at P6
- [ ] VNPay production terminal, IPN URL separate from staging; **unique constraint on gateway txn id**; signature verification via the `vnpay` library
- [ ] Refund flow with reversing entries, tested against whatever sandbox access VNPay granted
- [ ] Invoice void = reversal, never delete; *hóa đơn điều chỉnh / thay thế* maps onto the same reversal entries
- [ ] E-invoice issuance as an **idempotent pg-boss job keyed on folio id**, triggered at folio close; provider's invoice number stored beside the folio and used as the legal reference on reports
- [ ] Daily gateway reconciliation view; discrepancy alerts to phone

### P4 — Guest booking engine
- [ ] `app/(booking)/` route group — no Three.js/GSAP/Lenis; CI bundle budget
- [ ] Search → type selection → guest details → payment → confirmation
- [ ] Guest register/login, profile, stay history, VIP tier, loyalty points
- [ ] ID upload to private storage
- [ ] Post-stay feedback tied to completed booking
- [ ] Transactional emails: confirmation, cancellation, pre-arrival reminder

### P5 — Operations
- [ ] Shift open/close with cash drawer count + variance
- [ ] Handover notes + pending-items list
- [ ] Income/expense (thu chi) with categories
- [ ] Audit interceptor: actor / action / before→after; DB trigger backstop
- [ ] Audit log viewer with filters
- [ ] Excel export via `exceljs`, streamed

### P6 — Reporting
- [ ] Night audit job: post room charges, roll business date, write snapshot
- [ ] Snapshot tables: occupancy, ADR, RevPAR, revenue, room-status counts
- [ ] Report API: day / month / quarter / arbitrary range
- [ ] Recharts dashboards in `apps/admin`

### P6.5 — Overbooking
- [ ] No-show rate model from historical data
- [ ] Overbooking limits per type/date
- [ ] Walk/relocation policy + workflow

### Before the trigger — pulled out of P7
- [ ] ID scans: SSE, short-TTL signed URLs issued after the role check, issuance audit-logged, expiry by **R2 lifecycle rule** verified on a real object
- [ ] Weekly `pg_dump` → R2, encrypted, 8-week lifecycle — one copy outside the vendor
- [ ] **Restore drill executed and timed** against a scratch branch
- [ ] Uptime monitor on `/health`; heartbeat monitor the night audit checks into; both page your phone
- [ ] Neon Free → Launch; Vercel Hobby → Pro (a booking site is commercial use)

### P7 — Hardening
- [ ] Registration-record retention per statutory floor (verify first)
- [ ] Rate limiting, CORS, security headers, dependency + secret scan
- [ ] Load test availability endpoint
- [ ] Paper-fallback runbook for the front desk, written as though it will be used
- [ ] Evaluate 60 days of property uptime data against report 3 §4; decide replica / no replica; **write the decision down**

### P8 — Deferred
- [ ] Evaluate channel-manager options; design inventory-push interface

---

## 16. Success metrics

| # | Metric | Target |
|---|---|---|
| 1 | Concurrency test: N parallel bookings, last room | Exactly **1** success, N−1 clean 409s, **0** oversells. In CI |
| 2 | Production oversell count | **0**, monitored; `sold_rooms > total_rooms` unreachable |
| 3 | Night-audit integrity (Σ postings = Σ payments + outstanding) | **100%** of nights; failure pages you |
| 4 | Walk-in → check-in → post service → checkout → invoice enqueued | **<3 min**, stopwatch-timed by someone who isn't you. Provider round-trip excluded — it is not on the guest's path |
| 5 | Availability search p95 (12-mo calendar, 40 rooms) | **<300 ms** |
| 6 | Payment webhook replayed 10× | **1** payment posted |
| 7 | Audit coverage of state-changing endpoints | **100%**, asserted by test |
| 8 | Coverage on `inventory` + `folio` + `pricing` | **≥85%** (UI coverage explicitly not a target) |
| 9 | E2E booking vs gateway sandbox → production | Green in CI; **1** successful real prod transaction before opening |
| 10 | Restore drill | Full restore **<1 hour**, verified, documented — **before the first real booking**, not at P7 |
| 11 | ID-scan retention | **0** scans older than N days post-checkout. **Enforced** by the R2 lifecycle rule, **verified** by a scheduled job. One bucket, one code path |
| 12 | Brief bullets → demonstrable screen/endpoint | **12/12**, mapped in traceability table |
| 13 | `/booking` route JS payload | Under CI budget; **0** bytes of `three`/`gsap`/`lenis` |
| 14 | Optimizer vs greedy | Never worse; improvement quantified on seeded dataset |
| 15 | Keyboard-only check-in E2E | Passes; **0** mouse events |
| 16 | ERD staleness check | Green on every CI run |
| 17 | E-invoice coverage | **100%** of closed folios carry a provider invoice number; failures retried and alerted, never silently dropped |
| 18 | E-invoice signing | **0** manual dongle steps anywhere in the checkout path |

---

## 17. Evidence separation

- **Verified 09:39**: repo state — file tree, `package.json`, `.github/workflows/ci.yml`, `README.md`, absence of any backend surface.
- **Verified 14:29 (amendment)**: monorepo layout, root `package.json` name `mariva`, rewritten `README.md`, `apps/web` dependency set, `packages/shared` at zod 4.4.3, CI steps, `.nvmrc`, `plans/260726-p0-foundations/plan.md` phase table.
- **High confidence, standard practice**: Postgres `CHECK` / `EXCLUDE USING gist` patterns; ledger/reversal accounting model; night-audit + snapshot reporting; webhook idempotency via unique constraint.
- **Since verified by report 3** — no longer belief: **Nghị định 70/2025/NĐ-CP** and its máy-tính-tiền obligation (this supersedes the reference to Nghị định 123/2020 above); VNPay sandbox surface, IPN duplication, and the sandbox refund restriction; MoMo's 15-second IPN deadline; HSM remote signing as the precondition for automated issuance; the named e-invoice providers and their developer surfaces.
- **Still belief, NOT verified**: whether Nghị định 70/2025 binds *this entity's* activity codes; VNPay's onboarding document list and review timeline; khai báo lưu trú / ASM portal obligations; statutory retention floors; data-residency rules for CCCD scans held offshore. **Confirm each against current official sources before building against them.**

---

## 18. Unresolved questions

1. Room count + type mix at opening — drives whether Layer-1 inventory needs any optimization (under ~100 rooms: no). **Open.**
2. Statutory retention floor for ID scan image vs registration record — blocks finalizing §7's N. **Open; assigned to the lawyer, alongside the offshore-storage question.**
3. E-invoice provider — **narrowed, not closed.** Decision rule: ask the accountant; if they work in MISA AMIS take meInvoice, otherwise Viettel S-Invoice. The real blocking purchase is the **HSM certificate and the máy-tính-tiền SKU**, not the brand.
4. Channel-manager vs direct OTA APIs for P8 — evaluate during P6; long lead time. **Open.**
5. Whether the professor requires a specific diagram notation (UML strict vs Mermaid-generated) — affects §13 tooling. **Open.**
6. ~~Monitoring/alerting budget~~ — **closed.** Better Stack free tier: uptime, heartbeats, 100k exceptions/mo. Effectively $0 at this scale.
7. **New:** does `@orpc/nest` enforce the contract at compile time? If not, oRPC loses its advantage over Nest+Swagger and §6.3's contract story reopens. A 30-minute spike gates P0 phase 03.
8. **New:** `.nvmrc` pins Node **20**, which reached end-of-life in April 2026 — before this project's first line of API code. Report 2 called for an even LTS and named 24.x. Verify the current LTS line at `nodejs.org/en/about/previous-releases` and repin `.nvmrc`, `engines`, and the CI matrix together, during the in-flight migration rather than after `apps/api` exists.

---

## 19. Amendment log — 2026-07-26 14:29

Reconciled against reports 2 and 3 and against live repo state. **The architecture held.** Nothing in §6 (two-layer inventory, the five invariants, DB-enforced impossibility of overlap) needed reversing — every correction below is a part number, a sequence, or a fact that moved underneath a claim.

### Corrections that change what you do

| # | Section | Was | Now | Why it matters |
|---|---|---|---|---|
| 1 | §6.2, §14 | Job infrastructure implied at P6, with the night audit as its first user | **pg-boss at P3** | E-invoice issuance and webhook ACK both need a queue at P3. Planning it for P6 means building it under pressure inside the money phase |
| 2 | §3, §6.2, §14 | E-invoice as a P3 integration, unspecified timing | **Point-of-sale issuance**, NĐ 70/2025 | Ordinary HĐĐT is the wrong product. The checkout screen becomes the máy tính tiền, and the certificate must be HSM — both decided at purchase, months before the code |
| 3 | §14, §15 | Retention, backups, restore drill, monitoring at P7 | **Before the VNPay production-credential commit** | P7 sits after the system takes real money. Backups you have not restored are not backups, and finding that out after the first booking is the wrong order |
| 4 | §4 G2, §16 #4 | `<3 min` to *invoice* | `<3 min` to invoice **enqueued** | A third party joined that path. Left unstated, the metric either fails for reasons outside your control or pressures you into a synchronous call at checkout |
| 5 | §3 #12, §14 | VNPay **and** MoMo at P3 | VNPay P3, **MoMo conditional P3.5** | Two signature schemes, two IPN shapes, two reconciliation jobs. The brief's bullet closes on one gateway |
| 6 | §7, §16 #11 | Auto-delete "verified by scheduled job" | **Lifecycle rule enforces, job verifies** | The original wording lets a cron become the only thing between you and a retention breach |
| 7 | §15 P0 | CI Postgres **service container** | **Testcontainers** | Report 2 chose it for local/CI parity. Two mechanisms is drift; `plans/260726-p0-foundations/plan.md` phase 04 still says service container and needs the same edit |
| 8 | §18 | — | **Node 20 is EOL** | `.nvmrc` pins it today. Cheapest to fix inside the migration already in flight |

### Parts filled in

Drizzle (was "Drizzle or Prisma"); oRPC contract-first; `@internationalized/date` turning the date invariant into a type error; Bklit for charts; `drizzle-dbml-generator` for the ERD; Neon / Fly / Vercel / R2 / Resend / Better Stack; Viettel S-Invoice by default; the `vnpay` library instead of hand-rolled HMAC. Repo topology gained `packages/api-client` and `packages/tokens`.

### Closed

§18 Q6 (monitoring budget → Better Stack free). P0 checklist items 1 and 2 (workspace layout, `package.json` name, README) — done and verified.

### Deliberately unchanged

§6.1 inventory design, §6.2 invariants, §10 ambition track, §11 keyboard architecture, §12 `/booking` isolation, and every non-goal in §4. The OTA deferral in §9 remains the most expensive decision in this document and is still the right one to revisit first.
