import { Module } from "@nestjs/common";
import { OpsAlertService } from "../notification/ops-alert.service.js";
import { SystemConfigService } from "../system-config/system-config.service.js";
import { GuestController } from "./guest.controller.js";
import { GuestService } from "./guest.service.js";
import { LoyaltyService } from "./loyalty.service.js";

// The guest realm — docs/architecture/repository-structure.md §apps/api.
//
// The service is exported as well as routed, and that is the ordering behind
// this module: check-in needs it before any route does — a guest is created and
// registered *inside* the transition that moves a booking to `CHECKED_IN`, in
// that transition's transaction — which is why every method on it takes the
// caller's executor rather than opening one.
//
// The controller carries `FR-GST-03`'s two endpoints. Both are declared in
// `packages/shared/src/contract/guest.ts`, per `repository-structure.md`, which
// admits a domain contract only once there is an endpoint to declare.
//
// `DatabaseModule` is global, so nothing is imported here for it. `GuestService`
// injects nothing at all: it holds the rules and the caller holds the
// connection.
//
// `LoyaltyService` is the second export and it is a different kind of thing:
// it injects three collaborators and writes on a transaction of its own, since
// what it does happens *after* somebody else's has committed. It lives in this
// module because the points belong to a guest account and nothing else about
// them belongs to the folio — `folio.module.ts` imports this one to reach it,
// which is the one direction that dependency can run: the ledger row keys on a
// folio, and a folio knows nothing about a guest's balance.
//
// Its two collaborators are provided here rather than reached by importing the
// modules that own them, on the reasoning `folio.module.ts` gives for providing
// `BusinessDateService`: each is a stateless reader, and each module around it
// carries a great deal this one has no business booting. `SystemConfigModule`
// brings the seeder that writes the row at boot and the `ADMIN` screen that
// edits it; `NotificationModule` brings the whole outbound surface — a mailer,
// a queue, a booking-token signer — where an accrual wants one method off one
// class. Neither instance can disagree with the one next door: the
// configuration reader caches nothing and reads the row on every call, and the
// alerter holds only the endpoint it reads from the environment.
@Module({
  controllers: [GuestController],
  providers: [
    GuestService,
    LoyaltyService,
    SystemConfigService,
    OpsAlertService,
  ],
  exports: [GuestService, LoyaltyService],
})
export class GuestModule {}
