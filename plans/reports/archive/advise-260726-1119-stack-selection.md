# Advise — Technology Selection (Mariva Resort PMS)

- Date: 2026-07-26
- Repo: `C:/Users/tamla/Downloads/khach-san` (branch `chore/add-ci-workflow`)
- Input: "what technologies (tools, assets) for this whole project"
- Predecessor: `advise-260726-0939-resort-pms.md` (architecture + phases). This report closes the *tool* decisions that one left open.
- Scope per user: **coding layer first** — structure, contracts, management. Hosting/vendors deliberately deferred to a later pass.
- Mode: advisory only. No code changed.

---

## 1. Verified current state

Changed since the 09:39 report — monorepo restructure landed.

| Surface | State |
|---|---|
| `apps/web` | Real. Three.js/GSAP/Lenis scrollytelling marketing site. Next 14.2, React 18.3 |
| `apps/web/app/(booking)` | **Exists, empty.** Route group reserved |
| `apps/api` | README only. Reserved shape, no `package.json` |
| `apps/admin` | README only. Reserved shape, no `package.json` |
| `packages/shared` | `zod ^4.4.3` only |
| `packages/api-client` | Empty `src/` |
| Toolchain | pnpm 11.1.2, Turborepo 2.10.7, TS 5.6.3, engines `node >=20` |
| Styling | **CSS Modules + CSS custom properties.** No Tailwind |
| Tokens | `apps/web/app/globals.css` — Mariva palette (Aman-sampled), 2 named eases, clamp type scale, spacing rhythm, reduced-motion kill-switch |
| Plan | `plans/260726-p0-foundations/` — phase 01 complete, 02–05 pending |

Design tokens are already good. They are the asset the whole design system should be built from, not re-derived.

---

## 2. Decisions locked this session

| # | Decision | Choice |
|---|---|---|
| 1 | Data layer | **Drizzle ORM** |
| 2 | API contract | **oRPC** (reversed from ts-rest — §4) |
| 3 | Test stack | **Vitest + Testcontainers** |
| 4 | Styling strategy | **Split, shared tokens** — web CSS Modules, admin Tailwind v4, one token file |
| 5 | Jobs/scheduling | **pg-boss** |
| 6 | Design sources | **Motion + React Bits + Bklit as sources to adapt**, not dependencies shipped as-is |

---

## 3. The stack

Versions verified against npm on 2026-07-26.

### 3.1 Runtime & workspace

| Concern | Pick | Version | Why |
|---|---|---|---|
| Runtime | **Node LTS (even line)** | pin 24.x | Local is **25.2.1 — odd-numbered Current line, never an LTS**. `engines: >=20` permits it. Pin `.nvmrc` + `engines` + CI matrix to one even LTS |
| Package manager | pnpm | 11.1.2 | Already set. `allowBuilds` discipline already correct |
| Task runner | Turborepo | 2.10.7 | Already set |
| Language | TypeScript | 5.6.3 | Already set. Raise to latest when Nest 11 lands |

### 3.2 API — `apps/api`

| Concern | Pick | Version | Why |
|---|---|---|---|
| Framework | NestJS | 11.1.x | Required by `@orpc/nest` (peers `>=11`) |
| HTTP adapter | Express | 5.2.x | `@orpc/nest` peers `express >=5`. Fastify 5 also supported; Express is the boring pick |
| ORM | drizzle-orm + drizzle-kit | 0.45.x | Migrations emit real `.sql` you hand-edit → `btree_gist` / `EXCLUDE` / `daterange` stay in version control |
| DB driver | **`pg` (node-postgres)** | 8.22.x | pg-boss uses `pg` internally. Same driver = **one pool**, not two |
| Contract | `@orpc/contract` | 1.14.10 | Contract-first, lives in `packages/shared` |
| Server binding | `@orpc/nest` | 1.14.10 | Implements the contract inside Nest, keeps DI/guards |
| Validation bridge | `@orpc/zod` | 1.14.10 | Peers `zod >=3.25` → **zod v4 stays** |
| OpenAPI | `@orpc/openapi` | 1.14.10 | Coursework API docs generated, not written |
| Jobs | pg-boss | 12.26.x | Queue inside Postgres. Transactional enqueue |
| Logging | pino + nestjs-pino | 4.6.x | Structured JSON, request-scoped, fast |
| Config | zod schema parsed at boot | — | Fail at startup, not at 2am |

