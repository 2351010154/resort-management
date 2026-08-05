import { Module } from "@nestjs/common";
import { GuestModule } from "../guest/guest.module.js";
import { HousekeepingModule } from "../housekeeping/housekeeping.module.js";
import { InventoryModule } from "../inventory/inventory.module.js";
import { AssignmentService } from "./assignment.service.js";
import { BookingService } from "./booking.service.js";
import { BusinessDateService } from "./business-date.service.js";
import { FolioStubService } from "./ports/folio-stub.service.js";
import { FOLIO_PORT } from "./ports/folio.port.js";
import { StayQuoteService } from "./stay-quote.service.js";

// The lifecycle state machine, holds, room assignment and cancellation —
// docs/architecture/repository-structure.md §apps/api.
//
// `InventoryModule` is a real dependency rather than a read across a boundary:
// `booking-state-machine.md` §3 gives every creating and cancelling transition
// an inventory effect, and `inventory.module.ts` exports `InventoryService` for
// exactly this caller — it says so, and says why there is no
// `/inventory/reservations` route that would let a room be consumed without a
// booking behind it.
//
// `GuestModule` and `HousekeepingModule` are the same kind of dependency and
// arrive with check-in and check-out. Both modules already say why they export a
// service before they have a controller: §3 writes the registration record
// inside the transition that reaches `CHECKED_IN`, and hands the room back as
// `DIRTY` inside the one that closes the stay. Reaching either over HTTP would
// put those writes in a different transaction from the state change they belong
// to, which is a stay that is checked out with the room still reading occupied.
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
//
// `FOLIO_PORT` is the one binding here that is expected to change. `M4` has no
// ledger, so it points at the stub that reports every folio settled; `M6` points
// it at the service that reads the real one, and nothing else in this module
// moves. `ports/folio.port.ts` argues why the dependency runs in this direction.
@Module({
  imports: [GuestModule, HousekeepingModule, InventoryModule],
  providers: [
    AssignmentService,
    BookingService,
    BusinessDateService,
    StayQuoteService,
    { provide: FOLIO_PORT, useClass: FolioStubService },
  ],
  exports: [AssignmentService, BookingService, BusinessDateService],
})
export class BookingModule {}
