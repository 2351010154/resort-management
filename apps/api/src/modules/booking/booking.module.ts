import { Module } from "@nestjs/common";
import { BookingTokenModule } from "../auth/booking-token/booking-token.module.js";
import { FolioModule } from "../folio/folio.module.js";
import { FolioService } from "../folio/folio.service.js";
import { GuestModule } from "../guest/guest.module.js";
import { HousekeepingModule } from "../housekeeping/housekeeping.module.js";
import { InventoryModule } from "../inventory/inventory.module.js";
import { SystemConfigModule } from "../system-config/system-config.module.js";
import { AssignmentController } from "./assignment.controller.js";
import { AssignmentService } from "./assignment.service.js";
import { BookingController } from "./booking.controller.js";
import { BookingService } from "./booking.service.js";
import { BusinessDateService } from "./business-date.service.js";
import {
  DEFAULT_HOLD_RATE_LIMIT,
  HOLD_RATE_LIMIT_POLICY,
  HoldRateLimitGuard,
} from "./hold-rate-limit.guard.js";
import { FOLIO_PORT } from "./ports/folio.port.js";
import {
  DEFAULT_PRESENCE_RATE_LIMIT,
  PRESENCE_RATE_LIMIT_POLICY,
  PresenceRateLimitGuard,
} from "./presence-rate-limit.guard.js";
import { SearchController } from "./search.controller.js";
import { SearchService } from "./search.service.js";
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
// `SystemConfigModule` is imported for `BusinessDateService`, which reads the
// rollover hour off the `system_config` row rather than out of the environment —
// §2's "changes one row, not a deploy". The same import `FolioModule` makes for
// the tax figures, and for the same reason: the row is the authority and the
// reader is the one class that knows how to ask it.
//
// `DatabaseModule` is global, so nothing is imported for the executor type or
// the `ENV` token the services take.
//
// Two controllers, split the way the services are and for the same reason
// `booking-state-machine.md` §5 splits them: `BookingController` owns §2's
// transitions and `AssignmentController` owns the operations that change no
// state. Each opens the transaction its writes need, which is why the services
// take an executor and this module provides no boundary of its own —
// `database.module.ts` and `closure.controller.ts` argue where that boundary
// belongs.
//
// `FOLIO_PORT` is the one binding here that was expected to change, and it has.
// `M4` had no ledger and pointed it at a stub that reported every folio settled;
// it now points at `FolioService`, which sums the postings. Nothing else in this
// module moved and nothing in the check-out path did either — the guard, its
// spec and the transition were written against the interface, which is the whole
// argument `ports/folio.port.ts` makes for the dependency running this way.
//
// `useExisting` and not `useClass`: `FolioModule` already provides the service
// and this must be the same instance the folio's own callers get, not a second
// one Nest would construct against this token.
//
// `SearchController` is the third, and it sits here rather than in a module of
// its own because `FR-BOOK-05` is a booking requirement and the thing it mostly
// answers about is a stay. It reads across two of the imports above — the
// housekeeping board for what a room is, the guest table for who a person is —
// and changes nothing, which is why it needs neither a port nor an export.
//
// `BookingTokenModule` is imported for one call: the hold issues the credential
// that makes the funnel's next four screens reachable for a guest with no
// account. The whole of `AuthModule` is not imported for it — that module owns
// two realms, their controllers and the global guard, and this controller needs
// none of them.
@Module({
  imports: [
    BookingTokenModule,
    FolioModule,
    GuestModule,
    HousekeepingModule,
    InventoryModule,
    SystemConfigModule,
  ],
  controllers: [BookingController, AssignmentController, SearchController],
  providers: [
    AssignmentService,
    BookingService,
    BusinessDateService,
    SearchService,
    StayQuoteService,
    { provide: FOLIO_PORT, useExisting: FolioService },
    HoldRateLimitGuard,
    // The figure, provided rather than read off the constant inside the guard,
    // so a suite can state a small limit instead of taking thirty rooms off the
    // shelf to prove the refusal.
    { provide: HOLD_RATE_LIMIT_POLICY, useValue: DEFAULT_HOLD_RATE_LIMIT },
    // The presence ping's own limiter and its own figure. Two policies rather
    // than one, because the two doors count different acts: a room taken off the
    // shelf, and a page saying it is still open. Sharing the hold's allowance
    // would have one funnel's heartbeats spend the requests it needs to book.
    PresenceRateLimitGuard,
    { provide: PRESENCE_RATE_LIMIT_POLICY, useValue: DEFAULT_PRESENCE_RATE_LIMIT },
  ],
  exports: [AssignmentService, BookingService, BusinessDateService],
})
export class BookingModule {}