### 3.3 Contracts — `packages/shared`

| Concern | Pick | Version | Why |
|---|---|---|---|
| Schema | zod | 4.4.x | Keep. oRPC unblocks it |
| Schema from tables | drizzle-zod | 0.8.3 | Peers `^3.25 \|\| ^4` — table → zod, no drift |
| **Dates** | **`@internationalized/date`** | 3.12.x | `CalendarDate` ≠ `ZonedDateTime` **at the type level** — makes the report's "#1 off-by-one-night bug" a compile error, not a test |
| Money | **no library** | — | `bigint` VND. `Intl.NumberFormat('vi-VN')` to display. VND has no minor unit; dinero.js buys nothing |
| Design tokens | `tokens.css` | — | Moves out of `apps/web/globals.css`. Single source both apps import |

### 3.4 Client — `packages/api-client`

| Concern | Pick | Version |
|---|---|---|
| Typed client | `@orpc/client` | 1.14.10 |
| React hooks | `@orpc/tanstack-query` | 1.14.10 |
| Cache/async | `@tanstack/react-query` | 5.101.x |

### 3.5 Admin console — `apps/admin`

| Concern | Pick | Version | Why |
|---|---|---|---|
| Framework | Next.js | match web | One version across repo |
| CSS | Tailwind | 4.3.x | v4 `@theme` reads CSS custom properties → **consumes Mariva tokens directly** |
| Primitives | shadcn/ui (Radix) | CLI | Copied in, so focus management is yours |
| Command palette | cmdk | 1.1.x | Ctrl+K. Same author as shadcn Command |
| Tables | `@tanstack/react-table` | 8.21.x | Headless. Dense arrivals/folio/housekeeping grids |
| Charts | **Bklit** | shadcn registry | 17+ chart types, copied in as source. Recharts is the fallback |
| Forms | react-hook-form + zod resolver | 7.83.x | Reuses `packages/shared` schemas |
| Motion | `motion` | 12.42.x | **Micro-interactions only** — see §5 |

### 3.6 Guest surfaces — `apps/web`

| Concern | Pick | Why |
|---|---|---|
| CSS | **CSS Modules, unchanged** | Zero risk to the six acts of scroll-tuned CSS |
| Motion | `motion` 12.42.x | For `/booking`. Acts keep GSAP — do not migrate working code |
| Component source | **React Bits (CSS variant)** | 4 variants incl. plain CSS. Copy-paste, adapt to Mariva tokens |
| Existing | three / @react-three/fiber / drei / gsap / lenis / zustand | **`(marketing)` only.** Never in `(booking)` |

### 3.7 Quality & delivery

| Concern | Pick | Version | Note |
|---|---|---|---|
| Test runner | Vitest | 4.1.x | One runner, whole repo |
| Real Postgres | `@testcontainers/postgresql` | 12.0.x | Needs Docker Desktop on Windows |
| Property tests | fast-check | 4.9.x | "No assignment map ever overlaps" |
| Seed data | `@faker-js/faker` | 10.5.x | `vi` locale for realistic VN guest names |
| E2E | Playwright | 1.61.x | **Already in devDeps.** Keyboard-only check-in test |
| Lint + format | Biome | 2.5.x | One tool, ~25× faster. Alternative: ESLint 9 flat + Prettier. Low blast radius, reversible in an afternoon |
| Git hooks | lefthook | 2.1.x | Single binary, faster than husky |
| ERD | `drizzle-dbml-generator` | 0.10.x | Schema → DBML → dbdocs. **CI fails on drift** |
| Diagrams | Mermaid | — | State machine, sequences, use-case — generated from the same tables code enforces |
| Excel | exceljs | 4.4.0 | ⚠ **Last published 2024-12-20.** Works, but stale. Re-evaluate `write-excel-file` at P5 |
| Folio print | Browser print stylesheet | — | Legal invoice comes from the e-invoice provider. Don't build a PDF engine |

