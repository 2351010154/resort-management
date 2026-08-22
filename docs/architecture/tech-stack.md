# Technology stack

The decided parts list. One row per concern, one line of reasoning each. Full
rationale, alternatives and evidence:
[`plans/reports/archive/advise-260726-1119-stack-selection.md`](../../plans/reports/archive/advise-260726-1119-stack-selection.md)
(R2), frozen 2026-07-26.

Three principles decide most of the table. Correctness invariants must be
expressible in the database. A contract is declared once. Fewer moving parts —
at forty rooms and one developer, every added service is another thing to back
up, monitor and upgrade.

## Runtime and workspace

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node 24 LTS, pinned in `.nvmrc`, `engines` and CI together | Even LTS line; three places that drift independently are pinned as one |
| Package manager | pnpm 11.1.2 | Already in use, `packageManager` pinned |
| Task runner | Turborepo 2.10.7 | Already in use |
| Language | TypeScript 5.6.3 | Raise when Nest 11 lands |

## API — `apps/api`

| Concern | Choice | Why |
|---|---|---|
| Framework | NestJS 11.1.x | `@orpc/nest` peers `>=11` |
| HTTP adapter | Express 5.2.x | `@orpc/nest` peers `express >=5`; the boring pick |
| Module system | **ESM** — `"type": "module"`, `module`/`moduleResolution` `nodenext` | `@orpc/*` ships ESM only. Not the Nest default; measured below |
| ORM | drizzle-orm 0.45.x + drizzle-kit 0.31.x | Migrations emit real `.sql` — `btree_gist`, `EXCLUDE`, `daterange` stay in version control. The two version independently; drizzle-kit is not on 0.45 |
| DB driver | `pg` 8.22.x | pg-boss uses `pg` internally: one pool, not two |
| Job queue | pg-boss 12.26.x | Queue inside Postgres; enqueue joins the transaction |
| Logging | pino + nestjs-pino 4.6.x | Structured, request-scoped |
| Config | zod schema parsed at boot | Fails at startup, not at 2am |
| Guest auth | Better Auth 1.6.x on the Drizzle adapter | Email verification, reset and session rotation already correct; shares the one pool. Google Sign-In is its social provider, on the same `guest_account` table |
| Staff auth | Passport-JWT (`@nestjs/passport` 11.0.x, `@nestjs/jwt` 11.0.x) | A bearer token the console sends, not a browser cookie — `rbac-matrix.md` §1 keeps the realms apart |
| Staff password hashing | `@node-rs/argon2` 2.0.x, argon2id at OWASP parameters | Memory-hard; prebuilt, so Windows needs no toolchain. Better Auth hashes the guest realm's own |
| Authorisation | `@RequiresCapability()` over `modules/identity/rbac/matrix.ts` | The RBAC matrix as data, enforced by one global fail-closed guard |

## Contract — `packages/shared`

| Concern | Choice | Why |
|---|---|---|
| Contract | `@orpc/contract` / `@orpc/nest` / `@orpc/zod` / `@orpc/client` / `@orpc/openapi-client` 1.14.10 | Contract-first; one definition yields server, client and OpenAPI |
| Schema | zod 4.4.x + drizzle-zod 0.8.3 | `@orpc/zod` peers `>=3.25`, so zod v4 stays; tables generate schemas |
| Dates | `@internationalized/date` 3.12.x | `CalendarDate` ≠ `ZonedDateTime` at the type level — the off-by-one-night bug becomes a compile error |
| Money | `bigint` VND, no library | VND has no minor unit; `Intl.NumberFormat('vi-VN')` to display |
| Design tokens | `packages/tokens` — `tokens.css`, the package's only export | One file defines Mariva; both apps import it |

## Frontend

| Surface | Choice | Why |
|---|---|---|
| `apps/web` CSS | CSS Modules, unchanged | Zero risk to six acts of scroll-tuned CSS |
| `apps/web` 3D/motion | three 0.169 + `@react-three/fiber` 9.6 + gsap + lenis, `(marketing)` only | `/booking` ships zero bytes of them — a CI budget |
| `apps/admin` | Next.js (matching web) + Tailwind 4.3 `@theme` | `@theme` reads CSS custom properties, so it consumes Mariva tokens directly |
| Admin primitives | shadcn/ui, cmdk 1.1, `@tanstack/react-table` 8.21, react-hook-form 7.83 | Copied in, restyled to tokens; focus management stays ours |
| Admin charts | Bklit (shadcn registry) | 17+ chart types as source; Recharts is the fallback |
| Data fetching | `@tanstack/react-query` 5.101 + `@orpc/tanstack-query` | Typed end to end from the contract |
| Motion budget | `motion` 12.42 | Guest surfaces choreograph; admin feedback ≤150ms, no entrance animation |

## Quality and delivery

