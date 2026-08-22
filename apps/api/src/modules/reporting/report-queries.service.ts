// What the Reports pages are read from — `FR-RPT-02`, revenue and room status.
//
// **This file only reads.** `night-audit.service.ts` is the folder's one writer
// and a snapshot is immutable once written — `migrations`' `BEFORE UPDATE OR
// DELETE` trigger raises `MV008` — so nothing here composes an insert, an update
// or a delete, and the two reports are the same answer however often they are
// asked.
//
// ## The boundary, and why one page may mix three kinds of read
//
// `docs/screens.md` stamps every report page with the last business date the
// night audit has closed, and says the stamp is *a boundary rather than a
// statement of source*: what it promises is that no page shows a day the audit
// has not closed, not that every figure on it was read from a frozen row. That
// is what makes this file coherent, because it reads three ways.
//
// - **Room and other revenue are frozen.** They come off `night_audit_snapshot`
//   and cannot move, which is the whole reason `FR-RPT-01` writes that table.
// - **Penalties are summed from the folio ledger, still cut at the boundary.**
//   `night-audit.service.ts` deliberately keeps `POLICY_CHARGE` out of
//   `other_revenue_vnd` — §4's cancellation charge is money a booking forfeited
//   by not happening, and counting it as takings would report a night of mass
//   cancellations as a good one. So the revenue page, which does have to say what
//   the property kept, sums it separately. Reading it live is safe on the terms
//   `screens.md` states: a penalty posts to the trading day it was taken on and
//   the ledger is append-only, so a closed day's total cannot move afterwards.
// - **Room status is counted live**, because there is nothing frozen to read. A
//   housekeeping status is where a room stands now and never a fact about a
//   night that has ended; `schema/housekeeping.ts` says why a history of it does
//   not exist and should not.
//
// **A day the audit never closed contributes nothing, penalties included, and
// that is stronger than cutting at the last closed date.** The audit can leave a
// gap: `night-audit-watchdog.job.ts` exists precisely because a day can be
// refused and left outstanding while later days close over it. Cutting only at
// the maximum would put a hole day's penalties on the page with no room revenue
// beside them — a bucket reporting money on a day the property has not agreed
// on, which is the one thing the boundary rules out. So {@link bucketRevenue}
// joins the ledger onto the closed days rather than onto the range, and a
// penalty landing on an unclosed day waits for the day to be closed.
//
// ## Why the arithmetic is pure and the statements are not
//
// {@link bucketRevenue} and {@link tallyRoomStatus} take rows and return the
// report; they read nothing. That is the shape `rollUp` is in and the reason is
// the same — every case a range can be in is reachable from literals, so an
// empty range, a range whose days were never closed, a day of corrections and a
// quarter boundary are all tested without a database being arranged into them.
// Whether the statements below select the right rows is a question about a real
// Postgres and belongs to a storage test.

import {
  HOUSEKEEPING_STATUSES,
  type HousekeepingStatus,
  ROOM_TYPE_CODES,
  type RevenueBucket,
  type RoomTypeCode,
  type StayDate,
  type VndAmount,
} from "@mariva/shared";
import { Injectable } from "@nestjs/common";
import { and, asc, eq, gte, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DbExecutor } from "../../database/database.module.js";
import { folioPosting } from "../../database/schema/folio.js";
import { roomCondition } from "../../database/schema/housekeeping.js";
import { room, roomType } from "../../database/schema/inventory.js";
import { nightAuditSnapshot } from "../../database/schema/night-audit.js";

/** One trading day the night audit has closed, in the two figures it froze. */
export interface ClosedDay {
  /** `YYYY-MM-DD`, the snapshot's own key. */
  readonly businessDate: string;
  readonly roomRevenueVnd: VndAmount;
  readonly otherRevenueVnd: VndAmount;
}

/** What §4's charges came to on one trading day, from the ledger. */
export interface DayPenalty {
  readonly businessDate: string;
  readonly penaltyVnd: VndAmount;
}

