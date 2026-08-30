# Evaluation — the automated test suite, as run

A dated record of what the repository's own test commands actually returned on
one machine, on one commit: how many tests ran, how long they took, which of
them passed, and — for the six that did not — what the failure output said. It
is evidence, not a decision. The requirements and their targets belong to
[`product-requirements.md`](../product-requirements.md); this file only reports
what a run returned.

**Four commands were run. Three came back clean and one did not.**

| # | What ran | Result |
|---|---|---|
| 1 | `turbo run test --force` — the whole workspace, Vitest | **4 720 passed, 0 failed, 0 skipped** |
| 2 | `turbo run build --force` | **5 of 5 tasks succeeded** |
| 3 | `turbo run typecheck --force` | **7 of 7 tasks succeeded** |
| 4 | `playwright test` — the admin console, Chromium | **1 passed, 6 failed** |

The fourth is the one worth reading. Two of its six failures are the console's
markup no longer matching what the spec looks for, and would fail against any
data at all; the other four are a queue the seeded property leaves empty or
one row short. Either way `NFR-04` and `NFR-11` were **not** demonstrated by
this run, and §2.5 says so at the level of the individual test.

## 1. What was run, and the verdict

| Field | Value |
|---|---|
| Commit | `9338c58a05ccf3994bbd6ceeadac24873499d54c`, branch `feat/m10-deploy-artifacts` |
| Date | 2026-08-30 |
| Working tree | clean at the time of the run — no uncommitted source change is inside these numbers |
| Vitest suite | started 13:40:45 +07:00, ended 13:47:15 +07:00, **turbo exit `0`** |
| Console e2e | started 13:51:06 +07:00, ended 13:53:57 +07:00, **`playwright test` exit `1`** |
| Machine verdict | `pnpm run lint`, `turbo run typecheck --force`, `turbo run build --force` and `turbo run test --force` all exited `0`; `pnpm --filter @mariva/admin test:e2e` exited `1` |

Nothing was skipped, focused or retried to reach these figures. `vitest run`
reports a skip count when there is one and reported none; a search of every
spec file in the repository for `it.only`, `test.only`, `describe.only`,
`.skip`, `.todo`, `xit` and `xdescribe` returns nothing. `playwright.config.ts`
fixes `retries: 0`, so the six failures below are first attempts and only
attempts.

## 2. Results

### 2.1 The workspace Vitest suite

`turbo run test --force` across all six workspace packages. `--force` matters
and is not decoration: `turbo.json` declares no `cache: false` on the `test`
task, so an ordinary `pnpm test` is free to replay a previous success without
executing anything. Every line below is a bypassed cache — turbo printed
`cache bypass, force executing` for all six tasks, and the run reported
`Cached: 0 cached, 6 total`.

| Package | Test files | Tests | Passed | Failed | Skipped | Vitest duration | Start |
|---|---|---|---|---|---|---|---|
| `@mariva/shared` | 15 | 183 | 183 | 0 | 0 | 0.666 s | 13:40:46 |
| `@mariva/web` | 20 | 257 | 257 | 0 | 0 | 1.88 s | 13:40:50 |
| `@mariva/admin` | 37 | 791 | 791 | 0 | 0 | 2.30 s | 13:40:50 |
| `@mariva/api` | 163 | 3 489 | 3 489 | 0 | 0 | 385.64 s | 13:40:49 |
| **Total** | **235** | **4 720** | **4 720** | **0** | **0** | wall **6 m 29.681 s** | |

`@mariva/api-client` and `@mariva/tokens` declare no `test` script and ran none;
they are two of the six packages in scope and contribute no tests to the total.

The API is 74 % of the tests and 99 % of the time, because it is the only
package that talks to a real database. Its ten slowest files, all of them
database-backed:

| File | Tests | Duration |
|---|---|---|
| `test/tier-recompute-sweep.e2e-spec.ts` | 15 | 5 110 ms |
| `test/seed.e2e-spec.ts` | 19 | 4 187 ms |
| `test/room-charge-sweep.e2e-spec.ts` | 22 | 3 745 ms |
| `test/guest-booking-token.e2e-spec.ts` | 37 | 3 075 ms |
| `test/stay-length.e2e-spec.ts` | 25 | 2 847 ms |
| `test/booking-api.e2e-spec.ts` | 123 | 2 844 ms |
| `test/check-in-out.e2e-spec.ts` | 28 | 2 812 ms |
| `test/folio-refunds.e2e-spec.ts` | 25 | 2 735 ms |
| `test/room-assignment.e2e-spec.ts` | 32 | 2 680 ms |
| `test/folio-api.e2e-spec.ts` | 77 | 2 644 ms |

