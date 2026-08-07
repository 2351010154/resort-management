import { Module } from "@nestjs/common";
import { BookingModule } from "../booking/booking.module.js";
import { FolioModule } from "../folio/folio.module.js";
import { PaymentService } from "./payment.service.js";
import { PAYMENT_GATEWAY } from "./ports/payment-gateway.port.js";
import { VnpayAdapter } from "./vnpay.adapter.js";

// Taking the money and putting it on the account — `FR-PAY-01`, `FR-PAY-03`, and
// docs/architecture/repository-structure.md §apps/api.
//
// **The binding is what this module is for.** `PAYMENT_GATEWAY` is a symbol
// because an interface is a type and erases, and `VnpayAdapter` is the only
// thing in the application that knows what VNPay is. Everything above the token
// — the service here, and the two routes `FR-PAY-03` still needs — is written
// against `PaymentGateway`, so `FR-PAY-06`'s second gateway is a second adapter
// and one changed line in this file rather than a change to any caller.
// `booking.module.ts` binds `FOLIO_PORT` the same way and has already been
// through exactly that swap once, which is the evidence the arrangement works.
//
// `useClass` and not `useExisting`: no other module provides the adapter, so
// there is no instance to point at and this is where it is constructed. It takes
// only `ENV`, which `ConfigModule` is global for, and it builds its client on
// first use — so registering this module does not require a terminal code, and a
// deployment without one boots and fails at the payment rather than at the boot.
//
// `FolioModule` is imported rather than the service re-provided, so a callback
// posts to the same account the check-out guard reads its balance from.
// `folio.module.ts` argues that export, and a second `FolioService` constructed
// here would be a second reader of the same rows carrying its own
// `SystemConfigService` behind it.
//
// `BookingModule` is imported for `BusinessDateService`, which is what dates a
// posting by the property's 04:00 rollover instead of by the calendar.
// `jobs.module.ts` imports it for that same provider and gives the same reason:
// reading the rollover hour out of the environment here would be a second
// implementation of one rule, and the two would agree until one was changed.
// Nothing runs the other way — a booking has no need of a payment — so there is
// no cycle to break.
//
// The service is exported before this module has a controller, which is the
// arrangement `folio.module.ts` and `guest.module.ts` both opened with. The
// payer's return and the gateway's IPN are their own piece of work; a controller
// registered now would be routes that answer nothing, and the dependency graph
// would say this module serves traffic when it does not.
//
// `DatabaseModule` is global, so nothing is imported for the transaction the
// service opens or for the executor it hands each write.
@Module({
  imports: [BookingModule, FolioModule],
  providers: [
    { provide: PAYMENT_GATEWAY, useClass: VnpayAdapter },
    PaymentService,
  ],
  exports: [PaymentService],
})
export class PaymentModule {}
