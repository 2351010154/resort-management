---
title: Work orders — the delegation menu
created: 2026-07-26
---

# Work orders — pick one, hand it over

**This is a menu, not a plan.** Every order below is a unit of work sized for one
handoff: independently pickable, with its file ownership stated so two agents
never edit the same file.

It carries **no status**. Jira project `SCRUM` owns execution state, assignment,
priority, sprint, dependencies, and readiness. What this file carries is
*packaging*: which stable backlog keys travel together, their file boundaries,
and what may run in parallel. Confirm the selected work order against its Jira
issue before handing it off.

---

## 1. Pick by what you want today

| If you want… | Take |
|---|---|
| The most valuable thing in the project | **WO-06** — the correctness core. Nothing else matters as much |
| Cheap, visible, low-risk | **WO-02** or **WO-04** |
| To stop being the bottleneck | **§4** — human-only questions, accounts, and sign-offs |
| To unblock the most downstream work | **WO-01** then **WO-05**. Contracts gate every screen; a deploy target gates production |
| Two agents running at once | Any pair marked *disjoint* in §5 |
| To feel the system working end to end | **WO-05** + **§4 provisioning** — a real URL answering `/health` |

---

## 2. Work packages

Each order lists what it delivers, the backlog keys it covers, the files it
**owns** (an agent may edit these and nothing else), and its size. Jira decides
whether it is ready to start. `S` = an afternoon · `M` = one to two days · `L`
= split it before handing it over.

### WO-01 · Contract layer — `packages/shared` → oRPC
`M` · covers `P0-C-03`, `P0-C-04` · Jira `SCRUM-20`

The primitive contracts are complete. The remaining boundary is the
`@orpc/contract` router, its `@orpc/nest` binding, and `@orpc/client` in
`packages/api-client`. This order moves `StaffRole` schema/type ownership to
`packages/shared` and updates API RBAC to import it. The capability matrix
itself remains API-owned.

Owns: `packages/shared/**`, `packages/api-client/**`,
`apps/api/src/common/orpc/**`, and the minimal API RBAC imports required to move
role ownership.

DoD comes with the keys. Add: a deliberate contract break must fail the build,
and the RBAC matrix tests remain green after the role import moves.

### WO-02 · Testcontainers, fast-check, and `pnpm test` in CI
`M` · covers `P0-CI-02`, `P0-CI-03`, `P0-CI-04` · Jira `SCRUM-21`

The repository test command must gate merges and database-backed tests must
bring their own Postgres through the same helper locally and in CI. They must
not depend on a manually provisioned `.env.test` database, and a cached Turbo
success must never substitute for the required runtime execution.

Owns: `.github/workflows/ci.yml`, `turbo.json`, `package.json`,
`apps/api/package.json`, `pnpm-lock.yaml`, `apps/api/vitest.config.ts`, and
`apps/api/test/**`.

Watch: `.withReuse()`, warm boot under 5s on Windows, a cache-bypassed
repository test run, and no CI-only service container.

### WO-04 · Biome covers `apps/api`
`S` · covers `P0-CI-05` · Jira `SCRUM-85`

The lint migration only covered `apps/web`; `biome.jsonc` still excludes the
API.

Owns: `biome.jsonc`, `apps/api/package.json`

### WO-05 · Dockerfile and deploy artifact for the API
`S`–`M` · unblocks `P0-API-07`

The agent-doable half of the deploy. A Dockerfile that builds the ESM Nest app,
a `fly.toml`, and a documented `node dist/main.js` boot against a
`DATABASE_URL`. **Creating the Fly app and setting secrets is yours** (§4) — but
none of that has to happen before the artifact exists.

Owns: `apps/api/Dockerfile`, `apps/api/fly.toml`, `apps/api/README.md`

### WO-06 · The correctness core — schema and two-layer inventory
`L` · **split before handing over** · closes `P1-SCH-*`, `P1-INV-*`

The load-bearing wall. Hand it over in this order, one agent at a time, because
every part writes to `database/schema/`:

- **WO-06a** `P1-SCH-01` … `P1-SCH-05` — `room_type`, `room`, `rate_plan`,
  `rate_calendar`, stay restrictions, promotions as rate modifiers. `M`
- **WO-06b** `P1-INV-01` … `P1-INV-04` — `room_type_inventory` with the
  oversell `CHECK`, `room_assignment` with the `EXCLUDE USING gist` overlap
  constraint, all nights in one transaction, out-of-order closure. `M`
