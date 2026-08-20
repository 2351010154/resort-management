// The desk's working day, written and read — `FR-OPS-01`.
//
// `schema/shift.ts` holds the invariants and this holds the acts, which is the
// division `folio.service.ts` states and the reason almost nothing here is
// checked twice. One open drawer per operator is a partial unique index; a
// count without a closing time is a `CHECK`; an item that is half-resolved is
// another. A rule restated here would hold for this service's callers and for
// nobody else, and this service would still have to read the SQLSTATE off the
// refusal for the caller that went round it — so the writes go in unguarded and
// the refusal is the return value. What is validated here is only what a
// constraint cannot say as a sentence somebody can act on.
//
// **The pending items are here rather than in a service of their own**, and the
// reason is the read they both turn on. An item is raised by, and resolved by,
// the caller's own open drawer — the contract refuses to let either travel in a
// request body — and "the caller's own open drawer" is precisely
// {@link ShiftService.current}'s query. Split in two, the second class would
// either run that query again from its own file or inject this one to run it,
// and the seam would fall across the middle of a single act: a handover is the
// count, the note and the items outstanding, produced by one person at one
// moment. `catalog.service.ts` is the counter-example that proves the line —
// what the property sells is the same answer for every stay, so it belongs
// nowhere near the account that bought from it. A drawer and the items its
// operator could not finish are one shift's business.
//
// **The variance is arithmetic and never a submitted figure.** `contract/
// operations.ts` refuses to accept one and `schema/shift.ts` refuses to store
// one; both say why, and the sum below is the whole of the difference. It is
// computed on every read, so a payment corrected after the fact is a payment
// this figure knows about — which is the property the schema asks for, and the
// reason {@link cashTakenOnTheDrawer} is a query rather than a column.
//
// **Nothing here scopes a read to the caller.** `rbac-matrix.md` puts
// "RCP: own shift" on both rows this service answers, and `contract/
// operations.ts` states where that is enforced: the handler, which knows who is
// calling and what their role grants. A service that also refused would be the
// matrix written twice, and the manager's read of a receptionist's day — the
// whole point of the history — is a call this file cannot tell apart from the
// receptionist's own. The one act that does take a scope takes it as an
// argument, because closing somebody else's drawer is a `MANAGER` grant the
// handler must hand over explicitly rather than a fact this file can infer.

