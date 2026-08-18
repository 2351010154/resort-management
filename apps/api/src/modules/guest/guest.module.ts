import { Module } from "@nestjs/common";
import { BusinessDateService } from "../booking/business-date.service.js";
import { OpsAlertService } from "../notification/ops-alert.service.js";
import { SystemConfigService } from "../system-config/system-config.service.js";
import { GuestController } from "./guest.controller.js";
import { GuestProfileController } from "./guest-profile.controller.js";
import { GuestProfileService } from "./guest-profile.service.js";
import { GuestService } from "./guest.service.js";
import { LoyaltyService } from "./loyalty.service.js";
import { TierDerivationService } from "./tier-derivation.service.js";

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
//
// `TierDerivationService` is the third export and the one that writes nothing at
// all. `FR-GST-04` makes a tier a value computed on read, so it holds two
// readers and no runner: the caller's transaction is the only boundary it has,
// and it needs none of its own because there is nothing to commit. It sits here
// beside the accrual because both answer §7 off the same net-room-revenue sum —
// `net-room-revenue.ts` is shared between them and belongs to neither.
//
// `BusinessDateService` is provided rather than imported, on the reasoning
// `folio.module.ts` gives for the same class: it lives in `BookingModule`, which
// already imports this one for check-in's guest writes, so importing it back
// would be a cycle broken with `forwardRef` for one stateless reader over a
// configuration row this module already reads.
//
// `GuestProfileService` is the fourth and it is `FR-GST-01`'s: the guest's own
// record of themselves, which is the only writable half of a profile and reaches
// exactly one table. It composes the two above it rather than repeating them —
// the tier is derived and the balance is summed, neither is stored, and a
// profile screen holding its own copy of either rule would be a second answer
// that could disagree. It is deliberately *not* exported: nothing outside this
// module has any business reading a guest's account of themselves, and the
// second controller is the only caller.
//
// `GuestProfileController` sits beside `GuestController` and never inside it.
// The two carry opposite requirements over the same domain — one is staff
// reading a named guest, the other is a guest reading themselves — and
// `guest-profile.controller.ts` argues why one class holding both capabilities
// is the shape `rbac-matrix.md` §2 declines.
@Module({
  controllers: [GuestController, GuestProfileController],
  providers: [
    GuestService,
    GuestProfileService,
    LoyaltyService,
    TierDerivationService,
    BusinessDateService,
    SystemConfigService,
    OpsAlertService,
  ],
  exports: [GuestService, LoyaltyService, TierDerivationService],
})
export class GuestModule {}
