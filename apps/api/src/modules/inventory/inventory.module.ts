import { Module } from "@nestjs/common";
import { AvailabilityController } from "./availability.controller.js";
import { AvailabilityService } from "./availability.service.js";
import { ClosureController } from "./closure.controller.js";
import { ClosureService } from "./closure.service.js";

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
// client the two services inject.
@Module({
  controllers: [AvailabilityController, ClosureController],
  providers: [AvailabilityService, ClosureService],
  exports: [AvailabilityService],
})
export class InventoryModule {}
