// The one route `FR-BOOK-05` asks for, and the first handler in this codebase
// that has to finish a decision the guard could not.
//
// **`search.operational` is one row and one route.** The matrix covers rooms,
// guests and bookings in a single row and narrows it by grant rather than by
// splitting it, so three routes here would need three keys the matrix does not
// have — and inventing one is the thing `prd-m4.md` forbids by name. What
// separates a housekeeper's search from a receptionist's is therefore not the
// path they call but what comes back.
//
// **The narrowing is read off the grant, never off the role.**
// `access.guard.spec.ts` §"the conditional grants" states the arrangement: a
// `⚠` row is granted, and the scope check the guard cannot see is handed on with
// the decision. `HOUSEKEEPING` holds `⚠` here with the matrix's note "HK: rooms
// only", and that is what this file resolves. Branching on
// `principal.role === "HOUSEKEEPING"` would put a copy of the matrix in a
// handler, and the day a sixth role is added `⚠` to the row it would silently
// receive the full answer.
//
// **It fails closed.** Anything that is not an unambiguous full grant gets the
// rooms. A decision that never arrived is a guard that did not run, and the
// honest answer to that is the narrow one rather than every stay in the
// property.
//
// **The transaction is opened here** — `database.module.ts`'s boundary, the same
// one `closure.controller.ts` argues for a much smaller write. A search is a
// read and still takes one: the room board, the stays and the people are three
// queries whose answers are shown side by side, and read on three connections
// they would be three different moments.

import {
  contract,
  type BookingState,
  type HousekeepingStatus,
  type RoomTypeCode,
  type StayDate,
} from "@mariva/shared";
import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import {
  Access,
  RequiresCapability,
} from "../../common/auth/access.decorators.js";
import type { AccessDecision } from "../../common/auth/principal.js";
import { TransactionRunner } from "../../database/transaction-runner.js";
import type { BoardRoom } from "../housekeeping/housekeeping.service.js";
import { BusinessDateService } from "./business-date.service.js";
import { type SearchFilters, SearchService } from "./search.service.js";

/** The criteria as the wire states them, in the shape the service takes. */
interface SearchQuery {
  readonly roomNumber?: string;
  readonly roomType?: RoomTypeCode;
  readonly roomStatus?: HousekeepingStatus;
  readonly from?: StayDate;
  readonly to?: StayDate;
  readonly guestName?: string;
  readonly guestPhone?: string;
  readonly state?: BookingState;
  readonly reference?: string;
}

@Controller()
export class SearchController {
  constructor(
    private readonly search: SearchService,
    private readonly transactions: TransactionRunner,
    private readonly businessDates: BusinessDateService,
  ) {}

  /**
   * Rooms, stays and people — or, for a `⚠` grant, the rooms.
   *
   * Declared as a read, because it is one and because the row hands
   * `ACCOUNTANT` a 👁: a route left at the strict default would refuse them the
   * search the matrix grants.
   */
  @RequiresCapability("search.operational", "read")
  @Implement(contract.search.operational)
  operational(@Access() access: AccessDecision | undefined) {
    return implement(contract.search.operational).handler(async ({ input }) => {
      const filters = asFilters(input);

      // The property's own day, resolved once and inside the transaction the
      // search was going to open anyway — the 04:00 rollover is
      // `business-date.service.ts`'s rule, and the room tiles and the occupancy
      // column have to be answered against the same answer to it. Resolved in
      // here rather than above it because the hour is a `system_config` row: read
      // outside the boundary it would cost this path a second connection, and it
      // would come from a different snapshot than the rows it is used to filter.
      if (narrowedToRooms(access)) {
        const rooms = await this.transactions.run(async (exec) =>
          this.search.searchRooms(
            exec,
            filters,
            await this.businessDates.current(exec),
          ),
        );

        return { scope: "rooms" as const, rooms: rooms.map(onWire) };
      }

      const found = await this.transactions.run(async (exec) =>
        this.search.search(
          exec,
          filters,
          await this.businessDates.current(exec),
        ),
      );

      return {
        scope: "everything" as const,
        rooms: found.rooms.map(onWire),
        // Copied rather than passed through, for the reason `booking.controller.ts`
        // gives: the service holds these `readonly` because nothing downstream
        // may edit them, and a serialiser handed the caller's own array could
        // sort it.
        bookings: found.bookings.map((hit) => ({
          ...hit,
          guestNames: [...hit.guestNames],
        })),
        guests: [...found.guests],
      };
    });
  }
}

/**
 * Whether this caller gets the rooms and nothing else.
 *
 * `conditional` is the matrix's `⚠`, and on this row the condition is the
 * scope. Written as "only a grant that is unambiguously unnarrowed opens the
 * rest" rather than as "conditional is narrow", so a grant this file has not
 * heard of — or a decision the guard never left — takes the narrow path instead
 * of the wide one.
 */
function narrowedToRooms(access: AccessDecision | undefined): boolean {
  return access?.grant !== "full" && access?.grant !== "read";
}

/**
 * The criteria as the service takes them.
 *
 * The two ends of the range become one value, because a range is one fact: the
 * schema has already refused a request carrying one end without the other, and
 * a service taking two optional dates would have to refuse it a second time to
 * be sure.
 */
function asFilters(input: SearchQuery): SearchFilters {
  return {
    roomNumber: input.roomNumber,
    roomType: input.roomType,
    roomStatus: input.roomStatus,
    range:
      input.from === undefined || input.to === undefined
        ? undefined
        : { from: input.from, to: input.to },
    guestName: input.guestName,
    guestPhone: input.guestPhone,
    state: input.state,
    reference: input.reference,
  };
}

/** A board tile as the wire carries it — the write's instant into ISO-8601. */
function onWire(tile: BoardRoom) {
  return { ...tile, updatedAt: tile.updatedAt?.toISOString() ?? null };
}
