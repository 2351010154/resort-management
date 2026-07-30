# Handoff prompt — backlog HTML dashboard

Hand the block below to the implementing agent verbatim. Recommended agent:
`ui-ux-designer` (it owns self-contained HTML artifacts in this repo). `fullstack-developer`
is the fallback if the generator script turns out to be the larger half of the job.

---

## PROMPT — copy from here

### Environment

- Primary working directory: `C:/Users/tamla/Downloads/khach-san`
- OS: Windows 11, `win32`. Shell: PowerShell primary; Bash (Git Bash) also available
- Package manager: pnpm 11.1.2 · Task runner: Turborepo 2.10.7 · Node 24 (`.nvmrc`)
- Monorepo: `apps/{web,admin,api}`, `packages/{shared,api-client}`
- Branch: `chore/web-react19-next16`
- Timezone: Asia/Bangkok
- Reports path: `C:/Users/tamla/Downloads/khach-san/plans/reports/`
- **`/plans/` is gitignored** (`.gitignore:28`). Generated output there is local and
  regenerable, never committed.

### Task

Build a **generated HTML dashboard for checking task progress** against
`plans/backlog.md`, plus the Node script that generates it.

Two deliverables:

1. `scripts/backlog-view.mjs` — reads `plans/backlog.md`, parses it, emits the HTML.
   Zero runtime dependencies; Node 24 built-ins only (`node:fs`, `node:path`). No new
   package installs.
2. `plans/backlog.html` — the generated output. Fully self-contained: inline CSS, inline
   JS, no network requests, no CDN, no external fonts, no build step to view. Opens by
   double-click.

Add `"backlog:view": "node scripts/backlog-view.mjs"` to the root `package.json` scripts.

### The one hard architectural constraint — read this before designing anything

**`plans/backlog.md` is the single source of truth for task status, and this HTML must
never become a second one.**

This is not a style preference. `docs/bao-cao/06-quy-trinh-phat-trien.md` line 247 states a
graded project metric: *"Số nguồn của backlog = **1** tài liệu hợp nhất"* (backlog sources
= 1). `docs/README.md` line 9 declares `plans/backlog.md` the winner for "tickets, phases,
gates and status". An HTML that stores tick state in `localStorage` and drifts from the
markdown violates both.

So the interaction model is:

- The HTML **renders** status parsed out of the markdown. That is the truth on load.
- Ticking a checkbox in the browser is a **staged, session-only edit**. Never persisted to
  `localStorage`, never written to disk by the page.
- A **"Copy markdown updates"** button emits the exact markdown table rows the user should
  paste back into `plans/backlog.md`, so the file stays authoritative and the round trip
  is one paste.
- A visible banner states which file is the source and shows the generation timestamp, so
  a stale view is obvious rather than trusted.

If you think a different mechanism serves this better, say so in your report — do not
silently substitute `localStorage` persistence.

### Files to read first

| File | Why |
|---|---|
| `plans/backlog.md` | **The data source.** 396 lines. Every structure you must parse |
| `plans/reports/advise-260726-1628-task-writing-readiness.md` | §12 has a 15-item pre-code checklist that belongs in the dashboard as its own section; §4/§5/§6 list known data gaps you must render honestly |
| `docs/README.md` | The authority map and precedence rules. Explains why the source-of-truth constraint exists |
| `apps/web/app/globals.css` lines 1–40 | The Mariva design tokens. Reuse these values |
| `apps/web/scripts/capture-visual-baseline.mjs` | Script conventions in this repo: `.mjs`, kebab-case, top-of-file comment explaining intent |
| `package.json` (root) | Where the script entry goes |

### Structures in `plans/backlog.md` you must parse

Parse, do not hardcode. The file changes; the script must survive it.

| Section | Shape | Notes |
|---|---|---|
| §0 Gates | Table: `Key · Gate · Blocks · Detail` | `G1`, `G2`, `G3`. **`G2` additionally has a 6-item `- [ ]` checklist** under "### G2 — the trigger checklist" — parse those as sub-items |
| §1 Decisions | Table: `Key · Decision · Owner · Blocks · Status` | `D1`–`D8`. Status text contains `Open` or `**Done** → <path>` |
| `## M0` … `## M11` | `##` heading = milestone | Heading carries name, phase code, and an italic estimate e.g. `*2–3 weeks*`, sometimes `**bold emphasis**` |
| `### P0-INF` etc. | `###` heading = epic | Only some milestones have epics. M4 onward use `- ` bullet lists instead of tables |
| Story tables | `Key · Story · DoD` | Key is the stable ID. **DoD cells are sometimes empty — 8 of them in M2. Render empty as a visible warning, never as blank space** |
| Bullet-list milestones (M4–M11) | `- **P2-SM** — description` | Epic-level only, no keys per story. Render as epics with no checkable children |
| §9 Reconciliation log | Table | Render as a collapsed panel — context, not tasks |
| §10 Traceability | Table: `# · Brief bullet · Milestone/epic · Issue` | 12 rows. **Issue column is empty; show 0/12 filled as a headline metric** |
| §11 Unresolved | Numbered list | Render as a panel |

