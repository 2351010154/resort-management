// Renders plans/backlog.md as a single self-contained HTML page.
//
// The page is a *view*, never a second source. docs/README.md puts
// plans/backlog.md first in the precedence list for "tickets, phases, gates and
// status", and docs/bao-cao/06-quy-trinh-phat-trien.md grades the project on
// "Số nguồn của backlog = 1". So nothing here persists: no localStorage, no
// write-back. A tick in the browser is a staged edit that lives until reload,
// and the "Copy markdown updates" button hands it back as markdown rows for the
// user to paste into the file. The file stays authoritative; the HTML stays
// disposable, which is why plans/ is gitignored and this is regenerated rather
// than committed.
//
// Everything on the page is parsed. A hardcoded story list is exactly the drift
// this dashboard exists to make visible — M1 drifted six rows in one day.
//
// Zero dependencies, Node built-ins only, so it runs before apps/api exists and
// keeps running after.
//
// Usage: node scripts/backlog-view.mjs [source.md] [out.html]
//   default source plans/backlog.md
//   default out    plans/backlog.html

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SOURCE = path.resolve(
  process.argv[2] ?? path.join(ROOT, "plans", "backlog.md"),
);
const OUT = path.resolve(
  process.argv[3] ?? path.join(ROOT, "plans", "backlog.html"),
);

/** The pre-code checklist lives in the advisory report, not the backlog — it is
 *  the work that happens *before* a story is worked, so it is parsed from its
 *  own source rather than copied into either file. Missing is survivable: the
 *  section renders a notice instead of vanishing. */
const ADVISORY = path.join(
  ROOT,
  "plans",
  "reports",
  "advise-260726-1628-task-writing-readiness.md",
);
const ADVISORY_SECTION = "12. Work checklist";

// ---------------------------------------------------------------------------
// markdown primitives
// ---------------------------------------------------------------------------

const splitRow = (line) => {
  const t = line.trim();
  const body = t.slice(1, t.endsWith("|") ? -1 : undefined);
  return body.split("|").map((c) => c.trim());
};

const isRow = (line) => line.trim().startsWith("|");
const isSeparator = (cells) =>
  cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));

/** A table starts at a `|` line whose successor is the `---|---` separator.
 *  Anything else beginning with `|` is not a table and is left alone. */
function readTable(lines, i) {
  if (!isRow(lines[i]) || i + 1 >= lines.length || !isRow(lines[i + 1]))
    return null;
  const headers = splitRow(lines[i]);
  if (!isSeparator(splitRow(lines[i + 1]))) return null;

  const rows = [];
  let j = i + 2;
  while (j < lines.length && isRow(lines[j])) {
    rows.push(splitRow(lines[j]));
    j++;
  }
  return { headers, rows, next: j };
}

/** `- [ ]` / `- [x]` items. Continuation lines are indented, so they are folded
 *  back into the item they belong to rather than dropped. */
function readChecklist(lines, i) {
  const items = [];
  let j = i;
  while (j < lines.length) {
    const m = /^- \[([ xX])\]\s+(.*)$/.exec(lines[j]);
    if (m) {
      items.push({ checked: m[1].toLowerCase() === "x", text: m[2] });
      j++;
      continue;
    }
    if (items.length && /^\s+\S/.test(lines[j])) {
      items[items.length - 1].text += ` ${lines[j].trim()}`;
      j++;
      continue;
    }
    break;
  }
  return items.length ? { items, next: j } : null;
}

/** Plain `- ` bullets, same continuation rule. */
function readBullets(lines, i) {
  const items = [];
  let j = i;
  while (j < lines.length) {
    const m = /^- (?!\[[ xX]\])(.*)$/.exec(lines[j]);
    if (m) {
      items.push(m[1]);
      j++;
      continue;
    }
    if (items.length && /^\s+\S/.test(lines[j])) {
      items[items.length - 1] += ` ${lines[j].trim()}`;
      j++;
      continue;
    }
    break;
  }
  return items.length ? { items, next: j } : null;
}

/** `1.` / `2.` numbered items, same continuation rule. */
function readOrdered(lines, i) {
  const items = [];
  let j = i;
  while (j < lines.length) {
    const m = /^\d+\.\s+(.*)$/.exec(lines[j]);
    if (m) {
      items.push(m[1]);
      j++;
      continue;
    }
    if (items.length && /^\s+\S/.test(lines[j])) {
      items[items.length - 1] += ` ${lines[j].trim()}`;
      j++;
      continue;
    }
    break;
  }
  return items.length ? { items, next: j } : null;
}

// ---------------------------------------------------------------------------
// backlog model
// ---------------------------------------------------------------------------

const MILESTONE_HEADING = /^## (M\d+(?:\.\d+)?)\s+—\s+(.*)$/;
const EPIC_HEADING = /^### (.*)$/;
const REF = /`(D\d+|G\d+)`/g;

/** Which decisions and gates a milestone or epic sits behind. The backlog says
 *  this in prose — "Consumes `D1`, `D4`", "*gated by `G1`*" — so the badge is
 *  read out of the prose rather than maintained as a second list. */