The per-file result and duration for all 235 files is in
[`workspace-suite.txt`](automated-test-suite/workspace-suite.txt), §3 explains
what was removed from it and what was not.

**The API's files do not run in parallel, by configuration rather than by
accident.** `vitest.config.ts` sets `fileParallelism: false` because the whole
suite shares one Postgres database and truncates tables in it, and
`test/global-setup.ts` takes a session-scoped advisory lock so that a *second*
`vitest run` waits rather than interleaving. Both were in force here. This is
most of why 3 489 tests take six and a half minutes, and it is a correctness
property rather than a performance defect.

### 2.2 `NFR-01` — fifty parallel bookings

`NFR-01` sets double-booking at **0**, "unrepresentable at the storage layer",
and names the 50-parallel-bookings test as its evidence
([`product-requirements.md`](../product-requirements.md) §5, and `FR-INV-02`
in §4). Two files carry that claim at two different layers. Both ran inside the
suite above and both passed; the per-case names and timings below come from the
targeted re-run described in §3.

**`test/booking-race.e2e-spec.ts` — over HTTP, through the route the desk uses.**
Nine of the property's ten Deluxe rooms are sold for the night of 2027-09-14,
then fifty `POST /bookings` for the tenth are issued together.

| Test case | What it exercises | Expected | Actual | Verdict |
|---|---|---|---|---|
| goes to exactly one of fifty simultaneous requests | 50 concurrent booking creations against one remaining room | exactly one `201`; exactly 49 `409`; no response `>= 500`; every `409` body carrying the sold-out message and no other conflict | as expected | **PASS** (207 ms) |
| leaves the property's books reading exactly what it owns | the counter and the booking rows after the race | `total_rooms` 10 and `sold_rooms` **exactly** 10 — not "at most" — and exactly one booking row, whose id is the `201`'s | as expected | **PASS** (3 ms) |
| leaves the night after it alone | the following night's counter | `sold_rooms` 0 on 2027-09-15, the departure date being half-open and therefore unsold | as expected | **PASS** (1 ms) |

The second and third assertions are what make the first one mean something. One
success and forty-nine refusals is also what a system that lost an increment
would report, and the counter check is what separates the two. The
`no response >= 500` line is asserted separately and by body: a `23514` check
violation that reached the wire untranslated is the specific defect this file
exists to catch, because it is the property telling forty-nine guests its
booking system is broken when what happened is that it sold its last room.

**`test/inventory-reservation.e2e-spec.ts` — at the service and the constraint.**
All ten passed. The concurrency case is the first; the rest bound what the same
write path does when it is not racing.

| Test case | Verdict |
|---|---|
| the last room of a type › goes to exactly one of fifty simultaneous requests | **PASS** (71 ms) |
| the last room of a type › leaves the night after it alone | **PASS** (1 ms) |
| a stay the property cannot sell in full › is refused, and leaves every night of it untouched | **PASS** (11 ms) |
| a stay across nights the property has not opened › is refused rather than sold across a calendar that does not exist | **PASS** (4 ms) |
| a stay that is sold › consumes one room on each of its nights | **PASS** (5 ms) |
| a stay that is sold › gives the nights back when it is released | **PASS** (4 ms) |
| a stay that is sold › refuses a release of nights nobody sold | **PASS** (3 ms) |
| simultaneous multi-night stays › sell exactly what the tightest night had left | **PASS** (25 ms) |
| requests that are not about inventory at all › refuses a stay of no nights | **PASS** (1 ms) |
| requests that are not about inventory at all › refuses a stay that ends before it begins | **PASS** (1 ms) |

**What the HTTP file does not measure, and says so itself.** The application's
pool is ten connections wide, so its fifty requests are fifty requests queueing
through ten rather than fifty simultaneous transactions at the row lock. The
file states this in its own header and declines to correct it, on the grounds
that what it is testing is the answer each of the fifty receives from the
arrangement a deployed API actually runs. True simultaneity at the lock is
`inventory-reservation.e2e-spec.ts`'s subject, and that file provisions its own
pool for it. Neither file alone carries `NFR-01`; the pair does.

