// The night the guest is sleeping, put on their account — `FR-FOL-01` and
// `FR-FOL-02`.
//
// `postRoomCharge` has existed since the ledger landed and nothing in the tree
// calls it. So a guest checks in, stays five nights and departs owing nothing:
// the only money anywhere near the stay is the total frozen on the booking, and
// §4's check-out guard reads the *folio*, which sums to zero for an account
// nobody ever posted to. The stay settles and walks. This is the caller that
// makes the ledger say what the property is owed.
//
// It is not the night audit. `FR-RPT-01` is `M9` and does three things — posts
// the room charges, rolls the business date, freezes the snapshot the reports
// read. Only the first of those is an act on the ledger and only the first is
// here. A sweep that also rolled the date would be a second implementation of
// §2's rollover, and one that froze a snapshot would freeze it over a night the
// rest of the audit had not finished.
//
// ## Idempotency is the predicate, not a flag written afterwards
//
// `job-runner.service.ts` re-runs a sweep inside the same transaction and
// requires the second pass to come back empty, and for a sweep that writes money
// there is one honest way to satisfy that: the row it writes has to be the row
// that stops it writing again. So "this night has not been charged" is a `not
// exists` inside the same statement that selects the stay, and what it looks for
// is the room charge this sweep would post. A read followed by a write would
// leave a window between them, and the two runs that can be inside that window —
// the cron's, and a manager re-running the night by hand — are exactly the pair
// that would charge a guest twice for one night.
//
// The line it looks for is narrowed to one nobody authored. `schema/folio.ts`
// keeps `posted_by` null for the writers with no person behind them, so a room
// charge carrying an author is the desk's — a late checkout, a day-use hour —
// and a stay that was charged one of those still owes rent for the night.
// Without the narrowing, a receptionist posting anything against today would
// silently suppress today's room charge, and the folio would be short by a night
// with nothing anywhere recording why.
//
// A reversed charge is not posted again, and that is the answer rather than an
// oversight. `FR-FOL-01` corrects a mistake with a reversing entry and leaves the
// mistake standing, so the `ROOM_CHARGE` row is still on the account — where a
// sweep reading the balance instead would see the credit, re-charge the night an
// hour later, and undo a correction somebody made deliberately.
//
// ## What one night costs, and why it is the difference of two totals
//
// `booking_night.standard_gross` is the calendar price of a night *before* the
// plan's percentage, its breakfast and the property's extra-person rate.
// `schema/booking.ts` says so and `cancellation-calculator.ts` hands the same
// figure on with the same instruction: apply the plan once, over whatever comes
// back, never per night on the way in. Posting `standard_gross` as the night's
// charge would bill a `BB` party of three for a bare room every night, and the
// account would settle for less than the guest agreed to.
//
// Running §3's arithmetic per night instead is the other obvious answer, and it
// is the one §5 forbids: the percentage is an integer division, so dividing once
// a night truncates once a night and the nights stop summing to
// `quoted_stay_total_gross`. `schema/booking.ts` names that as the reason the
// calendar price is what is stored — a discrepancy that is unprovable rather
// than merely wrong.
//
// So a night is charged as what the stay costs through tonight less what it cost
// through last night, both answered by the one function that priced the stay in
// the first place. Every per-night term of `stayTotalGross` — the extra heads,
// the breakfast — differences to exactly one night of itself; the one term that
// is not, the percentage over the summed calendar price, telescopes, so the
// truncations cancel and the nights sum to the agreed total to the đồng with the
// odd one landing wherever the division left it. Nothing here rounds, which is
// the structural trick `tax-decomposition.ts` uses one file over to make three
// lines sum to the figure they came from. The gross figure is then decomposed by
// `postRoomCharge` at the rates in force on the business date — `FR-FOL-02` —
// and this file never sees a rate.
//
// ## Checked in, and the business date inside the stay
//
// `check_in_date <= businessDate < check_out_date` is the half-open range the
// whole tree reads a stay as, and it is what keeps the departure day off the
// account: the guest leaving this morning slept last night, and last night was
// posted last night. `CHECKED_IN` and nothing weaker — a `CONFIRMED` stay
// arriving today is a room held for a guest who may still not come, and what
// that becomes is `FR-BOOK-04`'s no-show charge rather than a night's rent this
// sweep would have to take back.
//
// ## The nights it did not charge, said out loud
//
// One business date is charged per run and there is no catch-up, which leaves a
// gap that is quiet rather than rare. A guest arrives at 23:00 and the desk keys
// the check-in the following afternoon: the stay was `CONFIRMED` for the whole
// of the night it slept, no run selected it, and no later run ever asks about
// that date again. The same hole opens on a business date this process was down
// for, or one whose `booking_night` rows landed late. The folio is short, §4's
// check-out guard reads that short folio, and the stay settles for less than it
// agreed to with nothing anywhere recording why.
//
// Posting the missing night automatically is the obvious answer and it is the
// wrong one. `FR-RPT-01` freezes a snapshot per business date, so back-posting
// would drop a figure into a trading day the property has closed and reported —
// which is the thing dating a posting correctly exists to prevent, arrived at
// from the other side. Recovery belongs to a person: `job-trigger.controller.ts`
// takes a business date, so re-running this sweep over the missed one posts it
// at the rates and on the day it belongs to, deliberately.
//
// What is fixed here is that nobody has to notice first. Every run counts the
// nights an in-house stay should have been charged for and was not, by the same
// predicate that decides tonight, and says so. It charges none of them and its
// return value does not mention them — the runner requires a second pass over
// the same transaction to come back empty, and a sweep that reported work it had
// not done would fail that check for the wrong reason.
//
// Both reports below are made once per run rather than once per pass. The runner
// calls a sweep twice inside one transaction when the first pass touched
// anything, and neither report's answer moves between the two — the arrears are
// nights *before* tonight, and a stay with no price still has none. Said twice,
// one incident reads as two to whoever is triaging it, so the transaction the
// runner hands over and the date it was handed together mark the run: the same
// pair arrives on the second pass, and a new transaction is a new run that is
// entitled to speak again.
//
// ## A stay in house tonight with no price for tonight
//
// `booking_night` is written by the transaction that writes the stay and an
// extension appends to both, so a night with no row is a broken invariant rather
// than a case. There is still nothing to charge on it: the only alternative to
// charging nothing is inventing a price for a line that goes on an invoice,
// which is the refusal `stay-quote.service.ts` makes about an unpriced night.
//
// What this must not do is take the rest of the property down with it. The
// runner's boundary is the whole run, so a throw from inside the loop rolls back
// every stay charged before it — one malformed booking and no guest in the
// building is charged, on this run or on any hourly run after it, until somebody
// repairs the row. Charging the priced stays and *then* throwing is not the
// milder version of that: the throw rolls back the charges it just wrote, so it
// is the same outage reached by a longer route.
//
// So the run completes, the stays that can be charged are, and the ones that
// cannot are named at `error` — a level of their own, and not because an arrear
// is merely less urgent. The arrears report above is driven by `booking_night`
// rows, so it can only name a night that *has* one. A night with no row is
// invisible to it, on this run and on every run after it, which makes the line
// below the only record anywhere that the night was owed. That is the whole
// reason it is an error and names the stay: nothing else will say it again.

