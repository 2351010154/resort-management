# Advise — Context and docs for the Mariva project report

- Date: 2026-07-26
- Repo: `C:/Users/tamla/Downloads/khach-san` (branch `chore/web-react19-next16`)
- Input: `C:/Users/tamla/Downloads/ABDM/Documents/Medical_Appointment_B3_8_Report.pdf` (reference format only), `docs/`, `plans/`, reports R1–R3 + readiness
- Question: rewrite that report to reflect Mariva — what context and docs are needed, what is missing?
- Mode: advisory only. No code or docs changed.

## Interview outcomes (binding)

| # | Question | Decision |
|---|---|---|
| 1 | Subject | **Công nghệ phần mềm / Đồ án** — full lifecycle, not the reference PDF's architecture course |
| 2 | Reference template | Formatting reference only; chapter skeleton is not binding |
| 3 | Evidence gap | **Build first, then write.** Prepare context + skeleton now; prose waits for P0/P1 |
| 4 | Language | **Vietnamese prose, English technical terms** |
| 5 | Authorship | **Solo**, cover details to be supplied |
| 6 | Rubric | No document beyond the 12 brief bullets already in R1 §3A |

---

## 1. Verdict

**You are not short of material — you are short of the right shape and one deadline.**

The reference PDF is a 15-page skeleton: chapter 1 written, chapters 2–7 are headings with page numbers. Mariva already has more written substance than that PDF's finished portions — three advisory reports (1,517 lines), a consolidated backlog with 11 milestones, and two architecture documents authored ahead of code. Chapters 1–3 of a CNPM report are largely **translation and restructuring**, not authorship.

Three real problems, in order of cost:

1. **No deadline is recorded anywhere.** "Build first, then write" is only viable if the đồ án is due after P1 lands (~7 weeks of engineering from today, per the backlog). If it is due sooner, the strategy inverts and this whole plan changes. This is the one blocker.
2. **The report's scope is not the system's scope.** Mariva is a 6–12 month build; an đồ án is graded as a bounded deliverable. Without an explicit scope boundary the report reads as an unfinished system rather than a deliberately phased one.
3. **Docs are English, the report is Vietnamese.** Nothing currently prevents six months of inconsistent ad-hoc translation. Fixed for ~1 hour of work now (§6.1).

Do not copy the reference PDF's structure. It is an architecture-course template and it is mostly empty. Copy exactly one thing from it: **§1.3's method** — tech choices as dated ADRs with a comparison table and an honest trade-off statement. Mariva's R2 already contains that reasoning at higher quality than the PDF's generic SQL-vs-NoSQL table.

---

## 2. What the reference PDF actually offers

| Element | Verdict |
|---|---|
| Cover page, `THÔNG TIN PHÂN CÔNG`, MỤC LỤC, DANH MỤC BẢNG/HÌNH, DANH MỤC TỪ VIẾT TẮT, TÀI LIỆU THAM KHẢO, PHỤ LỤC | **Keep.** Institutional formatting — reuse verbatim, adjust for solo authorship |
| §1.1 problem framing anchored to a cited survey `[1]` | **Keep the pattern.** Mariva's equivalent anchor is a real property opening, which is stronger |
| §1.3 tech choices → ADR files + comparison tables + trade-off admitted | **Keep the method.** Best thing in the document |
| Chapter skeleton (7 chapters, C4, sequence diagrams, Docker, CI/CD, demo) | **Discard as a template**, harvest as a checklist. Different subject |
| Its actual decisions (Django, MySQL, React+Vite, RabbitMQ) | **Irrelevant.** Mariva picked NestJS, Postgres, Next.js, pg-boss for reasons R2 records |
| Chapters 2–7 | Empty. Nothing to learn |

One caution from it: §1.3.1 admits the backend choice was made *before* the architecture was settled ("cần thống nhất lại kiến trúc dự án trước khi chọn backend… nhưng trước mắt, nhóm quyết định sử dụng Django"). Mariva's R2 does the opposite and should say so — decisions follow from constraints, and where one was reversed (ts-rest → oRPC, R2 §4) the reversal is documented. **A recorded reversal scores better than a clean-looking list.**

---

## 3. Recommended chapter outline

Nine chapters. Every one maps to material that exists or is scheduled. Vietnamese titles; English technical terms retained.

