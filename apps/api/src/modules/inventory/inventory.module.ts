import { Module } from "@nestjs/common";
import { GuestModule } from "../guest/guest.module.js";
import { AvailabilityController } from "./availability.controller.js";
import { AvailabilityService } from "./availability.service.js";
import { ClosureController } from "./closure.controller.js";
import { ClosureService } from "./closure.service.js";
import { InventoryService } from "./inventory.service.js";

// The property and what may be sold against it —
// docs/architecture/repository-structure.md §apps/api.
//
// The rate calendar the availability query prices against is `pricing`'s table
// and this module only reads it. That is a read across a module boundary rather
// than a service call because the two are one SQL statement: `NFR-03` gives the
// answer 300 ms over a twelve-month calendar, and joining inventory to rates in
// Postgres is what meets it. Fetching rates through a second service would
// return five hundred rows to the application to be matched up in JavaScript.
//
// `DatabaseModule` is global, so nothing is imported here for the Drizzle
// client the services inject.
//
// `GuestModule` is imported for `TierDerivationService`, and it is imported
// rather than the service being provided a second time — the reasoning
// `guest.module.ts` gives for providing its own stateless readers runs the other
// way here. That class holds two collaborators of its own and reads four
// configuration rows to answer, so a second instance is a second ladder a guest
// could be measured against; `availability.service.ts` says why a search asks it
// at all. The dependency runs one way: nothing in the guest realm reads
// inventory.
//
// `InventoryService` has no controller and is exported anyway. It is the write
// primitive a booking ends in, and `booking-state-machine.md` §3 puts every
// caller of it inside a transition — so the endpoint that reaches it belongs to
// the booking module at `M4`, not here. An `/inventory/reservations` route
// would be a way to consume a room without a booking behind it, which is the
// one thing the two-layer design exists to prevent.
@Module({
  imports: [GuestModule],
  controllers: [AvailabilityController, ClosureController],
  providers: [AvailabilityService, ClosureService, InventoryService],
  exports: [AvailabilityService, InventoryService],
})
export class InventoryModule {}