import {
  type Party,
  type StayDate,
  stayTotalGross,
  type VndAmount,
} from "@mariva/shared";
import { Injectable } from "@nestjs/common";
import {
  and,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  notExists,
  sql,
} from "drizzle-orm";
import { PinoLogger } from "nestjs-pino";
import type { DbExecutor } from "../../database/database.module.js";
import { booking, bookingNight } from "../../database/schema/booking.js";
import { folio, folioPosting } from "../../database/schema/folio.js";
import type { SweepJob } from "../../jobs/sweep-job.js";
import { quotedPromotion } from "../booking/quoted-promotion.js";
import { FolioService } from "./folio.service.js";

// Hourly, and `no-show-sweep.ts` makes the whole argument for it: the rollover
// hour is configuration, so a daily cron pinned a few minutes past 04:00 would
// be that number's second home and would charge the wrong night the morning
// after somebody moved it. Asking hourly needs no such agreement — whenever the
// day rolls, the next tick charges it, and every later tick that day finds the
// night already on the account and writes nothing. Thirty-five past keeps it off
// the hour boundary and off the no-show sweep's twenty past.
const HOURLY = "35 * * * *";

/** One priced night of one stay, as `booking_night` holds it. */
interface PricedNight {
  readonly stayDate: string;
  readonly standardGross: VndAmount;
}

/**
 * How many stays a report names rather than counts.
 *
 * Enough to start from without turning one stuck stay into a log nobody reads.
 * The counts beside them are the whole set.
 */
const NAMED_IN_A_REPORT = 5;

/**
 * Posts one night's room charge to every in-house stay's folio.
 *
 * Registered in `jobs.module.ts` and owned here, which is the split that file
 * describes: the scheduler is machinery, and a sweep belongs to the requirement
 * that asked for it.
 */