/** One bucket of the revenue report — {@link revenueBucketRowSchema}'s shape as
 *  the service produces it. */
export interface RevenueBucketRow {
  readonly from: string;
  readonly to: string;
  readonly closedDays: number;
  readonly roomRevenueVnd: VndAmount;
  readonly otherRevenueVnd: VndAmount;
  readonly penaltyRevenueVnd: VndAmount;
  readonly totalVnd: VndAmount;
}

/** The same four columns over the whole range. */
export interface RevenueTotals {
  readonly closedDays: number;
  readonly roomRevenueVnd: VndAmount;
  readonly otherRevenueVnd: VndAmount;
  readonly penaltyRevenueVnd: VndAmount;
  readonly totalVnd: VndAmount;
}

/** The revenue page, assembled. */
export interface RevenueReport {
  readonly bucket: RevenueBucket;
  readonly lastClosedBusinessDate: string | null;
  readonly buckets: readonly RevenueBucketRow[];
  readonly totals: RevenueTotals;
}

/** Which trading days a revenue report is asked about, and how to cut them. */
export interface RevenueReportQuery {
  readonly bucket: RevenueBucket;
  readonly from?: StayDate;
  readonly to?: StayDate;
}

/** How many rooms of one type stand in one condition, as the count comes back. */
export interface RoomStanding {
  readonly roomType: RoomTypeCode;
  readonly status: HousekeepingStatus;
  readonly rooms: number;
}

/** How many rooms stand in one condition. */
export interface RoomStatusCount {
  readonly status: HousekeepingStatus;
  readonly rooms: number;
}

/** One type, and how its rooms are standing. */
export interface RoomStatusType {
  readonly roomType: RoomTypeCode;
  readonly rooms: number;
  readonly byStatus: readonly RoomStatusCount[];
}

/** The counted half of the room-status page. The stamp and the instant are added
 *  by the caller, which is the only part of that page that is not a count. */
export interface RoomStatusTally {
  readonly rooms: number;
  readonly byStatus: readonly RoomStatusCount[];
  readonly byType: readonly RoomStatusType[];
}

/** The room-status page, assembled. */
export interface RoomStatusReport extends RoomStatusTally {
  readonly takenAt: Date;
  readonly lastClosedBusinessDate: string | null;
}

@Injectable()
export class ReportQueries {
  /**
   * The revenue page — `FR-RPT-02`'s money half.
   *
   * Three statements and one boundary. The first asks which day the audit has
   * reached; the other two are both cut at it, and neither is issued at all when
   * the answer is that no day has been closed — an empty page is the honest
   * answer for a property whose first night audit has not run, and two queries
   * over a range that cannot contain anything are two round trips to be told so.
   *
   * The upper bound is `min(what was asked for, what has been closed)` rather
   * than a refusal, because a reader asking for "this month" on the fourteenth is
   * asking a sensible question about a month that is not over. The stamp on the
   * response is what tells them where the answer actually stops.
   *
   * Everything runs on the caller's executor and therefore inside the caller's
   * transaction, so the three statements see one snapshot of the database: a
   * night audit committing between them cannot produce a page whose penalties
   * reach a day whose revenue does not.
   */
  async revenue(
    exec: DbExecutor,
    query: RevenueReportQuery,
  ): Promise<RevenueReport> {
    const lastClosed = await this.lastClosedBusinessDate(exec);

    if (lastClosed === null) {
      return {
        bucket: query.bucket,
        lastClosedBusinessDate: null,
        buckets: [],
        totals: NOTHING_EARNED,
      };
    }

    const from = query.from?.toString();
    const to = earlierOf(query.to?.toString(), lastClosed);

    if (from !== undefined && from > to) {
      // The reader asked about days that begin after the audit has reached, which
      // is a well-formed question with an empty answer rather than a mistake. The
      // stamp still travels, because that is the fact they are missing.
      return {
        bucket: query.bucket,
        lastClosedBusinessDate: lastClosed,
        buckets: [],
        totals: NOTHING_EARNED,
      };
    }

    const closedDays = await this.closedDays(exec, from, to);
    const penalties = await this.penalties(exec, from, to);
    const buckets = bucketRevenue(closedDays, penalties, query.bucket);

    return {
      bucket: query.bucket,
      lastClosedBusinessDate: lastClosed,
      buckets,
      totals: totalOver(buckets),
    };
  }

