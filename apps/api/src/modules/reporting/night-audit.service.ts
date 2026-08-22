// What a closed day amounted to, assembled once and frozen — `FR-RPT-01`.
//
// The sweep beside this file decides *which* day and guarantees the night's rent
// is on the accounts first; this decides what the day was worth. They are two
// files because they answer to different things: which day is closed is a
// question about the property's clock and the runner's transaction, and what a
// day came to is arithmetic over the ledger that a test can reach from literals.
//
// ## The figures are read back, never recomputed
//
// `FR-FOL-02` posts a sale as three lines — the net charge, the service charge
// and the VAT — and `tax-decomposition.ts` makes them sum to the gross figure
// the guest agreed to by construction rather than by an adjustment. So net room
// revenue is `sum(amount)` over the `ROOM_CHARGE` lines and nothing here divides
// by a rate: a snapshot that re-derived the net from a gross total would apply
// today's rates to last night's money, and §8 is a list of the ways that goes
// wrong. `FR-GST-04`'s exclusion of VAT and service charge is therefore
// satisfied by reading the right column rather than by subtracting anything.
//
// ## A correction is a fact about the day it was made on
//
// `folio.service.ts` dates a reversal to the caller's business date and not to
// the line it undoes, because "a correction is an act of the day it was made,
// and dating it back would move a figure inside a trading day the property has
// already reconciled". This file is the reader that makes that decision pay:
// every posting is taken at its own business date, so a room charge reversed
// three days later leaves the night it was posted on exactly as it was frozen
// and lands as a credit on the day somebody actually made the correction. A day
// can therefore hold negative room revenue, which is what a day of corrections
// genuinely is.
//
// A reversal is classified by the line it undoes rather than by its own type,
// because `REVERSAL` says only that something was corrected. Undoing a room
// charge is room revenue coming off; undoing the VAT beside it is not revenue at
// all, and a snapshot that summed reversals as one kind would subtract the tax
// from the property's own takings.
//
// ## Rooms sold is counted from the ledger and not from the counter
//
// `type_inventory.sold_rooms` is the obvious source and is the wrong one. It is
// the availability counter — it moves when a booking is taken and moves back
// when one is cancelled or released as a no-show — so it answers "how many of
// this type were spoken for on that date", which is not the same set as the
// rooms that were slept in and charged for. ADR is net room revenue over rooms
// sold, and a numerator drawn from the ledger against a denominator drawn from
// the counter is a rate over two different populations: a night with three
// no-shows released after the audit ran would quietly move every ADR the
// property ever reported for it.
//
// So a room is sold if the night audit's own room charge for it stands. A charge
// reversed within the same day is a night the property has agreed did not
// happen, and it counts in neither the revenue nor the rooms — `folio.service.ts`
// reads a reversed room charge the same way when it counts nights spent for §4.
// A charge reversed *later* was standing when the day closed, which is what the
// frozen row says and what it will go on saying.

import type { StayDate, VndAmount } from "@mariva/shared";
import { Injectable } from "@nestjs/common";
import { and, eq, gt, inArray, isNull, lte, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DbExecutor } from "../../database/database.module.js";
import { booking } from "../../database/schema/booking.js";
import {
  folio,
  folioPosting,
  type POSTING_TYPES,
} from "../../database/schema/folio.js";
import { typeInventory } from "../../database/schema/inventory.js";
import {
  nightAuditSnapshot,
  nightAuditSnapshotType,
} from "../../database/schema/night-audit.js";

/** What a folio line says it is. */
type PostingType = (typeof POSTING_TYPES)[number];

/**
 * One folio line of the day being closed, with the line it undoes named.
 *
 * `reversedType` is null on everything that is not a `REVERSAL`, and on a
 * reversal it is what the undone line was — which is the only thing that says
 * whether the correction is coming off the rent, off a service item or off a
 * tax line that was never revenue.
 */
export interface AuditedPosting {
  readonly postingId: string;
  readonly bookingId: string;
  readonly roomTypeId: string;
  readonly amount: VndAmount;
  readonly type: PostingType;
  readonly reversesPostingId: string | null;
  readonly reversedType: PostingType | null;
}

