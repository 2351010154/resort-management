# Orientation — start here

For the person building this, not for an agent. `plans/backlog.md` is written to
be executed; this file is written to be **read when you have been away for a
week and do not know what to touch next**.

It is deliberately not a fourth source of truth. It explains and it points.
Where it disagrees with the files named in [`README.md`](README.md), those files
are right and this one is stale — §6 and §8 are dated snapshots for exactly that
reason.

---

## 1. What Mariva is, in five lines

A **property management system for one resort**, built from scratch, plus the
public website that sells its rooms.

It has two audiences that never meet. A **guest** finds a free room, books it and
pays online. **Staff** — six roles, from housekeeping to admin — run the property:
check people in, post charges, take payment, issue the invoice, hand over the
shift, read the numbers. One database, one set of rules, two front doors.

It is also a coursework deliverable. The professor's twelve requirements are a
**subset** of what is being built, not the target — see §5.

## 2. The one thing that must never break

Everything else in this project is ordinary software. This is not:

> **Two guests must never be sold the same room for the same night.**

A hotel sells inventory that is finite, dated, and worthless the day after. The
usual way to get this wrong is to check availability in application code — read,
decide, write — because two requests can read the same "1 room left" before
either writes.

So the guarantee does not live in code. It lives in the database, in two layers:

| Layer | What it holds | What makes it safe |
|---|---|---|
| **Type level** — what you sell | rooms sold per night, per room type | `CHECK (sold_rooms <= total_rooms)`. Two people racing for the last Deluxe: one commits, the other's transaction is **rejected by Postgres** |
| **Room level** — what you operate | which physical room, which date range | `EXCLUDE USING gist` — an overlapping stay on the same room is **not representable**, so it cannot be stored by any code path, including a bug |

Guests book a *type* ("a Deluxe for three nights"). Room 301 is chosen at
check-in. That separation is what makes room moves, maintenance closures and
upgrades routine instead of a crisis.

The test that proves it — 50 parallel bookings on the last room, exactly 1
success — is written **before** any booking screen. It is milestone M3, and it is
the reason M3 is called the correctness core.

Design detail: `plans/reports/archive/advise-260726-0939-resort-pms.md` §6.1.

## 3. The shape

```
                    apps/web            apps/admin
              marketing + /booking      front desk + management
                   (guests)                  (staff)
                        \                    /
                         \                  /
                          apps/api  ← all business logic lives here, only here
                              |
                          Postgres
```

Three rules that follow from the picture:

- **One brain.** Front-ends never re-implement a rule. No business logic in Next
  server actions.
- **The contract is a package.** `packages/shared` holds the schemas; the API
  validates against them and both front-ends get their types from them. Break the
  contract and the build fails, not production.
- **`/booking` shares a domain with the marketing site but not its bundle.** The
  scrollytelling acts load Three.js, GSAP and Lenis. The booking funnel must load
  **zero bytes** of them — a conversion path is not a showreel.

## 4. Words the other documents assume you know

The docs are written in hotel vocabulary. This is the whole glossary.

| Term | What it means here |
|---|---|
| **Hold** | A booking that has reserved inventory but is not paid. Expires on a timer and gives the room back |
| **Folio** | The bill attached to one stay. **Append-only**: room nights, services, tax, payments as separate lines. "Editing an invoice" = adding a reversing line, never an `UPDATE` |
| **Reversing entry** | How money is corrected. The wrong line stays, an opposite line cancels it, a correct line follows. This is why the audit log is nearly free |
| **Night audit** | A job that runs every night: posts that night's room charges, rolls the business date forward, and freezes a snapshot. All reports read snapshots, so last month's numbers never change |
| **Business date** | The hotel's day, which is not midnight-to-midnight. Rolled by the night audit |
| **Housekeeping status** | `CLEAN / DIRTY / INSPECTED / OUT_OF_ORDER`. Completely separate from whether a room is occupied. A checked-out room is not sellable until inspected |
| **Occupancy / ADR / RevPAR** | The three numbers a hotel is actually judged on: % of rooms sold, average price achieved, revenue per available room. Gross revenue alone says nothing |
| **Máy tính tiền invoice** | Under Nghị định 70/2025, a hotel must create, sign and send the invoice to the tax authority **at the moment of sale**. Your checkout screen is legally the cash register. Needs a purchased HSM certificate — not a USB token, and not something you can build |
| **The trigger (`G2`)** | The commit that swaps VNPay sandbox credentials for production ones. The moment the system becomes real. A six-item checklist must be green before it |

Money is always **integer VND**. Stay dates are always `date`; event times are
always `timestamptz`. Mixing those two is the single most common source of
off-by-one-night bugs, so the contract types make it a compile error.

## 5. The road

Fourteen milestones. Each one ends with something you can demonstrate, and
stopping at any of them leaves a coherent system rather than a half-built one.