  /**
   * The room-status page — `FR-RPT-02`'s operational half.
   *
   * The stamp is read even though nothing on this page came from a snapshot,
   * because it is the family's page furniture and `screens.md` puts it on every
   * report: the promise it makes is about the family, and a page missing it would
   * read as a page nobody had decided the boundary for.
   *
   * `takenAt` is this process's clock rather than the database's. It stamps a
   * *page* with the moment somebody looked, which is a fact about a person at a
   * desk — `excel-sheet.ts` draws the same distinction for the instant it puts at
   * the top of a file.
   */
  async roomStatus(exec: DbExecutor): Promise<RoomStatusReport> {
    const lastClosed = await this.lastClosedBusinessDate(exec);
    const standings = await this.roomStandings(exec);

    return {
      takenAt: new Date(),
      lastClosedBusinessDate: lastClosed,
      ...tallyRoomStatus(standings),
    };
  }

  /**
   * The last trading day the night audit has closed, or nothing.
   *
   * `max(business_date)` and not "yesterday": the audit can be behind, and a page
   * that assumed the day before the property's own would show a day nobody has
   * agreed on the moment a run is missed. It is also not the *count* of closed
   * days — a gap in the middle is left where it is, and {@link bucketRevenue}
   * refuses to invent the hole day rather than this reading being narrowed here.
   *
   * Null means the audit has never run, which is a real state — a property in its
   * first day of trading — and is carried to the page as null rather than as a
   * date nothing supports.
   */
  async lastClosedBusinessDate(exec: DbExecutor): Promise<string | null> {
    const [closed] = await exec
      .select({
        businessDate: sql<
          string | null
        >`max(${nightAuditSnapshot.businessDate})`,
      })
      .from(nightAuditSnapshot);

    return closed?.businessDate ?? null;
  }

  /**
   * Every closed day in the window, with what the audit froze it at.
   *
   * One row per day and no grouping: the bucketing is
   * {@link bucketRevenue}'s and doing it in SQL would put the same decision in
   * two places, where only one of them is reachable from a literal. The volume
   * this trades away is a row per trading day — a decade of a property's history
   * is under four thousand rows.
   *
   * Ordered so that the pure function is handed the days in the order it would
   * have to put them in anyway.
   */
  private async closedDays(
    exec: DbExecutor,
    from: string | undefined,
    to: string,
  ): Promise<readonly ClosedDay[]> {
    const window = [lte(nightAuditSnapshot.businessDate, to)];

    if (from !== undefined) {
      window.push(gte(nightAuditSnapshot.businessDate, from));
    }

    return await exec
      .select({
        businessDate: nightAuditSnapshot.businessDate,
        roomRevenueVnd: nightAuditSnapshot.netRoomRevenueVnd,
        otherRevenueVnd: nightAuditSnapshot.otherRevenueVnd,
      })
      .from(nightAuditSnapshot)
      .where(and(...window))
      .orderBy(asc(nightAuditSnapshot.businessDate));
  }

