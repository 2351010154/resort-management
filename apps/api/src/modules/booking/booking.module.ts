import { Module } from "@nestjs/common";
import { InventoryModule } from "../inventory/inventory.module.js";
import { BookingService } from "./booking.service.js";
import { BusinessDateService } from "./business-date.service.js";
import { StayQuoteService } from "./stay-quote.service.js";

// The lifecycle state machine, holds, room assignment and cancellation —
// docs/architecture/repository-structure.md §apps/api.
//
// `InventoryModule` is the one import, and it is a real dependency rather than a
// read across a boundary: `booking-state-machine.md` §3 gives every creating and
// cancelling transition an inventory effect, and `inventory.module.ts` exports
// `InventoryService` for exactly this caller — it says so, and says why there is
// no `/inventory/reservations` route that would let a room be consumed without a
// booking behind it.
//
// `pricing` is NOT imported. `stay-quote.service.ts` reads the rate calendar,
// the plan and the property tariff in SQL through the caller's executor, which
// is the same read-across-the-boundary `availability.service.ts` makes and for a
// sharper reason: the price has to be frozen inside the transaction that
// consumes the nights, and a service reached through Nest would read it on a
// different connection with a different snapshot.
//
// `DatabaseModule` is global, so nothing is imported for the executor type or
// the `ENV` token the services take.
//
// No controller yet. The routes these transitions answer are a later task's, and
// the transaction boundary they need is opened there — `database.module.ts` and
// `closure.controller.ts` say why it belongs at the controller and not here.
@Module({
  imports: [InventoryModule],
  providers: [BookingService, BusinessDateService, StayQuoteService],
  exports: [BookingService, BusinessDateService],
})
export class BookingModule {}
