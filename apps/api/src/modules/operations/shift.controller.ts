// The desk's working day over HTTP — `FR-OPS-01`'s seven routes.
//
// Two rows of the matrix and no key invented for either: `operations.cash-drawer`
// carries the four shift routes and `operations.shift-handover` the three
// pending-item ones, which is the division `contract/operations.ts` states and
// `rbac-matrix.md` §"Folio and money" is the authority for. The two reads
// declare themselves reads, because both rows hand `ACCOUNTANT` a 👁 and a route
// left at the strict default would refuse them the history the matrix grants.
//
// **The whole of "RCP: own shift" is enforced here**, and this file is where the
// requirement said it would be. `shift.service.ts` scopes nothing and says why:
// a manager reading a receptionist's day is a call it cannot tell apart from the
// receptionist's own, so the file that knows who is calling owes the narrowing.
// It is owed in three different shapes, because the note means something
// different on each act:
//
// 1. **Whose drawer it is is never in a request body.** Opening one, raising an
//    item and clearing one all take the operator off the session, so there is
//    nothing for a check to compare and nothing a caller could have chosen —
//    `contract/operations.ts` refuses to carry the field at all. The narrowest
//    form of the rule is the one where the out-of-scope act cannot be said.
// 2. **Closing takes the grant as a fact and hands it on.** The close names a
//    shift, deliberately: the matrix gives `MANAGER` and `ADMIN` `full` on this
//    row precisely for the drawer somebody went home without closing, and an
//    address meaning "my own open shift" would leave it open forever. So the
//    grant is resolved here and travels as `mayCloseAnotherOperatorsDrawer`,
//    and the comparison against the row's actual operator is the service's,
//    where the row is.
// 3. **The history is narrowed to the caller, and the backlog is not.** They
//    look alike and are opposites. A shift is somebody's, so a receptionist
//    reading the history reads their own and a filter they typed is overwritten
//    rather than refused — the console's operator picker is a manager's control
//    and a receptionist reaching it should get their own day, not an error. A
//    pending item is nobody's: `contract/operations.ts` argues that the point of
//    the table is that an item outlives the drawer that found it, and the read
//    an incoming shift makes is "what is still outstanding", which names no
//    shift. Scoping that list would hand each shift only the work it raised
//    itself, which is the one thing a handover is not.
//
// **The narrowing is read off the grant and never off the role**, which is
// `search.controller.ts`'s arrangement and its reason: a branch on
// `principal.role === "RECEPTIONIST"` is the matrix copied into a handler, and
// the day a sixth role is added `⚠` to either row it would silently receive the
// manager's answer. Both helpers below fail closed for the same reason — a
// decision that never arrived is a guard that did not run.
//
// **The transaction is opened here**, as every other controller in the tree
// does and `database.module.ts` requires. The reads take one too: a page and the
// count printed beside it are two statements, and on two connections they are
// two different moments — a list of nineteen shifts under a heading that says
// twenty. The close needs the boundary for a sharper reason, which
// `shift.service.ts` sets out: it holds a row lock from before the cash is
// summed until the count is written, and a lock only lasts as long as the
// transaction it was taken in.

import { contract } from "@mariva/shared";
import { Controller } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import {
  Access,
  CurrentPrincipal,
  RequiresCapability,
} from "../../common/auth/access.decorators.js";
import type {
  AccessDecision,
  Principal,
} from "../../common/auth/principal.js";
import type { PendingItemRow } from "../../database/schema/shift.js";
import { TransactionRunner } from "../../database/transaction-runner.js";
import type { Shift } from "./shift.service.js";
import { ShiftService } from "./shift.service.js";

@Controller()
export class ShiftController {
  constructor(
    private readonly shifts: ShiftService,
    private readonly transactions: TransactionRunner,
  ) {}

  /**
   * A drawer opened in the caller's own name, and in nobody else's.
   *
   * The operator is the session's, so there is no grant to resolve on this
   * route: `conditional` and `full` open the same act, because the act names the
   * only person it could be about. A second open drawer is
   * `shift_one_open_per_operator` refusing, reported by the service as a
   * sentence about the drawer already open rather than as a fault.
   */
  @RequiresCapability("operations.cash-drawer")
  @Implement(contract.operations.openShift)
  openShift(@CurrentPrincipal() principal: Principal | null) {
    return implement(contract.operations.openShift).handler(
      async ({ input }) => {
        const operatorId = operatorOf(principal, "open a cash drawer");

        return onWire(
          await this.transactions.run((exec) =>
            this.shifts.open(exec, {
              operatorId,
              openingFloat: input.openingFloat,
            }),
          ),
        );
      },
    );
  }