### 3.8 Deferred to the infra pass

Hosting, Postgres host, object storage, email, e-invoice provider, payment gateway, monitoring. Auth libraries (Better Auth 1.6.x guest realm + Passport-JWT staff realm) already decided in the predecessor report and encoded in P0 phase 03 — not reopened.

---

## 4. Reversal: ts-rest → oRPC

Recorded honestly: **the user proposed oRPC and was right.**

Verified conflict that killed ts-rest:

- `@ts-rest/core@3.52.1` (latest) peers `zod: ^3.22.3` — **v3 only**
- `packages/shared` pins `zod ^4.4.3`
- `@ts-rest/core@3.53.0-rc.1` drops the zod peer (Standard Schema) — but **RC**, no controllable stable date

oRPC dissolves it on a stable release:

| Requirement | oRPC |
|---|---|
| zod v4 | ✅ `@orpc/zod` peers `>=3.25.0` |
| Contract-first | ✅ `@orpc/contract` |
| OpenAPI for coursework | ✅ `@orpc/openapi`, first-class |
| NestJS | ✅ official `@orpc/nest` |
| Webhook routes | ✅ verified: `os.route({ method:'POST', path:'/webhooks/vnpay' })`, `{id}` params, `.prefix()` |
| Admin hooks | ✅ `@orpc/tanstack-query` (ts-rest needed extra wiring) |
| Release status | ✅ stable 1.14.10 |

Cost: younger than ts-rest, smaller community. Both are small; oRPC is the one that doesn't force a bad trade.

**Must verify before committing (P0 phase 03):** `@orpc/nest` controller ergonomics — compile-time contract enforcement, guards/interceptors/DI interop. Docs pages 404'd on the URLs tried. **Spike it for 30 minutes first.**

---

## 5. Design system — how the three sources are used

User instruction: *keep our DESIGN pattern, adapt from these sources, build from scratch when nothing fits.* Encoded as:

```
packages/shared/src/tokens.css        <- SINGLE source of truth
  --ivory --ivory-warm --sand --stone --stone-deep --umber --ink
  --dusk-amber --ocean
  --ease-scene --ease-ui
  --text-* --tracking-caps --space-1..5
        |
        +-- apps/web    globals.css imports it -> CSS Modules (unchanged)
        |
        +-- apps/admin  @import 'tailwindcss'
                        @theme { --color-ink: var(--ink); ... }
                        -> shadcn / Bklit / cmdk speak Mariva by default
```

| Source | Use for | Not for |
|---|---|---|
| **Motion** 12.42 | `/booking` transitions, admin micro-interactions (toasts, dialogs, optimistic rollback) | Replacing GSAP in the six acts. Working code |
| **React Bits** (CSS variant) | `(marketing)` and `/booking` — text reveals, backgrounds. Copy in, restyle to tokens | Admin. It is landing-page material by its own description |
| **Bklit** (shadcn registry) | Admin dashboards — occupancy, ADR, RevPAR, revenue | — |

Adaptation rule: **copy in, then rewrite against tokens.** No component ships with its source palette. If nothing fits, build from scratch on the tokens — that is cheaper than bending a component that was never Mariva.

### The one caveat worth stating plainly

The front desk and the marketing site have opposite design goals. A receptionist runs check-in 40× a day: animation is latency they feel. Marketing animation exists to slow the eye down; console animation must never slow the hand down.

So: **same palette, same type scale, same spacing — different motion budget.** Admin gets Motion for state feedback (≤150ms, `--ease-ui`), never for entrance choreography. `prefers-reduced-motion` already has a global kill-switch in `globals.css`; carry it into `tokens.css` so admin inherits it.

This is a recommendation, not a veto. The design bar stays high in both places — it is expressed as density, typography and restraint in the console, and as choreography on the guest surfaces.

---

## 6. What NOT to use

