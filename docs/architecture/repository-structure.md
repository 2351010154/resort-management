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
plans/              Stable requirement IDs, acceptance criteria, handoff packages, and research records
```

One API, three consumers. Business logic exists once, in `apps/api`; the
frontends render it and nothing else. No Next.js server action, route handler,
or admin screen may reach the database directly — that is what turns one brain
into three that disagree.

GitHub issues own execution state. Files under `plans/` preserve
requirements, rationale, and work-package boundaries; they do not mirror issue
status, assignment, milestone, or delivery evidence.

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

`StaffRole` follows that rule: `packages/shared` owns and exports its schema and
type, while the capability matrix remains API policy under
`apps/api/src/modules/identity/rbac/`.

**A pricing rule both sides apply is shared too, and it is the one kind of
behaviour that belongs there.** `packages/shared/src/occupancy-pricing.ts` holds
the extra-person and child bands because the API quotes against them and the
funnel shows a total before the round trip — two implementations of one band is
a card and an invoice free to disagree. The API's use of it is authoritative;
the funnel's is what lets a price appear without waiting. Nothing else in
`packages/shared` computes: a rule earns its way in by being applied on both
sides of the network, not by being useful twice.

**Invariants live in the database.** Overlap and oversell are prevented by
constraints in `apps/api/src/database/migrations/`, not by service-layer checks.
Application code may not be the last line of defence for money or inventory.

**Reads may cross module boundaries in SQL; writes may not.** A module owns its
writes and their invariants. A read-only query may join another module's tables
when one statement is materially better than composing service calls — the
availability aggregate depends on the joined schema, and must reference it
through typed schema objects so drift fails the build.

## `apps/api` — NestJS

```
src/
  main.ts, app.module.ts
  common/          The capability guard, the audit interceptor, exception filters, pipes
    observability/ Logging an unknown throw without changing what the caller is told
  config/          Env parsing and validation, one schema, fails fast at boot
  database/
    schema/        One file per domain, re-exported from index.ts
    migrations/    SQL. Constraints, extensions, and indexes live here
    migration-check.ts  Boot refuses a database behind migrations/meta/_journal.json
  health/          Liveness. Operational, so not under modules/
  modules/<domain>/
  jobs/            Scheduled work: the runner, the scheduler, the sweep contract
test/              e2e and the concurrency suite
```

A module is a folder: `x.module.ts`, `x.controller.ts`, `x.service.ts`, `dto/`,
and its `*.spec.ts` next to what it tests. **A module's public surface is what
its NestJS module exports** — reaching into another module's internals to write
is how a modular monolith becomes a tangle that needs microservices to explain
itself. Reads are the stated exception, under the rule above.

**There is no repository layer, and none is coming.** Drizzle is already the
query builder, so a `*.repository.ts` over it would be a pass-through with a
second name for every method. The invariants are in the database rather than in
an abstraction over it, the migrations depend on `btree_gist`, `EXCLUDE` and
`daterange`, and the suite is e2e against real Postgres — none of the three
things a repository buys is on offer here. Queries shared between services
graduate to a plain function beside them, the way `pricing/room-type-id.ts` and
`inventory/sql-state.ts` did.

A service does not open its own transaction. Writes take a required `DbExecutor`
(`database/database.module.ts`) and the caller draws the boundary through
`TransactionRunner`, because a booking has to consume inventory, post a folio
line and record a payment in one commit.

Schema files are centralised under `database/schema/` because migrations need a
single entry point, but each file is owned by the module that names it.

`health/` sits beside `modules/` rather than inside it: the table below is the
domain list, and liveness has no domain behind it. The rule that keeps the
directory from becoming a second junk drawer is that everything in it must be
answerable without reading a single business rule.

### Domain modules

| Module | Owns |
|---|---|
| `identity` | Staff accounts and the permission matrix; imports the shared staff-role contract |
| `auth` | Two separate realms: staff sessions and guest accounts |
| `guest` | Guest profiles, the registration record, VIP tier, loyalty |
| `inventory` | Room types, rooms, per-night type inventory, availability queries |
| `pricing` | Rate plans, rate calendar, stay restrictions, promotions |
| `booking` | Lifecycle state machine, holds, room assignment, cancellation |
| `housekeeping` | Room condition, orthogonal to occupancy; out-of-order |
| `folio` | The append-only posting ledger, taxes, invoices, reversals |
| `payment` | VNPay/PayPal, idempotent webhooks, refunds, reconciliation |
| `operations` | Shift handover, cash drawer, service catalog, income/expense. Only the catalog is built — `FR-FOL-03` needed it; the other three are later milestones |
| `reporting` | Night-audit snapshots, occupancy/ADR/RevPAR, exports |
| `audit` | The change log every state-changing action writes to |
| `feedback` | Post-stay feedback tied to a completed booking |
| `notification` | Transactional email and its templates |
| `system-config` | The one mutable configuration row — tax rates, business-date rollover — and the `ADMIN` route that edits it |

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
lib/               Domain-blind and genuinely shared — what no single feature owns
```