| Ch | Title | Content | Source | Writable |
|---|---|---|---|---|
| 1 | **Giới thiệu đề tài** | Bối cảnh (resort chưa khai trương), bài toán, phạm vi báo cáo vs phạm vi hệ thống, non-goals | R1 §2, §4 | **Now** |
| 2 | **Phân tích yêu cầu** | 12 functional bullets + 11 added requirements; NFRs; actors; use cases | R1 §3A/§3B, `rbac-matrix.md` | **Now** (use-case diagram after P0-DOC-03) |
| 3 | **Lựa chọn công nghệ** | Stack per layer, comparison tables, ADRs, one documented reversal, what was rejected | R2 §3, §4, §6, §8; R3 §3, §5, §6 | **Now** |
| 4 | **Thiết kế kiến trúc** | Modular monolith, one-API-three-consumers, module map, dependency rules, two-layer inventory | `repository-structure.md`, R1 §6 | **Now** |
| 5 | **Thiết kế chi tiết** | ERD, schema, invariants as DB constraints, state machine, RBAC matrix, API contract, sequence diagrams | `booking-state-machine.md`, `rbac-matrix.md`; ERD/OpenAPI generated | **Partial** — ERD after P1-SCH, API after P0-C |
| 6 | **Quy trình phát triển** | Iterative phased delivery, milestone table with estimates, gates and blocking decisions, git workflow, risk register | `backlog.md`, R1 §9, R2 §8, R3 §9 | **Now** |
| 7 | **Kiểm thử và đảm bảo chất lượng** | Test strategy: concurrency, property-based, RBAC data-driven, visual baseline, Testcontainers, CI gates | R2 §10, backlog `P0-CI-*`, `P1-INV-05` | **Strategy now**, results after P1 |
| 8 | **Triển khai và vận hành** | Infra topology, environments, secrets, monitoring, backup/restore drill, the G2 trigger checklist | R3 §3, backlog `P0-INF-*`, G2 | **Design now**, evidence after P0-INF |
| 9 | **Kết quả, hạn chế, hướng phát triển** | Measured results, traceability 12/12, limitations, roadmap P7/P8 | `backlog.md` §10, R1 §16 metrics | **After the build** |

Appendices: bảng traceability, danh mục ADR, hướng dẫn cài đặt, screenshots.

**Chapter 6 is the differentiator for a CNPM subject** and the reference PDF has no equivalent. A backlog with dependency-ordered milestones, explicit gates, a reconciliation log recording what was superseded and why, and 48 success metrics used as acceptance criteria — that is process evidence most đồ án reports cannot produce.

### 3.1 The scope boundary (§1 finding 2)

State it once in chapter 1, in a table:

- **Phạm vi báo cáo** — P0 → P6. Covers all 12 brief bullets (backlog §10 proves it). This is what is graded.
- **Phạm vi hệ thống** — P0 → P8 including MoMo, overbooking, OTA channel manager. Deferred with reasons already written in R1 §4 non-goals.

That converts apparent incompleteness into a defended engineering decision. R1 §14 already establishes all 12 bullets close at P6, so the boundary is factual, not a convenience.

---

## 4. Source map — where each chapter's material lives

| Existing artifact | Feeds | State |
|---|---|---|
| `plans/reports/advise-260726-0939-resort-pms.md` | Ch 1, 2, 4, 9 | Complete, amended once (§19) |
| `plans/reports/advise-260726-1119-stack-selection.md` | Ch 3, 7 | Complete |
| `plans/reports/advise-260726-1401-infra-money-rails.md` | Ch 3, 8 | Complete |
| `plans/reports/advise-260726-1440-task-readiness.md` | Ch 6 | Complete |
| `plans/backlog.md` | Ch 6, 9, traceability appendix | Active, single source |
| `docs/architecture/repository-structure.md` | Ch 4 | Written ahead of code |
| `docs/architecture/rbac-matrix.md` | Ch 2 (use cases), Ch 5 | Written ahead of code; 6 ⚑ rows unsigned |
| `docs/architecture/booking-state-machine.md` | Ch 5 | Written ahead of code; 3 ⚑ rows unsigned |
| `plans/260726-p0-foundations/plan.md` | Ch 6 | Phase 01 done |
| `apps/web` + visual baseline (`b80e902`) | Ch 7, screenshots | Only running code today |

**The three advisory reports are dated rationale and read-only** (backlog line 9). The report may quote them; it must not become a fourth conflicting source. Where the backlog and a report disagree, the backlog wins — backlog §9 lists eight such reconciliations already.