**`NFR-01` says "in CI", and this run was not CI.** It was the same
arrangement — `.github/workflows/ci.yml` stands up `postgres:17` as a service
container on port 5433 with database `mariva_test`, writes `apps/api/.env.test`
pointing at it, and runs `pnpm run test` — reproduced by hand on the machine in
§4. What differs is the host and that CI's `pnpm run test` carries no `--force`,
so a CI run may legitimately replay a cached result where this one could not.

### 2.3 Payment reconciliation

Five files, 65 tests, all passed. Per-case names are in
[`targeted-verbose.txt`](automated-test-suite/targeted-verbose.txt).

| File | What it holds | Tests | Duration | Verdict |
|---|---|---|---|---|
| `src/database/schema/reconciliation.spec.ts` | the table: the unique daily key, the trading day as a date rather than an instant, both figures as whole đồng and nullable, the classification's members, and the fields the table refuses to carry | 12 | 5 ms | **12 PASS** |
| `src/modules/payment/reconciliation.service.spec.ts` | the comparison: matched is not a row; money the gateway took that never reached an account; a payment the report does not account for; an amount mismatch carrying both figures; a report naming one attempt twice refused rather than resolved; the second run writing nothing while still reporting what it found | 11 | 8 ms | **11 PASS** |
| `src/modules/payment/reconciliation.job.spec.ts` | the sweep: the sentence a discrepancy pages with, a rollover hour moved mid-sweep not splitting one night across two day boundaries, two gateways on one night, a settlement short by one cent, and a date that throws leaving the rest of the tick to finish | 14 | 13 ms | **14 PASS** |
| `test/payment-reconciliation-api.e2e-spec.ts` | the two routes over HTTP: the capability each declares against all five roles and an anonymous caller, the listing and its date filtering, range ceilings, and refusals | 21 | 857 ms | **21 PASS** |
| `test/payment-reconciliation-sweep.e2e-spec.ts` | the sweep end to end against the database: a discrepancy written down and paged over the wire, paged once however often the night is re-reconciled, a clean night recorded as looked at and waking nobody, an unreachable gateway leaving the night outstanding rather than filing every payment as missing | 7 | 630 ms | **7 PASS** |

The case named in the branch's own history — that a clean reconciliation night
is recorded as looked at and wakes nobody — is
`test/payment-reconciliation-sweep.e2e-spec.ts › a night the two reports agree
on › is recorded as looked at, and wakes nobody`, and it passed in 32 ms.

### 2.4 Coverage — `NFR-10`

`apps/api/vitest.config.ts` enables v8 coverage for a plain `vitest run` rather
than behind a separate script, and declares an 85 % floor on lines, functions,
branches and statements for each of eleven directory globs separately. A breach
fails the run. The run exited `0`, so **every one of the eleven floors held**.

The summary the run printed, over the `include` globs only:

```text
Statements   : 96.57% ( 2596/2688 )
Branches     : 90.08% ( 1317/1462 )
Functions    : 98.43% ( 753/765 )
Lines        : 96.54% ( 2541/2632 )
```

**These four numbers are not repository-wide and must not be cited as if they
were.** They cover the modules `vitest.config.ts` names — booking, guest,
housekeeping, jobs, inventory, pricing, folio, payment, operations, audit, and
two schema files — chosen because that is where the money and the silent
defects are. The three front-end and shared packages measure no coverage at all,
and `schema/folio.ts` and `schema/payment.ts` are deliberately outside the
measurement rather than inside it without a floor, for the reason the config
gives: v8 counts a Drizzle reference thunk as covered when the ORM introspected
the table, not when a test proved the constraint holds. A whole-tree percentage
for this repository was not produced by this run and is not stated here.

### 2.5 The console's Playwright run — six of seven failed

`pnpm --filter @mariva/admin test:e2e`, one worker, no retries, Chromium, against
a production `next start` on port 3002 and the API on 3001. Seven tests,
**1 passed, 6 failed**, 2.8 minutes, exit `1`. Full output:
[`console-e2e.txt`](automated-test-suite/console-e2e.txt).

