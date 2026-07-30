# Implement — backlog HTML dashboard

- Date: 2026-07-26 · Branch `chore/web-react19-next16` · not committed, not pushed
- Handoff: `plans/reports/handoff-260726-1647-backlog-html-dashboard.md`

## Delivered

| File | State |
|---|---|
| `scripts/backlog-view.mjs` | new · 1107 lines (≈420 JS, the rest the inline CSS/HTML template) · `node:fs` + `node:path` only |
| `plans/backlog.html` | generated · 129 KB · gitignored, regenerable |
| `package.json` | `+1` line: `"backlog:view": "node scripts/backlog-view.mjs"` |

Nothing else touched. `apps/`, `packages/`, `docs/`, `plans/backlog.md` unmodified.

**Note:** the working tree carries unrelated modifications under `apps/web/**`,
`apps/web/package.json`, `pnpm-lock.yaml` and `apps/web/stylelint.config.mjs` that were not
present in this session's opening git status and are not mine. Left alone.

## Source-of-truth constraint — honoured as specified

No `localStorage`, `sessionStorage`, `indexedDB` or `document.cookie` anywhere (grep: 0).
Ticks are session-only JS state; reload discards them. "Copy markdown updates" emits
paste-ready rows grouped by milestone/epic. No alternative mechanism substituted — the
staged-edit + copy model is what shipped.

The G2 gate checklist and the §12 pre-code checklist are checkable on the same terms, and
the copy output emits them as `- [x]` lines under a heading naming their own source file
(`backlog.md` §0 and the advisory report respectively) — so every tick on the page has a
paste destination and none of it hides in the browser.

Sample output after ticking two M1 rows and one M2 row:

```
<!-- staged in plans/backlog.html, generated 2026-07-26T09:58:39Z -->

### backlog.md — story rows

#### M1
<!-- this table has no Status column yet; header becomes: | Key | Story | DoD | Status | -->
| `P-1-02` | Remove unused `@react-three/drei` | Build green · `R2#2` | done |
| `P-1-05` | Next 14.2 → 15; audit async `cookies()`/... | Screenshots green | done |