**Status parsing.** A `Status` column does not exist in the story tables yet — it is being
added. Handle both:

- If a story table has `Status` and/or `Commit` columns, use them (`todo` / `wip` / `done`).
- If not, infer: a DoD cell containing `Done` means done (M1's `P-1-01` reads
  `Done — b80e902`); everything else is `todo`.
- Never crash on a column that is absent. Never assume column order — map by header name.

### Known data reality — render this, do not clean it up

The dashboard's job is to make gaps visible. From the advisory report:

- **8 M2 stories have an empty DoD**: `P0-INF-04`, `P0-INF-07`, `P0-API-05`, `P0-API-06`,
  `P0-C-03`, `P0-AUTH-01`, `P0-AUTH-03`, `P0-CI-03`. Flag each inline and count them in a
  headline metric.
- **M1 status is stale**: the file marks 1 of 10 done; 7 are actually landed. Do not
  hardcode the correction — just make the status column visible enough that the drift is
  obvious.
- **Traceability Issue column is 0/12 filled.** Headline metric.

### Functional requirements

1. **Milestone → epic → story tree.** Collapsible at milestone and epic level. M0–M11 in
   file order (that order is dependency order — never re-sort it).
2. **Per-milestone progress**: `done / total` and a bar. Exclude epic-only milestones
   (M4–M11) from completion math, or show them as "epic level — not counted". Do not
   invent progress for stories that do not exist.
3. **Headline metrics strip**, sourced from the advisory report's §13 targets:
   - stories with blank DoD (current: 8 · target 0)
   - traceability rows filled (current: 0/12 · target 12/12)
   - open decisions `D1`–`D8` (target: 0 unseparated)
   - gates unresolved (`G1` open, `G2` 0/6 ticked, `G3` open)
4. **Gates panel, visually distinct from stories.** Gates are merge blockers, not work
   items — `G2`'s 6 sub-items get their own checklist. A gate must never look tickable in
   the same way a story does.
5. **Decisions panel** `D1`–`D8` with owner and what each blocks. Link a `Done` decision to
   its `docs/` path.
6. **Pre-code checklist section** — the 15 items from §12 of
   `advise-260726-1628-task-writing-readiness.md`. This is what the user works through
   *first*, so place it above the milestone tree.
7. **Filter/search**: free-text over key + story text, and a status filter
   (all / todo / wip / done / blank-DoD).
8. **Blocked-by rendering**: where a story or milestone consumes a decision or sits behind
   a gate (the file says so in prose — "Consumes `D1`, `D4`", "gated by `G1`"), surface it
   as a badge on that milestone or epic.
9. **"Copy markdown updates"** — per the constraint above. Emit only rows the user actually
   changed this session, as valid markdown table rows ready to paste.
10. **Keyboard usable.** Tab order sane, focus visible, `/` focuses search, checkboxes
    reachable and togglable by keyboard. This project's own admin DoD is keyboard-first;
    do not ship a mouse-only dashboard.

### Design requirements

- **Reuse the Mariva palette** from `apps/web/app/globals.css`: `--ivory #f4efe6`,
  `--ivory-warm #eee7de`, `--sand #cfc0ab`, `--stone #8a7b6e`, `--stone-deep #645c51`,
  `--umber #3a332b`, `--ink #1c1915`, `--dusk-amber #b48b60`, `--ocean #7fa2b7`. Copy the
  values into the HTML — `packages/tokens` does not exist yet, so there is nothing to
  import. Add a comment naming `globals.css` as the origin.
- **This is an operational screen, not a marketing page.** The repo's own rule (backlog M4
  DoD): admin interaction feedback under 150ms, **no entrance animations on operational
  screens**. No scroll-triggered reveals, no staggered fades, no hero section. Density and
  scan-ability beat impression.
