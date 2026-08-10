import { Module } from "@nestjs/common";
import { CatalogController } from "./catalog.controller.js";
import { CatalogService } from "./catalog.service.js";

// The back office — `repository-structure.md`'s `operations`, which it defines
// as "shift handover, cash drawer, service catalog, income/expense".
//
// The catalog is the first of the four to be built, because `FR-FOL-03` needs it
// and the other three are later milestones. So this module holds one thing today
// and is named for what it will hold, which is the boundary the document already
// drew rather than one invented around a single service.
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
// The service is exported, so the controller is not the only way in, for the
// same reason `SystemConfigModule` exports its reader: `folio.controller.ts`
// resolves an item inside the transaction it is about to post in, and reaching
// this over HTTP would answer from a different connection than the write.
//
// `DatabaseModule` is global, so nothing is imported for the Drizzle client or
// the `TransactionRunner` the controller injects.
@Module({
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class OperationsModule {}