| # | Milestone | What you can do once it is done | Size |
|---|---|---|---|
| **M0** | Paperwork & procurement | Nothing visible. Unlocks real payments and legal invoices. Runs beside everything; mostly other people's latency | — |
| **M1** | Web migration | The marketing site sits on current React/Next, guarded by a visual baseline. Stable ground for the API | ~1w |
| **M2** | **P0** Foundations | API boots against Postgres, six roles enforced, tests actually run, ERD generates from the schema | 2–3w |
| **M3** | **P1** Inventory & availability | The system knows what is free on any date and **cannot** oversell. §2 lands here | 3–4w |
| **M4** | **P2** Booking lifecycle & front desk | A receptionist can check a guest in, move rooms, extend, cancel — keyboard only | 4w |
| **M5** | P2.5 Assignment optimizer | Refused bookings become revenue by re-packing rooms. Optional; blocks nothing | 2–3w |
| **M6** | **P3** Folio, payments, invoicing | You can take money and issue a legal invoice. Where the money is | 3–4w |
| **M6.5** | P3.5 MoMo | Second wallet. Only if VNPay-only abandonment proves it is needed | ~2w |
| **M7** | **P4** Guest booking engine | A stranger books on the website and pays. **The trigger lands here** | 3w |
| **M8** | **P5** Operations | Shift handover, thu chi, audit log viewer, Excel export | 2–3w |
| **M9** | **P6** Reporting | The charts the brief asks for, plus occupancy / ADR / RevPAR | 2–3w |
| **M9.5** | P6.5 Overbooking | Sell above 100% against a no-show model. Needs real data first | 1–2w |
| **M10** | **P7** Hardening | Security audit, load test, paper-fallback runbook | 2–3w |
| **M11** | P8 OTA channel manager | Booking.com / Agoda / Traveloka sell your rooms. Deferred, and the most expensive deferral here | — |

**The coursework:** all twelve of the professor's bullets are demonstrable by
**M9**, without ever building for the rubric. The mapping is `plans/backlog.md`
§10 — three bullets have a story key today, nine are still at epic level, which
is correct rather than a gap.

**Bold rows are the spine.** M5, M6.5, M9.5 and M11 can all be skipped or
deferred without breaking anything downstream.

## 6. You are here

*Snapshot, 2026-07-26. Derived from `git log`, the working tree and a test run;
per-story status lives in `plans/backlog.md` and wins over this section.*

- **M1 is eight of ten done.** Committed: the visual baseline, drei removal,
  React 19, R3F 9, Next 15, Next 16, Node 24, and the `@mariva/tokens`
  extraction. Biome is half-landed — `biome.json` and the dependency exist,
  `apps/web/eslint.config.mjs` is still there and CI still calls it, so the repo
  currently has two linters. lefthook does not exist.
- **M2 is much further along than the backlog records.** `apps/api` boots
  against a real Postgres — validated env, structured logging, `/health`
  returning 503 when the database is down, `btree_gist` enabled by migration
  `0000`. On top of that, **both auth realms are implemented end to end**: staff
  on Passport-JWT with argon2 hashing, guests on Better Auth, a **fail-closed**
  global access guard (a route without a capability decorator stops answering),
  the six-role matrix as 669 lines of code, a Resend mailer, and a staff-account
  creation script. Vitest is configured and **411 of 412 tests pass** — the one
  red test is the guest password-reset flow, where `/api/auth/forget-password`
  answers 404.
- **Not yet in M2:** the oRPC contract layer, Testcontainers, fast-check, every
  `P0-INF` provisioning row, the payment port, and the docs/ERD generators.
- **Nothing is built past M2.** No inventory, no booking, no folio, no payment.
  Most of `apps/api/src/modules/*` is still reserved empty directories.
- **The design record is complete and ahead of the code** — seven architecture
  documents, eleven coursework chapters, eight figures — and it is committed and
  pushed as of `2af3152` and `2d001c0`.
- **The branch is `chore/web-react19-next16`**, now on `origin`. `main` is far
  behind it and there is no pull request yet.
- **Uncommitted:** the API auth work, some arrival refinements in `apps/web`, the
  Biome config, the backlog viewer script, and a `(booking)/login` prototype.

## 7. How to answer "what should I do next?"

Four checks, in this order. Stop at the first one that gives you an answer.

1. **Is anything unpushed or uncommitted?** Land it first. Work that exists only
   in one working tree is not work, it is exposure.
2. **Is a gate blocking?** `plans/backlog.md` §0. `G2` in particular: nothing
   merges past the credential flip with an unticked box.
3. **Is the current milestone finished?** Finish it before opening the next one.
   Half-finished milestones are how a solo project accumulates three fronts and
   closes none.
4. **Then take the first `todo` row in the current milestone**, in table order.
   The order is dependency order, not preference.

Two things run **outside** this loop and should be done whenever you notice them:

- **Free questions to other people.** Zero cost, weeks of latency, and every one
  of them blocks something later. Send them; do not wait for answers.
- **The status columns.** A `done` row without a commit SHA is not done. They
  have drifted within a day twice already.

## 8. What to do next — today

*Ordered. Dated 2026-07-26; re-derive with §7 rather than trusting this list in
two weeks.*