function refsIn(text) {
  const out = [];
  for (const m of String(text).matchAll(REF))
    if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

const stripCode = (s) => s.replace(/[`*]/g, "").trim();

/** §10's Issue column is meant to hold one story key. Row 12 currently holds a
 *  sentence — "One production gateway closes this" — which is a note, not a
 *  key, so counting it as filled would report 1/12 for a table that is empty.
 *  A key is one unspaced token. */
const isIssueKey = (cell) => {
  const v = stripCode(cell ?? "");
  return v !== "" && !/\s/.test(v);
};

function normaliseStatus(raw) {
  const v = stripCode(raw ?? "").toLowerCase();
  if (v.startsWith("done")) return "done";
  if (/^(wip|doing|in progress|in-flight|in flight)/.test(v)) return "wip";
  return "todo";
}

/** Column order is not assumed anywhere — headers are matched by name, and an
 *  absent column is absent, not a crash. Status and Commit do not exist in the
 *  tables yet (advise §7 step 3 adds them); until they do, a DoD reading
 *  "Done — <sha>" is the only status signal there is. */
function indexHeaders(headers) {
  const at = (name) =>
    headers.findIndex((h) => stripCode(h).toLowerCase() === name);
  return {
    key: at("key"),
    story: at("story"),
    dod: at("dod"),
    status: at("status"),
    commit: at("commit"),
  };
}

function parseStories(table, context) {
  const idx = indexHeaders(table.headers);
  if (idx.key < 0 || idx.story < 0) return [];

  return table.rows.map((cells) => {
    const dod = idx.dod >= 0 ? (cells[idx.dod] ?? "") : "";
    const declared = idx.status >= 0 ? (cells[idx.status] ?? "") : "";
    const status =
      idx.status >= 0 ? normaliseStatus(declared) : normaliseStatus(dod);
    return {
      key: stripCode(cells[idx.key] ?? ""),
      keyRaw: cells[idx.key] ?? "",
      story: cells[idx.story] ?? "",
      dod,
      commit: idx.commit >= 0 ? (cells[idx.commit] ?? "") : "",
      status,
      statusDeclared: idx.status >= 0,
      blankDod: idx.dod >= 0 && dod === "",
      cells,
      headers: table.headers,
      statusIndex: idx.status,
      milestone: context.milestone,
      epic: context.epic,
    };
  });
}

function parseBacklog(md) {
  const lines = md.split(/\r?\n/);
  const model = {
    gates: [],
    gateChecklist: { title: "", items: [] },
    decisions: [],
    milestones: [],
    reconciliation: null,
    traceability: null,
    unresolved: [],
  };

  let i = 0;
  // frontmatter
  if (lines[0]?.trim() === "---") {
    i = 1;
    while (i < lines.length && lines[i].trim() !== "---") i++;
    i++;
  }

  let milestone = null;
  let group = null;
  let section = null; // gates | decisions | reconciliation | traceability | unresolved

  const closeGroup = () => {
    if (milestone && group) milestone.groups.push(group);
    group = null;
  };
  const closeMilestone = () => {
    closeGroup();
    if (milestone) model.milestones.push(milestone);
    milestone = null;
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("## ")) {
      closeMilestone();
      section = null;

      const m = MILESTONE_HEADING.exec(line);
      if (m) {
        const parts = m[2].split(" · ");
        milestone = {
          id: m[1],
          name: parts[0],
          tags: parts.slice(1),
          heading: m[2],
          refs: refsIn(m[2]),
          intro: [],
          outro: [],
          groups: [],
        };
      } else if (/^## 0\./.test(line)) section = "gates";
      else if (/^## 1\./.test(line)) section = "decisions";
      else if (/^## 9\./.test(line)) section = "reconciliation";
      else if (/^## 10\./.test(line)) section = "traceability";
      else if (/^## 11\./.test(line)) section = "unresolved";

      i++;
      continue;
    }

    if (line.startsWith("### ")) {
      if (section === "gates") {
        // "### G2 — the trigger checklist" — its own shape, handled below.
        model.gateChecklist.title = EPIC_HEADING.exec(line)[1];
        i++;
        continue;
      }
      if (milestone) {
        closeGroup();
        const head = EPIC_HEADING.exec(line)[1];
        const dash = head.indexOf(" — ");
        const id = dash > 0 ? head.slice(0, dash) : head;
        const rest = dash > 0 ? head.slice(dash + 3) : "";
        const parts = rest.split(" · ");
        group = {
          kind: "epic",
          id: stripCode(id),
          idRaw: id,
          name: parts[0] ?? "",
          tags: parts.slice(1),
          refs: refsIn(head),
          notes: [],
          stories: [],
        };
      }
      i++;
      continue;
    }

    if (isRow(line)) {
      const table = readTable(lines, i);
      if (table) {
        if (section === "gates") {
          const idx = table.headers.findIndex(
            (h) => stripCode(h).toLowerCase() === "key",
          );
          for (const cells of table.rows) {
            model.gates.push({
              key: stripCode(cells[idx] ?? ""),
              cells,
              headers: table.headers,
            });
          }
        } else if (section === "decisions") {
          const h = table.headers.map((x) => stripCode(x).toLowerCase());
          for (const cells of table.rows) {
            const status = cells[h.indexOf("status")] ?? "";
            model.decisions.push({
              key: stripCode(cells[h.indexOf("key")] ?? ""),
              decision: cells[h.indexOf("decision")] ?? "",
              owner: cells[h.indexOf("owner")] ?? "",
              blocks: cells[h.indexOf("blocks")] ?? "",
              status,
              done: /^\*\*done\*\*/i.test(status.trim()),
            });
          }
        } else if (section === "reconciliation") {
          model.reconciliation = table;
        } else if (section === "traceability") {
          model.traceability = table;
        } else if (milestone) {
          // A table directly under `##` (M0, M1) is its own group with no epic.
          if (!group) {
            group = {
              kind: "epic",
              id: milestone.id,
              idRaw: "",
              name: "",
              tags: [],
              refs: [],
              notes: [],
              stories: [],
            };
          }
          const stories = parseStories(table, {
            milestone: milestone.id,
            epic: group.id,
          });
          group.stories.push(...stories);
        }
        i = table.next;
        continue;
      }
    }

    if (/^- \[[ xX]\]/.test(line)) {
      const list = readChecklist(lines, i);
      if (list) {
        if (section === "gates") model.gateChecklist.items.push(...list.items);
        i = list.next;
        continue;
      }
    }

    if (/^- /.test(line) && milestone) {
      const list = readBullets(lines, i);
      if (list) {
        // M4 onward are epic-level bullets: "- **P2-SM** — description".
        closeGroup();
        for (const text of list.items) {
          const m = /^\*\*([^*]+)\*\*\s+—\s+(.*)$/.exec(text);
          milestone.groups.push({
            kind: "bullet",
            id: m ? stripCode(m[1]) : "",
            idRaw: m ? `**${m[1]}**` : "",
            name: m ? m[2] : text,
            tags: [],
            refs: refsIn(text),
            notes: [],
            stories: [],
          });
        }
        i = list.next;
        continue;
      }
    }

    if (/^\d+\.\s/.test(line) && section === "unresolved") {
      const list = readOrdered(lines, i);
      if (list) {
        model.unresolved.push(...list.items);
        i = list.next;
        continue;
      }
    }

    // prose
    if (line.trim() && line.trim() !== "---") {
      // Fold wrapped paragraphs so a sentence broken across lines stays one.
      const buf = [line.trim()];
      let j = i + 1;
      while (
        j < lines.length &&
        lines[j].trim() &&
        !lines[j].startsWith("#") &&
        !isRow(lines[j]) &&
        !/^- /.test(lines[j]) &&
        !/^\d+\.\s/.test(lines[j]) &&
        lines[j].trim() !== "---"
      ) {
        buf.push(lines[j].trim());
        j++;
      }
      const text = buf.join(" ");
      if (milestone) {
        if (group) group.notes.push(text);
        else if (milestone.groups.length) milestone.outro.push(text);
        else milestone.intro.push(text);
        milestone.refs = [...new Set([...milestone.refs, ...refsIn(text)])];
        if (group) group.refs = [...new Set([...group.refs, ...refsIn(text)])];
      }
      i = j;
      continue;
    }

    i++;
  }

  closeMilestone();
  return model;
}

