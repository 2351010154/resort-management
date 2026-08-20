import { Module } from "@nestjs/common";
import { BusinessDateService } from "../booking/business-date.service.js";
import { CashBookService } from "../operations/cash-book.service.js";
import { OperationsModule } from "../operations/operations.module.js";
import { SystemConfigModule } from "../system-config/system-config.module.js";
import { ManagementExports } from "./management-exports.js";
import { ReportingController } from "./reporting.controller.js";

// Management data as a file — `repository-structure.md`'s `reporting` row, and
// the first thing to occupy the folder it reserved.
//
// **It is only the export half of that row today.** `FR-RPT-01`'s night audit
// and the KPI reads land at M9 and are not anticipated here: an empty service
// registered against a requirement nobody has built is the lie
// `app.module.ts` warns about in its own header. What is here is `FR-OPS-03`,
// which M8 owes, and the machinery it is built on is the machinery the Reports
// pages will hand their own rows to — `excel-sheet.ts` knows nothing about a
// cash book, so a snapshot-backed report is a fourth sheet definition and no
// change to the writer at all.
//
// **This module reads and writes nothing.** Every row in every file it produces
// comes back through the service that already owns that list, so there is no
// query here to keep in step with a screen and no scoping rule to restate. That
// is also why it holds no service of its own beyond the sheet definitions.
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
  providers: [BusinessDateService, CashBookService, ManagementExports],
})
export class ReportingModule {}
