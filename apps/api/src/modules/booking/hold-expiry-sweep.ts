// The other half of `FR-BOOK-02` — the TTL that releases what a hold consumed.
//
// `booking.service.ts`'s `createHold` consumes the nights in full at the moment
// the funnel takes the hold, because a hold that did not consume them would be a
// room two guests could reach the payment step for. That is only half a
// requirement: nothing else in the tree reads `hold_expires_at`, so without this
// file every abandoned funnel session consumes a night for good. Not an attack —
// the ordinary browse-and-leave is enough, and the guest has no route back
// either, since a booking carries no guest until check-in registers one. The
// nights would come back only when somebody at the desk cancelled the booking by
// hand.
//
// ## It reuses `cancel` rather than restating §3 in SQL
//
// The tempting shape is one set-based `update ... returning`, which is what
// `sweep-job.ts` describes and what the no-show sweep will be. It is wrong here.
// §3 gives an expired hold the same inventory effect as any other cancellation,
// and `BookingService.cancel` already is that effect: it releases every night,
// clears the expiry the check constraint would otherwise refuse, and refuses to
// act twice on a booking already cancelled. A statement here that moved
// `sold_rooms` itself would be a second implementation of §3's arithmetic, and
// the two would agree right up until one of them was changed.
//
// The cost is a loop, and it is the right cost. Expired holds are counted in
// ones and twos per run, they are all in the runner's transaction on one
// connection — so the loop is sequential, not `Promise.all` — and the alternative
// duplicates the one piece of arithmetic in this system that must never drift.
//
// ## There is no batch limit, and that is deliberate
//
// A sweep that took the oldest N would be the usual defence against a backlog.
// It is incompatible with how `job-runner.service.ts` establishes idempotency:
// the runner re-runs the sweep inside the same transaction and requires the
// second pass to come back empty, so a limited sweep with more than N expired
// holds would hand back the next batch and be rejected as non-idempotent. The
// backlog this would guard against cannot form anyway while the cron fires every
// minute; if it ever does, the answer is a larger transaction once, not a sweep
// that reports success having done part of the work.

import { Inject, Injectable } from "@nestjs/common";
import { and, eq, lt, or, sql } from "drizzle-orm";
import { ENV, type Env } from "../../config/env.js";
import type { DbExecutor } from "../../database/database.module.js";
import { booking } from "../../database/schema/booking.js";
import type { SweepJob } from "../../jobs/sweep-job.js";
import { BookingService } from "./booking.service.js";

// Every minute, and the cadence is a promise about lateness rather than a
// performance decision: a hold is released somewhere between the moment it fell
// due and that moment plus this. No cadence makes that overshoot zero —
// `BOOKING_HOLD_TTL_MINUTES` floors at one minute — and the direction it errs in
// is the safe one, since a night still counted as sold is a night the property
// declines to sell twice.
//
// A minute rather than the two it was, and the minute bought is the last one of
// the overshoot. That matters because the door the hold came through is public
// and unauthenticated, so the overshoot is time a stranger holds a room for free
// — and it is not paid for in load. The query behind each tick reads two partial
// indexes that exist for it, `booking_hold_expires_at_idx` and
// `booking_last_seen_at_idx`, each covering only the rows that are still held; on
// a minute with nothing due it reads nothing.
//
// It is also no longer the whole of what an abandoned funnel session costs. The
// worst case used to be the TTL plus this — eleven minutes of a room for a guest
// who closed the tab in the first thirty seconds — and a hold now falls due a
// grace after the funnel last said it was open, so the same abandonment costs the
// property about three. The overshoot this cadence describes is unchanged; what
// changed is the moment it is measured from.
const EVERY_MINUTE = "* * * * *";

/**
 * Cancels every hold that has run out, releasing its nights.
 *
 * Registered in `jobs.module.ts` and owned here, which is the split that file
 * describes: the scheduler is machinery, and a sweep belongs to the requirement
 * that asked for it.
 *
 * **Two clocks decide when a hold has run out, and the hold dies at whichever
 * reached the end first.** The TTL is one of them and it is a ceiling: it says
 * how long a room may be held at the very most. The other is the guest — the
 * funnel says every twenty seconds that it is still open, and a hold is due
 * `BOOKING_HOLD_GRACE_SECONDS` after the last of those arrived. Before the second
 * one existed, a guest who closed their tab thirty seconds into a ten-minute TTL
 * cost the property a room for the remaining nine and a half, and on a night at
 * the anonymous share cap that is a room the next guest is turned away from.
 *
 * The presence clock may only ever bring the moment forward. Nothing in it can
 * move `hold_expires_at`, so a browser pinging forever holds a room for one TTL
 * and not a second longer — which is the reason the predicate below is an `or` of
 * two deadlines rather than a deadline this sweep recomputes.
 *
 * One thing does move that column, and it is not on this path: opening a payment
 * attempt pushes it out to `BOOKING_PAYMENT_WINDOW_MINUTES` from then, so a guest
 * sent to a gateway near the end of their TTL is not cancelled mid-payment —
 * `BookingService.extendHoldForPayment`. Nothing here reads that differently; it
 * is the same deadline, further away. What it means for the caps in
 * `booking.service.ts` is that a hold may outlive one TTL by that window, and by
 * another one each time an attempt is opened against it. They still bound how many
 * rooms a caller may hold at once, which is what they were written to bound; what
 * they no longer bound on their own is for how long.
 *
 * **It is a courtesy and not a defence**, and nothing was relaxed in exchange for
 * it. A caller who wants to keep rooms off the shelf simply never says they are
 * present and gets the full TTL, exactly as they did before — so a future reader
 * must not read "abandoned holds release themselves now" as a reason to raise a
 * cap or shorten a TTL. The caps still do all of the work against anybody who is
 * not cooperating, because they are the only thing that ever did.
 */