/** §12 of the advisory report — the 15 items worked through before any story. */
function parseAdvisoryChecklist(file, sectionTitle) {
  if (!existsSync(file)) return null;
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  let i = lines.findIndex(
    (l) => l.startsWith("## ") && l.slice(3).trim() === sectionTitle,
  );
  if (i < 0) return null;
  i++;
  while (i < lines.length && !lines[i].startsWith("## ")) {
    if (/^- \[[ xX]\]/.test(lines[i])) {
      const list = readChecklist(lines, i);
      if (list) return list.items;
    }
    i++;
  }
  return null;
}

// ---------------------------------------------------------------------------
// inline rendering
// ---------------------------------------------------------------------------

const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

/** Turn `docs/architecture/rbac-matrix.md` into a link, but only when the file
 *  is really there. P0-DOC names `docs/erd.dbml` and `docs/openapi.json`, which
 *  its own stories exist to create — linking those would promise a page that
 *  does not load. The href is relative to plans/, where the output lives. */
function localHref(target) {
  const clean = target.replace(/[#?].*$/, "");
  if (!/^(docs|plans)\//.test(clean)) return null;
  if (!existsSync(path.join(ROOT, clean))) return null;
  return clean.startsWith("plans/")
    ? clean.slice("plans/".length)
    : `../${clean}`;
}

/** Escape first, then apply the four inline forms the backlog actually uses.
 *  Code spans are lifted out before anything else so `**` inside a code span is
 *  not read as emphasis. Any link with a scheme is rendered as plain text —
 *  which is what keeps the output free of network references. */
function inline(md) {
  const parts = String(md).split(/(`[^`]+`)/g);
  return parts
    .map((part) => {
      if (part.startsWith("`") && part.endsWith("`") && part.length > 1) {
        const body = part.slice(1, -1);
        const code = `<code>${esc(body)}</code>`;
        const href = localHref(body);
        return href ? `<a href="${esc(href)}">${code}</a>` : code;
      }
      let out = esc(part);
      out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (whole, text, url) =>
        /^[a-z][a-z0-9+.-]*:/i.test(url)
          ? esc(whole)
          : `<a href="${url}">${text}</a>`,
      );
      out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
      return out;
    })
    .join("");
}

// ---------------------------------------------------------------------------
// page
// ---------------------------------------------------------------------------

const STATUS_LABEL = { todo: "todo", wip: "wip", done: "done" };

function badge(ref) {
  const kind = ref.startsWith("G") ? "gate" : "decision";
  return `<span class="ref ref-${kind}" title="${kind === "gate" ? "Blocked by gate" : "Consumes decision"} ${esc(ref)}">${esc(ref)}</span>`;
}

function renderStoryRow(story, hasCommitColumn) {
  const flag = story.blankDod
    ? `<span class="warn" title="No definition of done — this story has no verifiable finish line">no DoD</span>`
    : inline(story.dod);
  const commit = hasCommitColumn
    ? `<td class="col-commit">${inline(story.commit)}</td>`
    : "";
  const haystack =
    `${story.key} ${stripCode(story.story)} ${stripCode(story.dod)}`.toLowerCase();

  return `<tr class="story" data-key="${esc(story.key)}" data-status="${story.status}" data-blank="${story.blankDod ? "1" : "0"}" data-search="${esc(haystack)}">
  <td class="col-tick"><input type="checkbox" id="tick-${esc(story.key)}" data-story="${esc(story.key)}"${story.status === "done" ? " checked" : ""} aria-label="Mark ${esc(story.key)} done (staged, not saved)"></td>
  <td class="col-key"><label for="tick-${esc(story.key)}">${inline(story.keyRaw)}</label></td>
  <td class="col-story">${inline(story.story)}</td>
  <td class="col-dod">${flag}</td>
  <td class="col-status"><span class="pill pill-${story.status}" data-status-for="${esc(story.key)}">${STATUS_LABEL[story.status]}</span></td>
  ${commit}
</tr>`;
}

function renderGroup(group) {
  const head = [
    group.idRaw ? `<span class="epic-id">${inline(group.idRaw)}</span>` : "",
    group.name ? `<span class="epic-name">${inline(group.name)}</span>` : "",
    ...group.tags.map((t) => `<span class="tag">${inline(t)}</span>`),
    ...group.refs.map(badge),
  ]
    .filter(Boolean)
    .join(" ");

  if (group.kind === "bullet" || group.stories.length === 0) {
    const notes = group.notes
      .map((n) => `<p class="note">${inline(n)}</p>`)
      .join("");
    return `<div class="group group-epic-only" data-search="${esc(`${group.id} ${stripCode(group.name)}`.toLowerCase())}" data-status="none">
  <div class="epic-head">${head}<span class="epic-only">epic level — no stories yet</span></div>
  ${notes}
</div>`;
  }

  const hasCommit = group.stories.some((s) =>
    s.headers.some((h) => stripCode(h).toLowerCase() === "commit"),
  );
  const done = group.stories.filter((s) => s.status === "done").length;
  const notes = group.notes
    .map((n) => `<p class="note">${inline(n)}</p>`)
    .join("");

  return `<details class="group" open>
  <summary class="epic-head">${head}<span class="count">${done}/${group.stories.length}</span></summary>
  ${notes}
  <div class="table-scroll">
    <table class="stories">
      <thead><tr><th class="col-tick"><span class="sr-only">Done</span></th><th>Key</th><th>Story</th><th>DoD</th><th>Status</th>${hasCommit ? "<th>Commit</th>" : ""}</tr></thead>
      <tbody>${group.stories.map((s) => renderStoryRow(s, hasCommit)).join("\n")}</tbody>
    </table>
  </div>
</details>`;
}

function renderMilestone(milestone) {
  const stories = milestone.groups.flatMap((g) => g.stories);
  const done = stories.filter((s) => s.status === "done").length;
  const blank = stories.filter((s) => s.blankDod).length;
  const pct = stories.length ? Math.round((done / stories.length) * 100) : 0;

  const progress = stories.length
    ? `<span class="progress"><span class="bar"><span class="fill" style="width:${pct}%"></span></span><span class="ratio">${done}/${stories.length}</span></span>`
    : `<span class="progress progress-none">epic level — not counted</span>`;

  const meta = [
    ...milestone.tags.map((t) => `<span class="tag">${inline(t)}</span>`),
    ...milestone.refs.map(badge),
    blank ? `<span class="warn">${blank} without DoD</span>` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const search = `${milestone.id} ${stripCode(milestone.name)}`.toLowerCase();

  return `<details class="milestone" id="ms-${esc(milestone.id)}" data-milestone="${esc(milestone.id)}" data-search="${esc(search)}"${stories.length ? " open" : ""}>
  <summary class="ms-head">
    <span class="ms-id">${esc(milestone.id)}</span>
    <span class="ms-name">${inline(milestone.name)}</span>
    ${meta}
    ${progress}
  </summary>
  ${milestone.intro.map((n) => `<p class="note">${inline(n)}</p>`).join("")}
  ${milestone.groups.map(renderGroup).join("\n")}
  ${milestone.outro.map((n) => `<p class="note note-dod">${inline(n)}</p>`).join("")}
</details>`;
}

function renderTable(table, className = "") {
  return `<div class="table-scroll"><table class="${className}">
  <thead><tr>${table.headers.map((h) => `<th>${inline(h)}</th>`).join("")}</tr></thead>
  <tbody>${table.rows
    .map(
      (r) =>
        `<tr>${r.map((c) => `<td>${c === "" ? '<span class="warn">empty</span>' : inline(c)}</td>`).join("")}</tr>`,
    )
    .join("")}</tbody>
</table></div>`;
}

function buildPage(model, precode, generatedAt) {
  const allStories = model.milestones.flatMap((m) =>
    m.groups.flatMap((g) => g.stories),
  );
  const blank = allStories.filter((s) => s.blankDod);
  const blankM2 = blank.filter((s) => s.milestone === "M2").length;

  const traceRows = model.traceability?.rows ?? [];
  const traceIssueIdx =
    model.traceability?.headers.findIndex(
      (h) => stripCode(h).toLowerCase() === "issue",
    ) ?? -1;
  const traceFilled =
    traceIssueIdx >= 0
      ? traceRows.filter((r) => isIssueKey(r[traceIssueIdx])).length
      : 0;

  const openDecisions = model.decisions.filter((d) => !d.done);
  const gateTicked = model.gateChecklist.items.filter(
    (it) => it.checked,
  ).length;

  const metrics = [
    {
      value: String(blank.length),
      label: "stories with no DoD",
      sub: `${blankM2} of them in M2 · target 0 (advise §13 #2)`,
      tone: blank.length ? "bad" : "good",
    },
    {
      value: `${traceFilled}/${traceRows.length}`,
      label: "traceability rows with an issue key",
      sub: `target ${traceRows.length}/${traceRows.length} · R1#12`,
      tone: traceFilled === traceRows.length ? "good" : "bad",
    },
    {
      value: `${openDecisions.length}/${model.decisions.length}`,
      label: "decisions still open",
      sub: `${openDecisions.map((d) => d.key).join(" ")} · target 0`,
      tone: openDecisions.length ? "bad" : "good",
    },
    {
      value: `${gateTicked}/${model.gateChecklist.items.length}`,
      label: "G2 trigger checklist ticked",
      sub: `${model.gates.length} gates open · nothing merges past G2 unticked`,
      tone: gateTicked === model.gateChecklist.items.length ? "good" : "bad",
    },
  ];

  // Staging data: the row source every "Copy markdown updates" line is rebuilt
  // from. Kept as inert JSON rather than generated JS so nothing is evaluated.
  const staging = {
    generatedAt,
    source: path.basename(SOURCE),
    advisorySource: precode
      ? path.relative(path.join(ROOT, "plans"), ADVISORY).replace(/\\/g, "/")
      : null,
    stories: allStories.map((s) => ({
      key: s.key,
      milestone: s.milestone,
      epic: s.epic,
      status: s.status,
      cells: s.cells,
      headers: s.headers,
      statusIndex: s.statusIndex,
    })),
    gateItems: model.gateChecklist.items.map((it, n) => ({
      id: `g2-${n}`,
      text: it.text,
      checked: it.checked,
    })),
    precode: (precode ?? []).map((it, n) => ({
      id: `pc-${n}`,
      text: it.text,
      checked: it.checked,
    })),
  };

  const gateHeaders = model.gates[0]?.headers ?? [];
  const gatesHtml = model.gates
    .map((g) => {
      const cell = (name) => {
        const i = gateHeaders.findIndex(
          (h) => stripCode(h).toLowerCase() === name,
        );
        return i >= 0 ? (g.cells[i] ?? "") : "";
      };
      return `<div class="gate">
  <div class="gate-key">${esc(g.key)}</div>
  <div class="gate-body">
    <p class="gate-title">${inline(cell("gate"))}</p>
    <p class="gate-meta"><span class="label">blocks</span> ${inline(cell("blocks"))}</p>
    <p class="gate-detail">${inline(cell("detail"))}</p>
  </div>
</div>`;
    })
    .join("\n");

  const gateChecklistHtml = model.gateChecklist.items.length
    ? `<div class="checklist checklist-gate">
  <h3>${inline(model.gateChecklist.title || "G2 checklist")}</h3>
  <ul>${model.gateChecklist.items
    .map(
      (it, n) =>
        `<li><input type="checkbox" id="g2-${n}" data-check="g2-${n}"${it.checked ? " checked" : ""}><label for="g2-${n}">${inline(it.text)}</label></li>`,
    )
    .join("")}</ul>
</div>`
    : "";

  const decisionsHtml = model.decisions
    .map(
      (d) => `<div class="decision${d.done ? " decision-done" : ""}">
  <div class="dec-key">${esc(d.key)}</div>
  <div class="dec-body">
    <p class="dec-title">${inline(d.decision)}</p>
    <p class="dec-meta"><span class="label">owner</span> ${inline(d.owner) || "—"} · <span class="label">blocks</span> ${inline(d.blocks) || "—"}</p>
    <p class="dec-status">${inline(d.status)}</p>
  </div>
</div>`,
    )
    .join("\n");

  const precodeHtml = precode
    ? `<ul class="precode">${precode
        .map(
          (it, n) =>
            `<li><input type="checkbox" id="pc-${n}" data-check="pc-${n}"${it.checked ? " checked" : ""}><label for="pc-${n}">${inline(it.text)}</label></li>`,
        )
        .join("")}</ul>`
    : `<p class="warn-block">Checklist source not found: <code>${esc(path.relative(ROOT, ADVISORY).replace(/\\/g, "/"))}</code> — nothing rendered rather than a stale copy.</p>`;

  const json = JSON.stringify(staging).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mariva backlog — progress view</title>
<style>
/* Palette copied from apps/web/app/globals.css — packages/tokens does not
   exist yet (P-1-08), so there is nothing to import from. */
:root {
  --ivory: #f4efe6;
  --ivory-warm: #eee7de;
  --sand: #cfc0ab;
  --stone: #8a7b6e;
  --stone-deep: #645c51;
  --umber: #3a332b;
  --ink: #1c1915;
  --dusk-amber: #b48b60;
  --ocean: #7fa2b7;

  --bg: var(--ivory);
  --panel: #fbf8f3;
  --line: var(--sand);
  --text: var(--ink);
  --muted: var(--stone-deep);
  --accent: var(--dusk-amber);
  /* Darkened until ivory-on-green clears 4.5:1 — the D5/D6 chip is 14px bold,
     which is not large text. */
  --good: #45704b;
  --bad: #9a4b3a;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #17140f;
    --panel: #201c16;
    --line: #3d362d;
    --text: #ece5da;
    --muted: #a99c8c;
    --good: #8fbc96;
    --bad: #d99384;
  }
}

*, *::before, *::after { box-sizing: border-box; }
body {
  margin: 0;
  padding: 0 1.25rem 4rem;
  background: var(--bg);
  color: var(--text);
  font: 400 14px/1.5 ui-sans-serif, system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  overflow-x: hidden;
}
.wrap { max-width: 1280px; margin: 0 auto; }
code, kbd { font-family: ui-monospace, "Cascadia Mono", "SFMono-Regular", Consolas, monospace; font-size: 0.92em; }
code { background: color-mix(in srgb, var(--sand) 30%, transparent); padding: 0.05em 0.3em; border-radius: 3px; }
a { color: inherit; text-decoration-color: var(--accent); text-underline-offset: 2px; }
h1, h2, h3 { font-weight: 600; letter-spacing: -0.01em; }
h1 { font-size: 1.35rem; margin: 0; }
h2 { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.14em; color: var(--muted); margin: 2rem 0 0.75rem; }
h3 { font-size: 0.9rem; margin: 0 0 0.5rem; }
p { margin: 0 0 0.5rem; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 2px; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }

/* No entrance animation on an operational screen — backlog M4 DoD (R1#14).
   Transitions are limited to interaction feedback. */
@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; }
}

/* banner ------------------------------------------------------------- */
.banner {
  border: 1px solid var(--line);
  border-left: 3px solid var(--accent);
  background: var(--panel);
  padding: 0.85rem 1rem;
  margin: 1.25rem 0;
  display: flex; flex-wrap: wrap; gap: 0.4rem 1.25rem; align-items: baseline;
}
.banner strong { font-weight: 600; }
.banner .muted { color: var(--muted); }

/* metrics ------------------------------------------------------------ */
.metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 0.75rem; }
.metric { border: 1px solid var(--line); background: var(--panel); padding: 0.75rem 0.9rem; }
.metric .value { font-size: 1.7rem; font-weight: 600; line-height: 1.1; font-variant-numeric: tabular-nums; }
.metric.bad .value { color: var(--bad); }
.metric.good .value { color: var(--good); }
.metric .label { display: block; margin-top: 0.15rem; }
.metric .sub { display: block; color: var(--muted); font-size: 0.78rem; margin-top: 0.3rem; }

