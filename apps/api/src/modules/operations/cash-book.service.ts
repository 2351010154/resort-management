// The property's own cash book, written and read — `FR-OPS-02`.
//
// `schema/cash-book.ts` holds the invariants and this holds the acts, which is
// the division `folio.service.ts` states and `shift.service.ts` restates. So
// almost nothing here is checked twice: the amount above nothing, the category
// belonging to a side, cash naming a drawer and an entry reversed at most once
// are all constraints, and a rule restated here would hold for this service's
// callers and for nobody else. What is validated here is only what a constraint
// cannot say as a sentence somebody can act on, and what a constraint cannot see
// at all — the property's current trading day, and what kind of row the entry
// being reversed is.
//
// **The book is append-only and this file has no update and no delete.** That is
// not an omission to fill in later: `migrations/0042` raises `MV007` on either,
// because a shift's expected cash is computed from these rows and an expense
// edited after the drawer it came out of was counted would move a variance
// somebody has already signed for. A mistake is corrected by
// {@link CashBookService.reverse}, which writes a row of its own naming the row
// it undoes.
//
// **A cash entry's drawer is named by the caller, and that is the difference
// from a payment.** `folio.controller.ts` resolves the shift from the session,
// because the person taking cash from a guest is the person on the desk. Nobody
// in this file is on the desk: `rbac-matrix.md` puts *Income / expense (thu
// chi)* at `full` for `ACCOUNTANT`, `MANAGER` and `ADMIN` and grants a
// receptionist nothing on the row, and an accountant holds no drawer of their
// own. So the entry names the till the money moved through, and what this file
// owes in exchange is the refusal: a drawer already counted out takes no further
// cash, which is `migrations/0042`'s trigger reporting itself and the sentence
// {@link recordedIntoACountedDrawer} turns it into.
//
// **The two page totals are queries and never accumulated.** They are counted
// under the same predicate the page was cut from, on every read, for
// `folioPageSchema`'s reason: a total assembled from the rows on screen answers
// the accountant's question for the first fifty entries and is silently wrong
// for every page after.

