// Room closure — `FR-INV-04`, and the `inventory.close-room` row of the matrix.
//
// That row is `MANAGER` and `ADMIN` only, and it sits under "Housekeeping and
// room state" while granting neither of the two housekeeping rows beside it.
// The separation is the requirement: a receptionist may mark 304 out of order
// and a housekeeper may mark it dirty, and neither act removes a room from what
// the property can sell. This one does, which is why it is a manager's.

import { contract } from "@mariva/shared";
import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { RequiresCapability } from "../../common/auth/access.decorators.js";
import { TransactionRunner } from "../../database/transaction-runner.js";
import { ClosureService } from "./closure.service.js";

// The transaction is opened here because a request is the boundary a closure
// happens in — there is nothing else to write alongside it. A booking is the
// case that made the service take its executor rather than open one: its
// transition writes inventory, a folio and a payment, and all four have to be
// one commit.
@Controller()
export class ClosureController {
  constructor(
    private readonly closures: ClosureService,
    private readonly transactions: TransactionRunner,
  ) {}

  @RequiresCapability("inventory.close-room")
  @Implement(contract.inventory.listRoomClosures)
  listRoomClosures() {
    return implement(contract.inventory.listRoomClosures).handler(
      async ({ input }) => {
        const closures = await this.transactions.run((exec) =>
          this.closures.list(exec, input),
        );
        return closures.map((closure) => ({
          ...closure,
          checkIn: closure.checkIn.toString(),
          checkOut: closure.checkOut.toString(),
        }));
      },
    );
  }

  @RequiresCapability("inventory.close-room")
  @Implement(contract.inventory.closeRoom)
  closeRoom() {
    return implement(contract.inventory.closeRoom).handler(async ({ input }) => {
      const closure = await this.transactions.run((exec) =>
        this.closures.close(exec, input),
      );

      // `CalendarDate` inside, ISO text on the wire — the crossing
      // `stayDateSchema`'s codec declares, performed where the two meet.
      return {
        ...closure,
        checkIn: closure.checkIn.toString(),
        checkOut: closure.checkOut.toString(),
      };
    });
  }

  @RequiresCapability("inventory.close-room")
  @Implement(contract.inventory.reopenRoom)
  reopenRoom() {
    return implement(contract.inventory.reopenRoom).handler(({ input }) =>
      this.transactions.run((exec) => this.closures.reopen(exec, input.id)),
    );
  }
}
