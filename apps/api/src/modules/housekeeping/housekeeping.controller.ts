// The three housekeeping routes — `FR-HK-01`'s readiness states, `FR-HK-02`'s
// out-of-order flag, and the board the floors are walked with.
//
// Three routes and three capability rows, which is the matrix's own split rather
// than this file's: `housekeeping.set-condition`, `housekeeping.set-out-of-order`
// and `housekeeping.board`. The first two are separate rows because they are
// separate acts — one says a room has been cleaned, the other says nobody may
// walk into it — and `housekeeping.ts` says why the contract keeps them apart
// too. None of the three is `inventory.close-room`, which sits in the same
// section of the matrix, is a manager's, and is the only one of the four that
// changes what the property can sell.
//
// **The transaction is opened here**, as `closure.controller.ts` argues and
// `database.module.ts` requires. The board is a read and is wrapped too: it
// needs an executor, and a controller holding the Drizzle client is a controller
// that can run a query of its own — the boundary `transaction-runner.ts` keeps.
//
// **Who touched the room is taken from the session, never from the body.** The
// board answers "who last set this and when", and a caller naming somebody else
// in a field would be a cleaning judgement filed in another person's name. The
// service already takes `updatedBy` as optional because check-out calls it with
// nobody deciding — that is the null this route never sends.

import { contract } from "@mariva/shared";
import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import {
  CurrentPrincipal,
  RequiresCapability,
} from "../../common/auth/access.decorators.js";
import type { Principal } from "../../common/auth/principal.js";
import { TransactionRunner } from "../../database/transaction-runner.js";
import { BusinessDateService } from "../booking/business-date.service.js";
import {
  HousekeepingService,
  type RoomCondition,
} from "./housekeeping.service.js";

@Controller()
export class HousekeepingController {
  constructor(
    private readonly housekeeping: HousekeepingService,
    private readonly transactions: TransactionRunner,
    private readonly businessDates: BusinessDateService,
  ) {}

  /** `CLEAN` / `DIRTY` / `INSPECTED` — a cleaning round's three states. */
  @RequiresCapability("housekeeping.set-condition")
  @Implement(contract.housekeeping.setCondition)
  setCondition(@CurrentPrincipal() principal: Principal | null) {
    return implement(contract.housekeeping.setCondition).handler(
      async ({ input }) =>
        onWire(
          await this.transactions.run((exec) =>
            this.housekeeping.setCondition(exec, {
              ...input,
              updatedBy: staffId(principal),
            }),
          ),
        ),
    );
  }

  /**
   * `OUT_OF_ORDER`, and back out of it — `FR-HK-02`.
   *
   * The room stays sellable. Nothing on this path touches `type_inventory`, and
   * the route that does withdraw a room from sale is a manager's closure.
   */
  @RequiresCapability("housekeeping.set-out-of-order")
  @Implement(contract.housekeeping.setOutOfOrder)
  setOutOfOrder(@CurrentPrincipal() principal: Principal | null) {
    return implement(contract.housekeeping.setOutOfOrder).handler(
      async ({ input }) =>
        onWire(
          await this.transactions.run((exec) =>
            this.housekeeping.setOutOfOrder(exec, {
              ...input,
              updatedBy: staffId(principal),
            }),
          ),
        ),
    );
  }

  /**
   * Every room, in the state it is in, for the day the property is having.
   *
   * A read, declared as one: the matrix grants this row `full` to the four roles
   * that hold it, and a route that reads a row must say so rather than take the
   * strict default meant for writes.
   */
  @RequiresCapability("housekeeping.board", "read")
  @Implement(contract.housekeeping.board)
  board() {
    return implement(contract.housekeeping.board).handler(async ({ input }) => {
      // Absent, the property's own day — the 04:00 rollover is
      // `business-date.service.ts`'s rule and not a sum a client should be
      // doing. Present, the date named, which is how a board is read for a
      // night that has already been closed.
      //
      // Resolved inside the transaction the board was going to open anyway,
      // because the rollover hour is a `system_config` row: asked for out here
      // it would cost this route a second connection, and the tiles would be
      // read against a day resolved in a different snapshot.
      const { businessDate, rooms } = await this.transactions.run(
        async (exec) => {
          const on =
            input.businessDate ?? (await this.businessDates.current(exec));

          return {
            businessDate: on,
            rooms: await this.housekeeping.getBoard(exec, on),
          };
        },
      );

      return {
        businessDate: businessDate.toString(),
        rooms: rooms.map((tile) => ({
          ...tile,
          updatedAt: tile.updatedAt?.toISOString() ?? null,
        })),
      };
    });
  }
}

/**
 * The staff member making the call, as the column stores them.
 *
 * Null for anyone who is not staff. No such caller can reach these routes —
 * every one of the three rows denies a guest — so this is the shape the type
 * asks for rather than a case that happens.
 */
function staffId(principal: Principal | null): string | null {
  return principal?.realm === "staff" ? principal.userId : null;
}

/** A condition as the wire carries it — the write's instant into ISO-8601. */
function onWire(condition: RoomCondition) {
  return { ...condition, updatedAt: condition.updatedAt.toISOString() };
}