- **WO-06c** `P1-INV-05` — **50 parallel bookings on the last room → exactly 1
  success, 49 clean 409s, in CI.** `S`, and the whole point of the other two

Owns: `apps/api/src/database/schema/**`, `apps/api/src/database/migrations/**`,
`apps/api/src/modules/inventory/**`, `apps/api/src/modules/pricing/**`

Hand **06c's acceptance criteria to 06b's agent up front.** A constraint written
without the test that attacks it is a constraint nobody has checked. WO-02
should land first so the test can run in CI rather than only on your machine.

### WO-07 · Availability query and stay-restriction search
`M` · closes `P1-AVL-01` … `P1-AVL-03` · **needs WO-06a + WO-06b**

Date range → available types + price, p95 under 300ms over a 12-month calendar.
Plus the search that makes rate rules usable: valid arrival dates for an N-night
stay under min-stay, max-stay, closed-to-arrival, closed-to-departure.

Owns: `apps/api/src/modules/inventory/**` (read paths), `packages/shared/**`

### WO-08 · Seed data
`S` · closes `P1-SEED-01` · **needs WO-06a**

40 rooms, 5 types, 12 months of rates, 500 synthetic bookings, `@faker-js/faker`
`vi` locale, reproducible from one command. Room count and type mix must match
`property-and-tariff.md` §1 exactly.

Owns: `apps/api/src/database/seed/**`

### WO-09 · ERD and OpenAPI generators
`M` · closes `P0-DOC-01`, `P0-DOC-02` · Jira `SCRUM-89`, `SCRUM-90` · best **after WO-06a**

`drizzle-dbml-generator` → `docs/erd.dbml`, with **CI failing on drift**;
`@orpc/openapi` → `docs/openapi.json` served via Scalar. Worth more once real
tables exist, but the drift check can be wired against the auth tables today.
Deletes a hand-drawn figure in `docs/bao-cao/hinh/` the day it lands.

Owns: `docs/erd.dbml`, `docs/openapi.json`, `.github/workflows/ci.yml`, generator scripts
Conflicts with WO-02 on the workflow file.

### WO-10 · Accessibility findings in the arrival
`S` · covers `P0-CI-06` · Jira `SCRUM-96`

Resolve the arrival correctness, accessibility, and style warnings reported by
the repository lint command without weakening or broadly suppressing the rules.

Owns: `apps/web/features/arrival/**`

### WO-11 · Payment port, sandbox only
`M` · closes `P0-PAY-01` … `P0-PAY-03` · Jira `SCRUM-92` … `SCRUM-94`

One `PaymentGateway` interface — `createPayment` / `verifyCallback` / `refund` /
`queryTransaction` — with no gateway type leaking past it. VNPay sandbox behind
it using the maintained `vnpay` library, never hand-rolled HMAC. Then the test
that replays one IPN callback ten times and asserts one payment posted.
The port and idempotency work do not wait for refund access. Real refund-path
verification is the separate `SCRUM-95`, blocked by `SCRUM-14`.

Owns: `apps/api/src/modules/payment/**`

---

## 3. Blocked, and by exactly what

| Work | Blocked by | Whose move |
|---|---|---|
| `P0-INF-01` … `P0-INF-07` provisioning | Accounts do not exist | **Yours** — §4 |
| `P0-API-07` deploy to production | `P0-INF-03` Fly app | Yours, after WO-05 |
| `P0-DOC-03`, `P0-DOC-04` diagram generators (`SCRUM-91`) | `D8` / `SCRUM-16` — strict UML or generated Mermaid? | **Professor**, one email |
| M6 e-invoice | `M0-01` provider and applicability (`SCRUM-12`), `M0-02` HSM, `M0-03` SKU | Yours, when M6 is in sight |
| M6 VAT totals | `D2b` / `SCRUM-12` + `SCRUM-86` — rate, window, and VAT-on-service-charge tax base | **Accountant** |
| M3 occupancy pricing | `D9` / `SCRUM-87` — extra-person and extra-bed stacking | **Owner** |
| M10 retention floor | `D2c` / `SCRUM-13` — lawful storage and statutory minimum `N` | **Lawyer** |
| `P0-PAY-REFUND` (`SCRUM-95`) | Refund-sandbox access (`SCRUM-14`) | VNPay / owner follow-up |
| `M0-07` property probe | ISP line not installed | Nobody — not yet possible |
| M6.5 MoMo | Abandonment data that does not exist | Nobody — measure first |
| M9.5 overbooking | No-show data that does not exist | Nobody — measure first |

---

## 4. Only you can do these — no agent can