| Concern | Choice | Why |
|---|---|---|
| Test runner | Vitest 4.1.x | One runner, whole repo |
| Nest under Vitest | `unplugin-swc` 1.5.x + `@swc/core` 1.15.x | Vitest transforms with Oxc/esbuild, neither of which emits `emitDecoratorMetadata`; without it every Nest injection in a test is `undefined` |
| Real Postgres in test | `@testcontainers/postgresql` 12.0.x | Local and CI use the same helper, not a CI-only service container. `apps/api/vitest.config.ts` shows the current `.env.test` implementation gap |
| Test task cache | No replay of database-backed success until runtime dependencies are hermetic and represented | A stale Turbo result must not mask a missing Postgres runtime; policy lives in `turbo.json` |
| Property tests | fast-check 4.9.x | "No assignment map ever overlaps" |
| E2E | Playwright 1.61.x | Keyboard-only check-in; visual baseline of the acts |
| Seed data | `@faker-js/faker` 10.5.x, `vi` locale | Realistic Vietnamese guest data |
| Lint + format | Biome 2.5.x | One repository config; its executable scope and current API exclusion live in `biome.jsonc` |
| Git hooks | lefthook 2.1.x | Format + typecheck on commit |
| ERD | `drizzle-dbml-generator` 0.10.x | Schema → DBML, CI fails on drift |
| Excel export | exceljs 4.4.0 | Kept at the M8 re-evaluation, 2026-08-20 — the only adopted writer that streams a workbook *and* formats a cell. See §Excel export, re-evaluated |

## Excel export, re-evaluated

`FR-OPS-03` asks for a streamed Excel export and made the choice conditional on
a re-evaluation at M8. **Decided 2026-08-20: exceljs 4.4.0 is kept.**

The requirement's own word decides it. "Streamed" is not a preference — an
export that assembles a whole workbook in memory has a memory profile that
fails on the one month somebody actually needs, which is the month the property
had a problem. That rules out most of the field, and what survives has to format
a cell as well, because the file exists so an accountant can sum a column of
đồng and a numeric cell needs a number format to be readable as money.

What was measured, on the day:

| Library | Latest | Published | Streams a workbook | Formats a cell | Weekly |
|---|---|---|:-:|:-:|---:|
| **exceljs** | 4.4.0 | 2023-10-19 | yes | yes | 11.4M |
| `write-excel-file` | 4.1.1 | 2026-06-08 | no | yes | 569k |
| `xlsx-write-stream` | 1.0.4 | 2026-05-12 | yes | **no** | 21k |
| `@zurmokeeper/exceljs` | 4.4.9 | 2025-02-26 | yes | yes | 4k |
| `@e965/xlsx` (SheetJS) | 0.20.3 | 2024-07-19 | no | yes | — |

`xlsx-write-stream` is the closest alternative and describes itself exactly:
"strictly a CSV replacement", with no formatting, one sheet and no number
formats. It would mean either a column of undecorated digits or text cells that
cannot be totalled, and losing the column an accountant opens the file for is a
larger cost than an old release date. `write-excel-file` is maintained and
formats well, and buffers — it builds the zip and hands back a `Blob`.
`@zurmokeeper/exceljs` is a maintained fork with the same streaming API; it is
the fallback if exceljs is ever found to be broken rather than merely still, and
it is not the choice today because it has three ten-thousandths of the adoption
and one maintainer.

**The staleness is real and is a staleness rather than a defect.** 4.4.0 is the
last stable release; the last publish of anything was a prerelease on
2024-12-20. Against that: no advisory stands against 4.4.0 — the one CVE on the
package was fixed in 1.6.0 — its dependency ranges resolve to patched versions
of `tmp` and `jszip`, it is MIT, it ships its own types, and the streaming
writer was verified against Node 25 in this repository before the decision was
made. A format that has not changed and a library that has not changed are a
better pairing than most.

**What the risk is bounded by.** `apps/api/src/modules/reporting/excel-sheet.ts`
is the only file in the tree that imports it, and its interface — columns, a
stamp, an async source of rows — names nothing exceljs owns. Replacing the
library is that one file.

**Re-evaluate again if any of these becomes true**, rather than on a date: an
advisory is filed against 4.4.0 or a dependency it pins, it stops working on a
Node LTS the project moves to, or a maintained library appears that streams a
workbook and formats a cell.

## Rejected, and why

| Rejected | Reason |
|---|---|
| Prisma | Cannot express `daterange` / `EXCLUDE`; type safety fails exactly at money and inventory |
| tRPC | Gateway webhooks need real REST — it would mean two API layers |
| Redis + BullMQ | A service to run and back up, and enqueue cannot join the DB transaction |
| `@nestjs/schedule` alone | A timer, not a queue: two instances close the books twice |
| Tailwind in `apps/web` | Rewrites the most fragile CSS in the repo for no user-visible gain |
| dinero.js / decimal.js | `bigint` VND is complete |
| MUI X Pro | Paid tier for grid features TanStack Table gives free |
| A PDF engine for invoices | The legal invoice is the e-invoice provider's output |
| Node 25 | Odd-numbered Current line, never an LTS |
| Two test runners | Vitest everywhere |
| Hand-rolled VNPay HMAC | Use the maintained `vnpay` library |
| `xlsx-write-stream` for the Excel export | Streams, but is a CSV replacement with no cell formats — a đồng column would be unreadable or unsummable. See §Excel export, re-evaluated |
| `write-excel-file`, SheetJS for the Excel export | Both buffer the whole workbook before the first byte, which is the memory profile `FR-OPS-03` says "streamed" to avoid |