/* panels ------------------------------------------------------------- */
.cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 1rem; align-items: start; }
.panel { border: 1px solid var(--line); background: var(--panel); padding: 0.9rem 1rem; }

.gate, .decision { display: grid; grid-template-columns: 2.6rem 1fr; gap: 0.6rem; padding: 0.6rem 0; border-top: 1px solid var(--line); }
.gate:first-of-type, .decision:first-of-type { border-top: 0; }
.gate-key, .dec-key {
  font-weight: 600; font-family: ui-monospace, Consolas, monospace;
  background: var(--umber); color: var(--ivory); text-align: center;
  align-self: start; padding: 0.15rem 0; border-radius: 2px;
}
.gate-key { background: var(--bad); }
.decision-done .dec-key { background: var(--good); }
/* --good and --bad invert for dark, so the chip text has to invert with them
   or ivory-on-pale-red drops to ~2:1. */
@media (prefers-color-scheme: dark) {
  .gate-key, .decision-done .dec-key { color: var(--ink); }
}
.gate-title, .dec-title { font-weight: 500; }
.gate-meta, .dec-meta, .gate-detail, .dec-status { color: var(--muted); font-size: 0.84rem; }
.label { text-transform: uppercase; letter-spacing: 0.1em; font-size: 0.68rem; }