/** How many of a type the property could have sold that night — `FR-INV-04`. */
export interface SellableRooms {
  readonly roomTypeId: string;
  readonly sellableRooms: number;
}

/** One room type's share of a closed day. */
export interface FrozenType {
  readonly roomTypeId: string;
  readonly sellableRooms: number;
  readonly roomsSold: number;
  readonly netRoomRevenueVnd: VndAmount;
}

/**
 * A closed day, in the figures the snapshot holds.
 *
 * The property-wide counts are the sum of the per-type ones by construction
 * rather than by a second query, so a report that adds the five types up cannot
 * arrive somewhere the parent row disagrees with.
 */
export interface FrozenDay {
  readonly sellableRooms: number;
  readonly roomsSold: number;
  readonly netRoomRevenueVnd: VndAmount;
  readonly otherRevenueVnd: VndAmount;
  readonly byType: readonly FrozenType[];
}

/**
 * What each posting type contributes to a day.
 *
 * Two members, and everything else is revenue nowhere. `PAYMENT` and `REFUND`
 * are money moving rather than money earned; `SERVICE_CHARGE_FEE` and `VAT` are
 * the two derived lines `FR-GST-04` excludes; and `REVERSAL` is absent because a
 * reversal is whatever it undoes, which is resolved before this map is
 * consulted.
 *
 * **`POLICY_CHARGE` is absent, and it is the one omission worth arguing.** A
 * cell of §4's grid is not a sale. The property let a room it did not sell and
 * served nothing; what it keeps is money a booking forfeited by not happening,
 * and §5 now records the owner's decision that the line carries no VAT and no
 * service charge because there is no supply under it. Counting it as takings
 * would put revenue on a day the hotel did no business — a night of mass
 * cancellations would report as a good one, which is the exact reading a KPI
 * page exists to prevent. It stays on the folio, because the guest's account has
 * to say what §4 came to; it is simply not what a room-nights report is
 * measuring.
 *
 * A reversal of one falls out of that rather than needing a rule of its own:
 * `REVERSAL` resolves to the type it undoes, `POLICY_CHARGE` is not in this map,
 * and so the correction is as absent from the snapshot as the charge was. That
 * is the only consistent answer available — a credit counted where the charge
 * never was would take a day's revenue below what the property actually earned.
 */
const REVENUE_OF: Partial<Record<PostingType, "ROOM" | "OTHER">> = {
  ROOM_CHARGE: "ROOM",
  SERVICE_ITEM: "OTHER",
};

@Injectable()
export class NightAuditService {
  /**
   * Closes one business date, and says whether this call is what closed it.
   *
   * `false` means the day already had a snapshot, which is the answer a second
   * pass over the same transaction gets and the whole of what makes the sweep
   * above idempotent. It is decided by the insert rather than by a look taken
   * first: between a read and a write there is nothing holding the key, and the
   * two runs that can be inside that window — the cron's, and a manager
   * re-running a night by hand — are exactly the pair that would freeze one day
   * twice.
   *
   * Everything is written on the caller's executor and inside the caller's
   * transaction, so a failure between the parent row and its types leaves
   * neither and the date is still outstanding for the next tick.
   */
  async freeze(exec: DbExecutor, businessDate: StayDate): Promise<boolean> {
    const day = rollUp(
      await this.postings(exec, businessDate),
      await this.sellable(exec, businessDate),
    );

    const [frozen] = await exec
      .insert(nightAuditSnapshot)
      .values({
        businessDate: businessDate.toString(),
        sellableRooms: day.sellableRooms,
        roomsSold: day.roomsSold,
        netRoomRevenueVnd: day.netRoomRevenueVnd,
        otherRevenueVnd: day.otherRevenueVnd,
      })
      .onConflictDoNothing()
      .returning({ businessDate: nightAuditSnapshot.businessDate });

    if (!frozen) {
      return false;
    }

    if (day.byType.length > 0) {
      await exec.insert(nightAuditSnapshotType).values(
        day.byType.map((type) => ({
          businessDate: businessDate.toString(),
          roomTypeId: type.roomTypeId,
          sellableRooms: type.sellableRooms,
          roomsSold: type.roomsSold,
          netRoomRevenueVnd: type.netRoomRevenueVnd,
        })),
      );
    }

    return true;
  }