- ❌ **Prisma** — cannot express `daterange`/`EXCLUDE`; type safety fails exactly at money and inventory.
- ❌ **tRPC** — you need real REST for gateway webhooks. Would mean two API layers.
- ❌ **Redis/BullMQ** — a whole service to run and back up, and enqueue can't join your DB transaction. pg-boss at 40 rooms, forever.
- ❌ **`@nestjs/schedule` alone** — a timer, not a queue. Two instances = two night audits.
- ❌ **Migrating `apps/web` to Tailwind** — rewrites your most fragile CSS for zero user-visible gain.
- ❌ **React Bits in the admin console** — see §5.
- ❌ **dinero.js / decimal.js** — `bigint` VND is complete.
- ❌ **MUI X Pro** — paid tier for grid features TanStack Table gives free.
- ❌ **A PDF engine for invoices** — legal invoice is the provider's output.
- ❌ **Node 25** in production — odd-numbered Current line.
- ❌ **Two test runners** — Vitest everywhere.

---

## 7. Efficiency wins (ranked, effort → impact)

| Instead of | Do | Saves |
|---|---|---|
| Hand-writing DTOs + client + docs | One oRPC contract → server + client + OpenAPI | 3 artifacts collapse to 1; drift becomes a build failure |
| `Date` everywhere | `@internationalized/date` `CalendarDate` | Off-by-one-night bugs become type errors |
| Redis for 4 cron jobs | pg-boss in the DB you already run | A service, its backups, and dual-write bugs |
| Two DB pools (`postgres.js` + `pg`) | `pg` for both Drizzle and pg-boss | One pool, one config, one failure mode |
| Hand-drawn ERD in the report | `drizzle-dbml-generator` + CI drift check | A miserable retrofit week; a professor finding the mismatch |
| Building a chart library | Bklit copied in, restyled to tokens | Weeks of the reporting phase |
| Assembling shadcn by hand | shadcn CLI, then restyle | Focus management still yours, boilerplate isn't |
| ESLint + Prettier + configs | Biome | One config, ~25× faster, one tool to upgrade |
| Separate CI DB config | Testcontainers | Local == CI, permanently |

---

## 8. Trade-offs

- **Two styling idioms.** Context-switching between CSS Modules and Tailwind is real friction. Bought: zero risk to the Three.js work, plus Bklit/shadcn/React Bits all usable as shipped.
- **oRPC is young.** Fewer StackOverflow answers than ts-rest, which itself has fewer than Nest+Swagger. Mitigated by the 30-min `@orpc/nest` spike before P0 phase 03 commits.
- **Docker Desktop required** on your Windows box for Testcontainers. Non-negotiable given the concurrency test must hit real Postgres.
- **Drizzle over Prisma** — no Studio GUI, thinner docs. You will read more SQL. That is the point.
- **pg-boss shares your database.** Job load and query load compete for the same Postgres. Irrelevant at this scale; would matter at 10×.
- **exceljs is stale** (Dec 2024). Fine at P5, but a known-unmaintained dependency in the export path.
- **Copy-in components mean no upstream fixes.** shadcn/Bklit/React Bits code becomes yours the moment you paste it — bugs and improvements both.
- **Biome ≠ ESLint ecosystem.** A few niche Next/React rules have no Biome equivalent. Reversible cheaply; that's why it isn't a blocking decision.

---

## 9. Install order — mapped to the existing plan

| Phase | Install |
|---|---|
| **P0.02** API skeleton | Nest 11 + Express 5, drizzle-orm + drizzle-kit + `pg`, pino, `btree_gist` migration, zod config schema |
| **P0.03** Contracts + auth | `@orpc/contract` + `@orpc/nest` + `@orpc/zod` + `@orpc/client`, `@internationalized/date`, tokens.css extraction, Better Auth + Passport-JWT |
| **P0.04** CI + docs | Vitest + Testcontainers, fast-check, Biome, lefthook, `drizzle-dbml-generator` + drift check, `@orpc/openapi` |
| **P1** Inventory | `@faker-js/faker` (seed), the 50-way concurrency test |
| **P2** Front desk | Tailwind 4 + shadcn + cmdk + TanStack Table + Query + react-hook-form + motion |
| **P3** Payments | pg-boss reconciliation jobs; gateway SDK (infra pass) |
| **P4** Booking funnel | React Bits adaptations in `(booking)`; bundle budget in CI |
| **P5** Operations | exceljs (or replacement) |
| **P6** Reporting | Bklit charts; pg-boss night-audit schedule |