---

## 5. Gap list — what no document contains

| # | Gap | Blocks | Cost | Owner |
|---|---|---|---|---|
| **1** | **Submission deadline** | The entire build-first strategy | 1 min | You |
| **2** | Cover details — họ tên, MSSV, lớp, khoa, giảng viên hướng dẫn, tháng nộp | Cover, assignment page | 1 min | You |
| 3 | Page/format constraints — length, font, citation style, print or PDF | Ch 3 table density, figure count | 1 min | Course |
| 4 | Diagram notation — strict UML vs Mermaid-generated (`D8`, open since R1 §18 Q5) | Ch 2, 4, 5 tooling | Ask professor | Professor |
| 5 | ERD | Ch 5 | Generated at `P0-DOC-01`, needs P1 schema | Build |
| 6 | API endpoint list | Ch 5 | Generated at `P0-DOC-02`, gated on `G1` | Build |
| 7 | Sequence diagrams (hold→confirm, payment webhook, check-in, night audit) | Ch 5 | 4–5 hand-written Mermaid, ~2h, after P2/P3 | Build |
| 8 | Property facts, tax model, cancellation grid, rate structure (`D1`–`D4`, `D7`) | Ch 2 business rules, Ch 5 | One owner+accountant conversation | Owner |
| 9 | Measured results — concurrency, p95, bundle budget, night-audit proof | Ch 9 | Falls out of the build **if captured** (§6.2) | Build |
| 10 | VN↔EN terminology glossary | Every chapter | ~1h now (§6.1) | You |
| 11 | Citations — Nghị định 70/2025/NĐ-CP, VNPay docs, hotel KPI definitions | TÀI LIỆU THAM KHẢO | Collect while building | You |

Gaps 1–3 are minutes and unblock planning. Gap 4 is one email. Gaps 5–7 and 9 are scheduled work, not missing work. **Gap 8 is already the project's largest blocker** (readiness §10) — it now blocks the report too, which raises its priority.

---

## 6. Recommendations

### 6.1 Write the glossary before the first Vietnamese sentence

`docs/glossary.md` — a two-column VN↔EN table with a keep-in-English column. Terms already in play: folio, night audit, business date, rate plan, rate calendar, ADR/RevPAR/occupancy, idempotency, state machine, hold, no-show, out-of-order, housekeeping status, reversing entry, oversell, exclusion constraint, contract-first, hóa đơn điện tử khởi tạo từ máy tính tiền, chữ ký số HSM, thu chi, ca trực / bàn giao ca.

Decide once whether *folio* becomes "sổ chi phí phòng" or stays English. Doing this at report time means re-reading everything; doing it now costs an hour and makes translation mechanical.

### 6.2 Capture artifacts at the moment they are produced

Reconstructing evidence after the fact is the expensive failure mode. Each item below is nearly free during the build and costs a day to recreate later.

| When | Capture | Feeds |
|---|---|---|
| `G1` verdict | The oRPC spike result, written down either way | Ch 3 ADR |
| Each `D1`–`D8` resolution | A dated ADR file — context, decision, reason, consequence | Ch 3, appendix |
| `P0-CI-*` green | CI run screenshot; Testcontainers warm-boot timing | Ch 7 |
| `P0-DOC-01/02` | `docs/erd.dbml`, `docs/openapi.json` committed and CI-drift-guarded | Ch 5 |
| `P0-AUTH-04` | Test output: every matrix row, allowed + denied | Ch 5, Ch 7 |
| **`P1-INV-05`** | **Full log: 50 parallel bookings → 1 success, 49 clean 409s** | **Ch 9 headline result** |
| `P1-AVL-03` | p95 latency numbers over a 12-month calendar | Ch 9 |
| `P2-*` complete | Keyboard-only check-in E2E recording, 0 mouse events | Ch 9, demo |
| `P3-*` complete | Nightly Σ postings = Σ payments + outstanding assertion output | Ch 9 |
| `P4` bundle gate | CI output proving 0 bytes of `three`/`gsap`/`lenis` in `/booking` | Ch 9 |
| `P6` night audit | pg-boss history proving exactly one run per business date | Ch 9 |
| Every milestone | Screenshots at completion, not at the end | Ch 9, appendix |

**The `P1-INV-05` log is the single strongest figure the report can contain.** Most đồ án reports show screenshots; this shows an invariant enforced under concurrency. Capture it properly — command, output, and the constraint definition that made it structural.

