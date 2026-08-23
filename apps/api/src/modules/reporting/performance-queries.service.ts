// What the performance page is read from — `FR-RPT-03`, occupancy, ADR and
// RevPAR over a stretch of closed trading days.
//
// **A file of its own rather than a third read on `ReportQueries`.** That
// service owns `FR-RPT-02` and is already long enough that a reader looking for
// the penalty predicate has to scroll past two pages of room counting; a third
// public read bolted onto it would make one file two features and one header
// argue two boundaries. What is *not* duplicated is the part the two pages must
// agree about, and there are exactly two such parts: `bucketKeyOf` cuts a
// business date into a day, a month or a quarter, and
// `ReportQueries.lastClosedBusinessDate` says how far the audit has got. Both
// are imported from `report-queries.service.ts` and neither is re-derived here.
// Two implementations of `max(business_date)` would let the revenue page and
// this one disagree about what day it is, on two pages a manager reads in the
// same sitting.
//
// **This file only reads.** `night-audit.service.ts` is the folder's one writer
// and a snapshot is immutable in Postgres — the `BEFORE UPDATE OR DELETE`
// trigger raises `MV008` — so nothing here composes a write, and in particular
// nothing here writes a ratio back. `schema/night-audit.ts` argues that at
// length: a stored ADR cannot be re-totalled across a range, a month or the five
// types, which is every question the range picker asks. The three countable
// facts are frozen and the three ratios are computed by whoever asks, which is
// this file.
//
// ## The rule that decides everything below: a ratio is never averaged
//
// A month's ADR is Σ`net_room_revenue_vnd` / Σ`rooms_sold` over the month's
// closed days, never the mean of thirty daily ADRs. The two differ whenever the
// nights differ in size, which is always, and the mean silently weights a quiet
// Tuesday equally with a full Saturday. So {@link bucketPerformance} sums the
// *counts* and divides once, at the end, and {@link totalPerformanceOver} does
// the same thing again over the buckets — the counts are additive and the ratios
// are not, so the additive things are what travel and the ratio is recomputed at
// each level it is asked for. `performance-queries.service.spec.ts` holds a case
// whose two readings differ by a wide margin, because this is the one rule an
// implementation can get wrong while looking entirely right.
//
// **The property row is counted over the property snapshot's own columns.** It
// is not assembled by summing the five type rows. `schema/night-audit.ts` notes
// the parent's counts already agree with the children by construction, so
// recomputing the parent from the children would be a second answer to a
// question the database has already answered — and the first time the two
// disagreed, the page would be showing the wrong one with nothing to say which.
//
// ## Where the boundary is, and what a bucket is
//
// The same place as `FR-RPT-02`'s, because it is the family's rather than either
// page's: `docs/screens.md` stamps every report with the last business date the
// night audit closed, and what the stamp promises is that no page shows a day
// the audit has not closed. A bucket exists because a day in it was *closed*;
// `from` and `to` are the first and last closed day *in* the bucket rather than
// its calendar span, and `closedDays` counts them and is never zero. That
// matters more here than on the revenue page: a ratio computed over two thirds
// of a month is a perfectly plausible-looking number that nothing on a chart
// would flag, where two thirds of a month's takings at least look small.
//
// ## Why the arithmetic is pure and the statements are not
//
// {@link bucketPerformance} and {@link totalPerformanceOver} take rows and
// return the report; they read nothing. Every case a range can be in is
// reachable from literals — an empty denominator in either direction, a night
// sold above what was sellable, a day of corrections, a quarter with a boundary
// running through it — so none of them needs a database arranged into it.
// Whether the two statements below select the right rows is a question about a
// real Postgres and belongs to `test/performance-queries-storage.e2e-spec.ts`.

import {
  ROOM_TYPE_CODES,
  type RevenueBucket,
  type RoomTypeCode,
  type StayDate,
  type VndAmount,
} from "@mariva/shared";
import { Injectable } from "@nestjs/common";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import type { DbExecutor } from "../../database/database.module.js";
import { roomType } from "../../database/schema/inventory.js";
import {
  nightAuditSnapshot,
  nightAuditSnapshotType,
} from "../../database/schema/night-audit.js";
import {
  bucketKeyOf,
  earlierOf,
  ReportQueries,
} from "./report-queries.service.js";

