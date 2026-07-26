# @mariva/api

NestJS + Postgres. Every business rule in the system, and the only writer to the
database.

Built through `P0-API-01` … `P0-API-06`: Nest 11.1.28 on Express 5.2.1, an
environment schema parsed at boot, one `pg` pool with Drizzle over it, JSON
request logging, and a health check that asks the database rather than the
process. No domain modules, no contracts and no auth yet — those are `P0-C` and
`P0-AUTH`.

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
  dev loop goes through the Nest CLI, which compiles with `tsc`.

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

## Commands

```bash
pnpm --filter @mariva/api build       # plain tsc; the artifact does not need the Nest CLI
pnpm --filter @mariva/api dev         # nest start --watch
pnpm --filter @mariva/api start       # node dist/main.js
pnpm --filter @mariva/api db:generate # diff the schema into a new migration
pnpm --filter @mariva/api db:migrate  # apply pending migrations
```

Both `db:` commands read `DATABASE_URL` the same way the app does.