import type { StayDate, VndAmount } from "@mariva/shared";
import { Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import { type SQL, and, count, desc, eq, gte, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DbExecutor } from "../../database/database.module.js";
import {
  type CashBookCategory,
  type CashBookDirection,
  type CashBookMethod,
  cashBookEntry,
} from "../../database/schema/cash-book.js";
import { staffUser } from "../../database/schema/identity.js";
import { sqlStateOf } from "../../database/sql-state.js";
import { BusinessDateService } from "../booking/business-date.service.js";

const FOREIGN_KEY_VIOLATION = "23503";
const UNIQUE_VIOLATION = "23505";

/** The drawer refusing, in the SQLSTATE `migrations/0040` gave it and
 *  `migrations/0042` reuses: a caller acts on either by naming a drawer that is
 *  open. */
const DRAWER_VIOLATION = "MV006";

/** One movement of the property's own money, as anything that reads the book
 *  sees it. The trading day stays the ISO text the column holds — `FolioLine`
 *  declines the same crossing for the same reason: nothing between the query and
 *  the wire does arithmetic on it. */
export interface CashBookEntry {
  readonly id: string;
  readonly direction: CashBookDirection;
  readonly category: CashBookCategory;
  readonly method: CashBookMethod;
  readonly amount: VndAmount;
  readonly businessDate: string;
  readonly shiftId: string | null;
  readonly note: string;
  readonly recordedById: string;
  readonly recordedByName: string;
  readonly recordedAt: Date;
  readonly reversesEntryId: string | null;
  readonly reversedByEntryId: string | null;
}

/** A page of the book, what the filters matched, and what those matches came to
 *  on each side. */
export interface CashBookPage {
  readonly entries: readonly CashBookEntry[];
  readonly total: number;
  readonly incomeTotal: VndAmount;
  readonly expenseTotal: VndAmount;
}

/** Recording a movement. The recorder is the handler's fact, never the
 *  caller's. */
export interface RecordCashBookEntryRequest {
  readonly direction: CashBookDirection;
  readonly category: CashBookCategory;
  readonly method: CashBookMethod;
  readonly amount: VndAmount;
  /** The trading day the money moved. Absent is the property's own, resolved
   *  here rather than by whoever is asking. */
  readonly businessDate?: StayDate;
  /** Not null on exactly the cash entries — the contract refuses the other
   *  combinations, and the table refuses them again. */
  readonly shiftId?: string | null;
  readonly note: string;
  readonly recordedBy: string;
}

/** Undoing one: the entry, the drawer the đồng come back through, and why. */
export interface ReverseCashBookEntryRequest {
  readonly entryId: string;
  readonly shiftId?: string | null;
  readonly note: string;
  readonly recordedBy: string;
}

/** Which entries to read back. */
export interface CashBookQuery {
  readonly from?: StayDate;
  readonly to?: StayDate;
  readonly direction?: CashBookDirection;
  readonly category?: CashBookCategory;
  readonly method?: CashBookMethod;
  readonly limit: number;
  readonly offset: number;
}

/**
 * The correction that undid this entry, if one has been made.
 *
 * A self-join under an alias, because the answer is another row of this same
 * table. `cash_book_entry_reversal_unique_key` is what makes it a scalar rather
 * than a set — an entry is reversed at most once — and a left join, because the
 * ordinary entry has no correction and a reader needs to be told that rather
 * than have the row disappear.
 */
const correction = alias(cashBookEntry, "correction");

/** Every column a reader of the book needs, in one place. The recorder's name
 *  comes from `staff_user` and not from a second lookup: a book of who spent the
 *  property's money is not readable as a column of uuids. Inner join, because
 *  `recorded_by` is `NOT NULL` behind a foreign key. */
const entryColumns = {
  id: cashBookEntry.id,
  direction: cashBookEntry.direction,
  category: cashBookEntry.category,
  method: cashBookEntry.method,
  amount: cashBookEntry.amount,
  businessDate: cashBookEntry.businessDate,
  shiftId: cashBookEntry.shiftId,
  note: cashBookEntry.note,
  recordedById: cashBookEntry.recordedBy,
  recordedByName: staffUser.fullName,
  recordedAt: cashBookEntry.recordedAt,
  reversesEntryId: cashBookEntry.reversesEntryId,
  reversedByEntryId: correction.id,
} as const;

/**
 * What one side of the filtered book came to.
 *
 * Text on the way back, because Postgres widens `sum(bigint)` to `numeric` and
 * the driver hands a numeric over as a string. Parsed to `bigint` from that
 * text, which is the one route that cannot lose a đồng — `NFR-12` — and the
 * arrangement `cashTakenOnTheDrawer` already uses.
 */
function sideTotal(direction: CashBookDirection): SQL<string> {
  return sql<string>`coalesce(sum(${cashBookEntry.amount}) filter (
    where ${cashBookEntry.direction} = ${direction}
  ), 0)`;
}

@Injectable()
export class CashBookService {
  constructor(private readonly businessDates: BusinessDateService) {}

  /**
   * Records a movement of the property's own money — `FR-OPS-02`.
   *
   * **The insert is unguarded and every refusal is the database's.** A cash
   * entry against a drawer that has been counted out is `MV006`, raised by the
   * trigger `migrations/0042` installs, and that trigger takes `FOR SHARE` on
   * the shift so a close and an entry cannot pass each other — a check taken
   * here first would read a `closed_at` that is still null in this
   * transaction's snapshot and let both commit. A shift or a staff account that
   * is not there at all is `23503`, which is the more precise answer than
   * anything this file could pre-empt.
   *
   * The trading day is resolved here where the caller named none, rather than
   * defaulted anywhere the property's rollover is not known —
   * `business-date.service.ts` argues why that read joins the caller's
   * transaction. A day *ahead* of the property's own is refused, and that is the
   * one thing checked before the write: money that has not moved yet is not an
   * entry, and no constraint can see today.
   */
  async record(
    exec: DbExecutor,
    request: RecordCashBookEntryRequest,
  ): Promise<CashBookEntry> {
    const businessDate = await this.dayItMovedOn(exec, request.businessDate);

    const recordedId = await this.write(exec, {
      direction: request.direction,
      category: request.category,
      method: request.method,
      amount: request.amount,
      businessDate,
      shiftId: request.shiftId ?? null,
      note: request.note,
      recordedBy: request.recordedBy,
      reversesEntryId: null,
    });

    // Read back rather than composed from the insert, because two of the fields
    // a reader gets are not on the row: the recorder's name, and whether the
    // entry has been corrected — which is nothing yet, and is answered by the
    // same join that will answer it later rather than by a null written here.
    const recorded = await this.byId(exec, recordedId);

    return recorded!;
  }

  /**
   * Undoes an entry by recording its opposite — `FR-OPS-02`.
   *
   * **Everything but the drawer and the reason is read off the row being
   * reversed.** A caller able to send an amount or a category would be recording
   * a second, unrelated movement while calling it a correction, and the two
   * would not net to nothing. What travels is the entry, the till the đồng go
   * back through, and why.
   *
   * **The drawer is named again rather than inherited**, and that is what keeps
   * a counted shift reproducible. The original may have moved through a till
   * that was counted out hours ago, and its variance stands on that count; the
   * money physically comes back through whichever drawer is open now, so that is
   * the shift this row binds to. Inheriting the original's would be đồng into a
   * handover somebody has already signed for — the one thing this table is
   * arranged to prevent — and the trigger would refuse it anyway.
   *
   * **A reversal is not itself reversed.** Undoing a correction is recording the
   * original movement again, which this service already does and says plainly;
   * a chain of corrections is a book nobody can read, and the refusal here costs
   * a caller one sentence. A second correction of the *same* entry is
   * `cash_book_entry_reversal_unique_key` refusing with `23505`, which is a
   * different mistake and gets a different sentence.
   */
  async reverse(
    exec: DbExecutor,
    request: ReverseCashBookEntryRequest,
  ): Promise<CashBookEntry> {
    const [mistake] = await exec
      .select({
        id: cashBookEntry.id,
        direction: cashBookEntry.direction,
        category: cashBookEntry.category,
        method: cashBookEntry.method,
        amount: cashBookEntry.amount,
        businessDate: cashBookEntry.businessDate,
        reversesEntryId: cashBookEntry.reversesEntryId,
      })
      .from(cashBookEntry)
      .where(eq(cashBookEntry.id, request.entryId))
      .limit(1);

    if (!mistake) {
      throw new ORPCError("NOT_FOUND", {
        message: "No cash book entry with that id, so there is nothing to undo",
      });
    }

    if (mistake.reversesEntryId !== null) {
      throw new ORPCError("CONFLICT", {
        message:
          "That entry is itself a correction, and a correction is not corrected " +
          "again — if the money moved after all, record it as the movement it was",
      });
    }

    const wantsADrawer = mistake.method === "CASH";
    const shiftId = request.shiftId ?? null;

    if (wantsADrawer && shiftId === null) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          "That entry moved cash, so undoing it puts đồng back in a till — name " +
          "the drawer that is open now, whose count has to account for them",
      });
    }

    if (!wantsADrawer && shiftId !== null) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          "That entry moved no cash, so undoing it moves no drawer — a bank " +
          "transfer reversed against a till would move a variance nothing happened to",
      });
    }

    const correctionId = await this.write(exec, {
      direction: mistake.direction === "INCOME" ? "EXPENSE" : "INCOME",
      category: mistake.category,
      method: mistake.method,
      amount: mistake.amount,
      // The trading day the correction is made on, not the day of the mistake.
      // The money moves back today, and filing it under the original's day would
      // make a month that has already been reported quietly change its totals.
      businessDate: (await this.businessDates.current(exec)).toString(),
      shiftId,
      note: request.note,
      recordedBy: request.recordedBy,
      reversesEntryId: mistake.id,
    });

    const correcting = await this.byId(exec, correctionId);

    return correcting!;
  }

  /**
   * A stretch of the book — what the property took and spent.
   *
   * **The days filter `business_date` and not `recorded_at`**, which is the
   * whole reason that column is stored: an accountant recording Friday's
   * transfer on Monday has filed it under Friday, and a month cut on the instant
   * would report it in the wrong one. Both ends are inclusive.
   *
   * Latest trading day first, then the most recently recorded, with the id
   * breaking the tie, so the order is total: an offset over a partial order is a
   * page that shows one entry twice and another never.
   *
   * The two sums are taken under the page's own predicate rather than over the
   * rows returned — the header says why — and in the same statement as the
   * count, because they answer one question about one set of rows and two
   * statements would be two moments.
   */
  async list(exec: DbExecutor, query: CashBookQuery): Promise<CashBookPage> {
    const narrowed: SQL[] = [];

    if (query.from) {
      narrowed.push(gte(cashBookEntry.businessDate, query.from.toString()));
    }

    if (query.to) {
      narrowed.push(lte(cashBookEntry.businessDate, query.to.toString()));
    }

    if (query.direction) {
      narrowed.push(eq(cashBookEntry.direction, query.direction));
    }

    if (query.category) {
      narrowed.push(eq(cashBookEntry.category, query.category));
    }

    if (query.method) {
      narrowed.push(eq(cashBookEntry.method, query.method));
    }

    const where = narrowed.length > 0 ? and(...narrowed) : undefined;

    const listed = await exec
      .select(entryColumns)
      .from(cashBookEntry)
      .innerJoin(staffUser, eq(staffUser.id, cashBookEntry.recordedBy))
      .leftJoin(correction, eq(correction.reversesEntryId, cashBookEntry.id))
      .where(where)
      .orderBy(
        desc(cashBookEntry.businessDate),
        desc(cashBookEntry.recordedAt),
        desc(cashBookEntry.id),
      )
      .limit(query.limit)
      .offset(query.offset);

    // No joins here: the count and the two sums are over `cash_book_entry` rows
    // alone, and the recorder's name and the correction are only ever columns on
    // the page above. The predicate is the same one.
    const [summed] = await exec
      .select({
        total: count(),
        incomeTotal: sideTotal("INCOME"),
        expenseTotal: sideTotal("EXPENSE"),
      })
      .from(cashBookEntry)
      .where(where);

    return {
      entries: listed,
      total: summed?.total ?? 0,
      incomeTotal: BigInt(summed?.incomeTotal ?? "0"),
      expenseTotal: BigInt(summed?.expenseTotal ?? "0"),
    };
  }

  /**
   * The insert both writes share, with the database's refusals turned into
   * sentences.
   *
   * One place, because recording and correcting differ in what they compute and
   * not in what they store — and the three refusals below are the same three
   * either way. `MV006` is the drawer counted out from under the caller, which
   * on this route is not a race but the ordinary mistake of naming yesterday's
   * shift; `23505` is the entry somebody else corrected a moment ago; `23503` is
   * a drawer or an account that is not there.
   */
  private async write(
    exec: DbExecutor,
    values: typeof cashBookEntry.$inferInsert,
  ): Promise<string> {
    try {
      const [written] = await exec
        .insert(cashBookEntry)
        .values(values)
        .returning({ id: cashBookEntry.id });

      return written!.id;
    } catch (error) {
      const state = sqlStateOf(error);

      if (state === DRAWER_VIOLATION) {
        throw recordedIntoACountedDrawer();
      }

      if (state === UNIQUE_VIOLATION) {
        throw new ORPCError("CONFLICT", {
          message:
            "That entry has already been corrected — the book records one " +
            "correction per mistake, or the money goes back twice",
        });
      }

      if (state === FOREIGN_KEY_VIOLATION) {
        throw new ORPCError("NOT_FOUND", {
          message:
            "No drawer or staff account with that id, so there is nothing for " +
            "this entry to belong to",
        });
      }

      throw error;
    }
  }

  /**
   * The trading day this movement is filed under.
   *
   * Absent is the property's own day, which only the rollover knows — a console
   * computing it at 01:30 would file a night's spending under a day the property
   * has not started. A day ahead of it is refused rather than stored: an entry is
   * a record of money that has moved, and the totals a month is closed on cannot
   * contain a day that has not happened. Behind it is not refused at all, because
   * recording Friday's transfer on Monday is the ordinary case this column exists
   * for.
   */
  private async dayItMovedOn(
    exec: DbExecutor,
    named: StayDate | undefined,
  ): Promise<string> {
    const today = await this.businessDates.current(exec);

    if (named === undefined) {
      return today.toString();
    }

    if (named.compare(today) > 0) {
      throw new ORPCError("BAD_REQUEST", {
        message: `The property is trading ${today.toString()}, and money cannot be recorded as having moved on a day that has not happened`,
      });
    }

    return named.toString();
  }

  /**
   * One entry by id, with its recorder and its correction. Null where there is
   * no such row.
   *
   * Private because no route asks for an entry on its own — `contract/finance.ts`
   * declines to declare a member route and says why. It exists so that both
   * writes answer with exactly what the read answers with, rather than each
   * composing an entry from the columns it happened to have.
   */
  private async byId(
    exec: DbExecutor,
    entryId: string,
  ): Promise<CashBookEntry | null> {
    const [found] = await exec
      .select(entryColumns)
      .from(cashBookEntry)
      .innerJoin(staffUser, eq(staffUser.id, cashBookEntry.recordedBy))
      .leftJoin(correction, eq(correction.reversesEntryId, cashBookEntry.id))
      .where(eq(cashBookEntry.id, entryId))
      .limit(1);

    return found ?? null;
  }
}

/**
 * The drawer refusing, as a sentence rather than a fault.
 *
 * `folio.controller.ts` translates the same SQLSTATE for the same reason: an
 * untranslated `MV006` is a 500 on a screen whose only remaining question is
 * which drawer the money goes in. `CONFLICT` and not `BAD_REQUEST`, because
 * nothing about the request was malformed — the state of a row it named changed
 * or was misread.
 */
function recordedIntoACountedDrawer(): ORPCError<string, unknown> {
  return new ORPCError("CONFLICT", {
    message:
      "That drawer has been counted out and its variance stands on that count " +
      "— name a drawer that is still open, so the đồng are in a count somebody " +
      "has yet to sign for",
  });
}