- System font stack. No web fonts.
- Light theme primary (the palette is warm/light). Dark via
  `@media (prefers-color-scheme: dark)` if cheap; skip it rather than do it badly.
- Respect `@media (prefers-reduced-motion: reduce)`.
- Readable at 1280px and usable down to ~900px. Wide tables scroll inside their own
  `overflow-x: auto` container; the page body never scrolls horizontally.
- Vietnamese text appears in the source data (`hóa đơn điện tử`, `thu chi`, `giảm giá`) —
  ensure it renders correctly, UTF-8 throughout, no mojibake.

### Acceptance criteria

- [ ] `pnpm backlog:view` regenerates `plans/backlog.html` from `plans/backlog.md`
- [ ] Script uses Node built-ins only; no new dependency in any `package.json`
- [ ] All 12 milestones (M0–M11, including M2.5/M6.5/M9.5 style half-steps) appear in file
      order
- [ ] All 3 gates appear, `G2` with its 6 sub-items
- [ ] All 8 decisions `D1`–`D8` appear with owner and blocks
- [ ] Every M1 and M2 story key from the file appears; count matches the file exactly
- [ ] The 8 blank-DoD stories are each visibly flagged, and the count is a headline metric
- [ ] Traceability shows 0/12 filled
- [ ] §12's 15 pre-code items appear as a checklist above the milestone tree
- [ ] Opening the file with no network available renders identically — verify by checking
      there is no `http`/`https`/`//cdn` reference anywhere in the output
- [ ] No `localStorage` / `sessionStorage` / `indexedDB` write anywhere in the page
- [ ] "Copy markdown updates" produces paste-ready markdown rows
- [ ] Keyboard: `/` focuses search, all checkboxes reachable and togglable, focus ring
      visible throughout
- [ ] Vietnamese strings render correctly
- [ ] Re-running the script twice with no source change produces a byte-identical file
      except the timestamp — no random ordering, no unstable iteration

### Constraints

- **DO NOT COMMIT OR PUSH.** Leave changes in the working tree.
- Do not modify `plans/backlog.md`. It is the source; this task only reads it.
- Do not modify anything under `docs/`.
- Do not modify anything under `apps/` or `packages/`.
- Do not add dependencies. Do not run `pnpm install`.
- Do not create additional markdown files outside `plans/` or `docs/`.
- Do not hardcode backlog content into the HTML template. Everything renders from the
  parse. A hardcoded story list is the drift this dashboard exists to prevent.
- Follow YAGNI / KISS / DRY in that order. No framework, no bundler, no TypeScript build
  step. One script, one HTML file.
- Prefer kebab-case file names. Write comments that explain *why*, matching the density of
  `apps/web/scripts/*.mjs`.

### Report back

Write your report to
`C:/Users/tamla/Downloads/khach-san/plans/reports/` using the naming pattern
`{type}-260726-{HHMM}-{slug}.md`.

End your final message with:

```text
Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
Summary: one or two sentences
Concerns/Blockers: optional
```

List any unresolved questions at the end of the report. Specifically flag: any backlog
structure that resisted parsing, and any place where rendering the data honestly conflicted
with making the dashboard look finished.

## PROMPT — copy to here

---

## Why the prompt is shaped this way

- **Source-of-truth clause is first and justified with a file:line.** Without it the agent
  will reach for `localStorage` — it is the obvious solution to "checkable dashboard" — and
  that quietly breaks a graded metric in `docs/bao-cao/06`.
- **Generator script, not hand-authored HTML.** A hand-written dashboard drifts from
  `backlog.md` within a day. M1 already drifted six rows in one day; a static HTML would
  be the seventh source of stale status.
- **Blank DoD cells named explicitly.** An agent optimising for a polished screen will
  render an empty cell as empty space. The whole value here is that 8 gaps become visible.
- **"No entrance animation" is quoted from the project's own M4 DoD**, so the instruction
  reads as a project rule rather than personal taste — otherwise a design agent will add
  scroll reveals to a spreadsheet.
- **Byte-identical regeneration** is the check that catches unstable `Object.keys` ordering
  and stray randomness, which is what makes a generated artifact CI-able later.

## Unresolved

1. Whether the `Status`/`Commit` columns get added to `plans/backlog.md` before or after
   this dashboard is built. The prompt handles both, but adding them first (report §7
   step 3) means the dashboard shows real status on day one instead of inferring it.
2. Whether this view eventually earns a CI drift check like `P0-DOC-01`. Not worth deciding
   until the dashboard is used for a week.