/** The three countable facts one closed trading day froze, property-wide. */
export interface PerformanceDay {
  /** `YYYY-MM-DD`, the snapshot's own key. */
  readonly businessDate: string;
  readonly sellableRooms: number;
  readonly roomsSold: number;
  readonly netRoomRevenueVnd: VndAmount;
}

/** The same three, for one room type on one closed day. */
export interface PerformanceTypeDay extends PerformanceDay {
  readonly roomType: RoomTypeCode;
}

/** The six figures a row carries — three counts and the three ratios they are
 *  divisions of. Every ratio is nullable and null means the denominator was
 *  zero, which is a real answer rather than a missing one. */
export interface PerformanceFigures {
  readonly sellableRooms: number;
  readonly roomsSold: number;
  readonly netRoomRevenueVnd: VndAmount;
  readonly occupancy: number | null;
  readonly adrVnd: VndAmount | null;
  readonly revparVnd: VndAmount | null;
}

/** One room type's six figures, by code. */
export interface PerformanceTypeRow extends PerformanceFigures {
  readonly roomType: RoomTypeCode;
}

/** One bucket of the performance report. */
export interface PerformanceBucketRow {
  readonly from: string;
  readonly to: string;
  readonly closedDays: number;
  readonly property: PerformanceFigures;
  readonly byType: readonly PerformanceTypeRow[];
}

/** The same figures over the whole range. `closedDays` may be zero here, unlike
 *  on a bucket: a range reaching only into days the audit has not closed has no
 *  buckets to hold. */
export interface PerformanceTotals {
  readonly closedDays: number;
  readonly property: PerformanceFigures;
  readonly byType: readonly PerformanceTypeRow[];
}

/** The performance page, assembled. */
export interface PerformanceReport {
  readonly bucket: RevenueBucket;
  readonly lastClosedBusinessDate: string | null;
  readonly buckets: readonly PerformanceBucketRow[];
  readonly totals: PerformanceTotals;
}

/** Which trading days a performance report is asked about, and how to cut them.
 *  Field for field `FR-RPT-02`'s, because the two pages take one range picker's
 *  worth of controls. */
export interface PerformanceReportQuery {
  readonly bucket: RevenueBucket;
  readonly from?: StayDate;
  readonly to?: StayDate;
}

@Injectable()
export class PerformanceQueries {
  /**
   * `ReportQueries` is injected for one method and that is the point of
   * injecting it rather than reaching for the table directly: the boundary every
   * report page is stamped with is one statement in one place, so the revenue
   * page and this one cannot disagree about how far the audit has got.
   */
  constructor(private readonly reports: ReportQueries) {}

  /**
   * The performance page — `FR-RPT-03`.
   *
   * Three statements and one boundary, arranged exactly as
   * `ReportQueries.revenue` arranges its own. The first asks which day the audit
   * has reached; the other two are both cut at it, and neither is issued at all
   * when the answer is that no day has been closed — an empty page is the honest
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
   * night audit committing between them cannot produce a page whose per-type rows
   * reach a day whose property row does not.
   */
  async performance(
    exec: DbExecutor,
    query: PerformanceReportQuery,
  ): Promise<PerformanceReport> {
    const lastClosed = await this.reports.lastClosedBusinessDate(exec);

    if (lastClosed === null) {
      return {
        bucket: query.bucket,
        lastClosedBusinessDate: null,
        buckets: [],
        totals: NOTHING_MEASURED,
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
        totals: NOTHING_MEASURED,
      };
    }

    const days = await this.closedDays(exec, from, to);
    const typeDays = await this.closedTypeDays(exec, from, to);
    const buckets = bucketPerformance(days, typeDays, query.bucket);

    return {
      bucket: query.bucket,
      lastClosedBusinessDate: lastClosed,
      buckets,
      totals: totalPerformanceOver(buckets),
    };
  }