  /**
   * The stays that occupied this date and carry no room charge for it.
   *
   * A day is frozen forever, so a day frozen while a night is missing from it is
   * a room revenue figure that is wrong for good — `schema/night-audit.ts` says
   * why nothing rewrites one. This is the question the sweep asks before it
   * freezes, and an answer of anything but nothing is what stops it.
   *
   * The predicate is `room-charge-sweep.ts`'s own, with the state widened. That
   * sweep charges `CHECKED_IN` stays, and the reason this reaches `CHECKED_OUT`
   * as well is the whole of the case: a day closed late — the look-back picking
   * up a night the property was down for — has stays that occupied it and have
   * since departed, and they are precisely the ones no run will ever charge.
   *
   * The `not exists` is unchanged down to the `posted_by is null`, which is to
   * say it asks for the line the sweep itself would have written. A reversed
   * charge therefore answers it and is not reported as missing — `FR-FOL-01`
   * leaves the mistake standing, and the night was charged. A room charge
   * somebody keyed at the desk does not answer it, because `posted_by` carries
   * the member of staff: the narrowing exists on the sweep's side so that a
   * desk-posted late checkout cannot suppress the night's rent, and it is kept
   * here so that both ask the same question. The consequence is that such a day
   * is refused rather than frozen short, and `night-audit-watchdog.job.ts` is
   * what stops the refusal going quiet once this sweep's look-back has passed
   * the date by.
   *
   * `HELD`, `CONFIRMED`, `CANCELLED` and `NO_SHOW` are outside it because none
   * of them slept in a room: an arrival that never arrived owes §4's no-show
   * charge rather than a night's rent, which is a different line on a different
   * requirement.
   */
  async unchargedStays(
    exec: DbExecutor,
    businessDate: StayDate,
  ): Promise<readonly string[]> {
    const night = businessDate.toString();

    const stays = await exec
      .select({ id: booking.id })
      .from(booking)
      .where(
        and(
          inArray(booking.state, ["CHECKED_IN", "CHECKED_OUT"]),
          lte(booking.checkInDate, night),
          gt(booking.checkOutDate, night),
          notExists(
            exec
              .select({ charged: sql`1` })
              .from(folioPosting)
              .innerJoin(folio, eq(folio.id, folioPosting.folioId))
              .where(
                and(
                  eq(folio.bookingId, booking.id),
                  eq(folioPosting.type, "ROOM_CHARGE"),
                  eq(folioPosting.businessDate, night),
                  isNull(folioPosting.postedBy),
                ),
              ),
          ),
        ),
      )
      .orderBy(booking.id);

    return stays.map((stay) => stay.id);
  }

  /**
   * Every folio line dated to this business date, with its stay's room type.
   *
   * Unfiltered by type on purpose. Which lines are revenue is one decision and
   * it is made in {@link rollUp}, where it can be read against the day it
   * produces; a `where type in (…)` here would be the same decision written a
   * second time, and the two would agree until somebody added a posting type.
   *
   * The join reaches the room type through the stay, because a folio line names
   * an account and an account names a booking. That is also the only place the
   * type could come from: a posting has no room type of its own, and a night is
   * sold as a type rather than as the room it is eventually assigned.
   */
  private async postings(
    exec: DbExecutor,
    businessDate: StayDate,
  ): Promise<readonly AuditedPosting[]> {
    const reversed = alias(folioPosting, "reversed_posting");

    return await exec
      .select({
        postingId: folioPosting.id,
        bookingId: folio.bookingId,
        roomTypeId: booking.roomTypeId,
        amount: folioPosting.amount,
        type: folioPosting.type,
        reversesPostingId: folioPosting.reversesPostingId,
        reversedType: reversed.type,
      })
      .from(folioPosting)
      .innerJoin(folio, eq(folio.id, folioPosting.folioId))
      .innerJoin(booking, eq(booking.id, folio.bookingId))
      // Left, because most lines reverse nothing. The reversed line may be dated
      // to an earlier day, so this join is deliberately not narrowed by the
      // business date the outer statement filters on.
      .leftJoin(reversed, eq(reversed.id, folioPosting.reversesPostingId))
      .where(eq(folioPosting.businessDate, businessDate.toString()));
  }

