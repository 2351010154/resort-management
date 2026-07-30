# Advise — Are the three reports enough to write the backlog?

- Date: 2026-07-26
- Repo: `C:/Users/tamla/Downloads/khach-san` (branch `chore/web-react19-next16`)
- Input: reports 1–3 (`advise-260726-0939`, `-1119`, `-1401`) + `plans/260726-p0-foundations/plan.md`
- Question: enough material to cut milestones and JIRA-style tasks before coding?
- Mode: advisory only. No code changed.

---

## 1. Verdict

**Enough to write the whole skeleton — milestones, epics, dependencies, sequencing. Not enough to write executable acceptance criteria for P1 pricing, P2 policy, and P3 money.**

The reports settled *architecture* and *parts*. They never settled *commercial rules*. You cannot write "policy-driven refund calculation" as a testable ticket when no document says what the cancellation deadlines or penalties are. Same for VAT rate, service-charge ordering, deposit rule, no-show charge, rate-plan count.

That gap is ~2 hours of decisions, not weeks of work. But it is the difference between tickets that can be closed and tickets that stall on "what should this actually do?" at implementation time.

Second finding, cheaper to fix and more likely to bite: **you have three overlapping checklists that already contradict each other**, and report 1 §19 amended some of them. Writing JIRA from all three produces duplicates and re-introduces corrections you already made.

---

## 2. What is already sufficient — do not re-derive

| Backlog need | Source | State |
|---|---|---|
| Milestone list + order + dependencies | R1 §14 phase table | Complete, amended once, correct |
| Epic content per phase | R1 §15 checklists | Complete |
| Definition of Done | R1 §16, R2 §11, R3 §11 metrics (48 total) | Complete — see §5 |
| Tech choices per task | R2 §3, R2 §9 install order | Complete |
| Non-goals (scope defence) | R1 §4 | Complete, unusually good — guard it |
| Vendor/paperwork tickets | R3 §10 immediate block | Complete, ticket them verbatim |
| Risk register material | R1 §9, R2 §8, R3 §9 trade-offs | Complete |

P0 is fully writable today. P1–P2 are writable at epic level today, story level after §3.

---

## 3. Gap A — decisions missing everywhere, blocking acceptance criteria

None of these exist in any of the three reports. Each blocks specific tickets.

| # | Missing decision | Blocks | Why the ticket is unwritable without it |
|---|---|---|---|
| 1 | **Property facts** — room count, type mix, floors, numbering scheme, check-in/checkout times, business-date rollover time, max occupancy per type, extra-bed rule | P1 seed, P2 check-in, P6 night audit | R1 §18 Q1 flags room count as open. Rollover time is the night-audit ticket's entire spec |
| 2 | **Tax & charge model** — VAT rate, service charge %, **whether VAT applies on top of service charge**, gross-or-net display, VND rounding rule, tax class per service | P3 folio, every total in the system | R1 §6.2 says "separate posting lines", never says the numbers or the ordering. Ordering changes every folio total. VAT reduced-rate status is time-sensitive → accountant, not a guess |
| 3 | **Cancellation / no-show policy grid** — deadline offsets, penalty amounts, no-show charge, early-departure charge | P2 cancellation, P3 refunds, P4 booking funnel copy | "refundable / non-refundable / deadline" is a schema shape, not a policy. Refund-calculation tests have no expected values |
| 4 | **Rate structure at launch** — how many rate plans (BAR only? +non-ref? +long-stay?), season calendar, weekend definition, child/extra-person pricing | P1 rate_calendar, P1 seed, P4 search results | Determines whether P1 is 3 weeks or 5 |
| 5 | **RBAC matrix content** — 6 roles × actions, allow/deny | P0.03 guard + its test, R1 §13 use-case diagram | Roles are *named*; the matrix does not exist. It is an input to two tickets and one deliverable |
| 6 | **Booking state-machine transition table** — which transitions are legal, which charge money (CHECKED_IN → CANCELLED? NO_SHOW → charge?) | P2 state machine + illegal-transition tests, R1 §13 state diagram | "Illegal transitions rejected" needs the list of legal ones |
| 7 | **Service catalog** — items, prices, tax class | P3 service posting, P5 shift handover | Minor; can be seeded thin and filled later |

**Recommendation:** one short doc — `docs/operations/property-rules.md` — holding 1–4 and 7, and `docs/architecture/rbac-matrix.md` + a state-transition table for 5–6. Items 5 and 6 you can decide alone in an hour. Items 1–4 need the owner/accountant. Write them as *decision* tickets in M1, blocking the tickets that consume them.

---

## 4. Gap B — three checklists, one backlog

Known conflicts if you transcribe all three literally:

| Conflict | Correct version |
|---|---|
| pg-boss at P6 (R1 original) vs **P3** (R1 §19 #1) | P3 |
| Retention/backups/restore/monitoring at P7 (R1 §15) vs **before the VNPay prod-credential commit** (R1 §19 #3, R3 §3.5) | Before the trigger — lands ~P4 |
| CI Postgres service container (`plans/260726-p0-foundations/plan.md` phase 04 prose is already correct; R1 §19 #7 flags the drift) | Testcontainers — verify the plan file has no residue |
| MoMo at P3 (R1 §3 #12) vs **conditional P3.5** (R3 §5.1) | Conditional P3.5 |
| Ordinary e-invoice (R1 original) vs **máy tính tiền SKU + HSM** (R3 §6) | R3 §6 |
| P0 checklist appears in R1 §15, R2 §10, R3 §10 with different items | Union, deduplicated, once |

**Do this before the first ticket:** produce one consolidated backlog document with the amendments applied, and mark the three reports read-only rationale. One source, or you will merge them again in your head every sprint. This is a ~1-hour mechanical job and it is the single highest-value thing you can do before opening JIRA.

---

## 5. Recommended issue hierarchy

```
Milestone  = phase        (P0, P1, P2, P2.5, P3, …)   — already dependency-ordered with estimates
Epic       = capability inside the phase              (e.g. "Two-layer inventory", "Rate plans")
Story      = a checklist line from R1 §15
DoD        = the matching success metric
```

**The 48 success metrics are your acceptance criteria — map them explicitly.** Two cross-checks fall out for free:

- A metric with no task → work you will not do.
- A story with no metric → probably not needed, or the metric is missing.

Three items that are **gates, not stories**, and should be blocking issues with checklists:

1. **oRPC `@orpc/nest` spike** (R2 §13 Q2) — blocks P0.03. 30 minutes. Do it first; a no-go rewrites the contract epic.
2. **The trigger** (R3 §3.5) — the commit flipping VNPay to production credentials. Model as one blocking issue in M-P4 carrying the six-item checklist. Nothing merges past it unticked.
3. **Paperwork epic, parallel to everything, starting now** — VNPay onboarding (with refund-sandbox request), HSM cert, máy-tính-tiền SKU, lawyer, tax agent. Weeks of someone else's process. Give each a due date, not a sprint.

Plus one standing artifact: **traceability table** (R1 §13) — 12 brief bullets → issue key. Fill it while writing tickets, not at the end.

---

## 6. Depth rule — do not write the whole backlog

Detail **two milestones deep** (P0, P1 as stories). Keep P2 onward as epics with the checklist pasted into the description. Everything past P3 will be rewritten once real data exists — R3 §5.1 already makes MoMo conditional on funnel data you do not have.

Writing 200 tickets today for P6 is inventory you will throw away. YAGNI applies to backlogs.

---

## 7. Order of operations before the first line of code

1. Consolidate three checklists → one backlog doc (§4). ~1h.
2. Decide RBAC matrix + state-transition table (§3 items 5, 6). ~1h, solo.
3. Book the owner/accountant conversation for §3 items 1–4. Write it as a decision ticket; do not block on it.
4. Run the `@orpc/nest` spike (§5 gate 1). 30 min.
5. Pin Node to an even LTS — `.nvmrc`, `engines`, CI matrix together (R1 §18 Q8: Node 20 is EOL as of April 2026). 15 min, inside the migration already in flight.
6. Open JIRA. Milestones from R1 §14, stories P0–P1 only, DoD from the metric tables.
7. File the paperwork epic the same day.

Steps 1, 2, 4, 5 total under three hours and remove every avoidable ambiguity from the first two milestones.

---

## 8. What NOT to do

- ❌ Transcribe all three checklists into JIRA — duplicates plus reverted corrections (§4).
- ❌ Write stories past P3 in detail (§6).
- ❌ Write P1 rate/P3 folio acceptance criteria before §3 items 2–4 are decided — they will read "TBD" and be closed on vibes.
- ❌ Treat the trigger checklist as a normal story. It is a merge gate.
- ❌ Start P0.03 before the oRPC spike verdict is written down.
- ❌ Let the reports become editable backlog. They are dated rationale; the backlog moves, they do not.

---

## 9. Success metrics for this stage

| # | Metric | Target |
|---|---|---|
| 1 | Backlog sources | **1** consolidated doc; three reports read-only |
| 2 | Superseded items re-entered as tickets (§4 list) | **0** |
| 3 | Stories in P0+P1 with a linked success metric as DoD | **100%** |
| 4 | Success metrics (48) with no owning ticket | **0**, or explicitly deferred with a reason |
| 5 | Brief bullets mapped in traceability table | **12/12** before the first P1 commit |
| 6 | Blocking gates modelled as issues | **3** (oRPC spike, trigger, paperwork) |
| 7 | Detailed stories beyond P3 | **0** |
| 8 | Tickets whose acceptance criteria say "TBD" | **0** |

---

## 10. Unresolved questions

1. **§3 items 1–4** — property facts, tax model, cancellation grid, rate structure. Owner + accountant. Largest blocker to writable stories.
2. **VAT rate and whether the reduced rate applies at opening** — time-sensitive, accountant only. Do not hardcode from memory; make it config from day one.
3. **Professor's diagram notation** (R1 §18 Q5) — strict UML vs Mermaid-generated. Affects the P0 docs tickets, nothing else.
4. **Room count and type mix** (R1 §18 Q1) — also decides whether P2.5's optimizer has anything to optimize.
5. Carried, unchanged: `@orpc/nest` compile-time enforcement (R2 Q2), offshore CCCD storage (R1 Q2/R3 Q3), NĐ 70/2025 applicability (R3 Q1), e-invoice provider via accountant (R3 Q2), VNPay refund sandbox (R3 Q4).