  /**
   * Every closed day in the window, in the three counts the audit froze it at.
   *
   * A statement of its own rather than `ReportQueries.closedDays` widened:
   * that one selects the two revenue columns the money page adds up and never
   * touches `sellable_rooms` or `rooms_sold`, and widening it would put three
   * columns on the revenue page's wire that nothing there reads.
   *
   * One row per day and no grouping, for the reason the revenue page gives: the
   * bucketing is {@link bucketPerformance}'s and doing it in SQL would put the
   * same decision in two places, where only one of them is reachable from a
   * literal. The volume this trades away is a row per trading day — a decade of
   * a property's history is under four thousand rows.
   *
   * Ordered so that the pure function is handed the days in the order it would
   * have to put them in anyway.
   */
  private async closedDays(
    exec: DbExecutor,
    from: string | undefined,
    to: string,
  ): Promise<readonly PerformanceDay[]> {
    const window = [lte(nightAuditSnapshot.businessDate, to)];

    if (from !== undefined) {
      window.push(gte(nightAuditSnapshot.businessDate, from));
    }

    return await exec
      .select({
        businessDate: nightAuditSnapshot.businessDate,
        sellableRooms: nightAuditSnapshot.sellableRooms,
        roomsSold: nightAuditSnapshot.roomsSold,
        netRoomRevenueVnd: nightAuditSnapshot.netRoomRevenueVnd,
      })
      .from(nightAuditSnapshot)
      .where(and(...window))
      .orderBy(asc(nightAuditSnapshot.businessDate));
  }

  /**
   * The same window, per room type — `night_audit_snapshot_type`, which
   * `schema/night-audit.ts` calls "the rows `FR-RPT-03` is read from".
   *
   * **Joined to `room_type` for the code and not for anything else.** The
   * snapshot stores the type by id on purpose — a code copied in as text would
   * survive a rename and show one type twice — and the contract carries the code,
   * because a report is read by a person and the five codes are what every other
   * shape in `rate-calendar.ts` already puts on the wire. So the join is where
   * those two decisions meet. It is an inner join because `room_type_id` is not
   * nullable and references the table: a row with no type is not a row to be
   * quiet about.
   *
   * Cut at the same window as the property rows above, so the two halves of one
   * bucket are over the same days by construction rather than by care.
   */
  private async closedTypeDays(
    exec: DbExecutor,
    from: string | undefined,
    to: string,
  ): Promise<readonly PerformanceTypeDay[]> {
    const window = [lte(nightAuditSnapshotType.businessDate, to)];

    if (from !== undefined) {
      window.push(gte(nightAuditSnapshotType.businessDate, from));
    }

    return await exec
      .select({
        businessDate: nightAuditSnapshotType.businessDate,
        roomType: roomType.code,
        sellableRooms: nightAuditSnapshotType.sellableRooms,
        roomsSold: nightAuditSnapshotType.roomsSold,
        netRoomRevenueVnd: nightAuditSnapshotType.netRoomRevenueVnd,
      })
      .from(nightAuditSnapshotType)
      .innerJoin(roomType, eq(roomType.id, nightAuditSnapshotType.roomTypeId))
      .where(and(...window))
      .orderBy(
        asc(nightAuditSnapshotType.businessDate),
        asc(roomType.code),
      );
  }
}

/** The three counts as they accumulate, before anything is divided. Ratios are
 *  absent here deliberately: a running ratio is a ratio being averaged. */
interface RunningCounts {
  sellableRooms: number;
  roomsSold: number;
  netRoomRevenueVnd: VndAmount;
}

/** A range that reached no closed day. The counts are zero because that is what
 *  an empty range came to; the ratios are null because zero rooms over zero
 *  rooms is not 0% occupancy, it is a question with no answer.
 *
 *  `byType` is empty rather than five all-null rows. A type with no frozen row
 *  has no measured fact behind it, and emitting a row for it would assert a
 *  measurement nobody made — which on this page is the difference between "the
 *  audit has not run" and "the suites sold nothing". */
const NOTHING_MEASURED: PerformanceTotals = {
  closedDays: 0,
  property: figuresOf({
    sellableRooms: 0,
    roomsSold: 0,
    netRoomRevenueVnd: 0n,
  }),
  byType: [],
};

/**
 * The closed days and their per-type rows, as the buckets a page draws.
 *
 * **The counts are summed and the ratios are taken once, at the end.** That is
 * the never-average rule made structural rather than remembered: nothing in the
 * accumulator below is a ratio, so there is no ratio available to average even
 * by mistake. {@link figuresOf} is the only place in this file that divides.
 *
 * **The property row and the per-type rows are counted independently.** The
 * property figures come from `night_audit_snapshot`'s own columns and the type
 * figures from `night_audit_snapshot_type`'s, over the same days — never one
 * assembled from the other, for the reason the header gives.
 *
 * **Which types appear.** Only those with at least one snapshot row in the
 * bucket. A type the audit froze no row for in those days has no measured fact,
 * and an all-null row for it would look like a measurement rather than an
 * absence. The ones that do appear come out in `ROOM_TYPE_CODES` order, which is
 * the property's own ladder from `SUPERIOR` up rather than the alphabet —
 * `tallyRoomStatus` orders its types the same way and for the same reason, and
 * an order the API fixes is one two identical requests cannot answer differently
 * and the console does not have to impose.
 *
 * A type row on a day with no property snapshot is impossible: the child
 * references the parent's primary key. Nothing here guards against it, because a
 * guard against a foreign key is a guard nothing can reach.
 *
 * Chronological, because a chart is read left to right and the order is a promise
 * the console should not have to impose.
 */
