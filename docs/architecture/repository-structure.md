# Repository structure

The shape the repo is being built into, and the rules that keep it from rotting
as screens multiply. Directories that exist but hold only a `.gitkeep` are
reserved boundaries — the work that fills them has not started.

## Top level

```
apps/
  api/              NestJS + Postgres. Every business rule. The only writer to the database
  admin/            Next.js. Front desk and management. Keyboard-first, no WebGL
  web/              Next.js. The public origin: the marketing arrival and the guest booking funnel
packages/
  shared/           zod schemas and the types inferred from them. The contract every app reads
  api-client/       Typed fetch wrapper over the API, validating responses with `shared`
docs/               Architecture, generated diagrams, traceability
plans/              Working plans and reports. Untracked
```

One API, three consumers. Business logic exists once, in `apps/api`; the
frontends render it and nothing else. No Next.js server action, route handler,
or admin screen may reach the database directly — that is what turns one brain
into three that disagree.

## Rules that survive contact with growth

**Dependencies point one way.** `app/` → `features/` → `components/ui/` + `lib/`
→ `packages/*`. Never back up the chain. A `components/ui/` file that imports a
feature is the first crack.

**A feature never imports another feature.** When two need the same thing, the
thing graduates: to `components/ui/` if it is presentational, to `lib/` if it is
infrastructure, to `packages/shared` if it is a contract. Copy it twice before
you decide — a wrong shared abstraction costs more than a duplicate.

**`lib/` is cross-cutting infrastructure, not a junk drawer.** The API client,
env access, formatters. If a file is about one screen family, it belongs to that
feature. This rule is the whole difference between a `lib/` you can read at 30
screens and one you grep.

**Anything crossing the network is declared once, in `packages/shared`.** A type
hand-written on the frontend to mirror an API response is drift waiting to
happen. Schemas live there; both sides infer.

**Invariants live in the database.** Overlap and oversell are prevented by
constraints in `apps/api/src/database/migrations/`, not by service-layer checks.
Application code may not be the last line of defence for money or inventory.

## `apps/api` — NestJS

```
src/
  main.ts, app.module.ts
  common/          The capability guard, the audit interceptor, exception filters, pipes
  config/          Env parsing and validation, one schema, fails fast at boot
  database/
    schema/        One file per domain, re-exported from index.ts
    migrations/    SQL. Constraints, extensions, and indexes live here
  health/          Liveness. Operational, so not under modules/
  modules/<domain>/
  jobs/            Scheduled work: night audit, ID-scan retention sweep
test/              e2e and the concurrency suite
```

A module is a folder: `x.module.ts`, `x.controller.ts`, `x.service.ts`, `dto/`,
and its `*.spec.ts` next to what it tests. **A module's public surface is what
its NestJS module exports** — reaching into another module's internals is how a
modular monolith becomes a tangle that needs microservices to explain itself.

Schema files are centralised under `database/schema/` because migrations need a
single entry point, but each file is owned by the module that names it.

`health/` sits beside `modules/` rather than inside it: the table below is the
domain list, and liveness has no domain behind it. The rule that keeps the
directory from becoming a second junk drawer is that everything in it must be
answerable without reading a single business rule.

### Domain modules

| Module | Owns |
|---|---|
| `identity` | Staff, roles, the permission matrix |
| `auth` | Two separate realms: staff sessions and guest accounts |
| `guest` | Guest profiles, ID records and scans, VIP tier, loyalty |
| `inventory` | Room types, rooms, per-night type inventory, availability queries |
| `pricing` | Rate plans, rate calendar, stay restrictions, promotions |
| `booking` | Lifecycle state machine, holds, room assignment, cancellation |
| `housekeeping` | Room condition, orthogonal to occupancy; out-of-order |
| `folio` | The append-only posting ledger, taxes, invoices, reversals |
| `payment` | VNPay/MoMo, idempotent webhooks, refunds, reconciliation |
| `operations` | Shift handover, cash drawer, service catalog, income/expense |
| `reporting` | Night-audit snapshots, occupancy/ADR/RevPAR, exports |
| `audit` | The change log every state-changing action writes to |
| `feedback` | Post-stay feedback tied to a completed booking |
| `notification` | Transactional email and its templates |

