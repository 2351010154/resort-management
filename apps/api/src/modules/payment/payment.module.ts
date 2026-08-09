import { Module } from "@nestjs/common";
import { BookingModule } from "../booking/booking.module.js";
import { FolioModule } from "../folio/folio.module.js";
import { PaymentController } from "./payment.controller.js";
import { PaymentService } from "./payment.service.js";
import { PAYMENT_GATEWAY } from "./ports/payment-gateway.port.js";
import { ReconciliationService } from "./reconciliation.service.js";
import { VnpayAdapter } from "./vnpay.adapter.js";

// Taking the money and putting it on the account — `FR-PAY-01`, `FR-PAY-03`, and
// docs/architecture/repository-structure.md §apps/api.
//
// **The binding is what this module is for.** `PAYMENT_GATEWAY` is a symbol
// because an interface is a type and erases, and `VnpayAdapter` is the only
// thing in the application that knows how to speak to VNPay. Everything above
// the token is written against `PaymentGateway`, so `FR-PAY-06`'s second gateway
// is a second adapter and one changed line in this file rather than a change to
// any caller. `booking.module.ts` binds `FOLIO_PORT` the same way and has
// already been through exactly that swap once, which is the evidence the
// arrangement works.
//
// The controller is the one thing here that also names VNPay, and it names its
// *protocol* rather than its host or its checksum: the two callback routes have
// no caller but the gateway, so their paths and the pairs they answer with are
// VNPay's specification. `payment.controller.ts` argues that at the top, and the
// second gateway registers a second controller beside it in this same list.
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
// The service is still exported, and now for one caller rather than none: the
// route that opens an attempt belongs to the guest funnel and will be asked for
// from outside this module. The two routes registered here are not that — they
// are the gateway's half of the conversation, and they are here because the
// callback and the account it posts to have to be reachable from one place.
//
// `DatabaseModule` is global, so nothing is imported for the transaction the
// service opens or for the executor it hands each write. `ConfigModule` is
// global too, which is what lets the controller read the origin it hands the
// payer back to without this module importing anything for it.
//
// `ReconciliationService` is provided and exported beside the service, and it
// has no route here on purpose. `FR-PAY-05`'s comparison belongs to this module
// because a discrepancy is a fact about payments; the nightly sweep that hands
// it the gateway's report and the screen that shows what it found are their own
// pieces of work, and both reach it through this export rather than by
// constructing a second one. It takes no gateway — the report is an argument —
// so the binding above does not reach it and neither does anything VNPay said.
//
// `PAYMENT_GATEWAY` is exported too, and exporting a token is not the leak
// `FR-PAY-01` forbids: what crosses is the port, and everything on the far side
// is still written against `PaymentGateway` with no VNPay vocabulary in reach.
// `ReconciliationJob` is why. It is a sweep, so `jobs.module.ts` owns where it is
// registered, and it needs the comparison and the port together — the report it
// compares has to be fetched through the same binding the rest of the property
// pays through. Constructing an adapter of its own would be a second client on
// the same terminal, configured from the same variables, differing from this one
// the first time either changed.
@Module({
  imports: [BookingModule, FolioModule],
  controllers: [PaymentController],
  providers: [
    { provide: PAYMENT_GATEWAY, useClass: VnpayAdapter },
    PaymentService,
    ReconciliationService,
  ],
  exports: [PaymentService, ReconciliationService, PAYMENT_GATEWAY],
})
export class PaymentModule {}