export function bucketPerformance(
  days: readonly PerformanceDay[],
  typeDays: readonly PerformanceTypeDay[],
  bucket: RevenueBucket,
): PerformanceBucketRow[] {
  const buckets = new Map<
    string,
    {
      from: string;
      to: string;
      closedDays: number;
      property: RunningCounts;
      byType: Map<RoomTypeCode, RunningCounts>;
    }
  >();

  for (const day of days) {
    const key = bucketKeyOf(day.businessDate, bucket);
    const held = buckets.get(key);

    if (held === undefined) {
      buckets.set(key, {
        from: day.businessDate,
        to: day.businessDate,
        closedDays: 1,
        property: {
          sellableRooms: day.sellableRooms,
          roomsSold: day.roomsSold,
          netRoomRevenueVnd: day.netRoomRevenueVnd,
        },
        byType: new Map(),
      });

      continue;
    }

    // The days are not assumed to arrive in order. The statement above orders
    // them and the test literals do not have to, which is the difference between
    // a function that is pure and one that is merely side-effect free.
    held.from = day.businessDate < held.from ? day.businessDate : held.from;
    held.to = day.businessDate > held.to ? day.businessDate : held.to;
    held.closedDays += 1;
    addInto(held.property, day);
  }

  for (const typeDay of typeDays) {
    // A type row whose day is not in `days` is dropped rather than creating a
    // bucket, because a bucket exists when a day was *closed* — and the closed
    // days are what the property snapshot holds. This is unreachable through the
    // statements above, which cut both tables at one window, and is the same
    // shape of refusal `bucketRevenue` makes for a penalty on an unclosed day.
    const held = buckets.get(bucketKeyOf(typeDay.businessDate, bucket));

    if (held === undefined) {
      continue;
    }

    const running = held.byType.get(typeDay.roomType) ?? {
      sellableRooms: 0,
      roomsSold: 0,
      netRoomRevenueVnd: 0n,
    };

    held.byType.set(typeDay.roomType, running);
    addInto(running, typeDay);
  }

  return [...buckets.values()]
    .map((held) => ({
      from: held.from,
      to: held.to,
      closedDays: held.closedDays,
      property: figuresOf(held.property),
      byType: typeRowsOf(held.byType),
    }))
    .sort((one, other) => one.from.localeCompare(other.from));
}

/**
 * What the buckets on the page came to.
 *
 * **The counts are added from the buckets and the ratios are taken again, from
 * scratch.** Adding the counts is safe for the reason `totalOver` gives: the
 * buckets partition the closed days — every one is in exactly one — so a second
 * aggregate over the days could only be a second chance to differ. Dividing
 * again rather than combining the buckets' ratios is the never-average rule at
 * the level it is easiest to break, since a range total is exactly where
 * somebody would reach for a mean of twelve months.
 *
 * A type appears in the totals when it appeared in any bucket, and in the same
 * ladder order.
 */
export function totalPerformanceOver(
  buckets: readonly PerformanceBucketRow[],
): PerformanceTotals {
  const property: RunningCounts = {
    sellableRooms: 0,
    roomsSold: 0,
    netRoomRevenueVnd: 0n,
  };
  const byType = new Map<RoomTypeCode, RunningCounts>();
  let closedDays = 0;

  for (const held of buckets) {
    closedDays += held.closedDays;
    addInto(property, held.property);

    for (const type of held.byType) {
      const running = byType.get(type.roomType) ?? {
        sellableRooms: 0,
        roomsSold: 0,
        netRoomRevenueVnd: 0n,
      };

      byType.set(type.roomType, running);
      addInto(running, type);
    }
  }

  return {
    closedDays,
    property: figuresOf(property),
    byType: typeRowsOf(byType),
  };
}

/** One more day, or one more bucket, onto a running set of counts. */
function addInto(running: RunningCounts, counts: RunningCounts): void {
  running.sellableRooms += counts.sellableRooms;
  running.roomsSold += counts.roomsSold;
  running.netRoomRevenueVnd += counts.netRoomRevenueVnd;
}