#### M2 / P0-INF
<!-- this table has no Status column yet; header becomes: | Key | Story | DoD | Status | -->
| `P0-INF-01` | Neon project `aws-ap-southeast-1`; ... | `R3#1` ≤ $5/mo pre-trigger | done |
```

The header comment appears once per table, not once per row. When advise §7 step 3 adds
`Status`/`Commit` to the tables, the comment disappears on its own and the emitted row
replaces the existing Status cell instead of appending one — no code change needed.

## Parse results — measured, not asserted

```
14 milestones · 66 stories · 10 without DoD · 3 gates · 8 decisions · 15 pre-code items
```

- 66 stories = M0 7 + M1 10 + M2 35 + M3 14. Matches the file row-for-row.
- 14 milestones: M0–M11 plus M6.5 and M9.5. **There is no M2.5** — the handoff's
  "M2.5/M6.5/M9.5 style half-steps" named one that does not exist in the source.
- 3 gates, `G2` with its 6 sub-items · 8 decisions `D1`–`D8`, 2 done (`D5`, `D6`) with
  working relative links to their `docs/architecture/*.md` files.
- 15 pre-code items parsed live out of §12 of `advise-260726-1628-task-writing-readiness.md`
  rather than copied into the generator — same DRY rule the dashboard exists to enforce.
  If that file moves, the section renders a "source not found" notice, not a stale copy.

### Two numbers came out different from the handoff

**Blank DoD is 10, not 8.** The advisory's metric counts M2 only. The file also has
`P1-SCH-02` (`room` — number, floor, type, housekeeping status) and `P1-SCH-04` (stay
restrictions) blank in M3. The tile therefore reads **10**, with the sub-line
`8 of them in M2 · target 0 (advise §13 #2)`, and all ten are flagged inline. Reporting 8
would have meant hardcoding the advisory's scope into a generated view — the opposite of
what this is for. The `no DoD` status filter returns exactly those ten.

**Traceability needed a definition to read 0/12.** Row 12's Issue cell is not empty — it
holds `One production gateway closes this`, a note. Counting non-empty cells reported 1/12
for a table with zero issue keys in it. The rule is now: an issue key is one unspaced
token. Row 12 fails it, so the metric reads **0/12** and matches both the acceptance
criterion and the truth. Documented at the `isIssueKey` definition.

## Acceptance criteria

| # | Criterion | Result |
|---|---|---|
| 1 | `pnpm backlog:view` regenerates the HTML | ✅ verified via pnpm |
| 2 | Node built-ins only, no new dependency | ✅ two imports, `node:fs` + `node:path` |
| 3 | All milestones in file order | ✅ 14, order is array order, never sorted |
| 4 | 3 gates, `G2` with 6 sub-items | ✅ |
| 5 | 8 decisions with owner and blocks | ✅ |
| 6 | Every M1/M2 story key present, count matches | ✅ 10 + 35 |
| 7 | Blank-DoD stories flagged, count is a metric | ✅ 10 flagged inline, headline tile |
| 8 | Traceability 0/12 | ✅ |
| 9 | 15 pre-code items above the milestone tree | ✅ |
| 10 | No network reference | ✅ `https?:` 0 · `//` 0 · external `src`/`href` 0 |
| 11 | No storage write | ✅ 0 occurrences of all four APIs |
| 12 | Copy produces paste-ready markdown | ✅ exercised in-browser, output above |
| 13 | Keyboard: `/` focuses search, all boxes reachable | ✅ 87 checkboxes, 0 `tabindex="-1"`, `:focus-visible` ring throughout, `<details>`/`<summary>` for collapse |
| 14 | Vietnamese renders | ✅ `hóa đơn điện tử`, `chữ ký số`, `thu chi`, `giảm giá`, `⚑` — `characterSet` UTF-8, no BOM, no mojibake |
| 15 | Byte-identical regeneration except timestamp | ✅ two runs diffed, identical modulo the 2 timestamps |

## Verified in-browser (file:// load, no network)

- 0 console errors.
- Filters: `auth` → 4 rows in M2 only · `blank` → the 10 blank-DoD rows across M2 and M3 ·
  `done` → 1 row (`P-1-01`, the only row the file marks done) · `m11` → M11 alone ·
  `optimizer` → M5 alone. Reset restores 14 / 66.
- Prose-only milestones (M6.5, M9.5, M11) survive the filter on their own heading — an
  early version hid them, which under-reported the plan rather than filtering it.
- `/` moves focus to the search box and does not fire while typing in a field.
- 900px and 1280px: body horizontal scroll = 0, no element overflows the viewport, wide
  tables scroll inside `.table-scroll`.
- Contrast (light): body 15.3 · muted 6.2 · warn 5.8 · gate chip 5.3 · done chip 5.0.
  Dark: body 14.7 · gate chip 7.1 · done chip 8.2. `--good` was darkened one step and the
  key chips get inverted text in dark mode; both were below 4.5 before.
- No entrance animation. Transitions are limited to hover/disclosure feedback, and
  `prefers-reduced-motion: reduce` kills all of them.

Screenshots were not capturable — the preview pane was not displayed, so the browser
reported "not compositing frames". Everything above was verified through the DOM,
computed styles and measured geometry instead.

## Where honesty and polish pulled apart

Three places, all resolved toward honesty:

1. **The blank-DoD count.** 10 looks worse than 8 and is correct.
2. **`0/12` traceability** required deciding a sentence is not an issue key. A dashboard
   that read 1/12 would have looked marginally better and been wrong.
3. **M4–M11 progress bars.** They render `epic level — not counted` rather than 0% or 100%.
   A bar for a milestone with no stories is invented progress; the strip would look more
   complete with twelve bars on it and would mean nothing.

## What resisted parsing

- **`## M0`/`## M1` tables sit directly under the milestone**, with no `###` epic. They get
  a synthetic group with no epic label rather than an invented epic name.
- **Milestone prose splits before and after the groups.** M4's `DoD: R1#15 …` line comes
  *after* the bullets and is a footnote to the milestone; M2's "Plan already exists…" comes
  before. Rendered as intro vs outro accordingly, the outro with an accent rule.
- **Wrapped paragraphs.** The source hard-wraps at ~78 columns, so a sentence is several
  lines. Folded back before rendering, otherwise every note broke mid-word.
- **`docs/erd.dbml` and `docs/openapi.json`** are named in `P0-DOC` but do not exist —
  their own stories create them. Local paths are linked only when the file is really on
  disk, so those two render as plain code, and `docs/architecture/*.md` render as links.
- Nothing else fought back. The file's structure is unusually regular for hand-written
  markdown, which is why ~420 lines of parser and renderer cover all of it.

## Unresolved

1. The unrelated `apps/web/**` + `pnpm-lock.yaml` modifications in the working tree. Not
   from this task; someone should confirm they are intentional before anything is committed.
2. `P-1-01`'s DoD cites `b80e902`; advise §4 cites `f4fc9c1` for the same story. The
   dashboard shows the file's value without comment — it renders the source, it does not
   arbitrate. Worth resolving when the `Commit` column lands.
3. Whether the `no DoD` metric should keep counting all 10 or narrow to M2 once
   `P1-SCH-02`/`-04` are filled. Currently it counts everything and names the M2 subset;
   no change needed unless the graded metric is meant to be M2-only forever.
4. Carried from the handoff: whether this view earns a CI drift check. Byte-identical
   regeneration is now proven, so the check is cheap to add whenever it is wanted.

Status: DONE
Summary: `scripts/backlog-view.mjs` + generated `plans/backlog.html` ship a
milestone/epic/story dashboard parsed entirely from `plans/backlog.md` and §12 of the
readiness advisory, with staged-only ticks and a markdown copy-back path — no second source
of status. All 15 acceptance criteria verified.
Concerns/Blockers: blank-DoD is 10 across the file, not the 8 the handoff expected (8 in M2
+ 2 in M3); traceability needed an explicit "an issue key is one unspaced token" rule to
read 0/12 rather than 1/12. Both resolved toward the source, both documented above.