---

## 10. Work checklist

### Immediate — unblocks P0.02
- [ ] Pin Node to one even LTS: `.nvmrc`, `engines`, CI matrix (currently `>=20`, local is 25.2.1)
- [ ] 30-min spike: `@orpc/nest` — contract enforcement, guards, DI. **Gate before committing to oRPC**
- [ ] Install Docker Desktop; verify `@testcontainers/postgresql` boots Postgres 17 on Windows
- [ ] Extract `apps/web/app/globals.css` tokens → `packages/shared/src/tokens.css`; web imports it; confirm site pixel-identical

### P0.02 — API skeleton
- [ ] Scaffold `apps/api`: Nest 11 + Express 5, `package.json`, tsconfig, Turbo tasks
- [ ] drizzle-orm + drizzle-kit + `pg`; single pool shared with pg-boss
- [ ] Migration 0001: `create extension btree_gist`
- [ ] Env schema parsed at boot; fail fast
- [ ] nestjs-pino structured logging
- [ ] Health endpoint

### P0.03 — Contracts
- [ ] `packages/shared`: keep zod 4.4.x, add drizzle-zod, `@internationalized/date`
- [ ] Define `StayDate` (`CalendarDate`) and `VndAmount` (`bigint`) as the two primitive contract types
- [ ] `@orpc/contract` router skeleton in `packages/shared`
- [ ] `@orpc/nest` binding in `apps/api`; `@orpc/client` in `packages/api-client`
- [ ] Auth realms per P0 plan (Better Auth guest / Passport-JWT staff)