  /**
   * The count, the note, and the variance that falls out of them.
   *
   * The grant is the whole of what this handler decides. `full` on the row is
   * the matrix's answer to "may this person close a drawer that is not theirs",
   * and it is handed to the service rather than acted on here, because the fact
   * it has to be compared against — whose shift the named row actually is — is
   * only true under the lock the service takes before it counts. Read here it
   * would be read a moment too early, which is the failure the lock exists for.
   */
  @RequiresCapability("operations.cash-drawer")
  @Implement(contract.operations.closeShift)
  closeShift(
    @Access() access: AccessDecision | undefined,
    @CurrentPrincipal() principal: Principal | null,
  ) {
    return implement(contract.operations.closeShift).handler(
      async ({ input }) => {
        const closedBy = operatorOf(principal, "close a cash drawer");

        return onWire(
          await this.transactions.run((exec) =>
            this.shifts.close(exec, {
              shiftId: input.shiftId,
              closingCount: input.closingCount,
              handoverNote: input.handoverNote,
              closedBy,
              mayCloseAnotherOperatorsDrawer: holdsEveryDrawer(access),
            }),
          ),
        );
      },
    );
  }

  /**
   * The drawer this caller is on, or null for somebody who is not on one.
   *
   * Null is the ordinary state of a receptionist who has not opened a drawer
   * yet and not a refusal — `contract/operations.ts` says so in as many words,
   * and the console renders "no shift" from it while the palette offers to open
   * one. There is no scope to resolve: the route takes no input, so the only
   * shift it could be about is the caller's.
   */
  @RequiresCapability("operations.cash-drawer", "read")
  @Implement(contract.operations.currentShift)
  currentShift(@CurrentPrincipal() principal: Principal | null) {
    return implement(contract.operations.currentShift).handler(async () => {
      const operatorId = operatorOf(principal, "read a cash drawer");

      const open = await this.transactions.run((exec) =>
        this.shifts.current(exec, operatorId),
      );

      return open === null ? null : onWire(open);
    });
  }

  /**
   * What happened at the desk over a stretch of trading days.
   *
   * **A narrowed caller's `operatorId` is overwritten rather than refused.** The
   * console's operator picker is a manager's control, and a receptionist who
   * reaches it — or an old link, or a screen that remembers a filter — is asking
   * to read a history they are entitled to exactly one of. Answering with their
   * own day is what the matrix's note means; answering with a 403 would be
   * telling somebody they may not read a list this route is about to hand them
   * anyway. The overwrite is silent for the same reason it is total: nothing
   * this caller could have typed changes what comes back.
   */
  @RequiresCapability("operations.cash-drawer", "read")
  @Implement(contract.operations.listShiftHistory)
  listShiftHistory(
    @Access() access: AccessDecision | undefined,
    @CurrentPrincipal() principal: Principal | null,
  ) {
    return implement(contract.operations.listShiftHistory).handler(
      async ({ input }) => {
        const operatorId = narrowedToOwnShifts(access)
          ? operatorOf(principal, "read the shift history")
          : input.operatorId;

        const page = await this.transactions.run((exec) =>
          this.shifts.history(exec, {
            operatorId,
            from: input.from,
            to: input.to,
            limit: input.limit,
            offset: input.offset,
          }),
        );

        return { shifts: page.shifts.map(onWire), total: page.total };
      },
    );
  }

  /**
   * Something this shift could not finish, recorded against the drawer it is
   * on.
   *
   * The raising shift is resolved by the service from the operator, and a caller
   * on no drawer at all is refused and told to open one — the coupling
   * `screens.md` describes for cash, applied to the rest of the desk's work: an
   * item raised by nobody's shift has no handover to appear in.
   */
  @RequiresCapability("operations.shift-handover")
  @Implement(contract.operations.raisePendingItem)
  raisePendingItem(@CurrentPrincipal() principal: Principal | null) {
    return implement(contract.operations.raisePendingItem).handler(
      async ({ input }) => {
        const operatorId = operatorOf(principal, "raise a pending item");

        return itemOnWire(
          await this.transactions.run((exec) =>
            this.shifts.raisePendingItem(exec, {
              operatorId,
              description: input.description,
            }),
          ),
        );
      },
    );
  }

