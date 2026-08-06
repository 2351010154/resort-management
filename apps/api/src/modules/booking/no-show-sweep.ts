// The guests who never came, found by the property's own day — `FR-BOOK-04`.
//
// A `CONFIRMED` booking whose arrival date has passed is a room the property
// held all night for somebody who did not turn up. Nothing else in the tree
// notices: `markNoShow` exists and has since the state machine was written, but
// only the desk can reach it, so until this sweep runs the stay sits `CONFIRMED`
// with every one of its nights still consumed. A five-night no-show is four
// nights the property cannot sell to anyone else, and it stays that way until a
// human happens to look at the arrivals list.
//
// ## Strictly before the business date, never on it
//
// The predicate is `check_in_date < businessDate`, so a stay arriving on the
// current business date is left alone however late in the day this runs. The
// property has not finished that day: the guest is late, not absent, and a sweep
// that wrote them off at noon would release the rest of their stay and cut their
// room hold back to tonight while they were still in a taxi.
//
// `markNoShow` itself is more permissive — it allows `today == arrival`, because
// `booking-state-machine.md` §3 gives the transition to a night audit running at
// 03:00, which under the 04:00 rollover reads the arrival date as its own
// business date. That guard is a floor on what the desk may do, not a schedule.
// This is a sweep with no human looking at it, so it takes the conservative half
// of that range: a day the property has fully left behind, and nothing else.
// This is not the night audit — `M9` closes the books and posts the no-show
// charge, and neither happens here.
//
// ## It transitions through `BookingService`, not through one `update`
//
// `sweep-job.ts` describes a sweep as a set-based `update ... returning` and
// names this one as the case for it. That description does not survive contact
// with what the transition actually is. §3 does not flip a column: it keeps the
// arrival night sold, releases every night after it, and cuts the room's hold
// back to the night that was kept — three writes across three tables, two of
// which are the inventory arithmetic that `inventory.service.ts` is the only
// permitted path to, precisely so the counter's locks are taken in stay-date
// order and `type_inventory_sold_at_most_total` stays the thing that refuses an
// oversell. A statement here that moved `sold_rooms` itself would be a second
// implementation of §3, and the two would agree right up until one was changed.
//
// So this is the argument `hold-expiry-sweep.ts` makes about cancellation,
// applied to a transition with strictly more arithmetic in it. The cost is the
// same loop, and it is the right cost: a night's no-shows are counted in ones
// and twos, they are all in the runner's one transaction on one connection, and
// the alternative duplicates the arithmetic that must never drift. There is no
// batch limit, for the reason that file gives — the runner re-runs the sweep in
// the same transaction and requires the second pass to be empty, which a limited
// sweep with a backlog could not deliver.
//
// The second pass is empty by construction: the predicate selects `CONFIRMED`,
// and every row this touched is `NO_SHOW` by the time it is asked again.
//
// ## The date it is handed and the date the service reads
//
// `markNoShow` asks `BusinessDateService` what day it is rather than taking the
// date this sweep was given, and the two can only disagree on a manual run over
// a date that is not today's. Back-dated, the service's guard is looser than the
// predicate above and lets every selected row through — which is the manager
// re-running a night the scheduler missed. Forward-dated, the service refuses a
// stay the property has not reached and the whole run rolls back, doing nothing:
// the right answer to being asked to write off tomorrow's arrivals, and the
// reason this file adds no guard of its own for it.

import type { StayDate } from "@mariva/shared";
import { Injectable } from "@nestjs/common";
import { and, eq, lt } from "drizzle-orm";
import type { DbExecutor } from "../../database/database.module.js";
import { booking } from "../../database/schema/booking.js";
import type { SweepJob } from "../../jobs/sweep-job.js";
import { BookingService } from "./booking.service.js";

// Hourly, and the alternative is worth saying out loud: a single daily cron a
// few minutes after the rollover. It would be wrong, because the rollover hour
// is configuration — `business-date.service.ts` reads it from the environment so
// "a property that runs its audit at 06:00 changes one row, not a deploy" — and
// a cron is a constant compiled into this file. Pinning `4` here would be that
// number's second home, and the day it moved, this sweep would fire before the
// rollover, read yesterday's business date, and write off nothing until the
// following morning.
//
// Asking hourly needs no such agreement. Whenever the day rolls, the next tick
// finds the arrivals it left behind, and every other tick is one indexed scan of
// `booking_state_check_in_date_idx` returning nothing. Twenty past the hour
// keeps it off the boundary the rest of the schedule crowds onto.
const HOURLY = "20 * * * *";

/**
 * Writes off every stay whose arrival night the property has left behind.
 *
 * Registered in `jobs.module.ts` and owned here, which is the split that file
 * describes: the scheduler is machinery, and a sweep belongs to the requirement
 * that asked for it.
 */
@Injectable()
export class NoShowSweep implements SweepJob {
  readonly name = "no-show";
  readonly schedule = HOURLY;

  constructor(private readonly bookings: BookingService) {}

  async run(
    exec: DbExecutor,
    businessDate: StayDate,
  ): Promise<readonly string[]> {
    // `for update` rather than a plain read, and it is what keeps this sweep off
    // a guest who is standing at the desk. Under `read committed` Postgres
    // re-evaluates the predicate after it takes each row's lock, so a stay that
    // a concurrent check-in moved to `CHECKED_IN` while this statement waited
    // drops out of the result — instead of arriving at `markNoShow` as a
    // transition §2 does not draw, which would throw and take the whole run with
    // it. Ordered by id so two statements contending for the same rows take them
    // in the same order; the runner's advisory lock already stops two runs of
    // this sweep overlapping, and this holds the line against everything else in
    // the tree that locks a booking.
    const missed = await exec
      .select({ id: booking.id })
      .from(booking)
      .where(
        and(
          eq(booking.state, "CONFIRMED"),
          lt(booking.checkInDate, businessDate.toString()),
        ),
      )
      .orderBy(booking.id)
      .for("update");

    const written: string[] = [];

    for (const { id } of missed) {
      await this.bookings.markNoShow(exec, id);
      written.push(id);
    }

    return written;
  }
}