| # | Test | Duration | Verdict |
|---|---|---|---|
| 1 | `keyboard-checkout.spec.ts` › a stay with a balance is checked out without a single mouse event | 15.8 s | **FAIL** |
| 2 | `nfr-04-feedback-timing.spec.ts` › the dashboard answers a keystroke and a press inside the budget | 10.7 s | **FAIL** |
| 3 | `nfr-04-feedback-timing.spec.ts` › the arrivals queue answers the keyboard inside the budget | 1.5 m | **FAIL** (90 s timeout) |
| 4 | `nfr-04-feedback-timing.spec.ts` › the departures queue answers the keyboard inside the budget | 15.7 s | **FAIL** |
| 5 | `nfr-04-feedback-timing.spec.ts` › the bookings screen answers typing, a submission and a press inside the budget | 11.1 s | **FAIL** |
| 6 | `nfr-04-feedback-timing.spec.ts` › no operational screen plays an entrance animation | 3.1 s | **PASS** |
| 7 | `nfr-11-keyboard-checkin.spec.ts` › a stay is checked in end to end without a single mouse event | 15.7 s | **FAIL** |

**Not one feedback measurement was taken.** Every `nfr-04` timing test failed
before it could time anything: the failures are `measureFeedback` reporting that
the acknowledgement it was waiting for never appeared, or `tabIntoQueue`
reporting an empty queue. So this run produces **no millisecond figure at all**
against the `< 150 ms` budget, in either direction. The one `NFR-04` test that
passed is its other half — no operational screen plays an entrance animation —
and that half is genuinely demonstrated.

The six divide into two kinds, and the distinction decides what each is
evidence of.

**Two fail against any data — the spec's selectors do not match the console's
markup.**

- **#2, the dashboard.** After tabbing to the rail, the spec presses Tab once
  and waits for `nav[aria-label="Console sections"] button` to take focus. That
  selector matches nothing. Playwright's captured page snapshot shows the
  element carrying `aria-label="Console sections"`
  ([`features/shell/app-nav.tsx`](../../apps/admin/features/shell/app-nav.tsx))
  containing only links, while the three buttons — the command palette, the
  drawer and "Open account menu for E2E Desk"
  ([`features/shell/user-menu.tsx`](../../apps/admin/features/shell/user-menu.tsx))
  — sit in a sibling element outside the rail. The spec's third measurement
  clicks the same non-matching selector, so it could not have run either.

  ```text
  Error: Dashboard · Tab leaves the rail for the account control: the console
  never showed `nav[aria-label="Console sections"] button` focused — no
  acknowledgement to measure.
  ```

- **#5, the bookings screen.** After submitting a search the spec waits for a
  `main button` reading **"Back to today"**. The bookings screen renders that
  control as **"Today"**
  ([`features/bookings/bookings-screen.tsx:253`](../../apps/admin/features/bookings/bookings-screen.tsx));
  the string "Back to today" exists in exactly one other place in the
  repository, `features/rates/rates-screen.tsx:557`, which is a different
  screen.

  ```text
  Error: Bookings · the search form acknowledges a submission: the console never
  showed `main button` visible carrying "Back to today" — no acknowledgement to
  measure.
  ```

  Whether the console's label changed or the spec was written against the rates
  screen's wording is not settled here. What the run establishes is only that
  the two disagree, and that no amount of seeded data changes that.

**Four fail on the data the seeded property holds.** The specs walk real queues
and refuse to fake one; on the business date this run fell on, the queues were
empty or one row short.

- **#1 and #4** stopped at `tabIntoQueue` with *"The queue on this screen is
  empty, so there is nothing to work."* — the departures queue had no rows.
- **#3 and #7** needed a second queue row: both wait on
  `tr[data-roving-item]` at index 1 after an ArrowDown, and the arrivals queue
  held exactly one row.

That matches the database directly. Against business date 2026-08-30, the
seeded property has **one** `CONFIRMED` arrival and **no** stay due to depart;
the console's own dashboard rendered "1 Arrivals awaiting Check-in" and
"0 Departures awaiting Checkout" in the failure snapshot. The seed spreads 500
synthetic stays across a year — roughly 1.4 arrivals a day — so a day with one
arrival and no departure is its ordinary output, not an anomaly.

**These four are therefore not evidence that the console's keyboard path is
broken, and not evidence that it works.** They are evidence that the suite
depends on ambient seeded data it does not provision, and that on this date
there was not enough of it. `NFR-11` — 0 mouse events end to end — was neither
demonstrated nor refuted by this run. No data was added to make them pass:
inventing arrivals to turn a red run green would have produced a number worth
less than the red one.