  /**
   * What §4's charges came to on each trading day in the window.
   *
   * **A reversal of a policy charge is a policy charge coming off**, and it is
   * resolved exactly as `night-audit.service.ts` resolves one: `REVERSAL` is
   * whatever it undoes, found through `reverses_posting_id`. Without that join a
   * penalty the property waived would stay on the report forever while the
   * guest's folio said otherwise. The reversed line may be dated to an earlier
   * day and the join is deliberately not narrowed by the window for that reason —
   * the credit belongs to the day it was taken, which is the day the ledger filed
   * it under.
   *
   * Summed per day in Postgres rather than row by row here, because unlike the
   * snapshots there is no bound on how many postings a day holds. The sum comes
   * back as text: Postgres widens `sum(bigint)` to `numeric` and the driver hands
   * a numeric over as a string, which is the one route back to `bigint` that
   * cannot lose a đồng — `cash-book.service.ts` reads its own totals the same
   * way and states the rule.
   *
   * The window's lower bound is the range's and its upper bound is the boundary,
   * but neither is what actually decides whether a day counts: a penalty on a day
   * the audit never closed is dropped by {@link bucketRevenue}, and it is dropped
   * there rather than joined away here so the rule is reachable from a literal.
   */
  private async penalties(
    exec: DbExecutor,
    from: string | undefined,
    to: string,
  ): Promise<readonly DayPenalty[]> {
    const reversed = alias(folioPosting, "reversed_posting");
    const window = [lte(folioPosting.businessDate, to)];

    if (from !== undefined) {
      window.push(gte(folioPosting.businessDate, from));
    }

    const days = await exec
      .select({
        businessDate: folioPosting.businessDate,
        penaltyVnd: sql<string>`sum(${folioPosting.amount})`,
      })
      .from(folioPosting)
      .leftJoin(reversed, eq(reversed.id, folioPosting.reversesPostingId))
      .where(
        and(
          or(
            eq(folioPosting.type, "POLICY_CHARGE"),
            and(
              eq(folioPosting.type, "REVERSAL"),
              eq(reversed.type, "POLICY_CHARGE"),
            ),
          ),
          ...window,
        ),
      )
      .groupBy(folioPosting.businessDate)
      .orderBy(asc(folioPosting.businessDate));

    return days.map((day) => ({
      businessDate: day.businessDate,
      penaltyVnd: BigInt(day.penaltyVnd),
    }));
  }

  /**
   * How the property's rooms are standing, right now.
   *
   * Driven from `room` and not from `room_condition`, so a room nobody has ever
   * recorded a condition for is still counted — `coalesce` to `CLEAN`, which is
   * `housekeeping.service.ts`'s default and its argument: a room the property has
   * never recorded a condition for has never been dirtied. Counting from the
   * condition table instead would quietly shorten the property by however many
   * rooms nobody has touched, on the one page whose job is to say how many rooms
   * there are and what state they are in.
   *
   * An inner join to the type for the reason the board gives: `room_type_id` is
   * not nullable, so a room with no type is not a room to be quiet about.
   */
  private async roomStandings(
    exec: DbExecutor,
  ): Promise<readonly RoomStanding[]> {
    const standing = sql<HousekeepingStatus>`coalesce(${roomCondition.status}, 'CLEAN')`;

    return await exec
      .select({
        roomType: roomType.code,
        status: standing,
        rooms: sql<number>`count(*)::int`,
      })
      .from(room)
      .innerJoin(roomType, eq(roomType.id, room.roomTypeId))
      .leftJoin(roomCondition, eq(roomCondition.roomId, room.id))
      .groupBy(roomType.code, standing);
  }
}

/** A range that reached no closed day. Every figure zero and the count zero,
 *  which is what an empty range came to rather than a value nobody computed. */
const NOTHING_EARNED: RevenueTotals = {
  closedDays: 0,
  roomRevenueVnd: 0n,
  otherRevenueVnd: 0n,
  penaltyRevenueVnd: 0n,
  totalVnd: 0n,
};

/**
 * Which bucket a trading day falls in — `FR-RPT-02`'s day, month and quarter.
 *
 * String keys and string arithmetic throughout, because a business date is ten
 * characters the database already agrees on and turning it into a `Date` to slice
 * a month out of it is the conversion that moves a night across a boundary.
 * `stay-date.ts` opens with that argument and this file honours it: nothing here
 * constructs a date, and the month and the year are read off the characters they
 * are written in.
 *
 * The quarter is `2026-Q3`, which sorts with its year and reads as itself. It is
 * a key rather than a label — what a bucket is *called* on screen is the
 * console's, and the API sends the days instead.
 */
