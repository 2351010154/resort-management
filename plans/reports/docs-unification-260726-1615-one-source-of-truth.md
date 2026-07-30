# Docs unification — one map, one authority per fact

- Date: 2026-07-26
- Branch: `chore/web-react19-next16`
- Scope: documentation only. No code touched, nothing committed or pushed.

## Created

| File | Content |
|---|---|
| `docs/architecture/tech-stack.md` (93 lines) | Decided stack distilled from R2 + backlog. Runtime/API/contract/frontend/quality tables, rejected options, open items pointing at `G1`, M8, M9, `D8`. Links archived R2 |
| `docs/architecture/infrastructure.md` (118 lines) | Decided infra + money rails from R3: hosting, Neon/pg-boss interaction, backup + restore drill, two R2 buckets and lifecycle retention, VNPay/MoMo, `G2` trigger, e-invoice (NĐ 70/2025, máy tính tiền SKU, HSM), connectivity rule. Links archived R3 |
| `plans/reports/archive/` | New home for the five advise reports |

## Moved

All five `plans/reports/advise-*.md` → `plans/reports/archive/`. `plans/reports/`
top level now holds only `archive/`, `handover-260726-react19-next16.md` and
`screenshots/`.

**`git mv` not possible:** `/plans/` is in `.gitignore`, so the reports were
never tracked. Plain `mv` used. Consequence: git history is *not* the safety net
for anything under `plans/` — the archive directory is.

## Edited

| File | Change |
|---|---|
| `docs/README.md` | Rewritten as the authority map: precedence stated once (backlog > docs > bao-cao; archived reports = frozen rationale), language rule, 7-row `fact domain → canonical file → status` table, decision-graduation rule (`D*` open row → `docs/` file → row flips to Done). Kept the "written as built", generated-diagram and figure paragraphs |
| `plans/backlog.md` | Header precedence prose replaced by a one-line pointer to `docs/README.md`; report list repointed at `archive/` and annotated with which doc distils R2/R3; added `P0-DOC-06` (pre-submission bao-cao ↔ canonical sync check) |
| `docs/bao-cao/README.md` | "Quy ước biên soạn" precedence paragraph → one Vietnamese sentence + link to `../README.md`. Status table, figure table, diagram/no-unmeasured-numbers rules and submission format untouched |
| `docs/bao-cao/10-phu-luc.md` | Refs [27]–[29] repointed at `archive/`; [26] no longer restates precedence; new [30] `docs/README.md` (authority map), [31] tech-stack, [32] infrastructure. Existing numbering preserved |
| `README.md` (root) | Stale advise-report reference dropped; new one-line **Documentation** section pointing at `docs/README.md` |
| `plans/260726-p0-foundations/plan.md` | Archive path + pointer to the authority map |

## Language sweep (item 6)

`docs/README.md`, `docs/architecture/*.md`, `plans/backlog.md` and the plan files
were **already English**. No prose needed translating. Retained Vietnamese domain
terms, now glossed on first use in `docs/README.md` and
`docs/architecture/infrastructure.md`: *hóa đơn điện tử*, *chữ ký số*, *hóa đơn
khởi tạo từ máy tính tiền*, *hóa đơn điều chỉnh / thay thế*, *khách sạn*, *đồ án*,
Nghị định 70/2025. `plans/backlog.md` keeps the same terms in `M0-*` rows, where
they name the exact SKU being purchased.

## Reconciliation, bao-cao ch. 03 / 04 / 06 (item 7)

Three drifts found, all fixed on the bao-cao side.

| Chapter | Was | Now |
|---|---|---|
| 03 §3.2 runtime row | "`.nvmrc` hiện ghim **Node 20 — đã hết vòng đời**… phải ghim cùng lúc" | Node 24; `.nvmrc` + `engines` + CI pinned together in P−1. Verified: `.nvmrc` = 24, `engines.node` = `>=24.0.0`, CI uses `node-version-file: .nvmrc` |
| 04 §4.8 repo-state table | `apps/web` "đang migrate lên React 19 + Next 16" | Migration landed — React 19.2, Next 16.2, R3F 9.6; remaining P−1 work named (`packages/tokens`, Biome, lefthook). Toolchain row gained the Node 24 pin |
| 06 §6.7 risk register | "Node 20 đã hết vòng đời" open, mitigation pending | Marked ✅ closed with the mitigation that landed |

Checked and found **no drift**: every version in ch. 03 (Nest 11.1, Express 5.2,
Drizzle 0.45, `pg` 8.22, oRPC 1.14.10, pg-boss 12.26, zod 4.4, Vitest 4.1,
Testcontainers 12.0, Biome 2.5, exceljs 4.4.0 …) matches R2 and the new
tech-stack table; ch. 03 §3.7.1 dependency list is correct post-drei-removal;
ch. 04 module map matches `repository-structure.md`; ch. 06 §6.2 milestone table,
§6.3 gates and §6.4 decision table match `plans/backlog.md`.

## Acceptance criteria — verified

1. `grep "thắng\|wins\|source of truth\|nguồn sự thật"` over `docs/` + `plans/`
   (excluding the archive): precedence stated only in `docs/README.md`. Two
   remaining `thắng` hits are unrelated ordinary usage (ch. 03 §3.6 "a decision
   should win by evidence", ch. 05 "the bucket silently wins").
2. Each map row names exactly one canonical path; none point into
   `plans/reports/archive/`.
3. `tech-stack.md` + `infrastructure.md` exist, decided-only, English, each
   linking its archived source report.
4. Canonical files carry no Vietnamese prose (glossed domain terms excepted);
   `docs/bao-cao/` is untouched Vietnamese.
5. `plans/reports/` top level = `archive/` + handover + screenshots;
   `grep -r "reports/advise-" --include="*.md"` returns no non-archive path.
6. `D5`/`D6` are the only Done D-rows; both point at `docs/architecture/`.
7. "What's our stack?" = `docs/README.md` → `docs/architecture/tech-stack.md`.
8. Reconciliation findings above.

All three new/rewritten files are far under `docs.maxLoc: 800` (81 / 93 / 118).

## Unresolved

1. `/plans/` is gitignored, so the backlog, the plans and the archived reports
   have no version history. The archive move is therefore the only record that a
   report was superseded. Worth deciding whether `plans/` should be tracked.
2. `plans/backlog.md` M1 rows `P-1-03` … `P-1-07` have no Done marker although
   the commits landed (React 19, R3F 9, Next 15, Next 16, Node pin). Left alone —
   backlog status upkeep was outside this task's scope.
3. Bao-cao chapters 05, 07, 08, 09, 10 were not reconciled — item 7 scoped the
   pass to 03 / 04 / 06. `P0-DOC-06` now owns the full sweep before submission.