## `apps/admin` — Next.js

```
app/
  (auth)/          Login. No shell, no nav
  (app)/           The authenticated shell: nav, command palette, hotkeys
features/          One folder per screen family
components/ui/     Primitives. Domain-blind
lib/               API client, keyboard and focus infrastructure
```

Screen families, deliberately not scaffolded because their names will move
before their domains do: dashboard, arrivals, departures, bookings, rooms,
housekeeping, guests, rates, folios, payments, reports, shifts, finance, audit,
settings.

The keyboard layer — command palette, global hotkeys, focus management, liberal
date parsing — belongs in `lib/` and the `(app)` layout **before** screens
multiply. Retrofitting keyboard-first onto twenty mouse-first screens is a
rewrite, not a refactor.

## `apps/web` — Next.js

```
app/
  (marketing)/     The arrival. three / gsap / lenis live only in this subtree
  (booking)/       The guest funnel. Plain bundle. Its auth screens are the first five
features/
  arrival/         The six acts, the concierge nav, and the WebGL machinery they need
  auth/            The guest realm's door. Talks to Better Auth in apps/api
components/ui/     Primitives shared across route groups
lib/               Domain-blind and genuinely shared. Currently two files
```

`features/auth/` holds five screens — log in, sign up, confirm an address, ask
for a reset, choose a new password — and the two `lib/` files they post with:
`sign-in.ts` and `guest-auth.ts`, both aimed at the API's Better Auth mount. They
belong in `packages/api-client` the day something other than these screens needs
the same session; today the callers are all here, and the rule below about
`shared` applies just as well to `api-client`.

Only `login` uses the two-plate composition. The other four share
`auth-shell.tsx`: a guest reaches them once, usually holding an email, and a
composition that competed for attention would be competing with the task.

The browser reaches the API by `NEXT_PUBLIC_API_URL` — see
[`apps/web/.env.example`](../../apps/web/.env.example). The guest session is an
httpOnly cookie the API sets on its own origin, so that value and the API's
`WEB_ORIGIN` are two halves of one CORS pair: a mismatch fails sign-in as a
CORS error rather than as a wrong password.

The root layout carries the document shell, fonts, and tokens — nothing else. A
provider mounted there sits in every route's tree, which is exactly how `three`
ends up in the conversion path. **`/booking` must ship zero bytes of `three`,
`gsap`, or `lenis`**; that is a CI budget, not a convention.

`lib/` kept exactly what a booking screen would also reach for: `motion-tokens`
(the one source for every ease, duration and stagger) and `use-in-view` (a
generic IntersectionObserver hook). Everything else the arrival touched —
the act store, image and video manifests, the Lenis provider, the monogram
geometry, the spring solver, the WebGL probe — moved into
`features/arrival/lib/`, because a single consumer does not make something
shared. The `arrival-` prefixes came off in the move: inside `features/arrival/`
they only stuttered.

`next lint` walks `app`, `pages`, `components`, `lib` and `src` and nothing
else, so `eslint.dirs` in `next.config.mjs` has to name `features` explicitly.
Miss it and the majority of the app lints clean by never being read.

## `packages/`

`shared` holds contracts only: zod schemas and inferred types, no runtime
dependencies beyond zod, no framework imports. Its name makes it the most
attractive place in the repo to dump a helper — resist that, and the contract
stays trustworthy.

`api-client` wraps fetch, injects auth, and parses every response through the
`shared` schema. Both frontends consume it, so a breaking API change surfaces as
a type error in two apps rather than a runtime shrug in one.

Neither a shared UI package nor a shared ESLint package exists yet. The
marketing arrival, the booking funnel, and the admin console have genuinely
different visual languages; a `packages/ui` serving all three would be a
lowest-common-denominator abstraction with no real second consumer. Revisit when
one appears.

What the three surfaces *do* share — the palette, the type scale, the spacing
rhythm, the two easing curves, and the copy voice — is written down in
[`design-foundations.md`](design-foundations.md) instead of packaged. That file
is the standard a `(booking)` screen is built against, including the
`three`/`gsap`/`lenis` budget above and what may be imported from `lib/`.