/** The accumulated types as the rows a page carries, in the property's ladder
 *  order and holding only the types something was frozen for. */
function typeRowsOf(
  byType: ReadonlyMap<RoomTypeCode, RunningCounts>,
): PerformanceTypeRow[] {
  return ROOM_TYPE_CODES.filter((code) => byType.has(code)).map((code) => ({
    roomType: code,
    // Present by construction — the filter above is what asked.
    ...figuresOf(
      byType.get(code) ?? {
        sellableRooms: 0,
        roomsSold: 0,
        netRoomRevenueVnd: 0n,
      },
    ),
  }));
}

/**
 * The three summed counts, and the three ratios they are divisions of.
 *
 * **The one place this file divides**, which is what keeps the never-average
 * rule structural: every level of the report reaches its ratios through here,
 * over counts that were summed rather than over ratios that were combined.
 *
 *     occupancy = roomsSold / sellableRooms
 *     adrVnd    = netRoomRevenueVnd / roomsSold
 *     revparVnd = netRoomRevenueVnd / sellableRooms
 *
 * **A null is a zero denominator and is a real answer.** `sellableRooms === 0`
 * is a property that had nothing on sale — not an empty house — so `occupancy`
 * and `revparVnd`, which share that denominator, are null. `roomsSold === 0` is
 * an empty night, which has no rate at all: a `0` there would read as "the rooms
 * sold for nothing" and drag down every axis and comparison drawn against it.
 * The two counts already state the fact exactly; the ratio's job is to say when
 * it has no answer.
 *
 * **Nothing is clamped in either direction.** Occupancy above 1 is a true
 * reading — `schema/night-audit.ts` carries no `rooms_sold <= sellable_rooms`
 * check on purpose, because a closure withdrawing a room after the night was
 * sold leaves a day genuinely sold above what was sellable. And revenue is
 * signed, so a range carrying corrections to earlier nights has a genuinely
 * negative ADR and RevPAR. A report taking magnitudes would turn a month of
 * corrections into a good one.
 */
function figuresOf(counts: RunningCounts): PerformanceFigures {
  const sellable = counts.sellableRooms;
  const sold = counts.roomsSold;
  const revenue = counts.netRoomRevenueVnd;

  return {
    sellableRooms: sellable,
    roomsSold: sold,
    netRoomRevenueVnd: revenue,
    occupancy: sellable === 0 ? null : sold / sellable,
    adrVnd: dongPerRoom(revenue, sold),
    revparVnd: dongPerRoom(revenue, sellable),
  };
}

/**
 * Đồng over a count of rooms, to the nearest whole đồng — or null when there
 * are no rooms to divide by.
 *
 * `NFR-12` makes every amount a `bigint` count of đồng and `money.ts` says why:
 * đồng is the smallest unit the currency has, so rounding to it loses nothing a
 * reader could spend, and a float here would be the one place in the tree an
 * amount stopped being exact.
 *
 * **Half away from zero, in both directions**, which is the tie rule
 * `roundVndForDisplay` already states for the thousand-đồng step and states its
 * reason for: a reversing entry is negative, and truncating toward zero would
 * round a refund and its charge differently — so a month of corrections would
 * not be the mirror of the month it corrected. That helper is not reused because
 * it rounds to 1,000 đồng for display and is documented as never being summed or
 * persisted, where this is the figure the page carries; and
 * `folio/tax-decomposition.ts` truncates deliberately, because its three lines
 * must sum to the figure the guest agreed to. Neither rule fits a quotient that
 * is nobody's residual, so the rule is stated here.
 *
 * The denominator is a room count and is non-negative — both snapshot tables
 * carry a check constraint refusing otherwise — so the sign of the answer is the
 * revenue's alone.
 */
function dongPerRoom(revenue: VndAmount, rooms: number): VndAmount | null {
  if (rooms === 0) {
    return null;
  }

  const denominator = BigInt(rooms);
  const sign = revenue < 0n ? -1n : 1n;
  const magnitude = revenue * sign;

  // `(2|x| + d) / 2d` in integer arithmetic is |x|/d rounded half up, and the
  // sign is put back afterwards so the negative case is the positive one
  // mirrored rather than a second rule.
  return sign * ((magnitude * 2n + denominator) / (denominator * 2n));
}
