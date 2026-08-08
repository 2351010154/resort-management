import { Module } from "@nestjs/common";
import { BusinessDateService } from "../booking/business-date.service.js";
import { SystemConfigModule } from "../system-config/system-config.module.js";
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
// `BusinessDateService` is provided here rather than imported from
// `BookingModule`, where it lives, for the reason `housekeeping.module.ts` gives
// about the same class: that module imports this one for `FOLIO_PORT`, so
// importing it back would be a cycle broken with `forwardRef` for the sake of
// one stateless provider. The instance is duplicated and the implementation is
// not, and it caches no hour — it reads the `system_config` row on every call —
// so no two instances can disagree about what day the property is on.
@Module({
  imports: [SystemConfigModule],
  controllers: [FolioController],
  providers: [
    { provide: E_INVOICE_PORT, useClass: LocalEInvoiceService },
    BusinessDateService,
    FolioService,
  ],
  exports: [FolioService],
})
export class FolioModule {}
