# @mariva/api

NestJS + Postgres. Every business rule in the system, and the only writer to the
database.

Built through `P0-API-01` … `P0-API-06`: Nest 11.1.28 on Express 5.2.1, an
environment schema parsed at boot, one `pg` pool with Drizzle over it, JSON
request logging, and a health check that asks the database rather than the
process. Then `P0-AUTH-01` … `P0-AUTH-04`: two authentication realms and the
capability guard between them. Contracts (`P0-C`) are still to come, so the
routes below are plain Nest controllers rather than `@orpc/nest` bindings.

Module layout, schema ownership and the dependency rules are in
[`docs/architecture/repository-structure.md`](../../docs/architecture/repository-structure.md).
The directory tree under `src/` is the reserved shape; a folder stays empty
until its module is built, because an imported empty module misrepresents the
dependency graph.

## This package is ESM

`"type": "module"`, `module` and `moduleResolution` both `nodenext`. Not the
CommonJS a Nest scaffold produces by default, and not optional: `@orpc/*` ships
ESM only, so CommonJS cannot import it (TS1479) and `moduleResolution: node10`
cannot even see its types (TS2307). Measured in the `G1` spike —
[`tech-stack.md`](../../docs/architecture/tech-stack.md) §"Settled by spike".

Three consequences when writing code here:

- **Relative imports need explicit `.js` extensions** — `./app.module.js`, even
  though the file is `app.module.ts`.
- **CommonJS dependencies are default-imported.** `pg` is CJS: `import pg from
  "pg"` then `new pg.Pool(…)`. A named import of `Pool` is the thing that
  breaks.
- **esbuild-based runners cannot host this app.** Nest's DI reads constructor
  parameter types from `emitDecoratorMetadata`, which esbuild does not emit, so
  `tsx` and friends produce an app whose every injection fails at runtime. The
  dev loop goes through the Nest CLI, which compiles with `tsc`. Vitest is one
  of those runners, which is why `vitest.config.ts` hands the transform to SWC
  and switches Vitest's own off — the symptom otherwise is every injected
  dependency arriving as `undefined`.

## Configuration

Every variable the API reads is declared in `src/config/env.ts` and parsed by
zod before the container is built. A missing or malformed variable prints which
one and exits 1 — it never boots on a default nobody chose. `DATABASE_URL` has
no default at all; one would point production at somebody's laptop.

Copy `.env.example` to `.env` for local development. Node 24 reads dotenv files
natively, so there is no `dotenv` dependency, and variables already set in the
shell win over the file. Deployed environments get theirs from `fly secrets` —
[`infrastructure.md`](../../docs/architecture/infrastructure.md).

## Database

One `pg` pool for the whole process, exported from `DatabaseModule` under the
`PG_POOL` token, with Drizzle bound to it under `DRIZZLE`. **One pool is a
requirement, not a default** (`R2#13`): pg-boss takes its workers from this same
pool at `P3-JOB`, and a second pool would mean a job that cannot join the
transaction that enqueued it — which is the entire reason the queue lives in
Postgres.

Migrations are plain `.sql` under `src/database/migrations/`, applied by
drizzle-kit and hand-editable, because `EXCLUDE USING gist` has no Drizzle
expression and the constraint that makes double-booking impossible has to live
in version control.

`0000_enable_btree_gist.sql` is the first one, and it exists before any table:
`btree_gist` supplies the operator classes that let one GiST index mix `room_id
WITH =` and `stay_range WITH &&`. Without it `P1-INV-02` cannot be written.

`0002_inventory_core.sql` is where that constraint is finally written, by hand
below the generated statements, and `0003_pricing_core.sql` adds the rate
calendar and the stay restrictions the availability query prices against.

Local development runs Postgres in Docker; Neon is for deployed environments
only.

## Logging

nestjs-pino, one JSON line per completed request. Each carries a correlation id
taken from an inbound `x-request-id` when there is one and generated when there
is not, echoed back on the response so a caller can quote it. `console.log` has
no place outside the bootstrap failure path — a line that cannot be joined to a
request is a line nobody can act on.

The error serializer is deliberately narrowed to type, message, code and stack:
pino's default copies every own property off an error, and `pg` hangs its entire
client — connection parameters included — off a connection failure.

## Health

`GET /health` executes `select 1` through the pool. 200 only after that
round-trip returns; 503 when it does not, never a 200 with a body explaining
that things are bad. A Node process that has lost Postgres still answers HTTP,
so a check that only proves the event loop turns pages nobody.

Verified against a real cluster: 200 while Postgres was up, 503 within the pool
timeout after it was stopped, and 200 again once it came back — the pool
recovers rather than staying poisoned.

## Authentication — two realms

[`rbac-matrix.md`](../../docs/architecture/rbac-matrix.md) §1 is the authority.
No token opens both realms, and they share nothing but the database and the
guard.

**Guests** (`modules/auth/guest`) are Better Auth, mounted at `/api/auth/*` by
one controller that hands the request to the library's own handler. Sign-up,
sign-in, email verification, password reset and sign-out are all its routes;
none of them is reimplemented here, because a second door into a flow is a
second door to keep in step. Sessions are httpOnly cookies prefixed
`mariva_guest`. An address must be verified before it can sign in.

Google is the one social provider, registered only when `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` are both set — optional in development, refused at boot
in production, because the login screen offers the button either way. Its
authorised redirect URI is `<API_URL>/api/auth/callback/google`. A guest who
signed up with a password and later presses Google is linked to the account they
already have, provided that account had confirmed the address itself; an
unconfirmed one is left alone, so registering a stranger's address does not
become a way to be handed it.

