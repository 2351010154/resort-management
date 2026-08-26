import { Module } from "@nestjs/common";
import { BookingModule } from "../booking/booking.module.js";
import { FolioModule } from "../folio/folio.module.js";
import { NotificationModule } from "../notification/notification.module.js";
import { SystemConfigModule } from "../system-config/system-config.module.js";
import { PaymentController } from "./payment.controller.js";
import { PaymentService } from "./payment.service.js";
import { PaypalAdapter } from "./paypal.adapter.js";
import { PaypalController } from "./paypal.controller.js";
import { GatewayRegistry } from "./ports/gateway-registry.js";
import { PAYMENT_GATEWAY } from "./ports/payment-gateway.port.js";
import { ReconciliationService } from "./reconciliation.service.js";
import { VnpayAdapter } from "./vnpay.adapter.js";

// Taking the money and putting it on the account — `FR-PAY-01`, `FR-PAY-03`, and
// docs/architecture/repository-structure.md §apps/api.
//
// **The bindings are what this module is for, and there are now three of
// them.** Everything above them is written against `PaymentGateway`, so
// `FR-PAY-06`'s second gateway is a second adapter and a second entry here
// rather than a change to any caller. `booking.module.ts` binds `FOLIO_PORT` the
// same way and has already been through exactly that swap once, which is the
// evidence the arrangement works.
//
// **`GatewayRegistry` is the first, and it is what replaced "the" gateway.**
// With one adapter there was nothing to choose between and a single binding was
// honest. With two there is, and `ports/gateway-registry.ts` argues why the
// choice is made per attempt rather than per deployment: a guest picks the
// gateway they want to pay through, so two payments against the same stay may go
// to different providers on the same afternoon. It is assembled here, by hand,
// because this is where every binding in this module is argued and because the
// map is the one place the property's own `payment_method` vocabulary is
// attached to a provider — `payment.service.ts` holds the registry and never a
// key it wrote itself.
//
// Bound by its class rather than by a symbol, unlike the port beside it. A
// symbol is what an *interface* needs, having erased by run time;
// `GatewayRegistry` is a class, is a value, and is its own token, exactly as
// `PaymentService` and `ReconciliationService` below are.
//
// **The map now holds both of `FR-PAY-01`'s implementations**, and it is still
// allowed to be partial. A method with nothing bound to it is a `503` at the
// call that asked for it and not a boot failure — the registry says why, and it
// is `vnpay.adapter.ts`'s own decision about a missing terminal code read from
// the other end. Being *bound* is not the same as being configured: both
// adapters build their clients on first use, so a property that has finished
// neither provider's merchant onboarding still starts and still does the several
// dozen other things this API does, and fails at the one call that needed
// credentials while naming the variables it needed.
//
// **`PAYMENT_GATEWAY` is the second, and it is now resolved through the map
// rather than constructed beside it.** The token stays because
// `payment.controller.ts` takes it for the callback routes VNPay posts to, and
// it resolves the đồng gateway, which is the one thing it has ever meant. Naming
// the method here is not the leak `FR-PAY-01` forbids for the same reason the
// map's keys are not: a method is the property's word for a way money reaches
// the desk, and a module is where a provider is attached to one. Nothing on the
// far side of the token learns which provider answered.
//
// **The two adapters are the third and fourth**, each provided as itself so the
// bindings above reach one instance of each. It was `useClass` on the token before, which
// constructed it and named it in the same line; a second adapter makes that
// impossible — two `useClass` bindings on one token is one gateway, silently.
// So the adapter is a provider and the registry points at it, which is also what
// keeps a single client per terminal: two instances configured from the same
// variables would differ the first time either changed. It takes only `ENV`,
// which `ConfigModule` is global for, and it builds its client on first use — so
// registering this module requires no terminal code, and a deployment without
// one boots and fails at the payment rather than at the boot.
//
// `PaypalAdapter` is bound the same way and for the same reasons, and it is what
// makes the choice in the map a real one. It is the first gateway this property
// has that cannot charge đồng, which is why `SystemConfigModule` is imported
// below: the rate that converts a stay into the dollars PayPal collects is the
// property's own configuration, read by the service in the transaction that
// writes the payment row. Nothing about that reaches the adapter — it is handed
// the figure to charge — and nothing about PayPal reaches the configuration,
// which is why `schema/config.ts` names the column for the currency pair.
//
// The controllers are the one thing here that also name a provider, and they
// name its *protocol* rather than its host or its checksum: a callback route has
// no caller but the gateway, so its path and the answer it gives are that
// gateway's specification. `payment.controller.ts` argues that at the top and
// says the second gateway registers a second controller beside it in this same
// list — which is what `PaypalController` now is.
//
// **Two controllers rather than four routes on one**, and the split is the
// argument each file makes rather than a tidying. VNPay signs a query string and
// calls both of its addresses with `GET`; PayPal signs a transmission — five
// headers over a POSTed body — and its payer return carries no signature at all.
// Sharing a class would mean one file whose every method began by saying which
// of two protocols it was in, and one `@Controller` prefix that neither
// gateway's addresses would fit under. It also keeps the smaller surface honest:
// `PaypalController` takes no `PAYMENT_GATEWAY` binding, because nothing on
// PayPal's payer return has a signature worth verifying, and a port in its
// constructor would be a route to an adapter for a caller that does not exist.
//
// `SystemConfigModule` is imported for `SystemConfigService`, which is where the
// property's đồng-per-dollar rate lives. `folio.module.ts` imports it for the tax
// figures and gives the same reason this one does: the row is edited by an
// `ADMIN` without a deploy, and a second reader constructed here would be a
// second answer to one question. The service reads it through the executor of
// the transaction that writes the attempt, so the rate frozen onto a payment is
// the one that transaction saw.
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
// `NotificationModule` is imported for `OpsAlertService`, the same import
// `jobs.module.ts` makes for `ReconciliationJob` and for the same requirement.
// `FR-PAY-05` compares the gateway's report against the ledger nightly and pages
// about what it finds; a callback that lands on a stay the property has already
// cancelled is the same discrepancy, known a day earlier by the one piece of
// code that watches it happen. The mail half of that module is not reached from
// here — a guest is told nothing about this, because there is nothing yet to
// tell them that a person has not decided.
//
// `PAYMENT_GATEWAY` is *not* exported, and that is the smaller surface rather
// than an oversight. It resolves the đồng gateway for the callback routes
// registered in this module and nothing outside asks for it: the sweep that
// once did now takes the registry instead, because a night holds money from
// every gateway the property collects through and a single binding could only
// ever answer for one of them.
//
// `GatewayRegistry` is exported in its place, and exporting it is not the leak
// `FR-PAY-01` forbids: what crosses is the port and a map keyed on the
// property's own payment methods, with no gateway vocabulary on the far side.
// `ReconciliationJob` is why. It is a sweep, so `jobs.module.ts` owns where it
// is registered, and it needs the comparison and the gateways together — the
// report it compares has to be fetched through the same bindings the rest of
// the property collects through. Constructing adapters of its own would be a
// second client on each terminal, configured from the same variables, differing
// from these the first time either changed.
//
// Opening an attempt is still this module's alone. Nothing outside it does —
// the route that does is the controller registered here — so exporting a way to
// reach an adapter directly would be a second door for no caller that exists.
@Module({
  imports: [
    BookingModule,
    FolioModule,
    NotificationModule,
    SystemConfigModule,
  ],
  controllers: [PaymentController, PaypalController],
  providers: [
    VnpayAdapter,
    PaypalAdapter,
    {
      provide: GatewayRegistry,
      useFactory: (vnpay: VnpayAdapter, paypal: PaypalAdapter) =>
        new GatewayRegistry({ VNPAY: vnpay, PAYPAL: paypal }),
      inject: [VnpayAdapter, PaypalAdapter],
    },
    {
      provide: PAYMENT_GATEWAY,
      useFactory: (gateways: GatewayRegistry) => gateways.for("VNPAY"),
      inject: [GatewayRegistry],
    },
    PaymentService,
    ReconciliationService,
  ],
  // `GatewayRegistry` leaves with the rest because the nightly sweep is bound
  // in `jobs.module.ts` and asks every gateway the property collects through
  // for its side of the night. It cannot name a provider to ask and it holds no
  // payer's choice to resolve, so what it needs is the map itself rather than
  // any one adapter out of it. Withheld, the sweep cannot be constructed at all
  // and the API refuses to boot.
  exports: [PaymentService, ReconciliationService, GatewayRegistry],
})
export class PaymentModule {}
