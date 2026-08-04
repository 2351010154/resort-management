import { Module } from "@nestjs/common";
import { GuestService } from "./guest.service.js";

// The guest realm — docs/architecture/repository-structure.md §apps/api.
//
// No controller yet, and that is not an omission. The routes this service ends
// up behind are contract work: `guest.read-record` and `guest.unmask-cccd` need
// a domain contract in `packages/shared/src/contract/`, and
// `repository-structure.md` admits one there only when there is an endpoint to
// declare. The service lands first because the check-in transition needs it
// before any route does — a guest is created and registered *inside* the
// transition that moves a booking to `CHECKED_IN`, in that transition's
// transaction, which is why `GuestService` is exported and why every method on
// it takes the caller's executor.
//
// `DatabaseModule` is global, so nothing is imported here for it. `GuestService`
// injects nothing at all: it holds the rules and the caller holds the
// connection.
@Module({
  providers: [GuestService],
  exports: [GuestService],
})
export class GuestModule {}
