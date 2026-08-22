import { Module } from "@nestjs/common";
import { BusinessDateService } from "../booking/business-date.service.js";
import { CashBookService } from "../operations/cash-book.service.js";
import { OperationsModule } from "../operations/operations.module.js";
import { SystemConfigModule } from "../system-config/system-config.module.js";
import { ManagementExports } from "./management-exports.js";
import { NightAuditService } from "./night-audit.service.js";
import { PerformanceQueries } from "./performance-queries.service.js";
import { ReportQueries } from "./report-queries.service.js";
import { ReportingController } from "./reporting.controller.js";

// Management data as a file, and the reports it is drawn from —
// `repository-structure.md`'s `reporting` row.
//
// **The export half of that row, then the night audit, now the Reports pages.**
// `FR-OPS-03`'s files were the first thing here and `FR-RPT-01` was the second;
// `FR-RPT-02` is the third, and it needed exactly what that second one promised
// — `excel-sheet.ts` knew nothing about a cash book, so the two report sheets
// are two more definitions in `management-exports.ts` and one new column kind in
// the writer. `FR-RPT-03` is the fourth and is `PerformanceQueries`.
//
// **Two report services and not one, which is a boundary rather than a
// duplication.** `ReportQueries` owns `FR-RPT-02`'s revenue and room-status
// pages and `PerformanceQueries` owns `FR-RPT-03`'s occupancy, ADR and RevPAR;
// the second is constructed against the first, because the boundary every report
// page is stamped with — `max(business_date)` — is one statement in one place,
// and two of them would let the two pages disagree about how far the audit has
// got. Nest hands it the same singleton the controller holds, so the pair is one
// object and one answer.
//
// **What the exports do is read and write nothing.** Every row in every file
// they produce comes back through the service that already owns that list, so
// there is no query there to keep in step with a screen and no scoping rule to
// restate. `ReportQueries` is that service for the two report sheets, and it is
// the same provider the two read routes answer from — the file and the page
// cannot disagree about a month, because there is one set of statements behind
// both.
//
// `NightAuditService` is the exception and is why this module now exports
// something. It is the only writer in the folder: it freezes what a closed
// trading day came to, and `night-audit.job.ts` — provided by `jobs.module.ts`
// with every other sweep, for the reason that file gives — is what calls it. The
// service lives here rather than there because a snapshot is a reporting fact
// and the scheduler owns no table; `night-audit.service.ts` argues the split
// between deciding which day is closed and deciding what the day was worth.
//
// `OperationsModule` is imported for `ShiftService`, which it exports for
// exactly this kind of caller. `CashBookService` is not exported by it, and is
// provided here rather than added to its exports — the instance is duplicated
// and the implementation is not, which is the trade `operations.module.ts`
// already makes for `BusinessDateService` and states its reason for. It is safe
// on the same terms and for a narrower reason than that one: this module calls
// only `list`, the service holds no state between calls, and every read goes
// through the executor the controller's transaction opened, so two instances
// cannot answer differently.
//
// `BusinessDateService` comes with it because `CashBookService` constructs
// against one, and `SystemConfigModule` is imported for the reader behind it.
// Neither is reached by anything in this module: no export resolves a trading
// day, because an export files nothing — it reads days the operator named.
//
// `AuditModule` is global and exports `AuditService`, so the change log needs no
// import line. `DatabaseModule` is global too, which is where the
// `TransactionRunner` the controller injects comes from.
@Module({
  imports: [OperationsModule, SystemConfigModule],
  controllers: [ReportingController],
  providers: [
    BusinessDateService,
    CashBookService,
    ManagementExports,
    NightAuditService,
    PerformanceQueries,
    ReportQueries,
  ],
  exports: [NightAuditService],
})
export class ReportingModule {}
