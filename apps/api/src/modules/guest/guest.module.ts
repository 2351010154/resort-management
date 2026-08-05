import { Module } from "@nestjs/common";
import { GuestController } from "./guest.controller.js";
import { GuestService } from "./guest.service.js";

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
@Module({
  controllers: [GuestController],
  providers: [GuestService],
  exports: [GuestService],
})
export class GuestModule {}
