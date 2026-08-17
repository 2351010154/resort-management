import { Module } from "@nestjs/common";
import { BusinessDateService } from "../booking/business-date.service.js";
import { GuestModule } from "../guest/guest.module.js";
import { OperationsModule } from "../operations/operations.module.js";
import { SystemConfigModule } from "../system-config/system-config.module.js";
import { EInvoiceJob } from "./e-invoice.job.js";
import { FolioController } from "./folio.controller.js";
import { FolioService } from "./folio.service.js";
import { LocalEInvoiceService } from "./local-e-invoice.service.js";
import { E_INVOICE_PORT } from "./ports/e-invoice.port.js";

// The append-only ledger one stay runs up — `FR-FOL-01`, and
// docs/architecture/repository-structure.md §apps/api.
//
// `SystemConfigModule` is imported rather than read around: `FR-FOL-02` has the
// rates read at posting time, and `SystemConfigService` is the reader — exported
// by that module for this caller and no other. It takes the posting's executor,
// so the rate and the lines it is applied to come out of one transaction.
//
// The service is exported as well as served over the controller, and the export
// is the older of the two: `booking.module.ts` binds `FOLIO_PORT` to it so the
// check-out guard reads a real balance. That guard cannot go through the routes
// below — reaching them over HTTP would answer it from a different connection
// than the transition it guards.
//
// The dependency between the two modules runs one way at runtime. `booking`
// imports this module for the binding; this module names `booking` only for the
// port's type, which erases, so there is no cycle to break with `forwardRef`.
//
// `DatabaseModule` is global, so nothing is imported for the Drizzle client the
// port's balance read takes or for the executor every write is handed.
//
// `E_INVOICE_PORT` is bound the way `payment.module.ts` binds its gateway, and
// for the same purpose: `FR-FOL-04` waits on `ASM-03` and `ASM-04`, so the
// provider that will issue the property's invoices is unknown, and the line
// below is what makes it one changed line rather than a change to the close
// path. `LocalEInvoiceService` issues nothing and answers everything, which is
// what lets the close, its idempotency and the stored reference be built and
// tested now — the argument `ports/folio-stub.service.ts` makes for the binding
// `booking` opened with.
//
// Not exported, unlike the service above it. `PAYMENT_GATEWAY` and `FOLIO_PORT`
// are both consumed inside the module that binds them, and this one is the
// same: what issues the invoice is this module's business, and a token reachable
// from elsewhere is a second caller of a provider that is about to be replaced.
//
// `EInvoiceJob` is provided and exported here, and it is the one sweep in the
// tree that is not provided by `jobs.module.ts`. That file's convention exists
// so "which sweeps run" is answerable from its registry, and the registry still
// names this one — what it cannot do is construct it, because construction
// needs `E_INVOICE_PORT` and the paragraph above is the reason that token does
// not leave this module. Exporting the token to satisfy a class that lives in
// this folder would be trading the boundary that matters for the one that
// reads well.
//
// `BusinessDateService` is provided here rather than imported from
// `BookingModule`, where it lives, for the reason `housekeeping.module.ts` gives
// about the same class: that module imports this one for `FOLIO_PORT`, so
// importing it back would be a cycle broken with `forwardRef` for the sake of
// one stateless provider. The instance is duplicated and the implementation is
// not, and it caches no hour — it reads the `system_config` row on every call —
// so no two instances can disagree about what day the property is on.
// `OperationsModule` is imported for the same reason and on the same terms as
// `SystemConfigModule` above it: `FR-FOL-03` posts a catalog item at the price
// the catalog holds, and the row has to be read through the posting's own
// executor so the figure the line is computed from is the figure that was there
// when it went in. The dependency runs one way — the catalog knows nothing about
// a folio, and a posting is the only place the two meet.
// `GuestModule` is imported for the one thing the close does after it commits:
// `FR-GST-05` earns a guest points for the stay whose account was just agreed,
// and `LoyaltyService` is where that lives. The edge runs this way and only
// this way — the ledger row keys on a folio, and nothing in the guest realm
// asks a folio anything — so no `forwardRef` is needed to state it.
@Module({
  imports: [GuestModule, OperationsModule, SystemConfigModule],
  controllers: [FolioController],
  providers: [
    { provide: E_INVOICE_PORT, useClass: LocalEInvoiceService },
    BusinessDateService,
    EInvoiceJob,
    FolioService,
  ],
  exports: [EInvoiceJob, FolioService],
})
export class FolioModule {}
