# Advise — Is the material enough to write tasks now?

- Date: 2026-07-26
- Repo: `C:/Users/tamla/Downloads/khach-san` (branch `chore/web-react19-next16`)
- Input: `docs/` (5 architecture docs + authority map + 11 report chapters), `plans/backlog.md`, `plans/260726-p0-foundations/plan.md`
- Question: enough to cut milestones and JIRA-style tasks? Last stage before coding?
- Mode: advisory only. No code changed.
- Supersedes the process advice in `plans/reports/archive/advise-260726-1440-task-readiness.md` (that report's steps 1, 2, 5 are complete).

Interview established: solo developer · >26 weeks to coursework submission · **no firm
property opening date** · `D1`–`D4`/`D7` are a mix of the user's own calls and genuinely
external answers, not yet separated.

---

## 1. Verdict

**Yes — enough. More than enough. Start coding.**

`plans/backlog.md` is not a draft that needs converting into tickets. It *is* the ticket
list: stable keys, milestone/epic/story hierarchy declared in §"How this maps to issues",
dependency order, DoD column citing metric IDs, gates modelled as blocking issues, a depth
rule, a reconciliation log, and a traceability table. Every readiness gap from the 14:40
report except three is closed.

The honest observation: **this is the sixth planning artifact and `apps/api/src` still
holds nothing but empty directories.** Seven `.gitkeep`-shaped module folders, a reserved
`packages/api-client`, zero lines of Nest. The risk today is no longer under-specification.
It is planning as a way of not starting. One more document would be the most reasonable-
looking mistake available.

Remaining genuine pre-code work is **~2 hours**, listed in §7. None of it is writing tasks.

## 2. What is already sufficient — do not redo

| Need | Where | State |
|---|---|---|
| Milestone list, order, dependencies | `backlog.md` M0–M11 | Complete |
| Issue hierarchy + DoD convention | `backlog.md` §"How this maps to issues" | Complete |
| Single ticket source, conflicts reconciled | `backlog.md` §9 + `docs/README.md` precedence | Complete — the 14:40 report's #1 item |
| Depth rule (story to P1, epic past it) | `backlog.md` §"Depth rule" | Complete |
| Gates as blocking issues | `G1`/`G2`/`G3` + the six-item `G2` checklist | Complete |
| RBAC content (`D5`) | `docs/architecture/rbac-matrix.md` | Complete, 4 ⚑ rows |
| State transitions (`D6`) | `docs/architecture/booking-state-machine.md` | Complete, 2 ⚑ rows |
| Stack + versions + rejected options | `docs/architecture/tech-stack.md` | Complete |
| Infra, money rails, e-invoice law | `docs/architecture/infrastructure.md` | Complete |
| Repo rules that survive growth | `docs/architecture/repository-structure.md` | Complete |
| Traceability skeleton | `backlog.md` §10, 12 bullets → milestone | Complete; Issue column empty by design |

M2 (P0) is executable today. Nothing in M2 consumes `D1`–`D4` or `D7`.

## 3. Do not create a tracker

Asked to argue this rather than assert it. The argument is in the user's own deliverable,
not in taste.

`docs/bao-cao/06-quy-trinh-phat-trien.md`:

- L159–160 — *"Một nguồn duy nhất, hoặc bạn sẽ hợp nhất chúng lại trong đầu mỗi sprint."*
  `plans/backlog.md` is named as that source.
- L247 — graded metric: *"Số nguồn của backlog | **1** tài liệu hợp nhất"*.

Importing the same stories into JIRA makes that claim false in a submitted chapter, and
re-creates the three-checklist failure `backlog.md` §9 exists to prevent. Solo, there is
nobody to assign to, no WIP contention, no standup, no burndown audience.

**What a tracker would genuinely give you, that the file lacks: per-story status.** That is
two columns, not a SaaS product — see §4.

Counter-case, honestly stated: if the grader ever asks for process evidence, a tracker is
legible in a way a markdown table is not. The user confirmed nobody but themself reads
tickets, and chapter 06 already presents the file as the evidence. Reversible later at the
cost of one import; not worth pre-paying.

## 4. Gap A — status, not content (the real gap)

The backlog's ticket *content* is done. Its *status* is already stale after one day.

M1 marks one row done (`P-1-01`). Git says seven of ten are landed:

| Key | Story | Actual | Evidence |
|---|---|---|---|
| `P-1-01` | Playwright visual baseline | done | `f4fc9c1` |
| `P-1-02` | Remove `@react-three/drei` | **done, not recorded** | `bbf313a` |
| `P-1-03` | React 19.2 | **done, not recorded** | `f30b021` |
| `P-1-04` | R3F 9.6 | **done, not recorded** | `f4f25ac` |
| `P-1-05` | Next 15 | **done, not recorded** | `796d694` |
| `P-1-06` | Next 16 | **done, not recorded** | `add70a2` |
| `P-1-07` | Pin Node to even LTS | **done, not recorded** | `d6c5ee5`, `.nvmrc` = 24 |
| `P-1-08` | `packages/tokens` | open | no `packages/tokens` |
| `P-1-09` | Biome replaces ESLint | open | `apps/web/eslint.config.mjs` still present |
| `P-1-10` | lefthook | open | no `lefthook.yml` |

**Fix: add `Status` and `Commit` columns to the M1 and M2 tables.** `todo` / `wip` / `done`,
and the SHA that closed it. That is the entire tracker feature set a solo developer needs,
it keeps the source count at 1, and it makes the DoD auditable against history.

Note `P-1-09`'s text is stale: it says Biome replaces `.eslintrc.json`, but the Next 16
migration already moved that to `eslint.config.mjs`.

## 5. Gap B — eight blank DoD cells in M2

The 14:40 report set metric #3: *100% of P0+P1 stories carry a linked success metric as
DoD*. Eight of M2's 27 stories have an empty DoD column:

`P0-INF-04` (Vercel project) · `P0-INF-07` (Better Stack) · `P0-API-05` (nestjs-pino) ·
`P0-API-06` (`/health`) · `P0-C-03` (oRPC router skeleton) · `P0-AUTH-01` (staff realm) ·
`P0-AUTH-03` (`@Roles()` guard) · `P0-CI-03` (fast-check wired)

Two of these are load-bearing. `P0-AUTH-03` is the guard the whole RBAC deliverable rests
on and its DoD is blank while `P0-AUTH-04` (the test) carries the metric — arguably fine,
but say so explicitly. `P0-C-03` gates on `G1` and has no verifiable finish line.

~20 minutes. Do it before coding, not after, or these are the four stories that get closed
on vibes.

## 6. Gap C — three small factual drifts

Each makes a sign-off ticket ambiguous in scope.

| Claim | Where | Reality |
|---|---|---|
| "six ⚑ rows" (RBAC) | `docs/README.md` L38, `backlog.md` `D5` | 4 ⚑ table rows; `rbac-matrix.md` L7 says "Six rows"; §5 lists 5 numbered decisions. Three-way disagreement |
| "three ⚑ rows" (state machine) | `docs/README.md` L39, `backlog.md` `D6` | 2 ⚑ table rows; the doc's own L6 correctly says "Two". §7's third item is a pointer to `D3`, not a ⚑ row |
| `D1`–`D4`/`D7` owner = "Owner"/"Accountant" | `backlog.md` §1 | Confirmed in interview as a **mix** of the user's own calls and genuinely external answers. Not separated, so the whole lump reads as blocked-on-someone-else |

Gap C's third row is the important one. See §7 step 5.

## 7. What you should do — ordered, ~2 hours

1. **`G1` — the `@orpc/nest` spike. 30 min. First.** A no-go rewrites `P0-C` entirely.
   Write the verdict into `tech-stack.md` §"Still open" either way, and flip the row.
   Do not write a contract line before it is written down.
2. **Fill the 8 blank DoD cells** (§5). 20 min.
3. **Add `Status` + `Commit` columns to M1 and M2; backfill M1's seven landed rows** (§4).
   15 min. This is the tracker.
4. **Reconcile the ⚑ counts** so `docs/README.md`, the backlog rows and the two documents
   agree on one number each (§6). 10 min.
5. **Split `D1`–`D4`/`D7` into two tables: *mine to decide* and *genuinely external*.**
   20 min, and it is the highest-leverage item here. With no opening date, the external
   half has no deadline pressure — so write defensible defaults for the mine half **today**
   and ⚑ them exactly like the RBAC rows. That converts the project's largest stated
   blocker from a wait into a write. Room count, floors, numbering, check-in/checkout
   times, rollover hour, rate-plan count, weekend definition are all yours. VAT rate,
   reduced-rate applicability, statutory retention floor are not — those stay external and
   stay config values, never constants.
6. **Email the professor about `D8`** (strict UML vs Mermaid-generated). Costs you two
   minutes, unblocks `P0-DOC-03`/`-04`, and the generators differ.
7. **Ask the accountant `M0-01`** (existing e-invoice provider? MISA AMIS?). It decides
   Viettel S-Invoice vs MISA meInvoice, which decides an API in M6. One question, long
   latency, no cost.
8. **Finish M1 first: `P-1-08` tokens, `P-1-09` Biome, `P-1-10` lefthook.** ~1 day, on the
   branch you are already on. Ordering matters: lefthook + Biome landing *before*
   `apps/api` exists means every API commit is formatted and typechecked from commit #1.
   Retrofitting a formatter across a new Nest app is a diff nobody reads.
9. **Then `P0-API-01`.** Nest 11 + Express 5. Code.

## 8. What you should not do

- ❌ **Create JIRA / GitHub Issues.** §3. Falsifies a graded claim, buys nothing solo.
- ❌ **Write M3+ stories now.** The depth rule already forbids it; `D1`/`D4` are undecided,
  so the acceptance criteria would read TBD — readiness metric #8 requires zero of those.
- ❌ **Wait on the owner conversation.** Nothing in M2 consumes `D1`–`D4`. Waiting is the
  most expensive thing available and it buys nothing this milestone.
- ❌ **Start `P0-C` before `G1`'s verdict exists in writing.** A verbal "it seemed fine"
  is how a rewritten epic gets discovered at `P0-C-04`.
- ❌ **Start `P0-DOC` before `D8`.** Generating Mermaid when the professor wants strict UML
  is throwing away the generator, not the diagram.
- ❌ **Write a seventh planning document.** This is the sixth. §1.
- ❌ **Buy the HSM certificate this week.** Disagreement with the backlog, stated in §9.

## 9. Where I disagree with the current backlog

**`M0` "starts today" is wrong now that there is no opening date.** `backlog.md` M0 says
*parallel, starts today* — correct under R3 §10's assumption of a scheduled opening. With
go-live unscheduled:

- `M0-02` (chữ ký số HSM) and `M0-03` (máy tính tiền SKU) start a certificate validity
  clock and an annual subscription for a system that will not issue an invoice for months.
  **Defer both to when M6 is in sight.** Keep the tickets; drop the due dates.
- `M0-04` (VNPay onboarding, with the refund-sandbox request) has weeks of latency and no
  recurring cost. **Keep it early** — it is the one where lead time genuinely bites.
- `M0-01`, `M0-05`, `M0-06` are questions to other people. Zero cost, long latency.
  **Send now**, expect answers whenever.
- `M0-07` (Better Stack probe from the day the ISP line goes live) **cannot** start early
  by construction. Leave it; it is not blocked, it is not yet possible.

This is a scheduling change, not a scope change. Record it in the backlog rather than
holding it in your head, or it reverts next time you read R3.

## 10. Benefits of doing it this way

- First production API commit lands **tomorrow**, not after another documentation round.
- Backlog source count stays **1** — the graded metric in chapter 06 §247 stays true.
- `G1` resolved before it can invalidate an epic, at its cheapest possible moment.
- The largest stated blocker (`D1`–`D4`) stops being a blocker without anyone answering
  anything, because the half that was always yours gets written down.
- lefthook + Biome precede the API, so no formatter retrofit diff ever exists.
- `Status`/`Commit` columns make every DoD auditable against git, which is strictly more
  evidence than a JIRA status field carries.

## 11. Trade-offs, honestly

- **Markdown status columns require manual discipline.** A tracker would nag; a table will
  not. Mitigation is the DoD-to-SHA link — a missing SHA is visible. M1 drifting six rows
  in one day is the warning, and it is the reason this is step 3 rather than optional.
- **No tracker means no process artifact** if a grader later wants one. Reversible for the
  cost of one import; you would just be importing a more complete file.
- **Writing defaults for `D1`–`D4` risks rework** if the real owner contradicts them. The
  RBAC and state-machine ⚑ convention already proved this costs little: a documented
  assumption is cheap to overturn, an undocumented wait is not.
- **Deferring the HSM certificate** means M6 could stall on procurement if go-live suddenly
  gets a date. Accepted: `M0-04`, the item with real lead time, stays early.
- **Six planning documents is already more than this project needed.** They are good
  documents, and the marginal one was worth less than the one before it. Stop here.

## 12. Work checklist

- [x] Run the `@orpc/nest` compile-time spike; write the verdict into `tech-stack.md`
      §"Still open" and flip `G1` in `backlog.md` §0
- [x] Fill DoD for `P0-INF-04`, `P0-INF-07`, `P0-API-05`, `P0-API-06`, `P0-C-03`,
      `P0-AUTH-01`, `P0-AUTH-03`, `P0-CI-03`
- [x] Add `Status` + `Commit` columns to `backlog.md` M1 and M2 tables
- [x] Backfill M1 rows `P-1-02` … `P-1-07` as done with their SHAs
- [x] Correct `P-1-09`'s text: `eslint.config.mjs`, not `.eslintrc.json`
- [x] Reconcile ⚑ counts across `docs/README.md`, `backlog.md` `D5`/`D6`,
      `rbac-matrix.md` L7/§5, `booking-state-machine.md` L6/§7
- [x] Split `backlog.md` §1 into *mine to decide* and *genuinely external*
- [x] Write ⚑-marked defaults for the *mine* half (property facts, rate-plan count,
      weekend definition, rollover hour)
- [x] Confirm VAT rate, reduced-rate applicability and retention floor stay config values,
      never constants
- [ ] Email the professor re `D8` diagram notation
- [ ] Ask the accountant `M0-01`; send `M0-05`, `M0-06`
- [x] Re-schedule M0 per §9: `M0-04` early, `M0-02`/`M0-03` deferred to M6, `M0-07` on ISP
- [x] Fill `backlog.md` §10 Issue column with the story keys that already exist
- [ ] `P-1-08` tokens · `P-1-09` Biome · `P-1-10` lefthook
- [ ] `P0-API-01` — scaffold `apps/api`

## 13. Success metrics for this stage

| # | Metric | Target |
|---|---|---|
| 1 | Backlog sources | **1** — `plans/backlog.md`; no tracker created |
| 2 | M2 stories with a blank DoD | **0** (currently 8) |
| 3 | M1 rows whose status disagrees with git | **0** (currently 6) |
| 4 | ⚑ counts that disagree across documents | **0** (currently 2 domains, 3-way and 2-way) |
| 5 | `G1` verdict recorded in `tech-stack.md` | **written**, either way, before the first `P0-C` line |
| 6 | Rows in `backlog.md` §1 whose owner is unseparated | **0** — every row is *mine* or *external* |
| 7 | Detailed stories written beyond M4 | **0** |
| 8 | New planning documents after this one | **0** before `P0-API-01` is committed |
| 9 | Hours from now to the first `apps/api` commit | **< 24** |
| 10 | Money spent on M0 procurement before M6 is in sight | **0** except VNPay onboarding (free) |

## 14. Unresolved

1. `D8` — professor's diagram notation. One email; blocks `P0-DOC-03`/`-04` only.
2. `G1` — `@orpc/nest` compile-time enforcement. 30 minutes, and it is step 1.
3. Which of `D1`–`D4`/`D7` are genuinely external. Unseparated as of this report; §7 step 5
   is the separation itself, and it is the user's to make.
4. VAT rate and reduced-rate applicability at opening — accountant only, time-sensitive,
   config from day one.
5. Carried unchanged: offshore CCCD storage (`M0-05`), NĐ 70/2025 applicability (`M0-06`),
   VNPay refund sandbox (`M0-04`), Bklit accessibility (M9), `exceljs` replacement (M8),
   channel manager (M11).