**Staff** (`modules/auth/staff`) are Passport-JWT. `POST /auth/staff/sign-in`
returns a thirty-minute access token in the body and a seven-day refresh token
as an httpOnly cookie scoped to `/auth/staff`. The refresh token is stored as a
SHA-256 digest and rotated on every use, so a replayed one fails; the access
token carries one role, and the strategy re-reads the account on every request,
so deactivating somebody ends their access at the next call rather than at the
token's expiry.

**Authorisation** is one global guard over the capability table in
`modules/identity/rbac/matrix.ts`, which mirrors §3 of the matrix row for row.
A route says which row governs it:

```ts
@RequiresCapability("booking.check-in")
@Post(":id/check-in")
```

A route that says nothing is unreachable by everyone — that is the point. The
only exception is `@Unguarded("<reason>")`, which takes a written reason and is
used by the routes that issue sessions and by `/health`.

The first `ADMIN` cannot be created through the API, because creating staff
accounts requires a capability only an `ADMIN` holds. It is created from a shell
instead; every account after it comes from `POST /identity/staff-accounts`.

## Inventory and rates

Four routes, defined in `packages/shared/src/contract/` and implemented by
`modules/inventory`.

| Route | Capability | Who |
|---|---|---|
| `GET /availability` | `availability.search` | anyone |
| `GET /availability/calendar` | `availability.search` | anyone |
| `POST /inventory/room-closures` | `inventory.close-room` | `MANAGER`, `ADMIN` |
| `DELETE /inventory/room-closures/{id}` | `inventory.close-room` | `MANAGER`, `ADMIN` |

The two availability routes are the only ones in the application a stranger can
reach, and they are open because the matrix row says so rather than because a
decorator was left off — `unauthenticated: true` is a column, and closing them
is one boolean.

They answer from `type_inventory` joined to `rate_calendar` in one statement.
A stay restriction — minimum stay, maximum stay, closed to arrival, closed to
departure — is applied at the query and not at the booking attempt, which is
`FR-PRC-02`'s requirement: a guest told at the payment step that their chosen
night has a two-night minimum has been made to do the work twice.

Room closure is a commercial act and not a cleaning one. It writes a hold on the
physical room and decrements `total_rooms` for every night of the range, in one
transaction; housekeeping status changes neither. A closure across a room that
is already held, or across a night whose type is fully sold, is a 409 — refused
by `room_assignment_no_overlap` and `type_inventory_sold_at_most_total`, not by
a check the service performs first, because a check followed by a write is two
statements a concurrent request can interleave.

What these do **not** price yet: promotions (`FR-PRC-03`) and the extra-person
and extra-bed charges (`FR-PRC-04`). A party above a type's maximum is refused,
per §3, but a third head inside the maximum is quoted at the rate, and
`extraBedPerNightGross` is always null — `property-and-tariff.md` §9 leaves the
extra-bed rule with the owner and says no pricing path may infer it from bed
capacity.

## Tests

Vitest, and a real Postgres — not testcontainers yet (`P0-CI-02` and a Docker
daemon the development machine does not have). Copy `.env.example` to
`.env.test` and point `DATABASE_URL` at a database you are willing to lose: the
suite applies the committed migrations and truncates every table it uses. It
refuses to start if that file is missing rather than falling back to `.env`,
which is how a test run empties somebody's development database.

- `src/common/auth/access.guard.spec.ts` — every row of the RBAC matrix, every
  role, both cross-realm directions. Driven off the table, so a row added
  without a test is not possible.
- `src/modules/identity/rbac/matrix.spec.ts` — the structural rules of §2.
- `test/auth.e2e-spec.ts` — both realms over HTTP against the real database.
- `test/inventory-storage.e2e-spec.ts` — the rows Postgres refuses: an oversold
  counter, a second guest in one room, a hold covering no night.
- `test/availability.e2e-spec.ts` — pricing by plan, the four stay
  restrictions one test each, and the `NFR-03` p95 budget over the seeded
  twelve months.
- `test/room-closure.e2e-spec.ts` — closure moves `total_rooms` and nothing
  else, and a receptionist cannot perform one.
- `test/seed.e2e-spec.ts` — forty rooms, the numbering, and that a second run
  produces the same data rather than more of it.

## Commands

```bash
pnpm --filter @mariva/api build       # plain tsc; the artifact does not need the Nest CLI
pnpm --filter @mariva/api dev         # nest start --watch
pnpm --filter @mariva/api start       # node dist/main.js
pnpm --filter @mariva/api db:generate # diff the schema into a new migration
pnpm --filter @mariva/api db:migrate  # apply pending migrations
pnpm --filter @mariva/api db:seed     # the demo property — see below
pnpm --filter @mariva/api test        # vitest, against .env.test
pnpm --filter @mariva/api typecheck   # the app, then the tests and configs

# The first staff account. Prompts for the password rather than taking it as an
# argument, which would put it in the shell history and in `ps`.
pnpm --filter @mariva/api staff:create -- \
  --email owner@mariva.vn --name "Trần Minh" --role ADMIN
```

Every `db:` command reads `DATABASE_URL` the same way the app does, and
`staff:create` boots the container to get the same hasher the API uses.

`db:seed` builds the property `docs/architecture/property-and-tariff.md` §1
describes — five types, forty rooms, twelve months of rates and five hundred
synthetic stays with Vietnamese-locale guests. It **empties** the property, the
calendar and every stay standing against them first, so it converges rather than
accumulating, and it refuses to run against `NODE_ENV=production`. Guests it
created are recognised by their `@seed.mariva.local` address and are the only
ones it deletes; a real sign-in in the same database survives.

The calendar opens from the first of the current month in the property's zone.
`--from` pins that instead, which is what the test suite uses — a fixture that
moves with the wall clock cannot assert a price on a named night:

```bash
pnpm --filter @mariva/api db:seed -- --from 2027-03-01 --bookings 0
```