@Injectable()
export class RoomChargeSweep implements SweepJob {
  readonly name = "room-charge";
  readonly schedule = HOURLY;

  /**
   * The business dates this sweep has already reported on, per transaction.
   *
   * The runner's transaction stands for the run: it is handed to every pass of
   * one run and to no other, so marking it is what tells the second pass that
   * the first has already spoken. Weak, so a finished run's transaction is
   * collected rather than held here for the life of the process.
   *
   * The date is held beside it rather than the transaction alone standing for
   * the run, because a run is a transaction *and* a date. Nothing asks this
   * sweep for two dates inside one transaction today, and keying on the pair
   * means that when something does, the second date is reported rather than
   * silently taken for the first one's second pass.
   */
  private readonly reportedOn = new WeakMap<object, Set<string>>();

  constructor(
    private readonly folios: FolioService,
    // The context is set on an injected `PinoLogger` rather than declared with
    // `@InjectPinoLogger`, for the evaluation-order reason `job-runner.service.ts`
    // sets out where it does the same thing.
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("RoomChargeSweep");
  }

  /**
   * Charges the night, and answers with the id of every charge it posted.
   *
   * The id rather than the booking's, because it is the row that was written and
   * because it is the handle a correction is issued against — `postRoomCharge`
   * returns the principal of the three lines, and `id = $1 or parent_posting_id
   * = $1` is the whole night.
   */
  async run(
    exec: DbExecutor,
    businessDate: StayDate,
  ): Promise<readonly string[]> {
    const tonight = businessDate.toString();

    // Whether this pass is the run's first. Both reports below hang off it: the
    // runner calls a sweep twice inside one transaction and neither report's
    // answer moves between the passes, so saying them again would turn one
    // incident into two in the log.
    const speakingForThisRun = this.firstPassOf(exec, tonight);

    // Before the early return below, because a night left behind is exactly the
    // thing a run with nothing to charge would otherwise say nothing about.
    if (speakingForThisRun) {
      await this.reportArrears(exec, tonight);
    }

    // `for update` rather than a plain read, for the reason both other sweeps
    // give: under `read committed` Postgres re-evaluates the predicate after it
    // takes each row's lock, so a stay that a concurrent check-out moved out of
    // `CHECKED_IN` while this statement waited drops out of the result instead
    // of being charged for a night that had already ended. Ordered by id so two
    // statements contending for the same rows take them in the same order; the
    // runner's advisory lock already stops two runs of this sweep overlapping,
    // and this holds the line against everything else that locks a booking.
    const inHouse = await exec
      .select({
        id: booking.id,
        percentAdjustment: booking.quotedPercentAdjustment,
        breakfastPerPersonGross: booking.quotedBreakfastPerPersonGross,
        extraPersonPerNightGross: booking.quotedExtraPersonPerNightGross,
        // §7's member discount, frozen at the sale. Selected here for the same
        // reason the plan's percentage is: the charge this sweep posts has to be
        // the price the guest agreed to, and a night priced off the
        // undiscounted room rate would put a folio line on the account that the
        // booking contradicts.
        promotionType: booking.quotedPromotionType,
        promotionValue: booking.quotedPromotionValue,
        adults: booking.adults,
        childAges: booking.childAges,
      })
      .from(booking)
      .where(
        and(
          eq(booking.state, "CHECKED_IN"),
          lte(booking.checkInDate, tonight),
          gt(booking.checkOutDate, tonight),
          notExists(
            exec
              .select({ charged: sql`1` })
              .from(folioPosting)
              .innerJoin(folio, eq(folio.id, folioPosting.folioId))
              .where(
                and(
                  eq(folio.bookingId, booking.id),
                  eq(folioPosting.type, "ROOM_CHARGE"),
                  eq(folioPosting.businessDate, tonight),
                  isNull(folioPosting.postedBy),
                ),
              ),
          ),
        ),
      )
      .orderBy(booking.id)
      .for("update");

    if (inHouse.length === 0) {
      return [];
    }

    const priced = await this.nightsThrough(
      exec,
      inHouse.map((stay) => stay.id),
      tonight,
    );

    const posted: string[] = [];
    const unpriced: string[] = [];

    // Sequential, not `Promise.all`: every one of these is on the runner's one
    // connection inside its one transaction, and a night's in-house stays are
    // counted in tens.
    for (const stay of inHouse) {
      const nights = priced.get(stay.id) ?? [];
      const last = nights.at(-1);

      // The stay occupies this date, so `booking_night` holds a row for it —
      // the two are written by the same transaction and an extension appends to
      // both. Missing, there is no price for tonight, and the only alternative
      // to charging nothing is inventing one for a line that goes on an
      // invoice. That is the refusal `stay-quote.service.ts` makes about an
      // unpriced night, arriving a milestone later.
      //
      // Set aside rather than thrown. The header argues it: the runner's
      // boundary is the whole run, so a throw from here — before the loop or
      // after it — takes every stay charged beside this one down with it, and
      // one malformed booking would stop the property charging anybody until
      // somebody repaired the row.
      if (!last || last.stayDate !== tonight) {
        unpriced.push(stay.id);
        continue;
      }

      const party: Party = {
        adults: stay.adults,
        children: stay.childAges.map((age) => ({ age })),
      };

      const throughTonight = standardTotal(nights);
      // One translation of the frozen columns, used by both calls below — the
      // difference between them is the night, and a promotion present in one
      // and absent from the other would make that difference a discount rather
      // than a room.
      const promotion = quotedPromotion(stay.promotionType, stay.promotionValue);

      posted.push(
        await this.charge(exec, stay.id, {
          businessDate,
          grossAmount:
            stayTotalGross({
              standardTotal: throughTonight,
              percentAdjustment: stay.percentAdjustment,
              breakfastPerPersonGross: stay.breakfastPerPersonGross,
              extraPersonPerNightGross: stay.extraPersonPerNightGross,
              nights: nights.length,
              party,
              promotion,
            }) -
            // Through last night. On the arrival night this is a stay of no
            // nights at a total of nothing, which the same function answers at
            // zero — so there is no first-night branch for a later change to
            // get wrong.
            stayTotalGross({
              standardTotal: throughTonight - last.standardGross,
              percentAdjustment: stay.percentAdjustment,
              breakfastPerPersonGross: stay.breakfastPerPersonGross,
              extraPersonPerNightGross: stay.extraPersonPerNightGross,
              nights: nights.length - 1,
              party,
              promotion,
            }),
        }),
      );
    }

    if (speakingForThisRun && unpriced.length > 0) {
      this.reportUnpriced(unpriced, tonight);
    }

    return posted;
  }

