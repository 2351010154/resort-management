import { Module } from "@nestjs/common";
import { HousekeepingService } from "./housekeeping.service.js";

// Room state and the board — docs/architecture/repository-structure.md
// §apps/api.
//
// No controller yet, and exported anyway. The service is a write primitive
// before it is an endpoint: `booking-state-machine.md` §3 has checkout hand the
// room back as `DIRTY` inside the transition that closes the stay, so the
// booking module reaches it through the same transaction rather than over HTTP.
// The routes join this module when the housekeeping contract does.
//
// `DatabaseModule` is global, so nothing is imported here for the executor the
// service is handed — which it takes as an argument and never opens itself.
@Module({
  providers: [HousekeepingService],
  exports: [HousekeepingService],
})
export class HousekeepingModule {}