/* checklists --------------------------------------------------------- */
.checklist ul, ul.precode { list-style: none; margin: 0; padding: 0; }
.checklist li, ul.precode li { display: grid; grid-template-columns: 1.4rem 1fr; gap: 0.35rem; padding: 0.28rem 0; align-items: start; }
ul.precode { columns: 2; column-gap: 2rem; }
ul.precode li { break-inside: avoid; }
@media (max-width: 900px) { ul.precode { columns: 1; } }
input[type=checkbox] { width: 1rem; height: 1rem; margin: 0.15rem 0 0; accent-color: var(--dusk-amber); cursor: pointer; }
label { cursor: pointer; }
li input:checked + label { color: var(--muted); text-decoration: line-through; }
.checklist-gate { margin-top: 0.9rem; border-top: 1px solid var(--line); padding-top: 0.75rem; }

/* toolbar ------------------------------------------------------------ */
.toolbar {
  display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center;
  position: sticky; top: 0; z-index: 5;
  background: var(--bg); border-bottom: 1px solid var(--line);
  padding: 0.6rem 0; margin-bottom: 0.75rem;
}
input[type=search], select, button {
  font: inherit; color: var(--text); background: var(--panel);
  border: 1px solid var(--line); padding: 0.35rem 0.55rem; border-radius: 2px;
}
input[type=search] { min-width: 16rem; flex: 1 1 16rem; }
button { cursor: pointer; transition: background 100ms linear; }
button:hover:not(:disabled) { background: color-mix(in srgb, var(--sand) 40%, var(--panel)); }
button:disabled { opacity: 0.5; cursor: default; }
button.primary { background: var(--umber); color: var(--ivory); border-color: var(--umber); }
button.primary:hover:not(:disabled) { background: var(--ink); }
.staged-count { color: var(--muted); font-variant-numeric: tabular-nums; }