`features/auth/` owns the guest-auth screens and screen-specific orchestration.
P0 contract work implements `packages/api-client` as the reusable transport
boundary; Better Auth UI policy remains in this feature rather than leaking
into the generic client.

Only `login` uses the two-plate composition. The other four share
`auth-shell.tsx`: a guest reaches them once, usually holding an email, and a
composition that competed for attention would be competing with the task.

The group is named `(booking)` and holds guest-auth as well as booking screens.
Route groups do not appear in URLs, so the name costs nothing to keep — but what
it *means* is **plain bundle**, and a screen belongs in it because it must not
load `three`, not because it sells a room.

### The `(booking)` route map

This route contract makes the resource and measurement boundaries explicit
before later steps couple them to expiring holds and asynchronous payment.

```
(booking)/
  login/ signup/ verify-email/ forgot-password/ reset-password/
  booking/
    page.tsx              /booking                     search + results
    [hold]/
      details/            /booking/<hold>/details
      payment/            /booking/<hold>/payment
      confirming/         /booking/<hold>/confirming    gateway return
  bookings/
    [reference]/          /bookings/<reference>         confirmation and stay detail
      account/            /bookings/<reference>/account attach the stay to an account
  account/
    page.tsx              /account                      profile, VIP tier, loyalty
    stays/                /account/stays                stay history
```

`/bookings/<reference>/account` is not a sixth funnel step and is not counted
below. It is reached only from the confirmation email, after the money, by a
guest who has already finished booking — and nothing in the funnel depends on
anyone opening it.

**Six logical steps use five URL patterns.** Search and room-type selection
share `/booking` because both are stateless views of URL search parameters.
Guest details, payment, gateway confirmation, and the resulting booking each
have a named resource URL. This keeps payment-step abandonment measurable,
makes back/refresh deterministic, and avoids a hidden in-memory step counter.

**Which of the two `/booking` steps is open is a search param, not component
state.** A complete range used to be the room list on its own; the dates step now
ends with the stay stated back beside the calendar, so a range and the room list
are different screens and the URL has to distinguish them. `step=rooms` does
that, and it is omitted for the dates step so the shortest meaningful link is
still the one a guest shares. The param names and their defaults are owned by
[`booking-search.ts`](../../apps/web/features/booking/lib/booking-search.ts);
the same rule as the sentence above applies to it, which is why the step lives in
the query rather than in a `useState` no link could carry.

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
them.** `tech-stack.md` §Frontend defines the motion boundary — the funnel
could not stay CSS-only because CSS has no exit, so a bottom sheet could enter
on the house curve and never leave on one. Bundle verification must prove that
funnel chunks
contain none of `three`, `gsap`, or `lenis`, and
[`scripts/check-bundle-budget.ts`](../../apps/web/scripts/check-bundle-budget.ts)
measures it on every build: the route group is still the convention, but a
post-build step now reads the emitted chunks and fails the build rather than
trusting where an import was written.