### 6.3 Extend the traceability table by one column

Backlog §10 already maps 12 bullets → milestone → issue. Add **report section**. Fill it while writing tickets. The "đối chiếu yêu cầu" appendix then assembles itself, and `R1#12` (12/12) is satisfied by the same table that proves the coursework complete.

### 6.4 Convert resolved decisions into ADR files as they close

The reference PDF's one good habit. `docs/adr/NNNN-slug.md` — bối cảnh, quyết định, lý do, hệ quả, ngày. Backfill the already-settled ones (monorepo, NestJS, Postgres, Drizzle, oRPC + its reversal, pg-boss, Neon/Fly/Vercel, VNPay-before-MoMo, two-layer inventory, `bigint` VND); write new ones as `D1`–`D8` and `G1` resolve. Chapter 3 becomes an index over `docs/adr/` rather than an essay.

### 6.5 Do not maintain the report in parallel with the build

Keep writing English `docs/` as you go — that habit is already working. The report is a **translation and assembly pass** at the end, over a documentation set that stayed current. Maintaining a Vietnamese report alongside a moving system produces two documents that disagree, and the disagreement is what gets noticed.

---

## 7. What NOT to do

- ❌ Adopt the reference PDF's 7-chapter skeleton. Wrong subject, and mostly empty.
- ❌ Write chapters 5, 7, 8, 9 before their evidence exists. That is the "write against the plan as if done" option, and a missing ERD is discovered in thirty seconds.
- ❌ Copy the PDF's generic comparison tables (SQL vs NoSQL, React vs Vue vs Angular). Compare the options **Mariva actually weighed** — Drizzle vs Prisma, oRPC vs ts-rest, Neon vs self-hosted, VNPay vs MoMo first.
- ❌ Let the report become a fourth source of truth alongside the three read-only reports and the backlog.
- ❌ Hand-draw diagrams that a generator owns. R1 §13: a drifted ERD is worse than none.
- ❌ Present the M0–M11 roadmap as the đồ án scope without the §3.1 boundary.
- ❌ State Nghị định 70/2025 obligations as settled before `M0-06` answers whether it binds this entity's activity codes. Keep it, cite it, mark it pending.
- ❌ Start Vietnamese prose before the glossary exists.

---

## 8. Order of operations

1. **Confirm the deadline** (§5 gap 1). Everything below assumes it clears P1. — *now*
2. Supply cover details; ask the professor about diagram notation (`D8`) and format constraints. — *this week*
3. Write `docs/glossary.md` (§6.1). — *~1h*
4. Add the report-section column to backlog §10 (§6.3). — *~15 min*
5. Create `docs/adr/` and backfill the settled decisions (§6.4). — *~2h, or incremental*
6. Add the §6.2 capture items to the DoD of the tickets that produce them. — *~30 min*
7. Build P0 → P1 as planned. Report writing does not start here.
8. After P1: draft chapters 1–4, 6 from existing material. Translation pass, not authorship.
9. After P3: chapters 5, 7, 8.
10. After P6: chapter 9, appendices, assembly.

Steps 1–6 total under four hours and are the entire difference between a report that assembles and a report that gets written from memory in a panic.

---

## 9. Success metrics

| # | Metric | Target |
|---|---|---|
| 1 | Report sections with no identified source | **0** |
| 2 | Diagrams hand-drawn that a generator could own | **0** |
| 3 | Brief bullets mapped to a report section | **12/12** |
| 4 | Technical terms translated inconsistently across chapters | **0** (glossary enforced) |
| 5 | Settled architectural decisions without an ADR file | **0** |
| 6 | Chapter 9 claims without a captured artifact | **0** |
| 7 | Contradictions between the report and `docs/` | **0** |
| 8 | Milestones whose completion screenshots were taken retroactively | **0** |

---

## 10. Unresolved questions

1. **Submission deadline.** Blocks the build-first strategy; nothing else in this report is safe to plan around until it is known.
2. **Cover details** — họ tên, MSSV, lớp, khoa, giảng viên hướng dẫn, tháng nộp.
3. **Format constraints** — page count, font, citation style, submission medium.
4. `D8` diagram notation — carried from R1 §18 Q5, now blocks three chapters rather than one.
5. Whether the professor accepts a phased scope boundary (§3.1) or expects a single delivered system.
6. Carried, unchanged: `D1`–`D4`, `D7` owner/accountant decisions — now also block chapter 2's business rules.
