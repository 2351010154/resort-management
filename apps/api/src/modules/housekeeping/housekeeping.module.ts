import { Module } from "@nestjs/common";
import { BusinessDateService } from "../booking/business-date.service.js";
import { HousekeepingController } from "./housekeeping.controller.js";
import { HousekeepingService } from "./housekeeping.service.js";

// Room state and the board — docs/architecture/repository-structure.md
// §apps/api.
//
// The service is exported as well as routed. `booking-state-machine.md` §3 has
// checkout hand the room back as `DIRTY` inside the transition that closes the
// stay, so the booking module reaches it through the same transaction rather
// than over HTTP — the routes are how a housekeeper writes the same fact, not
// the only way it gets written.
//
// `BusinessDateService` is provided here rather than imported from
// `BookingModule`, which is where it lives. That module already imports this one
// — check-out needs the service above — so importing it back would be a cycle to
// be broken with `forwardRef` for the sake of one stateless provider that reads
// the rollover hour out of the environment. It is the same class either way, so
// the 04:00 rule still has exactly one implementation; what is duplicated is an
// instance, and it holds nothing.
//
// `DatabaseModule` is global, so nothing is imported here for the transaction
// the controller opens or for the executor the service is handed — which it
// takes as an argument and never opens itself.
@Module({
  controllers: [HousekeepingController],
  providers: [HousekeepingService, BusinessDateService],
  exports: [HousekeepingService],
})
export class HousekeepingModule {}