  /**
   * An item cleared, credited to the drawer that actually dealt with it.
   *
   * Any shift may clear any item, which is the table's whole point rather than a
   * gap in the scoping: an item is inherited, so the shift that resolves it is
   * routinely not the one that raised it. What the caller cannot do is say
   * *which* shift is credited — that is their own open one, and the contract
   * carries no field for it.
   */
  @RequiresCapability("operations.shift-handover")
  @Implement(contract.operations.resolvePendingItem)
  resolvePendingItem(@CurrentPrincipal() principal: Principal | null) {
    return implement(contract.operations.resolvePendingItem).handler(
      async ({ input }) => {
        const operatorId = operatorOf(principal, "clear a pending item");

        return itemOnWire(
          await this.transactions.run((exec) =>
            this.shifts.resolvePendingItem(exec, {
              operatorId,
              pendingItemId: input.pendingItemId,
            }),
          ),
        );
      },
    );
  }

  /**
   * The backlog the desk is taking over, unscoped for every caller.
   *
   * The one read in this file that no grant narrows, and the header says why:
   * an outstanding item is every later shift's problem until somebody clears
   * it, so a list holding only what the caller's own drawer raised would be the
   * handover with the handover taken out. `raisedByShiftId` is still available
   * to anybody, because it answers provenance — "what did this shift raise",
   * which the closing screen asks about itself — and not ownership.
   */
  @RequiresCapability("operations.shift-handover", "read")
  @Implement(contract.operations.listPendingItems)
  listPendingItems() {
    return implement(contract.operations.listPendingItems).handler(
      async ({ input }) => {
        const page = await this.transactions.run((exec) =>
          this.shifts.listPendingItems(exec, {
            state: input.state,
            raisedByShiftId: input.raisedByShiftId,
            limit: input.limit,
            offset: input.offset,
          }),
        );

        return { items: page.items.map(itemOnWire), total: page.total };
      },
    );
  }
}

/**
 * The staff member the drawer belongs to.
 *
 * Both rows deny the guest realm outright, so no caller this can refuse reaches
 * it today. It is here because every act in this file attributes a drawer or an
 * item to a person, and `shift.operator_id` is `NOT NULL` behind a foreign key —
 * a principal accepted and then found to name nobody would be a type error deep
 * inside a write rather than a sentence saying who was refused.
 *
 * The act is named by the caller, so the refusal says which one was refused.
 * `folio.controller.ts` states the same argument for the same shape.
 */
function operatorOf(principal: Principal | null, act: string): string {
  if (principal?.realm !== "staff") {
    throw new ORPCError("UNAUTHORIZED", {
      message: `Only a signed-in member of staff may ${act}`,
    });
  }

  return principal.userId;
}

/**
 * Whether this caller may count out a drawer that is not theirs.
 *
 * Written as "only a grant that is unambiguously full opens it" rather than as
 * "conditional is refused", which is `folio.controller.ts`'s arrangement and its
 * reason: a decision that never arrived is a guard that did not run, and the
 * honest answer to that is the narrow one. `ACCOUNTANT` holds 👁 here and lands
 * on `false`, which is right twice over — a read-only grant is not authority to
 * write a count, and the write routes refuse them at the guard anyway.
 */
function holdsEveryDrawer(access: AccessDecision | undefined): boolean {
  return access?.grant === "full";
}

/**
 * Whether this caller reads their own shifts and only their own.
 *
 * The mirror of {@link holdsEveryDrawer} over a read, so `ACCOUNTANT`'s 👁 —
 * which the matrix grants precisely so the property's takings can be reconciled
 * across the desk — reads every operator, while `RECEPTIONIST`'s `⚠` reads one.
 * Anything else narrows, for the reason above.
 */
function narrowedToOwnShifts(access: AccessDecision | undefined): boolean {
  return access?.grant !== "full" && access?.grant !== "read";
}

/** A shift as the wire carries it — the two instants into ISO-8601. The opening
 *  business date is already the ten characters the column holds, and the three
 *  figures are `bigint`, which the serialiser writes out as text. */
function onWire(shift: Shift) {
  return {
    ...shift,
    openedAt: shift.openedAt.toISOString(),
    closedAt: shift.closedAt?.toISOString() ?? null,
  };
}

/** One outstanding item as the wire carries it. `resolvedAt` and
 *  `resolvedByShiftId` are null together — the table refuses every row where
 *  they disagree — so the null below is never a half-resolved item. */
function itemOnWire(item: PendingItemRow) {
  return {
    ...item,
    createdAt: item.createdAt.toISOString(),
    resolvedAt: item.resolvedAt?.toISOString() ?? null,
  };
}