  /**
   * How many rooms of each type were on sale that night.
   *
   * `total_rooms` and not a count of `room`: `FR-INV-04` withdraws a room from
   * sale by moving this counter, and an occupancy measured against the rooms
   * that physically exist would read a deliberate closure as an empty hotel.
   *
   * A type with no row for the date was not on sale at all and is absent rather
   * than zero — which is a real distinction on a date the property never opened
   * the calendar for.
   */
  private async sellable(
    exec: DbExecutor,
    businessDate: StayDate,
  ): Promise<readonly SellableRooms[]> {
    return await exec
      .select({
        roomTypeId: typeInventory.roomTypeId,
        sellableRooms: typeInventory.totalRooms,
      })
      .from(typeInventory)
      .where(eq(typeInventory.stayDate, businessDate.toString()));
  }
}

/**
 * The day's postings and its inventory, as the figures a snapshot holds.
 *
 * Pure, and it reads nothing — the same shape `decomposeGross` is in and for the
 * same reason: every case a night can be in is reachable from literals rather
 * than from a night somebody has to arrange in a database.
 *
 * A type with revenue but no inventory row still gets a row here, sellable zero.
 * It should not happen — a stay cannot be sold a night that was never opened for
 * sale — and dropping it if it did would leave the per-type rows summing to less
 * than the property row, which is the one disagreement this table exists to
 * prevent.
 */
export function rollUp(
  postings: readonly AuditedPosting[],
  sellable: readonly SellableRooms[],
): FrozenDay {
  const types = new Map<
    string,
    { sellableRooms: number; sold: Set<string>; net: VndAmount }
  >();

  const of = (roomTypeId: string) => {
    const type = types.get(roomTypeId) ?? {
      sellableRooms: 0,
      sold: new Set<string>(),
      net: 0n,
    };

    types.set(roomTypeId, type);

    return type;
  };

  for (const type of sellable) {
    of(type.roomTypeId).sellableRooms = type.sellableRooms;
  }

  // The room charges this day corrected within itself. Taken from the same set
  // of postings, so a reversal made on a later day is not in it — that day's
  // snapshot is already frozen and this one is being written as the night stood.
  const corrected = new Set(
    postings.flatMap((posting) =>
      posting.type === "REVERSAL" && posting.reversesPostingId !== null
        ? [posting.reversesPostingId]
        : [],
    ),
  );

  let otherRevenueVnd = 0n;

  for (const posting of postings) {
    const line =
      posting.type === "REVERSAL" ? posting.reversedType : posting.type;

    const revenue = line === null ? undefined : REVENUE_OF[line];

    if (revenue === "OTHER") {
      otherRevenueVnd += posting.amount;

      continue;
    }

    if (revenue !== "ROOM") {
      continue;
    }

    const type = of(posting.roomTypeId);

    type.net += posting.amount;

    // The stay is counted once however many lines its night came to, and not at
    // all if the charge was taken back before the day ended. The reversal itself
    // is revenue coming off and never a room sold, which is why only the charge
    // is asked about here.
    if (posting.type === "ROOM_CHARGE" && !corrected.has(posting.postingId)) {
      type.sold.add(posting.bookingId);
    }
  }

  const byType = [...types.entries()]
    .map(([roomTypeId, type]) => ({
      roomTypeId,
      sellableRooms: type.sellableRooms,
      roomsSold: type.sold.size,
      netRoomRevenueVnd: type.net,
    }))
    // By type, so the rows of one night land in a stable order whatever order
    // the two statements above came back in. Nothing reads the order, and that
    // is exactly why it should not vary between two runs of the same night.
    .sort((one, other) => one.roomTypeId.localeCompare(other.roomTypeId));

  return {
    sellableRooms: total(byType, (type) => type.sellableRooms),
    roomsSold: total(byType, (type) => type.roomsSold),
    netRoomRevenueVnd: byType.reduce<VndAmount>(
      (sum, type) => sum + type.netRoomRevenueVnd,
      0n,
    ),
    otherRevenueVnd,
    byType,
  };
}

/** A whole-number total over the types, summed in the order they are held. */
function total(
  byType: readonly FrozenType[],
  of: (type: FrozenType) => number,
): number {
  return byType.reduce((sum, type) => sum + of(type), 0);
}