These actions require a human identity, an external answer, or an account the
agent cannot hold. Jira owns their assignees and follow-up dates.

**Questions to other people** — zero cost, weeks of latency. Send, don't wait:

- [ ] Professor: strict UML, or generated Mermaid? (`D8`, `SCRUM-16`)
- [ ] Accountant: existing e-invoice provider? MISA AMIS? (`M0-01`, `SCRUM-12`)
- [ ] Accountant: VAT rate, reduced-rate applicability/end date, and whether VAT applies to service charge (`D2b`, `SCRUM-12`, `SCRUM-86`)
- [ ] Lawyer: may CCCD scans live offshore, and what is the retention floor? (`D2c`, `M0-05`, `SCRUM-13`)
- [ ] Tax agent: does Nghị định 70/2025 bind this entity's activity codes? (`M0-06`, `SCRUM-12`)
- [ ] Owner: when is an extra bed mandatory, and does its service line stack with the extra-person charge? (`D9`, `SCRUM-87`)
- [ ] VNPay: start merchant onboarding, **and request refund sandbox access in the same application** (`M0-04`, `SCRUM-14`)

**Accounts, cards and secrets** — an agent can write every config file, but it
cannot hold an identity or a payment method. Pair each with the WO that prepares it:

- [ ] Neon project, `aws-ap-southeast-1`, prod + staging branches, spend alert (`P0-INF-01`)
- [ ] Fly.io app in `sin` + `fly secrets` (`P0-INF-03`, pairs with **WO-05**)
- [ ] Vercel project, function region `sin1` (`P0-INF-04`)
- [ ] Two R2 buckets — assets and id-scans, private, lifecycle rule (`P0-INF-05`)
- [ ] Resend domain with SPF, DKIM, DMARC (`P0-INF-06`) — until this, guest verification mail only reaches the log
- [ ] Better Stack uptime + error tracking (`P0-INF-07`)
- [ ] VNPay sandbox account (gates **WO-11**)

**Sign-offs nobody will chase you for.** Every ⚑ in
`property-and-tariff.md`, `rbac-matrix.md` and `booking-state-machine.md` is your
own assumption written down so it stopped being a blocker. Review the marked
rows in those authority documents; code may rely on them before sign-off.

---

## 5. What may run in parallel

Two agents in one working tree have already collided once, over who owned the
token package. It cost a day of parked work. So: **file ownership decides
parallelism, nothing else.**

| Pair | Verdict |
|---|---|
| WO-01 + WO-02 | Disjoint — safe |
| WO-01 + WO-10 | Disjoint — safe |
| WO-02 + WO-10 | Disjoint — safe |
| WO-05 + anything except WO-04 | Disjoint — safe |
| WO-02 + WO-09 | **Collide** on `.github/workflows/ci.yml` |
| WO-06a + WO-06b + WO-06c | **Serial** — all write `database/schema/` |
| WO-07, WO-08 + WO-06 | **Serial after** WO-06a |
| Anything + `apps/api/src/database/schema/**` | One writer at a time, always |

Rule of thumb: **at most two agents, and never two inside `apps/api`.**

---

## 6. What every handoff must carry

Paste these into any order you delegate — they are the standing constraints, and
an agent that has not been told them will violate them politely.

- **Working directory** `C:/Users/tamla/Downloads/khach-san` · Windows, pnpm
  11.1.2, Turborepo, Node 24 · PowerShell primary, Bash available
- **Read first:** `docs/orientation.md`, then `docs/README.md` for which document
  owns which fact, then the specific `docs/architecture/` file for the domain
- **Files it may modify:** the *Owns* line, and nothing outside it
- **Acceptance criteria:** the DoD from the backlog keys, quoted verbatim
- **Precedence:** `docs/` wins for design facts; change the document *before* the
  implementation, never after
- **Jira project `SCRUM` is the execution authority.** Update the issue there
  with status, evidence, blockers, and dependencies; do not add live state to
  the local backlog
- **Verify before claiming:** `pnpm typecheck` and `pnpm build` at minimum,
  `pnpm test` for anything touching the API
- **Commits:** conventional, focused, no AI references, no plan IDs or phase
  numbers in messages or test names — describe the behaviour
- **Report to** `plans/reports/{type}-{yymmdd-hhmm}-{slug}.md`, ending with
  `Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT`
- **Never** commit secrets, `.env` files, or ID scan fixtures

---

## 7. Before you pick

Check the current Jira issue and `git status` before handing work over. File
ownership in this document prevents planned overlap; it cannot reveal another
writer's uncommitted changes.