@Injectable()
export class HoldExpirySweep implements SweepJob {
  readonly name = "hold-expiry";
  readonly schedule = EVERY_MINUTE;

  constructor(
    private readonly bookings: BookingService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * The business date is not taken, and its absence is the point.
   *
   * `sweep-job.ts` draws the line: a sweep tied to the property's day takes the
   * date so it can be re-run over a night that failed, and work that is
   * genuinely about *now* asks Postgres instead. A TTL is the second kind. The
   * `now()` below is the runner transaction's start time, so it is one instant
   * for both of the runner's passes and identical on every connection — an
   * expiry cannot fall due between the pass that did the work and the pass that
   * checks it settled.
   */
  async run(exec: DbExecutor): Promise<readonly string[]> {
    // `for update` rather than a plain read, and it is what keeps this sweep off
    // a booking somebody just paid for. Under `read committed` Postgres
    // re-evaluates the predicate after it takes each row's lock, so a hold that
    // a concurrent `confirm` moved to `CONFIRMED` while this statement waited
    // drops out of the result instead of being cancelled a moment later — and
    // §3 would have allowed that cancellation, since `CONFIRMED → CANCELLED` is
    // a legal transition. Ordered by id so that two statements contending for
    // the same rows take them in the same order; the runner's advisory lock
    // already stops two runs of this sweep overlapping, and this holds the line
    // against everything else in the tree that locks a booking.
    //
    // The predicate is the two deadlines written as an `or` rather than as a
    // `least(…)` over both, and the two say exactly the same thing: a hold is due
    // when either clock has passed. What the disjunction buys is that each branch
    // is a column compared to a constant, so Postgres can answer it from
    // `booking_hold_expires_at_idx` and `booking_last_seen_at_idx` instead of
    // evaluating an expression over every booking the property has ever taken —
    // this runs once a minute forever, and a job that got slower every year would
    // be a slow way of eventually not running.
    //
    // A null `last_seen_at` matches neither branch and is not a hold this sweep
    // takes early, which is the right reading: it is a hold created by something
    // with no browser behind it to be present or absent.
    const grace = sql`${`${this.env.BOOKING_HOLD_GRACE_SECONDS} seconds`}::interval`;

    const due = await exec
      .select({
        id: booking.id,
        // Which clock ran out, decided in the same statement that found the row
        // rather than by re-reading the expiry afterwards. It is the whole of the
        // difference below: a TTL that has passed is a hold nobody may keep, and
        // a guest who has merely stopped answering is not.
        ttlPassed: sql<boolean>`${booking.holdExpiresAt} < now()`,
      })
      .from(booking)
      .where(
        and(
          eq(booking.state, "HELD"),
          or(
            lt(booking.holdExpiresAt, sql`now()`),
            lt(booking.lastSeenAt, sql`now() - ${grace}`),
          ),
        ),
      )
      .orderBy(booking.id)
      .for("update");

    const cancelled: string[] = [];

    for (const { id, ttlPassed } of due) {
      // **A hold released early is never one with money in flight.** The guest
      // paying by QR code is in their banking app with this tab backgrounded or
      // closed — which is precisely the moment presence is absent, and precisely
      // the worst moment to put their room back on sale. So a hold that is due
      // only because nobody has said they are there is left alone while an
      // attempt against it is still `PENDING`, and it runs out its TTL like any
      // other. `booking.service.ts` owns what "in flight" means; asking it is
      // what keeps this sweep and the room a guest moves off refusing the same
      // set of stays.
      //
      // The TTL branch is deliberately not guarded the same way, and that is not
      // an oversight to be tidied up on the way past. A hold whose TTL has run
      // out is cancelled whether or not an attempt is open, exactly as it has
      // always been: `confirmPaidHold` and `FR-PAY-05`'s reconciliation are the
      // property's answer to a callback that lands after the room has gone, and
      // changing it here would be a room held indefinitely by an attempt nobody
      // ever finishes — a decision about inventory that the property has not
      // taken.
      if (!ttlPassed && (await this.bookings.hasPaymentInFlight(exec, id))) {
        continue;
      }

      // Never waived. The sweep is a clock and not an authority, and §4 prices
      // an abandoned hold by the same grid as any other cancellation.
      //
      // One reason for both clocks. `HOLD_EXPIRED` is what a hold that ran out
      // is called, and which of the two deadlines arrived first is not a fact
      // anybody prices, reports or acts on differently — a second code would
      // split one event by a detail no reader of it has a use for.
      await this.bookings.cancel(exec, {
        bookingId: id,
        reason: "HOLD_EXPIRED",
        waivedBy: null,
      });
      cancelled.push(id);
    }

    return cancelled;
  }
}