### P0.04 — Quality gates
- [ ] Vitest across api/shared/admin; delete any Jest remnants
- [ ] Testcontainers setup with `.withReuse()`
- [ ] fast-check wired
- [ ] Biome replaces ESLint+Prettier (or ESLint 9 flat — decide, don't defer twice)
- [ ] lefthook: format + typecheck on commit
- [ ] `drizzle-dbml-generator` → `docs/erd.dbml`; **CI fails on drift**
- [ ] `@orpc/openapi` → `docs/openapi.json`, served via Scalar
- [ ] CI runs `pnpm test` with Docker available

### P2 — Admin foundation
- [ ] Scaffold `apps/admin`: Next + Tailwind 4
- [ ] `@theme` maps every Mariva token; visual diff against web
- [ ] shadcn CLI init; Bklit registry configured
- [ ] cmdk palette + global hotkeys as shared primitives **before screens multiply**
- [ ] TanStack Table + Query + `@orpc/tanstack-query`
- [ ] Motion budget documented: ≤150ms, `--ease-ui`, reduced-motion respected

---

## 11. Success metrics

| # | Metric | Target |
|---|---|---|
| 1 | oRPC spike verdict | Documented go/no-go **before** P0.03 code |
| 2 | Contract drift | Changing a contract without updating the impl = **build failure**, proven by a deliberate break |
| 3 | zod version conflicts | **0** — `pnpm why zod` shows one version, tree-wide |
| 4 | Node version | `.nvmrc`, `engines`, CI all name **one even LTS**; `pnpm install` errors on mismatch |
| 5 | Testcontainers boot (warm, `.withReuse()`) | **<5s** on Windows |
| 6 | Concurrency test | 50 parallel holds → exactly **1** success, in CI |
| 7 | Token duplication | **1** file defines Mariva. `grep -r '#f4efe6'` outside `tokens.css` → **0 hits** |
| 8 | `apps/web` visual regression after token extraction | **0 px** diff, Playwright screenshot |
| 9 | `/booking` bundle | **0 bytes** of `three` / `gsap` / `lenis`; CI budget enforced |
| 10 | ERD drift | CI green on every run; schema change without regen **fails** |
| 11 | OpenAPI coverage | **100%** of endpoints in `openapi.json` |
| 12 | Test runners in repo | **1** (Vitest) |
| 13 | Connection pools | **1** — Drizzle and pg-boss share `pg` |
| 14 | Admin interaction latency | **<150ms** to visible feedback; no entrance animation on operational screens |
| 15 | Job reliability | Night audit runs exactly **once** per business date, provable from pg-boss history in SQL |

---

## 12. Evidence separation

**Verified this session** (npm registry + repo read + web fetch, 2026-07-26):

- Repo state: workspace layout, `package.json` files, `globals.css` tokens, empty `(booking)` route group, P0 plan status
- `@ts-rest/core@3.52.1` peers `zod ^3.22.3`; `3.53.0-rc.1` drops the zod peer; dist-tag `latest` = 3.52.1
- `@orpc/*` 1.14.10; `@orpc/nest` peers Nest `>=11`, express `>=5` / fastify `>=5`; `@orpc/zod` peers `zod >=3.25.0`
- oRPC custom method/path routing, `{id}` params, `.prefix()` — from official routing docs
- oRPC first-class OpenAPI + contract-first + NestJS integration listed — from orpc.dev
- React Bits: 140+ components, JS/TS × CSS/Tailwind variants, shadcn/jsrepo/copy-paste install, categories are text animations / UI animations / backgrounds, **self-described as marketing and landing-page oriented**
- Bklit: open-source React dataviz, 17+ chart types, **distributed via shadcn registry** (`pnpm dlx shadcn@latest add @bklit/area-chart`), Vercel OSS program
- Versions: drizzle-orm 0.45.2, drizzle-zod 0.8.3, pg-boss 12.26.3, vitest 4.1.10, @testcontainers/postgresql 12.0.4, motion 12.42.2, tailwindcss 4.3.3, @internationalized/date 3.12.2, exceljs 4.4.0 (**modified 2024-12-20**), fast-check 4.9.0, @faker-js/faker 10.5.0, lefthook 2.1.10, @biomejs/biome 2.5.5, better-auth 1.6.25, @tanstack/react-table 8.21.3, @tanstack/react-query 5.101.4, cmdk 1.1.1, react-hook-form 7.83.0, drizzle-dbml-generator 0.10.0, nestjs-pino 4.6.1, @nestjs/core 11.1.28, express 5.2.1, pg 8.22.0

**High confidence, standard practice, not verified here:** Tailwind v4 `@theme` consuming CSS custom properties; pg-boss transactional enqueue semantics; Drizzle hand-edited SQL migrations carrying `EXCLUDE` constraints.

**NOT verified — must check before relying on:**
- `@orpc/nest` controller ergonomics, compile-time enforcement, guards/DI interop (docs 404'd — **spike required**)
- Bklit's underlying render tech (D3 / SVG / canvas) and whether Tailwind is strictly required
- Whether Bklit charts are keyboard/screen-reader accessible out of the box
- Node LTS line numbering at your install date — check `nodejs.org/en/about/previous-releases`, don't trust this document

---

## 13. Unresolved questions

1. ~~Biome or ESLint 9 flat?~~ **Closed → Biome. See §14.**
2. **Does `@orpc/nest` enforce the contract at compile time?** If not, oRPC loses its main advantage over Nest+Swagger and the decision reopens. **Still the one real gate.**
3. ~~Next.js 14 → 15?~~ **Closed → migrate `apps/web` to Next 16 + React 19 first. See §14.**
4. **Bklit accessibility** — a management console used daily has a higher bar than a marketing chart. Audit before P6 commits.
5. **exceljs replacement** — decide at P5, not now.
6. ~~Where do Mariva tokens live?~~ **Closed → `packages/tokens`. See §14.**
7. Everything in §3.8 — hosting, gateway, e-invoice, storage, email, monitoring. **Next advisory pass.**
8. **Next 14 → 16 breaking changes** — async `cookies()`/`headers()`/`params`/`searchParams` landed in 15. Marketing site is one route group; likely small, but unaudited.

---

## 14. Layer 1 & 2 — closed 2026-07-26 12:12

| Layer | Decision | Choice |
|---|---|---|
| 1a | Token home | **`packages/tokens`** — `tokens.css` + TS mirror. Contracts and design assets stay separate |
| 1b | Lint + format | **Biome 2.5** — one tool, whole repo. Replaces a deprecated `next lint`; adds formatting that does not exist today |
| 2 | Framework versions | **Migrate `apps/web` to Next 16 + React 19 first**, then one version repo-wide |

### 14.1 Decision 2 — recorded position

Advisory recommendation was to split majors and freeze `apps/web`. **User chose to migrate.** The choice is sound and the advice was calibrated on a wrong assumption — corrected below.

Arguments that carry it:

- `apps/web` is the **only** app today. The same migration after `apps/admin` and `/booking` exist costs 3× more.
- Next 14 is October 2023. Security support lapses on someone else's schedule.
- Long runway; no external deadline on the marketing site.
- Removes a permanent two-major split from the repo.

### 14.2 The migration is far smaller than assumed — verified

| Claim | Evidence |
|---|---|
| **`@react-three/drei` is unused** | Appears **only** in `apps/web/package.json`. Zero imports in any `.ts`/`.tsx`/`.mjs`. **Delete it** — drei 9→10 leaves scope entirely |
| **R3F surface is 2 files** | `act-1-gathering/monogram-lens.tsx`, `act-2-welcome/foliage-gobo.tsx`. Nothing else imports `@react-three/*` |
| **Only 4 R3F APIs used** | `Canvas`, `useFrame`, `useThree`, `createPortal` — all stable core across v8→v9 |
| **GSAP / Lenis unaffected** | Not React-version coupled |
| **`three` needs no upgrade** | R3F 9.6.1 peers `three >=0.156`; you are on 0.169. **Leave it** |

**Revised risk: the R3F migration is the easy half. Next 14 → 16 (two majors) is the real work.**

### 14.3 Migration order — one variable per commit

1. **Baseline first.** Playwright capture machinery already exists (`apps/web/scripts/capture-*.mjs`, `screenshot-dir.mjs`). Produce deterministic per-act screenshots and commit them **before touching a dependency**. This is the regression net the acts have never had.
2. `pnpm remove @react-three/drei` — unused. Verify build.
3. React 18.3 → 19.2 + `react-dom` + `@types/react` / `@types/react-dom`. **Expect the type churn here, not in the 3D code** — React 19 types dropped implicit `children` and changed `ReactNode`.
4. `@react-three/fiber` 8.17 → 9.6. Two files, four APIs.
5. Next 14.2 → 15 → 16, **separately**. Audit async `cookies()`/`headers()`/`params`/`searchParams` at 15.
6. Re-run screenshots at every step. Any act that shifts, stop and diff.
7. Biome + `packages/tokens` land **after** the migration is green — do not mix a formatter rewrite into a version migration diff.

Do **not** upgrade `three` in the same pass. R3F 9 accepts 0.169; a renderer upgrade is a separate project.

### 14.4 Revised immediate checklist

- [ ] Playwright visual baseline of all 6 acts, committed
- [ ] Remove unused `@react-three/drei`
- [ ] React 19 + types; fix type churn
- [ ] R3F 9 (2 files)
- [ ] Next 15, then Next 16; audit async request APIs
- [ ] Screenshots green at every step
- [ ] `packages/tokens` extraction; `apps/web` pixel-identical
- [ ] Biome replaces `.eslintrc.json`; delete it; update CI `pnpm run lint`
- [ ] `lefthook` for format-on-commit
- [ ] **Then** `apps/api` scaffold (P0.02) on Next-independent ground

### 14.5 Success metrics for this migration

| # | Metric | Target |
|---|---|---|
| 1 | Visual regression across 6 acts | **0 px** unexplained diff vs pre-migration baseline |
| 2 | Dependency count after drei removal | `@react-three/drei` gone; build still green |
| 3 | Commits in the migration | **≥5**, one variable each — never a single "upgrade everything" commit |
| 4 | `three` version | **unchanged** at 0.169 |
| 5 | React majors in repo after | **1** |
| 6 | Lint config files after | **1** (`biome.json`); `.eslintrc.json` deleted |
| 7 | `grep -r '#f4efe6'` outside `packages/tokens` | **0 hits** |
| 8 | Biome + tokens landed in the migration diff | **No** — separate commits |