export function bucketKeyOf(businessDate: string, bucket: RevenueBucket): string {
  if (bucket === "DAY") {
    return businessDate;
  }

  const year = businessDate.slice(0, 4);

  if (bucket === "MONTH") {
    return businessDate.slice(0, 7);
  }

  const month = Number(businessDate.slice(5, 7));

  return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
}

/**
 * The closed days and the ledger's penalties, as the buckets a page draws.
 *
 * **The closed days are what exists.** A bucket appears because a day in it was
 * closed, never because a penalty was posted in it, and a penalty on a day with
 * no snapshot is dropped — the header argues why that is stronger than cutting at
 * the last closed date, and it is the whole of what "no page shows a day the
 * audit has not closed" means when the two halves come from different tables.
 *
 * `from` and `to` are the first and last closed day *in* the bucket rather than
 * the bucket's calendar span, so a month the audit has only reached the twentieth
 * of says so. `closedDays` counts them, and is why a partial quarter cannot be
 * mistaken for a whole one.
 *
 * Signed throughout. A day whose room charges were reversed within it nets to
 * nothing and a day carrying a correction to an earlier night is genuinely
 * negative — `schema/night-audit.ts` stores the figure signed for exactly that
 * reason, and a report taking magnitudes would turn a month of corrections into a
 * good one.
 *
 * Chronological, because a chart is read left to right and the order is a promise
 * the console should not have to impose.
 */
export function bucketRevenue(
  closedDays: readonly ClosedDay[],
  penalties: readonly DayPenalty[],
  bucket: RevenueBucket,
): RevenueBucketRow[] {
  const buckets = new Map<
    string,
    {
      from: string;
      to: string;
      closedDays: number;
      roomRevenueVnd: VndAmount;
      otherRevenueVnd: VndAmount;
      penaltyRevenueVnd: VndAmount;
    }
  >();

  for (const day of closedDays) {
    const key = bucketKeyOf(day.businessDate, bucket);
    const held = buckets.get(key);

    if (held === undefined) {
      buckets.set(key, {
        from: day.businessDate,
        to: day.businessDate,
        closedDays: 1,
        roomRevenueVnd: day.roomRevenueVnd,
        otherRevenueVnd: day.otherRevenueVnd,
        penaltyRevenueVnd: 0n,
      });

      continue;
    }

    // The days are not assumed to arrive in order. The statement above orders
    // them and the test literals do not have to, which is the difference between
    // a function that is pure and one that is merely side-effect free.
    held.from = day.businessDate < held.from ? day.businessDate : held.from;
    held.to = day.businessDate > held.to ? day.businessDate : held.to;
    held.closedDays += 1;
    held.roomRevenueVnd += day.roomRevenueVnd;
    held.otherRevenueVnd += day.otherRevenueVnd;
  }

  const closed = new Set(closedDays.map((day) => day.businessDate));

  for (const penalty of penalties) {
    if (!closed.has(penalty.businessDate)) {
      continue;
    }

    // Unreachable when the day is closed: the loop above created a bucket for
    // every closed day, and both loops key the same way. Read rather than
    // asserted, because a `!` here would be a claim about that invariant that
    // nothing checks.
    const held = buckets.get(bucketKeyOf(penalty.businessDate, bucket));

    if (held !== undefined) {
      held.penaltyRevenueVnd += penalty.penaltyVnd;
    }
  }

  return [...buckets.values()]
    .map((held) => ({
      from: held.from,
      to: held.to,
      closedDays: held.closedDays,
      roomRevenueVnd: held.roomRevenueVnd,
      otherRevenueVnd: held.otherRevenueVnd,
      penaltyRevenueVnd: held.penaltyRevenueVnd,
      totalVnd:
        held.roomRevenueVnd + held.otherRevenueVnd + held.penaltyRevenueVnd,
    }))
    .sort((one, other) => one.from.localeCompare(other.from));
}