  /**
   * Whether this pass is the first of its run, and marks it if it is.
   *
   * The runner hands one transaction to every pass of one run, so the executor
   * and the date it was handed are the run's identity without `SweepJob` having
   * to carry a run id that only this sweep would read. A manual re-run over the
   * same date opens a transaction of its own and is a run in its own right,
   * which is what somebody re-running a night to see what it says needs.
   */
  private firstPassOf(exec: DbExecutor, tonight: string): boolean {
    const dates = this.reportedOn.get(exec) ?? new Set<string>();

    this.reportedOn.set(exec, dates);

    if (dates.has(tonight)) {
      return false;
    }

    dates.add(tonight);

    return true;
  }

  /**
   * Says which in-house stays could not be charged for tonight at all.
   *
   * `error` rather than the `warn` {@link reportArrears} uses, and the levels
   * are the difference between the two. An arrear is a night with a price and no
   * charge: it has a benign cause — a check-in keyed the following afternoon —
   * and the report above names it again on every run until somebody recovers it.
   * This is a night with no price at all, which that report cannot see, because
   * it reads `booking_night` and there is no row there to read. So this line is
   * the only place the night is ever mentioned, and it is written at the level
   * something nothing else will repeat has to be written at.
   *
   * Nothing is written and nothing is returned to the runner, for the reason the
   * arrears report gives: the second pass over the same transaction has to come
   * back empty, and a sweep that reported work it had not done would fail that
   * check for the wrong reason.
   */
  private reportUnpriced(stays: readonly string[], tonight: string): void {
    this.logger.error(
      {
        businessDate: tonight,
        stays: stays.length,
        naming: stays.slice(0, NAMED_IN_A_REPORT),
      },
      "in-house stays have no priced night for this business date and were not charged — " +
        "booking_night must cover the stay before this sweep can charge it",
    );
  }

  /**
   * Opens the account if this is the first thing on it, and posts the night.
   *
   * The folio is ensured here rather than at check-in because this is the first
   * writer that needs one, and `ensureFolio` settles two concurrent openings in
   * one statement — so nothing is gained by opening it earlier and a stay that
   * never runs up a charge keeps no empty account.
   */
  private async charge(
    exec: DbExecutor,
    bookingId: string,
    night: { businessDate: StayDate; grossAmount: VndAmount },
  ): Promise<string> {
    return await this.folios.postRoomCharge(exec, {
      folioId: await this.folios.ensureFolio(exec, bookingId),
      grossAmount: night.grossAmount,
      businessDate: night.businessDate,
      // What the guest reads on the invoice, and what the two derived lines are
      // named after. The date is in it because a folio carries one of these per
      // night and three identically-worded lines would be an invoice nobody can
      // check against a stay.
      description: `Room charge, night of ${night.businessDate.toString()}`,
      // No person authored this, which `schema/folio.ts` records as null — and
      // which the predicate above reads back to recognise its own work.
      postedBy: null,
    });
  }