**Nothing runs this suite automatically.** `.github/workflows/ci.yml` runs
`lint`, `typecheck`, `test` and `build`, and never `test:e2e`. The vitest config
for `apps/admin` excludes `e2e/**` deliberately, because those specs import
`@playwright/test`. So the two requirements a browser is the only witness to
have no automated gate, and the six failures above could have stood for some
time without anything reporting them.

## 3. Method

**One machine, one commit, no edits.** No spec, config, threshold or fixture was
changed for this run. The working tree was clean at the recorded commit before
the first command and after the last, apart from files git already ignores
(`apps/api/.env.test`, `coverage/`, `test-results/`, build output). The
`.env.test` written for the run was deleted afterwards.

**Order.** `pnpm install --frozen-lockfile`, then `drizzle-kit migrate` against
the test database, then `turbo run build --force`, then `turbo run test --force`.
The console e2e followed, after seeding and standing up the two servers.

**The database.** `mariva_test` in the `mariva-pg-test` container on host port
5433 — the same port and database name `ci.yml` uses. `drizzle-kit migrate`
applied the full ledger: **47 migrations, 39 tables in `public`**, verified by
querying `drizzle.__drizzle_migrations` and `information_schema.tables` after it
finished. The suite truncates and re-seeds tables as it runs, which is why the
config refuses to start without `.env.test` and why the run holds an advisory
lock for its duration.

**`--force` on every turbo command, and why the number would otherwise be
worthless.** `turbo.json` gives the `test` task no `cache: false`, so turbo is
entitled to replay a previous success and print it as though it had run. Every
turbo invocation here passed `--force`, and each printed `cache bypass, force
executing` per task with `Cached: 0 cached`. Those lines are in the committed
evidence and are the reason these figures may be read as a run rather than as a
recording of one.

**The console e2e stand-up.** `pnpm --filter @mariva/api db:seed` against the
migrated database — 5 room types, 40 rooms, 365 nights from 2026-08-01 to
2027-07-31, 1 825 rates, 170 restrictions, 8 service items, 500 synthetic stays,
36 folios, 29 trading days closed through 2026-08-29. One `ADMIN` staff account
created with `staff:create` for the run to sign in with; its password was
generated for the occasion, passed to the run through the environment, never
written to a tracked file, and is not recoverable from anything committed here.
The API was started with `node dist/main.js` on port 3001 with `ADMIN_ORIGIN`
set to the console's origin, and answered
`{"status":"ok","database":"up"}` before the run began; the console was served
by `next start --port 3002` from the production build made in step three. Both
processes were stopped afterwards and both ports confirmed free.

**A second, targeted run for the per-case names.** `vitest run` prints one line
per *file*, not per test, so the individual case names in §2.2 and §2.3 come
from re-running those seven files with `--reporter=verbose`: 7 files, 78 tests,
all passed, 20.35 s, exit `0`. It was run with `--coverage.enabled=false`,
because a seven-file subset cannot meet whole-module coverage floors and would
have failed on that rather than on anything about the tests. **It is a naming
aid and not the authority** — the authority for pass and fail is the full run in
§2.1, which included all seven of these files with coverage on.

**What the committed evidence is, exactly.** All three files are verbatim
console output with ANSI colour codes stripped, and
`workspace-suite.txt` and `targeted-verbose.txt` additionally have the
interleaved pino log lines removed — every line beginning `{"level":`, 1 949 of
them in the suite log, which are the API's own per-request logging written to
the same stream. No line carrying a test name, a result, a count, a duration or
a summary was removed, and nothing was reordered or edited. The unfiltered logs
were not retained; the commands in this section reproduce them.

## 4. Environment

| Component | Value |
|---|---|
| CPU | AMD Ryzen 9 8940HX with Radeon Graphics — 16 physical / 32 logical cores |
| RAM | 31.2 GB |
| OS | Microsoft Windows 11 Pro, build 26200 |
| Node | v25.2.1 |
| pnpm | 11.1.2 |
| turbo | 2.10.7 |
| Vitest | 4.1.10 (`vitest/4.1.10 win32-x64 node-v25.2.1`) |
| Playwright | 1.62.1, Chromium, viewport 1440×900, locale `en-GB`, timezone `Asia/Bangkok` |
| Postgres | 17.10 (Debian 17.10-1.pgdg13+1), container `mariva-pg-test`, host port **5433**, database `mariva_test` |
| Container runtime | Docker Engine 29.6.2 |
| API under the e2e run | `node dist/main.js` on the host, port 3001, `NODE_ENV=development`, log level `info` |
| Console under the e2e run | `next start --port 3002`, Next.js 16.2.12, production build |