/**
 * What the buckets on the page came to.
 *
 * Added from the buckets rather than counted a second time over the days,
 * because the buckets partition the days — every closed day is in exactly one —
 * so the two cannot differ, and a second aggregate would be a second chance for
 * them to.
 */
export function totalOver(
  buckets: readonly RevenueBucketRow[],
): RevenueTotals {
  return buckets.reduce<RevenueTotals>(
    (running, held) => ({
      closedDays: running.closedDays + held.closedDays,
      roomRevenueVnd: running.roomRevenueVnd + held.roomRevenueVnd,
      otherRevenueVnd: running.otherRevenueVnd + held.otherRevenueVnd,
      penaltyRevenueVnd: running.penaltyRevenueVnd + held.penaltyRevenueVnd,
      totalVnd: running.totalVnd + held.totalVnd,
    }),
    NOTHING_EARNED,
  );
}

/**
 * The counted rooms, as the page reads them.
 *
 * **Every status appears on every row, zero included.** A grid with a missing
 * column reads as a column nobody measured; a type with no dirty room is a fact
 * worth showing. The statuses come from `HOUSEKEEPING_STATUSES` in the tuple's
 * own order, so a fifth condition added to the contract appears here without this
 * function being touched.
 *
 * The types are in `ROOM_TYPE_CODES` order, which is the property's own ladder
 * from `SUPERIOR` up rather than the alphabet — a manager reading down the page
 * is reading the room mix. A type with no rooms at all is absent, because the
 * count is over rooms and a type nobody has built is not a row of zeroes so much
 * as a type the property does not operate.
 *
 * The property-wide figures are summed over the same rows the per-type ones are,
 * so the page cannot show a total its own rows disagree with.
 */
export function tallyRoomStatus(
  standings: readonly RoomStanding[],
): RoomStatusTally {
  const byType = new Map<RoomTypeCode, Map<HousekeepingStatus, number>>();
  const propertyWide = new Map<HousekeepingStatus, number>();

  for (const standing of standings) {
    const type =
      byType.get(standing.roomType) ?? new Map<HousekeepingStatus, number>();

    byType.set(standing.roomType, type);
    type.set(standing.status, (type.get(standing.status) ?? 0) + standing.rooms);
    propertyWide.set(
      standing.status,
      (propertyWide.get(standing.status) ?? 0) + standing.rooms,
    );
  }

  const byStatus = countsOf(propertyWide);

  return {
    rooms: byStatus.reduce((sum, count) => sum + count.rooms, 0),
    byStatus,
    byType: ROOM_TYPE_CODES.filter((code) => byType.has(code)).map((code) => {
      const counts = countsOf(byType.get(code) ?? new Map());

      return {
        roomType: code,
        rooms: counts.reduce((sum, count) => sum + count.rooms, 0),
        byStatus: counts,
      };
    }),
  };
}

/** One tally as the four counts a row carries, in the contract's own order. */
function countsOf(
  counted: ReadonlyMap<HousekeepingStatus, number>,
): RoomStatusCount[] {
  return HOUSEKEEPING_STATUSES.map((status) => ({
    status,
    rooms: counted.get(status) ?? 0,
  }));
}

/** The earlier of what was asked for and what has been closed. Ten characters
 *  compared as ten characters — ISO dates order lexicographically, which is the
 *  property `stay-date.ts` relies on everywhere else in this tree.
 *
 *  Exported for `performance-queries.service.ts`, which narrows its own range at
 *  the same boundary. A second copy of two comparisons is how the revenue page
 *  and the performance page would come to stop at different days. */
export function earlierOf(asked: string | undefined, closed: string): string {
  return asked !== undefined && asked < closed ? asked : closed;
}