1. **Fix the one red test, then commit the API auth work.** The guest
   password-reset e2e expects `200` from `/api/auth/forget-password` and gets
   `404`, so that route is not mounted. It is the last thing standing between a
   finished `P0-AUTH` and a commit — and a whole epic is currently unversioned.
2. **Finish M1** — a day of work, and it is 80% done:
   - `P-1-09` Biome — the config and the dependency landed, so what is left is
     deleting `apps/web/eslint.config.mjs` and pointing CI at Biome. Two linters
     is worse than either one.
   - `P-1-10` lefthook — format and typecheck on commit. **Land this before the
     API grows further**, or you will retrofit a formatter across a Nest app
     later, and that is a diff nobody reads.
   - `stash@{0}` carries reduced-motion and alt-text fixes for four act files
     that never landed. Everything else in it is already in the tree, so rebase
     those four files out and drop the rest. `apps/web/stylelint.config.mjs`
     belongs to the same piece of work and is currently orphaned — the config is
     there, the dependency and the lint script are not.
3. **Send the four questions you have been sitting on.** Ten minutes total:
   the professor (`D8`, strict UML or generated Mermaid — it decides which
   generator you build), the accountant (`M0-01`, existing e-invoice provider),
   the lawyer (`M0-05`, how long CCCD scans may be kept and whether they may live
   offshore), the tax agent (`M0-06`, whether Nghị định 70/2025 binds this
   entity). Then start VNPay onboarding (`M0-04`) — free, and the one place lead
   time genuinely bites.
4. **Reconcile M2's status rows against reality** — `P0-AUTH` is built and the
   backlog still calls it `todo`, which is how you end up rebuilding it. Then
   continue M2 in table order: `P0-C` contracts (unblocked — the `@orpc/nest`
   spike passed), `P0-CI`'s Testcontainers and fast-check, `P0-INF`
   provisioning, `P0-PAY`'s sandbox port.
5. **Then M3, and write the concurrency test first.** Not the schema, not the
   UI — the test that proves 50 simultaneous bookings on the last room produce
   exactly one success. It is the only test in this project that cannot be
   retrofitted honestly.

**Do not** start a seventh planning document. Six exist, they are good, and the
marginal one is worth less than the one before it.

## 9. The five things that could actually sink this

1. **Manual OTA inventory blocking** (M11 deferred). New resorts take most
   first-year bookings through Booking.com and Agoda. Until a channel manager
   exists, someone blocks inventory by hand across three sites — and that is the
   one double-booking source §2's database constraints **cannot** prevent,
   because it happens outside the database.
2. **The e-invoice chain** (`M0-02`, `M0-03`, M6). An HSM certificate and a máy
   tính tiền subscription are purchases with weeks of process. They block nothing
   until they block checkout entirely.
3. **Stored ID scans.** The highest-liability data in the system. The mitigation
   is aggressive retention: a bucket lifecycle rule deletes them, and a scheduled
   job only *verifies* the rule worked. Two enforcement paths would silently
   drift.
4. **Solo, no bus factor.** No review, no second pair of eyes. The compensation
   is tests on money and inventory paths — not on UI — plus documentation honest
   enough that a stranger could continue.
5. **`plans/` is gitignored.** `plans/backlog.md` is the single source of truth
   for every ticket and it has no version history, no branch, no backup. See §11.

## 10. Where facts live

[`README.md`](README.md) is the authority map: which document owns which fact,
and the precedence order when two disagree. Short version — **`plans/backlog.md`
owns status, `docs/architecture/` owns design, `docs/bao-cao/` consumes both and
owns nothing, and `plans/reports/archive/` is frozen rationale you cite but never
update.**

Run `pnpm backlog:view` for the backlog as a filterable HTML page. It is
generated from `plans/backlog.md` on every run and stores nothing, so it can
never become a second status source.

`plans/work-orders.md` is the delegation menu: the same backlog keys repackaged
into units sized for one handoff, with file ownership, readiness, what only you
can do, and which pairs may run in parallel. It carries no status either — pick
from it, then take the acceptance criteria from the backlog.

## 11. Open questions this document raises

1. **Should `plans/backlog.md` be version-controlled?** `.gitignore` excludes
   `/plans/`, so the file the whole project is tracked in has no history and
   exists on one machine. Either un-ignore that one file, or accept the risk
   knowingly. Un-ignoring it also makes the coursework's *"backlog sources = 1"*
   metric auditable by someone other than you.
2. **Should the committed visual baselines move to CI?** They currently fail on
   an unchanged tree on this machine, which means M1's safety net does not
   actually gate anything locally.
3. **Do the architecture documents' ⚑ defaults get a sign-off pass?** They are
   your own assumptions, written down so they stop being blockers. Nothing forces
   you to revisit them, and nothing reminds you either.
4. **Four git worktrees exist** — this one, `khach-san-base`, `khach-san-n15`,
   and one under `.worktrees/`. The two migration-bisect trees have done
   their job. Two writers in one working tree have already collided once over who
   owns the token package, which cost a day of parked work; decide which trees
   survive and whether more than one agent may write to a tree at a time.