The machine is the one
[`nfr-03-availability-latency.md`](nfr-03-availability-latency.md) §4 records,
and the Postgres is the same container and port that document's host-process
set used.

## 5. Limitations

### 5.1 One run, so nothing here characterises flakiness

Every figure is a single execution. A suite that passes once has not been shown
to pass repeatedly, and the database-backed API files are exactly where an
order- or timing-dependent failure would hide. Nothing was run twice, so this
document cannot say whether any of the 4 720 is flaky. It can only say that on
2026-08-30 all 4 720 passed on the first attempt.

### 5.2 The passing figure is a local run, not a CI run

§2.2 sets out how closely the arrangement matches `ci.yml`. It is not identical:
this ran on Windows against a container on port 5433, CI runs on
`ubuntu-latest` against a service container. A requirement whose acceptance
criterion says "in CI" is satisfied by a CI run, and the correct citation for
that is a CI job, not this file.

### 5.3 Coverage is measured over ten directories, not the repository

Stated in full in §2.4. The four percentages there are over `apps/api`'s
money-moving modules. No front-end coverage was measured, and none of the four
should be repeated without the scope attached.

### 5.4 `NFR-04` and `NFR-11` are unproven either way

Six of seven console tests failed and no timing measurement was produced. Two of
the failures are a spec/markup disagreement that will recur on every run until
one side moves; four depend on a property with at least two arrivals and one
departing balance, which the seed does not guarantee on any given date. Until
both are addressed, this suite cannot return a verdict on either requirement,
and this document records the failures rather than a figure.

### 5.5 The e2e run used seeded data, on one business date

The four data-conditioned failures are a fact about 2026-08-30 against this
seed. A different date, or a re-seed, produces a different queue and possibly a
different set of failures. That variability is itself the finding: a run whose
result depends on which day it is executed on is not yet a gate.

### 5.6 What was not run

No load or performance test is in these numbers — `NFR-03` has its own
[evaluation](nfr-03-availability-latency.md) and its own method. No visual
baseline comparison was run; the scripts under `apps/web/scripts/` that capture
and compare it are manual, produce untracked output, and are not wired to a test
command. No mutation testing, no accessibility audit and no security scan were
performed, so nothing here speaks to the quality of the assertions as distinct
from their number.

### 5.7 A test count is not a coverage claim

4 720 passing tests says how much was checked, not how much matters was
checked. The suite is a good deal denser in some places than others by design —
the RBAC matrix is driven off its own table, and `apps/web` deliberately tests
only the funnel's pure logic because its components are verified in a browser
instead. Nothing in this document establishes that the untested remainder is
small or unimportant.

## 6. Traceability

- Requirement statements and targets: [`product-requirements.md`](../product-requirements.md) §4 (`FR-INV-02`) and §5 (`NFR-01`, `NFR-04`, `NFR-10`, `NFR-11`).
- `NFR-01`, over HTTP: [`apps/api/test/booking-race.e2e-spec.ts`](../../apps/api/test/booking-race.e2e-spec.ts).
- `NFR-01`, at the service and the constraint: [`apps/api/test/inventory-reservation.e2e-spec.ts`](../../apps/api/test/inventory-reservation.e2e-spec.ts).
- The storage-layer constraints those two prove: [`apps/api/src/database/schema/inventory.ts`](../../apps/api/src/database/schema/inventory.ts).
- Reconciliation: the five files listed in §2.3.
- Coverage floors and their reasoning: [`apps/api/vitest.config.ts`](../../apps/api/vitest.config.ts).
- Suite isolation against a shared database: [`apps/api/test/global-setup.ts`](../../apps/api/test/global-setup.ts).
- Console e2e configuration: [`apps/admin/playwright.config.ts`](../../apps/admin/playwright.config.ts).
- What CI runs: [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml).
- Raw evidence: the three files in [`automated-test-suite/`](automated-test-suite/), described in §3.
