# Docs

Written as the system is built, not assembled at the end. This file is the
**authority map**: it says which document owns which fact, and nothing else
restates it.

Looking for the project rather than a fact? [`orientation.md`](orientation.md) is
the human entry point — what Mariva is, the invariant everything else protects,
the milestone road, and a procedure for answering *what should I do next*. It
owns no facts and cites the files below for all of them.

## Precedence — stated once, here

1. **`plans/backlog.md` wins for tickets, phases, gates and status.** What is
   being built, in what order, and whether it is done.
2. **`docs/` wins for design facts.** Structure, roles, states, stack,
   infrastructure. Where a plan or a report disagrees with a `docs/` file about
   a design fact, the `docs/` file is right and the other is stale.
3. **`docs/bao-cao/` never wins.** The coursework report is assembled from the
   two above; it is a consumer of truth, never a source.
4. **`plans/reports/archive/` is frozen dated rationale.** The advisory reports
   explain *why* a decision was taken on the day it was taken. They are
   read-only, they are never updated, and they are not a fourth source. Cite
   them for reasoning; take the fact from the canonical file.

## Language

**English is the language of truth.** `docs/README.md`, everything under
`docs/architecture/`, `plans/backlog.md` and the plan files are English.

`docs/bao-cao/` is the Vietnamese coursework deliverable, translated and
assembled from the English documents. Vietnamese legal and commercial terms —
*hóa đơn điện tử* (electronic invoice), *chữ ký số* (digital signature), *hóa
đơn khởi tạo từ máy tính tiền* (point-of-sale-issued invoice) — keep their
Vietnamese names everywhere, because that is what they are called in the
contracts and the regulations. Everything else, in a canonical file, is English.

## The map — one canonical file per fact domain

| Fact domain | Canonical file | Status |
|---|---|---|
| Repository structure, dependency rules, module map | [`architecture/repository-structure.md`](architecture/repository-structure.md) | decided |
| Palette, type, spacing, motion, copy voice, alt-text rule | [`architecture/design-foundations.md`](architecture/design-foundations.md) | decided |
| Property facts, rate structure, cancellation grid, charge model, service catalog | [`architecture/property-and-tariff.md`](architecture/property-and-tariff.md) | decided — provisional in whole; §1–§6 all ⚑, §7 is config and never ⚑ |
| Roles and permissions | [`architecture/rbac-matrix.md`](architecture/rbac-matrix.md) | decided — **six** ⚑ decisions await owner sign-off, counted in its §5; §3 now has a code mirror in `apps/api/src/modules/identity/rbac/matrix.ts`, and the document stays the authority |
| Booking states and transitions | [`architecture/booking-state-machine.md`](architecture/booking-state-machine.md) | decided — **two** ⚑ decisions await owner sign-off, counted in its §7 |
| Technology stack, versions, rejected options | [`architecture/tech-stack.md`](architecture/tech-stack.md) | decided — contract layer gated on `G1` |
| Hosting, database, storage, backups, payments, e-invoice | [`architecture/infrastructure.md`](architecture/infrastructure.md) | decided — production flip gated on `G2` |
| Tickets, milestones, phases, gates, open decisions | [`../plans/backlog.md`](../plans/backlog.md) | active |
| Coursework report | [`bao-cao/README.md`](bao-cao/README.md) | draft — chapters 5, 7–9 await measured results |

Status means: **decided** — the fact is settled and code may rely on it;
**active** — a working record that changes as work lands; **draft** — being
written, not yet an authority; **open** — no canonical file yet, the decision
lives as a row in `plans/backlog.md` §1.

The architecture documents are authored **ahead** of the code that enforces
them: change the document first, then the implementation.

## How a decision becomes a document

Open decisions live as rows in [`plans/backlog.md`](../plans/backlog.md) §1 —
`D1` through `D8`. When one is settled, its content graduates into a `docs/`
file and the backlog row flips to **Done → `<docs path>`**. A decided fact never
stays in the backlog, and an open decision never gets a `docs/` file.

§1 is split by **who has to answer**: `§1.1` decisions that were always the
developer's, `§1.2` the three that are genuinely somebody else's. A decision in
§1.1 is settled by writing it down and marking it ⚑ — an assumption on the page
is cheap to overturn, an undocumented wait is not. `D5`, `D6` and
`property-and-tariff.md` are the worked examples.

## Not written yet

Once the schema exists: a generated ERD, sequence diagrams for the booking
hold, payment webhook, check-in and night-audit flows, and a traceability table
from each brief requirement to its endpoint, screen and test. The use-case and
state diagrams generate from the RBAC matrix and the state machine. `P0-DOC-01`
through `P0-DOC-05` own that work.

## The coursework report

[`bao-cao/`](bao-cao/README.md) — the Vietnamese đồ án (coursework) report.
Nine chapters plus front matter and appendices, assembled from the documents
above rather than authored separately.

[`bao-cao/hinh/`](bao-cao/hinh/) carries the eight figures as `.drawio` sources
with `.png` and `.svg` exports. They are hand-drawn **today** because the
schema, the contract and the CI generators do not exist yet — each one says so
on its face. `P0-DOC-01` through `P0-DOC-04` replace the ERD, the use-case
diagram and the state diagram with generated equivalents that CI re-runs and
fails on drift. Delete the hand-drawn version the day its generator lands; a
diagram that has drifted from the schema is worse than no diagram.