/* tree --------------------------------------------------------------- */
details.milestone { border: 1px solid var(--line); background: var(--panel); margin-bottom: 0.5rem; }
summary { cursor: pointer; list-style: none; }
summary::-webkit-details-marker { display: none; }
summary::before { content: "\\25B8"; display: inline-block; width: 1em; color: var(--muted); transition: transform 100ms linear; }
details[open] > summary::before { transform: rotate(90deg); }
.ms-head { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: baseline; padding: 0.6rem 0.85rem; }
.ms-head:hover { background: color-mix(in srgb, var(--sand) 22%, transparent); }
.ms-id { font-weight: 600; font-family: ui-monospace, Consolas, monospace; }
.ms-name { font-weight: 500; }
.progress { margin-left: auto; display: flex; align-items: center; gap: 0.5rem; }
.bar { display: block; width: 90px; height: 6px; background: color-mix(in srgb, var(--sand) 55%, transparent); border-radius: 3px; overflow: hidden; }
.fill { display: block; height: 100%; background: var(--good); }
.ratio { font-variant-numeric: tabular-nums; color: var(--muted); }
.progress-none { color: var(--muted); font-size: 0.8rem; }

details.group { margin: 0 0.85rem 0.5rem; border-left: 2px solid var(--line); }
.group-epic-only { margin: 0 0.85rem 0.35rem; border-left: 2px solid var(--line); padding-left: 0.6rem; }
.epic-head { display: flex; flex-wrap: wrap; gap: 0.45rem; align-items: baseline; padding: 0.35rem 0 0.35rem 0.6rem; }
.epic-id { font-weight: 600; font-family: ui-monospace, Consolas, monospace; }
.epic-name { color: var(--muted); }
.epic-only { color: var(--muted); font-size: 0.78rem; font-style: italic; }
.count { margin-left: auto; color: var(--muted); font-variant-numeric: tabular-nums; }
.note { color: var(--muted); font-size: 0.84rem; margin: 0.2rem 0.85rem 0.5rem 1.4rem; }
.note-dod { border-left: 2px solid var(--accent); padding-left: 0.6rem; }

.tag { color: var(--muted); font-size: 0.78rem; }
.ref {
  font-family: ui-monospace, Consolas, monospace; font-size: 0.72rem;
  padding: 0.1rem 0.35rem; border-radius: 2px; border: 1px solid currentColor;
}
.ref-gate { color: var(--bad); }
.ref-decision { color: var(--ocean); }
.warn { color: var(--bad); font-size: 0.8rem; font-weight: 500; }
.warn-block { color: var(--bad); }

/* tables ------------------------------------------------------------- */
.table-scroll { overflow-x: auto; margin: 0 0 0.5rem 0.6rem; }
table { border-collapse: collapse; width: 100%; font-size: 0.86rem; }
th, td { text-align: left; vertical-align: top; padding: 0.32rem 0.6rem 0.32rem 0; border-top: 1px solid var(--line); }
thead th { border-top: 0; border-bottom: 1px solid var(--line); color: var(--muted); font-weight: 500; font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.08em; white-space: nowrap; }
tbody tr:hover { background: color-mix(in srgb, var(--sand) 18%, transparent); }
.col-tick { width: 1.8rem; }
.col-key { white-space: nowrap; }
.col-story { min-width: 18rem; }
.col-dod { color: var(--muted); min-width: 12rem; }
.col-status, .col-commit { white-space: nowrap; }
.pill { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; padding: 0.1rem 0.4rem; border-radius: 2px; border: 1px solid var(--line); color: var(--muted); }
.pill-done { color: var(--good); border-color: currentColor; }
.pill-wip { color: var(--accent); border-color: currentColor; }
.pill.staged { background: var(--accent); color: var(--ivory); border-color: var(--accent); }
tr.hidden, details.hidden, .group.hidden { display: none; }

