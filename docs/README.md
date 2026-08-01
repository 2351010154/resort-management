# Documentation authority

This file routes collaborators to the smallest authority surface for each kind
of fact. Start with [`orientation.md`](orientation.md) for project context and
use this map when two sources disagree.

[`screens.md`](screens.md) records screen intent and navigation rationale. It
does not report implementation or delivery status.

## Precedence

1. **Source, tests, schemas, manifests and workflows own current behavior.**
   Documentation points to that evidence; an intended contract is not release
   proof.
2. **The [SCRUM Jira project](https://hungphat2018-1785053353783.atlassian.net/issues/?jql=project%20%3D%20SCRUM)
   owns current execution.** Status, assignee, priority, sprint, dates and
   blockers belong there.
3. **Repository documentation owns durable intent, decisions and rationale.**
   [`product-requirements.md`](product-requirements.md) owns product outcomes,
   business rules and acceptance criteria. The files under `architecture/` own
   architectural boundaries, constraints, trade-offs and pointers to their
   executable evidence.
4. **`plans/` contains versionable stateful records.** Plans, reports and research
   snapshots preserve context but may age; they do not override Jira, current
   evidence or durable documentation. Generated HTML and capture screenshots
   remain untracked.
5. **`docs/bao-cao/` is outdated and untrusted.** The coursework report is a
   consumer of the authorities above, and as of 2026-08-01 it has drifted from
   them. Do not read it to learn how the system works, do not cite it, and do
   not change code or docs to match it. It is edited only when the report itself
   is being rewritten, from directly re-read evidence.

When Jira says work is complete but the executable evidence disagrees, report
the inconsistency rather than rewriting either source to conceal it.

## Durable decision map

| Fact domain | Owner |
|---|---|
| Product outcomes, stable requirements, acceptance criteria, business rules and external assumptions | [`product-requirements.md`](product-requirements.md) |
| Repository boundaries and dependency rationale | [`architecture/repository-structure.md`](architecture/repository-structure.md) |
| Palette, typography, spacing, motion, copy voice and alternative-text rules | [`architecture/design-foundations.md`](architecture/design-foundations.md) |
| Property facts, rate structure, cancellation rules, charge model and service catalog | [`architecture/property-and-tariff.md`](architecture/property-and-tariff.md) |
| Roles, capabilities and permission rationale | [`architecture/rbac-matrix.md`](architecture/rbac-matrix.md) |
| Booking states and transition rules | [`architecture/booking-state-machine.md`](architecture/booking-state-machine.md) |
| Technology choices and rejected alternatives | [`architecture/tech-stack.md`](architecture/tech-stack.md) |
| Hosting, database, storage, backup, payment and e-invoice decisions | [`architecture/infrastructure.md`](architecture/infrastructure.md) |
| Screen intent and navigation | [`screens.md`](screens.md) |
| Current delivery fields and blockers | [SCRUM in Jira](https://hungphat2018-1785053353783.atlassian.net/issues/?jql=project%20%3D%20SCRUM) |
| Coursework report (outdated, untrusted — owns nothing) | [`bao-cao/README.md`](bao-cao/README.md) |

Architecture documents may describe an accepted target before code enforces it.
Follow their evidence links to determine what is implemented.

## How decisions move

Track unresolved work and external answers in Jira. Once an answer becomes a
durable product or architecture decision, record it once in the relevant owner
above and link the Jira issue to that document. Source, tests, schemas or
workflows then become the evidence that the decision has shipped.

Advisory material under `plans/reports/archive/` is frozen dated rationale. Cite
it for the trade-off considered at that time, but take the current decision from
the durable owner.

## Language

English is the canonical language for product and architecture documentation
and for Markdown plans. `docs/bao-cao/` is the Vietnamese coursework
deliverable. Vietnamese legal and commercial terms keep their Vietnamese names
where they are the terms used by contracts or regulations.

## Coursework

[`bao-cao/`](bao-cao/README.md) is the Vietnamese đồ án report and
[`bao-cao/hinh/`](bao-cao/hinh/) holds its diagram sources and exports. **Both
are stale as of 2026-08-01 and carry no authority.** The diagrams there are hand
drawn design sketches, not generated from any schema or contract, so they can
disagree with the database and the API without anything failing. Every claim in
that directory is downstream material to be re-verified against the durable
owner and executable evidence before it is reused or submitted.