It matches on markers the packages author about themselves rather than on module
paths, because the production bundler leaves no paths to match — and not on the
package names either, since guest copy about "a family of three" is not a
dependency on `three`.

**The funnel depends on three read contracts** —
per-date lowest price for a window of nights, per-date restriction flags,
per-type availability for a range — owned by the `pricing` and `inventory`
modules. Their schemas live in `packages/shared/src/rate-calendar.ts`. All three
are answered by `GET /availability/calendar` and `GET /availability`, the two
routes of the matrix's one unauthenticated row, and `/booking` reads them
through `features/booking/lib/availability.ts`.

`GET /availability/calendar` takes the window itself — half-open `from`/`to`,
per `packages/shared/src/contract/availability.ts` — rather than the `{year,
month}` it once took, so the funnel's 365-night horizon is one request on first
paint instead of thirteen. The window is bounded in the contract at
`LONGEST_CALENDAR_WINDOW` nights and a longer one is rejected, because this is
the route a caller holding no session can reach and an unbounded range there is
an amplification lever. The fixture that stood in for them while
they were unbuilt is gone, which is the rule those contracts were written under:
a fixture may satisfy the schemas during UI work and must be deleted when the
procedures land, and no component may know which transport supplies the data.

The browser reaches the API by `NEXT_PUBLIC_API_URL` — see
[`apps/web/.env.example`](../../apps/web/.env.example). The guest session is an
httpOnly cookie the API sets on its own origin, so that value and the API's
`WEB_ORIGIN` are two halves of one CORS pair: a mismatch fails sign-in as a
CORS error rather than as a wrong password.

The root layout carries the document shell, fonts, and tokens — nothing else. A
provider mounted there sits in every route's tree, which is exactly how `three`
ends up in the conversion path. **`/booking` must ship zero bytes of `three`,
`gsap`, or `lenis`**; the route groups are what keep it that way.

`lib/` keeps what more than one feature reaches for: `api` (the browser's single
client), `motion-tokens` (the one source for every ease, duration and stagger),
`use-in-view` (a generic IntersectionObserver hook), and the mailed-link pair
`booking-links` and `use-presented-link` — the confirmation email leads to a
booking screen and to a guest-auth screen, and both spend the same links, so they
graduated out of `features/booking/` rather than being imported across features.
Everything else the arrival touched — the act store, image and video manifests,
the Lenis provider, the monogram geometry, the spring solver, the WebGL probe —
moved into `features/arrival/lib/`, because a single consumer does not make
something shared. The `arrival-` prefixes came off in the move: inside
`features/arrival/` they only stuttered.

Lint scope is executable configuration, not a prose inventory. The root
`package.json` owns the lint command, `biome.jsonc` owns Biome's include and
exclude boundaries, and the web package manifest owns its CSS lint step.

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

`api-client` is the P0 transport boundary: it wraps fetch, injects auth, and
parses responses through the `shared` schema. That contract work has landed —
the client is derived from `contract` rather than written per endpoint, so a
route added in `shared` is callable the moment it exists. `apps/admin` remains
deferred.

Both packages are **built**, not compiled from source by their consumers. The
`@orpc/*` packages are ESM only, which puts `shared` on `moduleResolution:
nodenext`, where relative imports name the emitted `./money.js` — a file that
does not exist until tsc writes it, and one Turbopack will not substitute a
`.ts` for. The reasoning is in [`tech-stack.md`](tech-stack.md) §"The contract
package is built, not read as source"; the consequence here is that
`packages/*/dist` is what an app imports, and `turbo run` is what puts it
there.

Neither a shared UI package nor a shared lint-config package exists. The
marketing arrival, the booking funnel, and the admin console have genuinely
different visual languages; a `packages/ui` serving all three would be a
lowest-common-denominator abstraction with no real second consumer. Revisit when
one appears.

What the three surfaces *do* share — the palette, the type scale, the spacing
rhythm, the two easing curves, and the copy voice — lives in `packages/tokens`
and the codebase itself rather than in a shared package or a standards
document, including the `three`/`gsap`/`lenis` budget above and what may be
imported from `lib/`.