/* copy panel --------------------------------------------------------- */
#copy-panel { border: 1px solid var(--line); background: var(--panel); margin: 0.75rem 0; padding: 0 0.9rem; }
#copy-panel[open] { padding-bottom: 0.9rem; }
#copy-panel > summary { padding: 0.6rem 0; font-weight: 500; }
#copy-out { width: 100%; min-height: 12rem; font-family: ui-monospace, Consolas, monospace; font-size: 0.8rem; background: var(--bg); color: var(--text); border: 1px solid var(--line); padding: 0.6rem; }
.copy-hint { color: var(--muted); font-size: 0.82rem; }
</style>
</head>
<body>
<div class="wrap">

<header>
  <h1>Mariva backlog — progress view</h1>
  <div class="banner">
    <span><strong>Source of truth:</strong> <a href="backlog.md"><code>plans/backlog.md</code></a>. This page only renders it.</span>
    <span class="muted">Ticks here are staged for this session only — nothing is written to disk, nothing is stored in the browser. Use <strong>Copy markdown updates</strong> and paste into the file.</span>
    <span class="muted">Generated ${esc(generatedAt)} · regenerate with <code>pnpm backlog:view</code> · precedence: <a href="../docs/README.md"><code>docs/README.md</code></a></span>
  </div>
</header>

<h2>Where this stage stands</h2>
<div class="metrics">
${metrics
  .map(
    (m) => `  <div class="metric ${m.tone}">
    <span class="value">${esc(m.value)}</span>
    <span class="label">${esc(m.label)}</span>
    <span class="sub">${esc(m.sub)}</span>
  </div>`,
  )
  .join("\n")}
</div>

<h2>Before any story — the pre-code checklist</h2>
<div class="panel">
  <p class="copy-hint">From §${esc(ADVISORY_SECTION)} of <code>${esc(path.relative(ROOT, ADVISORY).replace(/\\/g, "/"))}</code>. Worked through first; none of it is writing tasks.</p>
  ${precodeHtml}
</div>

<div class="cols">
  <section class="panel">
    <h2 style="margin-top:0">Gates — merge blockers, not work items</h2>
    ${gatesHtml}
    ${gateChecklistHtml}
  </section>
  <section class="panel">
    <h2 style="margin-top:0">Decisions</h2>
    ${decisionsHtml}
  </section>
</div>

<h2>Milestones</h2>
<div class="toolbar">
  <input type="search" id="q" placeholder="Search key or story text  ( / )" aria-label="Search stories by key or text">
  <label class="sr-only" for="status-filter">Status filter</label>
  <select id="status-filter">
    <option value="all">All statuses</option>
    <option value="todo">todo</option>
    <option value="wip">wip</option>
    <option value="done">done</option>
    <option value="blank">no DoD</option>
  </select>
  <button type="button" id="expand">Expand all</button>
  <button type="button" id="collapse">Collapse all</button>
  <span class="staged-count" id="staged-count">0 staged</span>
  <button type="button" class="primary" id="copy" disabled>Copy markdown updates</button>
</div>

<details id="copy-panel">
  <summary>Staged markdown</summary>
  <p class="copy-hint">Paste these rows back into <code>plans/backlog.md</code>. Clearing this page (reload) discards them.</p>
  <textarea id="copy-out" readonly spellcheck="false" aria-label="Markdown rows for the staged changes"></textarea>
</details>

<div id="tree">
${model.milestones.map(renderMilestone).join("\n")}
</div>

<h2>Traceability — the professor's 12 bullets</h2>
<div class="panel">
  <p class="copy-hint">${traceFilled}/${traceRows.length} rows carry an issue key. <code>R1#12</code> requires ${traceRows.length}/${traceRows.length} before the coursework is claimed complete.</p>
  ${model.traceability ? renderTable(model.traceability, "trace") : '<p class="warn">Traceability table not found in the source.</p>'}
</div>

<h2>Unresolved</h2>
<div class="panel">
  <ol>${model.unresolved.map((u) => `<li>${inline(u)}</li>`).join("")}</ol>
</div>

<details class="panel" style="margin-top:1rem">
  <summary><strong>Reconciliation log</strong> — what the backlog changed against the reports. Context, not tasks.</summary>
  ${model.reconciliation ? renderTable(model.reconciliation, "recon") : '<p class="warn">Reconciliation table not found in the source.</p>'}
</details>

</div>

