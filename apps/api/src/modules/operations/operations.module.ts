import { Module } from "@nestjs/common";
import { BusinessDateService } from "../booking/business-date.service.js";
import { SystemConfigModule } from "../system-config/system-config.module.js";
import { CashBookController } from "./cash-book.controller.js";
import { CashBookService } from "./cash-book.service.js";
import { CatalogController } from "./catalog.controller.js";
import { CatalogService } from "./catalog.service.js";
import { ShiftController } from "./shift.controller.js";
import { ShiftService } from "./shift.service.js";

// The back office — `repository-structure.md`'s `operations`, which it defines
// as "shift handover, cash drawer, service catalog, income/expense".
//
// All four now. The catalog arrived first because `FR-FOL-03` needed it; the
// drawer and the handover are `FR-OPS-01`, and they are one service for the
// reason `shift.service.ts` argues at length — an item a shift could not finish
// and the drawer it could not finish it on are one person's day.
//
// **Income and expense is a third service and not a fourth act of the shift
// one**, though the two meet at the drawer. `cash-book.service.ts` says why they
// are separate at the seam that matters: a shift is one person's answerability
// for one till over one interval, and the cash book is the property's own money
// over months — read by an accountant closing a period, with a matrix row that
// denies a receptionist outright where both of the drawer's rows grant them
// `conditional`. What the two share is one figure, and it travels the way a
// figure should: `ShiftService` sums the entries bound to a drawer, from the
// table, without either service calling the other.
//
// **Not inside `folio`, and the distinction is the requirement's own.** The
// catalog is what the property sells; a folio is what one stay owes. They meet
// at exactly one point — a posting names an item — and that point is a foreign
// key, which is the narrowest join two things can have. Folding the reads into
// `FolioService` would put "what is for sale" and "what this guest owes" behind
// one class, and the first is the same answer for every stay in the building.
// `schema/service.ts` calls the table `modules/folio`'s because that is where an
// item becomes a line, and this module is what it becomes a line *from*.
//
// Both services are exported, so a controller is not the only way in, for the
// same reason `SystemConfigModule` exports its reader: `folio.controller.ts`
// resolves a catalog item inside the transaction it is about to post in, and
// reaching this over HTTP would answer from a different connection than the
// write. **The drawer needs that export more than the catalog does.** A catalog
// row read on a second connection is at worst a repricing a request old; the
// shift a cash payment names is chosen and then written into, and the trigger in
// `migrations/0040` takes a share lock on that row as the payment goes in
// expressly so a close and a payment cannot pass each other. Read outside the
// writing transaction, the drawer could be counted out between being chosen and
// being used — and the đồng would land in a handover somebody had already signed
// for.
//
// `SystemConfigModule` is imported for the reader behind `BusinessDateService`,
// which is provided here rather than imported from `BookingModule`, where it
// lives, for the reason `folio.module.ts` gives about the same class: that
// module imports this one, so importing it back would be a cycle broken with
// `forwardRef` for the sake of one stateless provider. The instance is
// duplicated and the implementation is not, and it caches no hour — it reads the
// `system_config` row on every call — so no two instances can disagree about
// which trading day a drawer opened on.
//
// `DatabaseModule` is global, so nothing is imported for the Drizzle client or
// the `TransactionRunner` the controllers inject.
@Module({
  imports: [SystemConfigModule],
  controllers: [CashBookController, CatalogController, ShiftController],
  providers: [
    BusinessDateService,
    CashBookService,
    CatalogService,
    ShiftService,
  ],
  exports: [CatalogService, ShiftService],
})
export class OperationsModule {}