## oRPC compile-time contract evidence

**Does `@orpc/nest` enforce the contract at compile time? Yes. The contract
layer stands as designed.**

Measured, not read from documentation. Isolated project, `@orpc/contract` /
`@orpc/nest` / `@orpc/server` 1.14.10, `@nestjs/common` + `@nestjs/core` 11.1.6,
zod 4.4.3, TypeScript 5.6.3. `Implement`'s signature is what does the work:

```ts
declare function Implement<T extends ContractRouter<any>>(contract: T):
  <U extends Promisable<Router<T, ORPCGlobalContext>>>(…) => void
```

The decorated method's return type is constrained to a `Router` derived from the
contract, so divergence is a type error at the implementation site.

Four deliberate violations, each typechecked in isolation:

| Violation | `tsc` | Error |
|---|:-:|---|
| Output missing a required contract field | **fails** | TS2322 — property missing |
| `number` where the contract says `bigint` | **fails** | TS2322 — `number` not assignable to `bigint` |
| Handler reads an input field the contract never declared | **fails** | TS2339 — property does not exist |
| Output carries an **extra** field the contract omits | *passes* | none — see the caveat |
| Contract gains a required field; handler untouched | **fails** | TS2345 — argument not assignable |

The money regression `VndAmount` exists to prevent is caught by the contract on
its own. The required-field case verifies the direction that actually happens:
the contract changes and an implementation goes stale.

**Caveat: the contract is a floor, not an exact shape.** An extra output field
compiles. It does not reach the wire — zod's object schema strips unknown keys,
verified: an `internalCostBasis` added to the handler's return was absent from
the parsed output. So this is not a data-leak path, but the compiler will not
tell you about a field you meant to delete. Reviews catch that; types do not.

### The constraint this spike found

`@orpc/*` ships **ESM only** — `"type": "module"`, a single `.mjs`, no CJS
entry. Consequences for `apps/api`, measured:

| `apps/api` config | Result |
|---|---|
| `module: commonjs` + `moduleResolution: node10` | TS2307 — cannot see the types at all |
| `module: nodenext` + package `type: commonjs` | TS1479 — an ESM module cannot be `require`d |
| `module: nodenext` + package **`type: module`** | **clean** |
| `moduleResolution: bundler` | TS5095 — incompatible with `module: commonjs` |

**`apps/api` is therefore an ESM package**, not the CommonJS default a Nest
scaffold produces. Relative imports need explicit `.js` extensions. Decided
here rather than during server binding, which is the whole point of the gate.

### What the first implemented contract found

The spike above proved the contract layer typechecks. Implementing `GET /health`
against it — the first route to go through `@Implement` — found two things a
type test could not, both measured.

**A Nest exception thrown inside an oRPC handler does not reach Nest's
exception filter.** `ServiceUnavailableException` came back as a 500, not a 503;
the contract layer catches the throw and encodes it first.
`health.controller.spec.ts` is the assertion that holds the status line, and the
handler raises `ORPCError("SERVICE_UNAVAILABLE", { status: 503 })` instead.

This generalises, and M3 is where it bites: an availability query that rejects a
stay restriction, and a booking that loses the race for the last room, both owe
the caller a specific status — 400 and 409 — and neither gets one by throwing
`BadRequestException` or `ConflictException` inside a handler. Domain services
may keep raising Nest exceptions; whatever crosses the `@Implement` boundary
states its own status.

**Deny-by-default survives, and is now asserted.** `AccessGuard` reads its
metadata off the same method `@Implement` decorates, so `@RequiresCapability`
and `@Unguarded` behave exactly as they do on a `@Get`, including the fail-closed
403 for a route that declares neither. That is not inference —
`access.guard.orpc.spec.ts` proves all three outcomes on oRPC handlers, because
the two ways it could have failed are silent and opposite.

### The contract package is built, not read as source

`packages/shared` emits `dist/` and its `exports` point there. It used to be
compiled from `.ts` by whichever app imported it, via
`transpilePackages: ["@mariva/shared"]`.

Holding the contract ended that. ESM-only `@orpc/*` puts the package on
`moduleResolution: nodenext`, where a relative import must name the emitted file
— `./money.js`. Turbopack resolves that specifier literally, finds no such file
beside `money.ts`, and fails the web build. Next has no extension aliasing that
reaches it: `experimental.extensionAlias` is webpack's, and was measured to be
ignored under both `experimental` and `turbopack`.

So the file the specifier names is made to exist. `packages/api-client` is built
for the same reason, and `turbo.json` gains `dependsOn: ["^build"]` on
`typecheck` and `dev` so a clean clone reports a missing build as a build, not
as a missing module.