<script id="staging-data" type="application/json">${json}</script>
<script>
(function () {
  "use strict";
  var data = JSON.parse(document.getElementById("staging-data").textContent);
  var byKey = Object.create(null);
  data.stories.forEach(function (s) { byKey[s.key] = s; });

  var staged = Object.create(null);   // key -> new status. Session only.
  var checks = Object.create(null);   // checklist id -> boxed state, session only.

  var countEl = document.getElementById("staged-count");
  var copyBtn = document.getElementById("copy");
  var copyPanel = document.getElementById("copy-panel");
  var copyOut = document.getElementById("copy-out");

  function stagedKeys() { return data.stories.map(function (s) { return s.key; }).filter(function (k) { return k in staged; }); }
  function stagedChecks() { return Object.keys(checks); }

  function refresh() {
    var n = stagedKeys().length + stagedChecks().length;
    countEl.textContent = n + " staged";
    copyBtn.disabled = n === 0;
  }

  // Story ticks. Unchecking returns a row to what the file says, unless the
  // file already said done — then the only meaningful undo is todo.
  document.querySelectorAll("input[data-story]").forEach(function (box) {
    box.addEventListener("change", function () {
      var key = box.getAttribute("data-story");
      var story = byKey[key];
      var next = box.checked ? "done" : (story.status === "done" ? "todo" : story.status);
      var pill = document.querySelector('[data-status-for="' + key + '"]');
      pill.textContent = next;
      pill.className = "pill pill-" + next + (next === story.status ? "" : " staged");
      var row = box.closest("tr");
      if (row) row.setAttribute("data-status", next);
      if (next === story.status) delete staged[key]; else staged[key] = next;
      refresh();
    });
  });

  // Gate and pre-code checklist items. Same rule: staged, never persisted.
  document.querySelectorAll("input[data-check]").forEach(function (box) {
    var id = box.getAttribute("data-check");
    var original = box.checked;
    box.addEventListener("change", function () {
      if (box.checked === original) delete checks[id]; else checks[id] = box.checked;
      refresh();
    });
  });

  function row(story, status) {
    var cells = story.cells.slice();
    if (story.statusIndex >= 0) cells[story.statusIndex] = status;
    else cells.push(status);
    return "| " + cells.join(" | ") + " |";
  }

  /** Until advise §7 step 3 lands, most tables have no Status column, so the
   *  appended cell needs a header to paste under. Said once per table. */
  function header(story) {
    if (story.statusIndex >= 0) return null;
    var headers = story.headers.concat(["Status"]);
    return "<!-- this table has no Status column yet; header becomes: | " +
      headers.join(" | ") + " | -->";
  }

  function markdown() {
    var out = ["<!-- staged in plans/backlog.html, generated " + data.generatedAt + " -->"];
    var keys = stagedKeys();
    if (keys.length) {
      out.push("", "### " + data.source + " — story rows");
      var group = null;
      keys.forEach(function (k) {
        var s = byKey[k];
        var label = s.milestone + (s.epic && s.epic !== s.milestone ? " / " + s.epic : "");
        if (label !== group) {
          group = label;
          out.push("", "#### " + label);
          var note = header(s);
          if (note) out.push(note);
        }
        out.push(row(s, staged[k]));
      });
    }
    var g2 = data.gateItems.filter(function (it) { return it.id in checks; });
    if (g2.length) {
      out.push("", "### " + data.source + " — G2 trigger checklist");
      g2.forEach(function (it) { out.push("- [" + (checks[it.id] ? "x" : " ") + "] " + it.text); });
    }
    var pc = data.precode.filter(function (it) { return it.id in checks; });
    if (pc.length && data.advisorySource) {
      out.push("", "### " + data.advisorySource + " — §12 work checklist");
      pc.forEach(function (it) { out.push("- [" + (checks[it.id] ? "x" : " ") + "] " + it.text); });
    }
    return out.join("\\n");
  }

  copyBtn.addEventListener("click", function () {
    var text = markdown();
    copyOut.value = text;
    copyPanel.open = true;
    copyOut.focus();
    copyOut.select();
    // The textarea is the reliable path (this file is opened from disk); the
    // clipboard write is the convenience on top of it, never the only route.
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () {});
    }
  });

  // filtering ------------------------------------------------------------
  var q = document.getElementById("q");
  var filter = document.getElementById("status-filter");

  function apply() {
    var term = q.value.trim().toLowerCase();
    var want = filter.value;
    var active = term !== "" || want !== "all";

    document.querySelectorAll("details.milestone").forEach(function (ms) {
      // A milestone matches on its own heading too — M6.5, M9.5 and M11 carry
      // no stories at all, and a filter that hid them would under-report the
      // plan rather than filter it. A status filter is about stories, so it
      // never keeps a milestone alive on its heading alone.
      var selfMatch =
        want === "all" &&
        (term === "" || ms.getAttribute("data-search").indexOf(term) !== -1);
      var childMatch = false;

      var groups = ms.querySelectorAll(".group");
      groups.forEach(function (group) {
        var groupVisible = false;
        var rows = group.querySelectorAll("tr.story");
        if (rows.length) {
          rows.forEach(function (tr) {
            var hit =
              (term === "" || tr.getAttribute("data-search").indexOf(term) !== -1) &&
              (want === "all" ||
                (want === "blank"
                  ? tr.getAttribute("data-blank") === "1"
                  : tr.getAttribute("data-status") === want));
            tr.classList.toggle("hidden", !hit);
            if (hit) groupVisible = true;
          });
        } else {
          // Epic-level entries have no status, so a status filter excludes them.
          groupVisible =
            want === "all" &&
            (term === "" || group.getAttribute("data-search").indexOf(term) !== -1);
        }
        group.classList.toggle("hidden", !groupVisible);
        if (groupVisible) {
          childMatch = true;
          if (active) group.open = true;
        }
      });

      // Matched by heading but nothing under it did: show the whole milestone
      // rather than an empty shell.
      if (selfMatch && !childMatch) {
        groups.forEach(function (group) {
          group.classList.remove("hidden");
          group.querySelectorAll("tr.story").forEach(function (tr) {
            tr.classList.remove("hidden");
          });
        });
      }

      var visible = childMatch || selfMatch;
      ms.classList.toggle("hidden", !visible);
      if (active && visible) ms.open = true;
    });
  }

  q.addEventListener("input", apply);
  filter.addEventListener("change", apply);

  document.getElementById("expand").addEventListener("click", function () {
    document.querySelectorAll("#tree details").forEach(function (d) { d.open = true; });
  });
  document.getElementById("collapse").addEventListener("click", function () {
    document.querySelectorAll("#tree details.milestone").forEach(function (d) { d.open = false; });
  });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target;
    var tag = t && t.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable)) return;
    e.preventDefault();
    q.focus();
    q.select();
  });

  refresh();
})();
</script>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------

const model = parseBacklog(readFileSync(SOURCE, "utf8"));
const precode = parseAdvisoryChecklist(ADVISORY, ADVISORY_SECTION);
const html = buildPage(
  model,
  precode,
  new Date().toISOString().replace(/\.\d+Z$/, "Z"),
);
writeFileSync(OUT, html, "utf8");

const stories = model.milestones.flatMap((m) =>
  m.groups.flatMap((g) => g.stories),
);
console.log(
  `${path.relative(ROOT, OUT).replace(/\\/g, "/")} — ` +
    `${model.milestones.length} milestones · ${stories.length} stories · ` +
    `${stories.filter((s) => s.blankDod).length} without DoD · ` +
    `${model.gates.length} gates · ${model.decisions.length} decisions · ` +
    `${precode ? precode.length : 0} pre-code items`,
);