import type { StayDate, VndAmount } from "@mariva/shared";
import { Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import {
  type SQL,
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  isNull,
  lte,
  sql,
} from "drizzle-orm";
import type { DbExecutor } from "../../database/database.module.js";
import { folioPosting } from "../../database/schema/folio.js";
import { staffUser } from "../../database/schema/identity.js";
import { payment } from "../../database/schema/payment.js";
import {
  type PendingItemRow,
  pendingItem,
  shift,
} from "../../database/schema/shift.js";
import { sqlStateOf } from "../../database/sql-state.js";
import { BusinessDateService } from "../booking/business-date.service.js";

const FOREIGN_KEY_VIOLATION = "23503";
const UNIQUE_VIOLATION = "23505";

/**
 * A shift as anything that reads one sees it.
 *
 * `openingBusinessDate` stays the ISO text the column holds rather than being
 * parsed into a `StayDate` and printed straight back out — `FolioLine` declines
 * the same crossing for the same reason: nothing between the query and the wire
 * does arithmetic on it. The two instants stay `Date`, which is what every other
 * service hands its controller, and the controller writes them out.
 *
 * `variance` and `closingCount` and `closedAt` are null together, because the
 * first is derived from the second and the database refuses a row where the
 * second and third disagree.
 */
export interface Shift {
  readonly id: string;
  readonly operatorId: string;
  readonly operatorName: string;
  readonly openingFloat: VndAmount;
  readonly openedAt: Date;
  readonly openingBusinessDate: string;
  readonly cashTaken: VndAmount;
  readonly closingCount: VndAmount | null;
  readonly variance: VndAmount | null;
  readonly closedAt: Date | null;
  readonly handoverNote: string | null;
}

/** A page of shifts, and how many the filters matched behind it. */
export interface ShiftPage {
  readonly shifts: readonly Shift[];
  readonly total: number;
}

/** Opening a drawer: whose it is, and what was counted into it. */
export interface OpenShiftRequest {
  readonly operatorId: string;
  readonly openingFloat: VndAmount;
}

/**
 * Closing a drawer: the count, the note, and who is doing the closing.
 *
 * **The two scoping fields are one decision split where it is knowable.** Which
 * staff account is calling is the handler's fact; whose drawer this row is, is
 * this file's. `rbac-matrix.md` gives `MANAGER` and `ADMIN` `full` on the cash
 * drawer precisely for the shift somebody went home without closing, so the
 * grant travels as its own field rather than being inferred from a role this
 * service would then be a second reader of.
 */
export interface CloseShiftRequest {
  readonly shiftId: string;
  readonly closingCount: VndAmount;
  /** Trimmed and non-empty by the time it arrives; absent and null are one claim. */
  readonly handoverNote?: string | null;
  readonly closedBy: string;
  /** The matrix's `full` on the drawer, resolved by the handler from the role. */
  readonly mayCloseAnotherOperatorsDrawer: boolean;
}

/** Which shifts to read back — a person, a span of trading days, or both. */
export interface ShiftHistoryQuery {
  readonly operatorId?: string;
  readonly from?: StayDate;
  readonly to?: StayDate;
  readonly limit: number;
  readonly offset: number;
}

/** Raising an item: what is outstanding, and who found it. */
export interface RaisePendingItemRequest {
  readonly operatorId: string;
  readonly description: string;
}

/** Which items to list — the backlog by default, one shift's findings on request. */
export interface PendingItemQuery {
  readonly state: "OUTSTANDING" | "ANY";
  readonly raisedByShiftId?: string;
  readonly limit: number;
  readonly offset: number;
}

/** A page of items, and how many the filters matched behind it. */
export interface PendingItemPage {
  readonly items: readonly PendingItemRow[];
  readonly total: number;
}

/**
 * What the drawer had gained at the moment it was counted.
 *
 * The rows are found by `shift_id` alone and no method is named beside it:
 * `payment_shift_binding` makes that column non-null on exactly the `CASH` rows,
 * so the binding *is* the method test and a `method = 'CASH'` here would be the
 * biconditional restated in a second place for the two to disagree from.
 * `payment_shift_idx` is the index the schema describes as existing for this.
 *
 * **The status filter is bounded by the close rather than absolute**, and that
 * boundary is what makes the figure both live and final. A payment reversed
 * before the count had already left the drawer — or never entered it, which is
 * the ordinary case of a card payment keyed as cash and corrected minutes
 * later — so counting it in would hand the receptionist a shortfall for money
 * the count rightly did not find. A payment reversed *after* the count is the
 * opposite: the đồng were in the drawer when it was counted and the closing
 * figure somebody signed attests to them, so letting a later act rewrite this
 * shift would put a shortfall on a drawer that was square when it was signed
 * for — while the drawer that actually paid the money back out already shows
 * the loss in its own count. One missing sum, reported twice. So while a shift
 * is open every reversal so far is a reversal before the count, and once it is
 * closed none is.
 *
 * The reversal's instant is read off the `REVERSAL` line rather than off the
 * payment row, which records no such moment. `payment.folio_posting_id` names
 * the line the money is the payer's side of, and
 * `folio_posting_reversal_unique_key` makes the line that reverses it at most
 * one — so the join cannot multiply a payment into the sum. A `REFUNDED` row
 * with no reversal behind it is not a row this tree writes, and the null
 * arithmetic below leaves it out, which is the safe direction.
 *
 * Text on the way back, because Postgres widens `sum(bigint)` to `numeric` and
 * the driver hands a numeric over as a string. Parsed to `bigint` from that
 * text, which is the one route that cannot lose a đồng — `NFR-12`.
 */
const cashTakenOnTheDrawer = sql<string>`(
  select coalesce(sum(${payment.amount}), 0)
  from ${payment}
  left join ${folioPosting}
    on ${folioPosting.reversesPostingId} = ${payment.folioPostingId}
  where ${payment.shiftId} = ${shift.id}
    and (
      ${payment.status} <> 'REFUNDED'
      or (
        ${shift.closedAt} is not null
        and ${folioPosting.postedAt} > ${shift.closedAt}
      )
    )
)`;

/**
 * Every column a reader of a shift needs, in one place.
 *
 * The name comes from `staff_user` and not from a second lookup: the history
 * exists to say who was answerable for a day that went badly, and a column of
 * uuids does not say it. Inner join, because `operator_id` is `NOT NULL` behind
 * a foreign key — a shift with no operator is a row this schema cannot hold.
 */
const shiftColumns = {
  id: shift.id,
  operatorId: shift.operatorId,
  operatorName: staffUser.fullName,
  openingFloat: shift.openingFloat,
  openedAt: shift.openedAt,
  openingBusinessDate: shift.openingBusinessDate,
  cashTaken: cashTakenOnTheDrawer,
  closingCount: shift.closingCount,
  closedAt: shift.closedAt,
  handoverNote: shift.handoverNote,
} as const;

/** The row {@link shiftColumns} selects, before the variance is worked out. */
interface CountedShiftRow {
  id: string;
  operatorId: string;
  operatorName: string;
  openingFloat: bigint;
  openedAt: Date;
  openingBusinessDate: string;
  cashTaken: string;
  closingCount: bigint | null;
  closedAt: Date | null;
  handoverNote: string | null;
}

/**
 * The variance, worked out where the three nullable fields can be seen moving
 * together.
 *
 * Counted less expected, expected being the float plus what the drawer took.
 * Positive is a drawer with more đồng in it than the property can account for
 * and negative is one that is short. Two exact integers subtracted from a third:
 * there is no rounding to get wrong here, and `bigint` is what makes it
 * impossible to reach for a route where there would be.
 */
function withVariance(row: CountedShiftRow): Shift {
  const cashTaken = BigInt(row.cashTaken);

  return {
    ...row,
    cashTaken,
    variance:
      row.closingCount === null
        ? null
        : row.closingCount - (row.openingFloat + cashTaken),
  };
}

@Injectable()
export class ShiftService {
  constructor(private readonly businessDates: BusinessDateService) {}

  /**
   * Opens a drawer in the caller's name — `FR-OPS-01`.
   *
   * **The insert is unguarded and a second open drawer is the index's refusal.**
   * `schema/shift.ts` makes the argument in full: two presses arriving together
   * both read a table with no open shift in it, both insert, and the property
   * then has one person answerable for two drawers with cash landing in
   * whichever the handler saw first. Nothing between a read here and the write
   * after it holds the key. `shift_one_open_per_operator` holds it, and `23505`
   * is that rule reporting itself.
   *
   * The trading day is resolved here rather than taken from the caller, because
   * a shift opened at 01:00 is answerable for the day before and only the
   * property's own rollover knows it — `business-date.service.ts` argues why
   * that read joins the caller's transaction rather than reaching for the pool.
   * Stored once, never derived again: a shift that changed which day it belonged
   * to would move cash between two days' takings after both were reported.
   */
  async open(exec: DbExecutor, request: OpenShiftRequest): Promise<Shift> {
    const openingBusinessDate = await this.businessDates.current(exec);

    let openedId: string;

    try {
      const [opened] = await exec
        .insert(shift)
        .values({
          operatorId: request.operatorId,
          openingFloat: request.openingFloat,
          openingBusinessDate: openingBusinessDate.toString(),
        })
        .returning({ id: shift.id });

      openedId = opened!.id;
    } catch (error) {
      const state = sqlStateOf(error);

      if (state === UNIQUE_VIOLATION) {
        throw new ORPCError("CONFLICT", {
          message:
            "You already have a shift open — count it out and close it before " +
            "opening another, or the cash taken from here on belongs to two drawers",
        });
      }

      if (state === FOREIGN_KEY_VIOLATION) {
        throw new ORPCError("NOT_FOUND", {
          message: "No staff account with that id, so there is nobody to be answerable for the drawer",
        });
      }

      throw error;
    }

    // Read back rather than composed from the insert, because two of the fields
    // a reader gets are not on the row: the operator's name, and what the drawer
    // has taken — which is nothing yet, and is answered by the same query that
    // will answer it at the handover rather than by a zero written here.
    const opened = await this.byId(exec, openedId);

    return opened!;
  }

  /**
   * Counts the drawer out and hands it over — `FR-OPS-01`.
   *
   * **The row is locked before the cash is summed, and that order is the whole
   * guarantee.** `migrations/0040` has the payment trigger take `FOR SHARE` on
   * the shift it is being counted into, expressly so that a close and a payment
   * cannot pass each other: `FOR UPDATE` here conflicts with that share lock in
   * both directions. A payment already in flight is waited for and lands in the
   * sum below — the drawer is counted with that đồng in it, which is where it
   * physically is — and one arriving after this commits reads a `closed_at` and
   * is refused with `MV006`. Summing first and locking afterwards would close
   * drawers on a figure that was true a moment ago, which is the failure the
   * receptionist is later asked to explain and nobody can trace.
   *
   * The lock lasts as long as the caller's transaction, which is why every
   * method here takes an executor — `database.module.ts` says whose job that
   * boundary is. A caller handing the client instead would hold a row lock
   * Postgres released at the end of the statement.
   *
   * **A second close is refused rather than passed over.** It would be easy to
   * make idempotent and wrong twice over: the count already stored was signed
   * for by whoever took it, and overwriting it would replace the figure the
   * property's variance is computed from with one taken at a different moment by
   * possibly a different person. The refusal carries when the first close
   * happened, which is what lets somebody work out which handover they are
   * looking at.
   *
   * **Whose drawer it is is checked before whether it is closed**, so a caller
   * with no business here learns nothing about the state of a colleague's day.
   */
  async close(exec: DbExecutor, request: CloseShiftRequest): Promise<Shift> {
    const [drawer] = await exec
      .select({
        id: shift.id,
        operatorId: shift.operatorId,
        closedAt: shift.closedAt,
      })
      .from(shift)
      .where(eq(shift.id, request.shiftId))
      .limit(1)
      .for("update");

    if (!drawer) {
      throw new ORPCError("NOT_FOUND", {
        message: "No shift with that id, so there is no drawer to count out",
      });
    }

    if (
      !request.mayCloseAnotherOperatorsDrawer &&
      drawer.operatorId !== request.closedBy
    ) {
      throw new ORPCError("FORBIDDEN", {
        message:
          "That drawer belongs to somebody else — a receptionist closes their " +
          "own, and a manager closes the one somebody went home without closing",
      });
    }

    if (drawer.closedAt !== null) {
      throw new ORPCError("CONFLICT", {
        message: `That drawer was already counted out at ${drawer.closedAt.toISOString()} and its variance stands on that count`,
      });
    }

    await exec
      .update(shift)
      .set({
        closingCount: request.closingCount,
        // Postgres' clock and not this process's: inside a transaction `now()`
        // is the transaction's own start, so the instant stored is the one every
        // statement of this close shares and is identical on whichever
        // connection took it.
        closedAt: sql`now()`,
        // Absent and null are one claim — a note of nothing reads to the next
        // shift as a note nobody wrote, which is what its absence already says.
        handoverNote: request.handoverNote ?? null,
        // The second write this column exists for. `schema/shift.ts` keeps it
        // where `payment.ts` refuses one precisely because a shift row is
        // written twice by design, and Drizzle does not move it on its own.
        updatedAt: sql`now()`,
      })
      // The state is named in the predicate as well as in the lock above. It
      // costs nothing and it is what makes the statement refuse rather than
      // overwrite, should this ever be reached from a path that did not lock.
      .where(and(eq(shift.id, drawer.id), isNull(shift.closedAt)));

    // Under the lock still held above, so the sum cannot have moved between the
    // count being written and the variance being read off it.
    const closed = await this.byId(exec, drawer.id);

    return closed!;
  }

  /**
   * The drawer this operator is on, or null for somebody who is not on one.
   *
   * Null is the ordinary state of a receptionist who has not opened a drawer
   * yet, and not a refusal: nothing is wrong with not being on a shift, and the
   * console renders "no shift" from it. `shift_one_open_per_operator` is what
   * makes "the" open shift a true singular — there cannot be a second row for
   * this predicate to have to choose between.
   */
  async current(exec: DbExecutor, operatorId: string): Promise<Shift | null> {
    const [open] = await exec
      .select(shiftColumns)
      .from(shift)
      .innerJoin(staffUser, eq(staffUser.id, shift.operatorId))
      .where(and(eq(shift.operatorId, operatorId), isNull(shift.closedAt)))
      .limit(1);

    return open ? withVariance(open) : null;
  }

  /**
   * What happened at the desk over a stretch of trading days.
   *
   * **The days filter `opening_business_date` and not `opened_at`**, which is
   * the whole reason that column is stored: a night shift opened at 01:00 is
   * answerable for the day before, and a history filtered on the instant would
   * file its variance under a day the property had already reported. Both ends
   * are inclusive.
   *
   * The open shift appears here when it falls inside the window — it is history
   * the moment it is a row, and dropping it would mean a manager looking at
   * today could not see who is on the desk. Its `variance` is null, for want of
   * a count rather than for want of a place in the list.
   *
   * Newest opening first with the id breaking the tie, so the order is total: an
   * offset over a partial order is a page that shows one shift twice and another
   * never. `total` is counted under the same predicate the page was cut from, so
   * a pager can offer a last page rather than only a next one.
   */
  async history(
    exec: DbExecutor,
    query: ShiftHistoryQuery,
  ): Promise<ShiftPage> {
    const narrowed: SQL[] = [];

    if (query.operatorId) {
      narrowed.push(eq(shift.operatorId, query.operatorId));
    }

    if (query.from) {
      narrowed.push(gte(shift.openingBusinessDate, query.from.toString()));
    }

    if (query.to) {
      narrowed.push(lte(shift.openingBusinessDate, query.to.toString()));
    }

    const where = narrowed.length > 0 ? and(...narrowed) : undefined;

    const listed = await exec
      .select(shiftColumns)
      .from(shift)
      .innerJoin(staffUser, eq(staffUser.id, shift.operatorId))
      .where(where)
      .orderBy(desc(shift.openedAt), desc(shift.id))
      .limit(query.limit)
      .offset(query.offset);

    // No join to `staff_user` here: the count is over `shift` rows and the name
    // is only ever a column on the page above. The predicate is the same one.
    const [counted] = await exec
      .select({ total: count() })
      .from(shift)
      .where(where);

    return {
      shifts: listed.map(withVariance),
      total: counted?.total ?? 0,
    };
  }

  /**
   * Records something this shift could not finish — `FR-OPS-01`.
   *
   * The raising shift is the caller's own open drawer and never a value in the
   * request: `contract/operations.ts` refuses to carry one, because naming
   * another shift would file the finding against a drawer that never saw it and
   * naming a closed one would add to a handover that has already happened.
   *
   * **A caller on no shift is refused and told to open one.** That is the
   * coupling `screens.md` describes for cash, applied to the rest of the desk's
   * work: the item exists to be inherited, and an item raised by nobody's drawer
   * has no handover to appear in.
   */
  async raisePendingItem(
    exec: DbExecutor,
    request: RaisePendingItemRequest,
  ): Promise<PendingItemRow> {
    const drawer = await this.openDrawerOf(exec, request.operatorId);

    const [raised] = await exec
      .insert(pendingItem)
      .values({ raisedByShiftId: drawer, description: request.description })
      .returning();

    return raised!;
  }

  /**
   * Clears an item, crediting the shift that actually dealt with it.
   *
   * **One conditional statement rather than a read and then a write.** Two
   * receptionists clearing the same item at the same moment would both read it
   * outstanding, and the second write would overwrite which shift dealt with
   * it — the half of the row the audit trail reads. `resolved_at is null` in the
   * predicate is what makes the loser update nothing, and both halves of
   * `pending_item_resolved_exactly_when_a_shift_cleared_it` are set in the same
   * statement, so no reader can see one without the other.
   *
   * The second read only happens when nothing was updated, and it is what tells
   * "no such item" apart from "somebody got there first". The instant is
   * Postgres' clock, for the reason the close's is.
   */
  async resolvePendingItem(
    exec: DbExecutor,
    request: { readonly operatorId: string; readonly pendingItemId: string },
  ): Promise<PendingItemRow> {
    const drawer = await this.openDrawerOf(exec, request.operatorId);

    const [resolved] = await exec
      .update(pendingItem)
      .set({ resolvedAt: sql`now()`, resolvedByShiftId: drawer })
      .where(
        and(
          eq(pendingItem.id, request.pendingItemId),
          isNull(pendingItem.resolvedAt),
        ),
      )
      .returning();

    if (resolved) {
      return resolved;
    }

    const [existing] = await exec
      .select({ resolvedAt: pendingItem.resolvedAt })
      .from(pendingItem)
      .where(eq(pendingItem.id, request.pendingItemId))
      .limit(1);

    if (!existing) {
      throw new ORPCError("NOT_FOUND", {
        message: "No pending item with that id, so there is nothing to clear",
      });
    }

    throw new ORPCError("CONFLICT", {
      message: `That item was already cleared at ${existing.resolvedAt?.toISOString()} — the shift credited with it is not rewritten`,
    });
  }

  /**
   * The backlog, or a stretch of what the desk has found and dealt with.
   *
   * **Nothing scopes this to a shift.** The whole point of the table is that an
   * item outlives the drawer that found it: raised by one, inherited by the
   * next, resolved by whichever finally deals with it. `raisedByShiftId` narrows
   * by provenance — "what did this shift raise", which the closing screen asks
   * about itself — and is not ownership, because an item is every later shift's
   * problem until somebody clears it.
   *
   * Oldest first with the id breaking the tie: the order `pending_item_unresolved_idx`
   * is built in, and the order a backlog is worked in.
   */
  async listPendingItems(
    exec: DbExecutor,
    query: PendingItemQuery,
  ): Promise<PendingItemPage> {
    const narrowed: SQL[] = [];

    if (query.state === "OUTSTANDING") {
      narrowed.push(isNull(pendingItem.resolvedAt));
    }

    if (query.raisedByShiftId) {
      narrowed.push(eq(pendingItem.raisedByShiftId, query.raisedByShiftId));
    }

    const where = narrowed.length > 0 ? and(...narrowed) : undefined;

    const listed = await exec
      .select()
      .from(pendingItem)
      .where(where)
      .orderBy(asc(pendingItem.createdAt), asc(pendingItem.id))
      .limit(query.limit)
      .offset(query.offset);

    const [counted] = await exec
      .select({ total: count() })
      .from(pendingItem)
      .where(where);

    return { items: listed, total: counted?.total ?? 0 };
  }

  /**
   * One shift by id, counted. Null where there is no such row.
   *
   * Private because no route asks for a shift on its own — `contract/
   * operations.ts` declines to declare a member route and says why. It exists so
   * that the two writes above answer with exactly what every read answers with,
   * rather than each composing a shift from the columns it happened to have.
   */
  private async byId(exec: DbExecutor, shiftId: string): Promise<Shift | null> {
    const [found] = await exec
      .select(shiftColumns)
      .from(shift)
      .innerJoin(staffUser, eq(staffUser.id, shift.operatorId))
      .where(eq(shift.id, shiftId))
      .limit(1);

    return found ? withVariance(found) : null;
  }

  /**
   * The id of the drawer this operator is on, refusing where there is none.
   *
   * The id alone, because both callers need a key to write and neither needs the
   * variance a full read would compute. The refusal is the sentence
   * `contract/operations.ts` asks for: the desk's work belongs to a drawer, or
   * it belongs to nobody.
   */
  private async openDrawerOf(
    exec: DbExecutor,
    operatorId: string,
  ): Promise<string> {
    const [open] = await exec
      .select({ id: shift.id })
      .from(shift)
      .where(and(eq(shift.operatorId, operatorId), isNull(shift.closedAt)))
      .limit(1);

    if (!open) {
      throw new ORPCError("CONFLICT", {
        message:
          "You are not on a shift — open a drawer first, so that what you " +
          "record belongs to a handover somebody inherits",
      });
    }

    return open.id;
  }
}
