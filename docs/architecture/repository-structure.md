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
  (booking)/       Everything that is not the arrival. Plain bundle, no WebGL
features/
  arrival/         The six acts, the concierge nav, and the WebGL machinery they need
  auth/            The guest realm's door. Talks to Better Auth in apps/api
  booking/         The funnel. The stay calendar, the room list, the search band
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

The group is named `(booking)` and holds five screens that are not booking
anything. Route groups do not appear in URLs, so the name costs nothing to keep
— but what it *means* is **plain bundle**, and a screen belongs in it because it
must not load `three`, not because it sells a room.

### The `(booking)` route map

Written before the funnel exists, because two of the three decisions below are
cheap now and are rewrites once step three is built.

```
(booking)/
  login/ signup/ verify-email/ forgot-password/ reset-password/   built
  booking/
    page.tsx              /booking                     search + results
    [hold]/
      details/            /booking/<hold>/details
      payment/            /booking/<hold>/payment
      confirming/         /booking/<hold>/confirming    gateway return
  bookings/
    [reference]/          /bookings/<reference>         confirmation and stay detail
  account/
    page.tsx              /account                      profile, VIP tier, loyalty
    stays/                /account/stays                stay history
```

**Each step is a route.** Not one route holding a step counter. Per-step
abandonment has to be measurable — whether P3.5 gets built at all depends on
measuring abandonment at the payment step — and a step with no URL cannot be
measured. Back and refresh then work without being implemented, and per-route
splitting makes the bundle budget below provable per step rather than for the
group as a whole.

**The hold id is in the path, from step three on.** `booking-state-machine.md`
§2 says only the public funnel starts at `HELD`, and §3 says entering `HELD`
starts a TTL. That is the line the routes fall on: `/booking` is stateless and
its state is search params, so it is shareable and a marketing call to action
can link straight into a date range. Everything after it names a hold that can
expire. In the path rather than a cookie, because two tabs stay unambiguous and
an expired hold is a `410` on a named resource instead of a form that is
mysteriously empty.

**Confirmation and stay detail are one route.** `rbac-matrix.md` §3 has one row
— *read own booking / stay history* — and a confirmation page is that row read
four seconds after payment. Two routes rendering one booking is two things to
keep in step forever; the freshly-booked state is a banner, not a page. This is
the argument `verify-email-screen.tsx` already makes for its own two states.

**`confirming/` is a step the funnel's five-bullet description does not name,
and it is not optional.** The gateway redirects the browser back, but the IPN
webhook is the source of truth and it is asynchronous and idempotent — the
redirect can arrive before it, after it, or instead of it. So the landing that
receives the redirect cannot be the confirmation: it subscribes, and resolves
either to `/bookings/<reference>` or back to `payment` with a reason. Same shape
the e-invoice job uses at folio close, and for the same reason — one provider
timeout must never be able to roll back a completed act.

**What the budget forbids is those three packages, and `motion` is not one of
them.** `/booking` uses it, `tech-stack.md` §Frontend already listed it as this
repo's motion budget, and
[`design-foundations.md`](design-foundations.md) §5 records why the funnel could
not stay CSS-only: CSS has no exit, so a bottom sheet could enter on the house
curve and never leave on one. The `three` / `gsap` / `lenis` line is unchanged and
is verified against the built route — `/booking`'s chunks contain none of the
five markers those packages leave, while `/`'s contain all five.

**`/booking` is built ahead of its API, and says so.** The three reads it needs —
per-date lowest price for a month, per-date restriction flags, per-type
availability for a range — belong to the `pricing` and `inventory` modules and do
not exist. The **contract** for them is real and permanent, in
`packages/shared/rate-calendar.ts`; the transport is a single stub,
`features/booking/lib/rate-calendar-fixture.ts`, which satisfies those schemas and
is deleted when the endpoints land. No component knows which of the two it is
reading, which is the whole point of putting the schema in `shared` first.

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

`shared` holds contracts only: zod schemas and the types inferred from them, no
framework imports. Its name makes it the most attractive place in the repo to
dump a helper — resist that, and the contract stays trustworthy.

Its runtime dependencies are closed, and [`tech-stack.md`](tech-stack.md)
§Contract is the list: zod, `@internationalized/date`, `drizzle-zod` and the
`@orpc/*` contract packages. Each earns its place by making a wrong program
fail to compile rather than by saving anyone typing — `CalendarDate` is here so
a stay date and an instant are different types, and nothing else gets in on a
weaker argument than that. This paragraph used to say *nothing beyond zod*,
which was true before the contract layer had been chosen and is the kind of
rule that quietly turns a decision into an accident.

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