  /**
   * Says which in-house stays are carrying a night nobody charged them for.
   *
   * The predicate is the one above with two changes: the night is *before*
   * tonight rather than tonight, and it comes from `booking_night` rather than
   * from the business date this run was handed — a run only ever knows about one
   * date, and the nights it is looking for are the ones no run ever asked about.
   * The `not exists` is unchanged down to the `posted_by is null`, so a night the
   * desk charged by hand is not reported as missing and a reversed one is not
   * reported twice.
   *
   * Nothing is written and nothing is returned to the runner. The header says
   * why the missing night is not simply posted, and why the recovery is a person
   * re-running this sweep over the date rather than this sweep deciding to.
   *
   * Called on the run's first pass only. The nights this asks about are the ones
   * *before* tonight, so tonight's charges do not move the answer and a second
   * pass would report the same stays a second time.
   */
  private async reportArrears(
    exec: DbExecutor,
    tonight: string,
  ): Promise<void> {
    const uncharged = await exec
      .select({ bookingId: booking.id, stayDate: bookingNight.stayDate })
      .from(bookingNight)
      .innerJoin(booking, eq(booking.id, bookingNight.bookingId))
      .where(
        and(
          eq(booking.state, "CHECKED_IN"),
          lte(booking.checkInDate, tonight),
          gt(booking.checkOutDate, tonight),
          lt(bookingNight.stayDate, tonight),
          notExists(
            exec
              .select({ charged: sql`1` })
              .from(folioPosting)
              .innerJoin(folio, eq(folio.id, folioPosting.folioId))
              .where(
                and(
                  eq(folio.bookingId, booking.id),
                  eq(folioPosting.type, "ROOM_CHARGE"),
                  eq(folioPosting.businessDate, bookingNight.stayDate),
                  isNull(folioPosting.postedBy),
                ),
              ),
          ),
        ),
      )
      .orderBy(booking.id, bookingNight.stayDate);

    if (uncharged.length === 0) {
      return;
    }

    this.logger.warn(
      {
        businessDate: tonight,
        stays: new Set(uncharged.map((night) => night.bookingId)).size,
        nights: uncharged.length,
        // Sorted by stay and then by date, so this is the oldest night of the
        // lowest-numbered stay rather than the oldest night outright. The dates
        // named below are what somebody re-runs, and they are all here.
        naming: uncharged
          .slice(0, NAMED_IN_A_REPORT)
          .map((night) => `${night.bookingId}@${night.stayDate}`),
      },
      "in-house stays are carrying nights with no room charge — re-run this sweep for those business dates",
    );
  }

  /**
   * Every priced night of these stays up to and including tonight, in stay
   * order, grouped by booking.
   *
   * One statement for all of them rather than one per stay: the nights before
   * tonight are what the difference above is taken against, so each stay needs
   * its own prefix and none of them needs a separate round trip. Rows past
   * tonight are excluded rather than summed — `schema/booking.ts` keeps the
   * nights an early departure will not sleep precisely so §4 can charge them,
   * and they are not rent owed for tonight.
   */
  private async nightsThrough(
    exec: DbExecutor,
    bookingIds: readonly string[],
    tonight: string,
  ): Promise<ReadonlyMap<string, readonly PricedNight[]>> {
    const rows = await exec
      .select({
        bookingId: bookingNight.bookingId,
        stayDate: bookingNight.stayDate,
        standardGross: bookingNight.standardGross,
      })
      .from(bookingNight)
      .where(
        and(
          inArray(bookingNight.bookingId, [...bookingIds]),
          lte(bookingNight.stayDate, tonight),
        ),
      )
      .orderBy(bookingNight.bookingId, bookingNight.stayDate);

    const byBooking = new Map<string, PricedNight[]>();

    for (const row of rows) {
      const nights = byBooking.get(row.bookingId);

      if (nights) {
        nights.push(row);
      } else {
        byBooking.set(row.bookingId, [row]);
      }
    }

    return byBooking;
  }
}

/** The calendar prices of these nights, summed and un-rounded — §5. */
function standardTotal(nights: readonly PricedNight[]): VndAmount {
  return nights.reduce<VndAmount>(
    (total, night) => total + night.standardGross,
    0n,
  );
}
