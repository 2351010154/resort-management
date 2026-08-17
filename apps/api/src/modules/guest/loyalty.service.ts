// What a stay earned, written once the account has been agreed — `FR-GST-05`,
// and `docs/architecture/property-and-tariff.md` §7.
//
// `schema/loyalty.ts` holds the shape and this holds the one act: a closed
// folio becomes a ledger row. Four decisions carry most of the weight.
//
// **It runs after the close commits, and it cannot take the close back.** A
// stay that was agreed is agreed; points are a consequence of that, not a
// participant in it. So {@link LoyaltyService.accruePoints} registers its work
// through `afterCommit` and the work opens a transaction of its own — the
// arrangement `payment.service.ts` uses to page about money that has landed,
// and for the identical reason. A failing accrual inside the close's
// transaction would roll back a checkout over a loyalty point, and `FR-FOL-04`
// already refuses that trade for an invoice, which is worth considerably more.
// The ordering comes free with it: a close that rolls back throws the queue
// away unrun, so nothing accrues for a stay the desk did not actually agree.
//
// **A failure is not swallowed, because there is nowhere for it to surface.**
// The caller is on the far side of its own commit and has already answered the
// desk; a thrown error would reach `TransactionRunner`'s post-commit log and
// nothing else, and a guest would be short of points that no screen and no
// sweep would ever notice were missing. So the failure pages, through the same
// `OpsAlertService` a payment landing on a cancelled stay uses. That service
// never throws — `ops-alert.service.ts` argues why — so paging cannot itself
// become the failure.
//
// **Idempotency is `loyalty_ledger_folio_id_unique`, not a check made here.**
// `FR-GST-05` asks for the `FR-PAY-03` pattern, and the pattern is that the
// database refuses the second one. A read-then-insert would pass while two of
// them raced, which is the one arrangement that doubles a guest's balance
// silently — the balance is a sum, so nothing downstream would notice. The
// insert therefore names the conflict and does nothing on it, which is a
// refusal that costs the caller no exception and leaves no aborted
// transaction behind.
//
// Nothing here updates or deletes a ledger row, and nothing here could: 0023's
// trigger raises `MV004` on either, so an accrual that tried to correct itself
// would be refused by Postgres. The correction this design offers instead is
// the one an append-only ledger allows — another row — and v1 has no act that
// writes one.
//
// **Net room revenue is read off the account, not off the booking.**
// `FR-GST-05` says the accrual reads "the final settled folio total, so an
// early departure or discretionary refund cannot overstate points", and the
// account is the only place that total exists: a night the guest did not take
// was never charged or has been reversed, and either way the lines standing on
// the folio are what the property actually billed for rooms. The sum itself is
// `net-room-revenue.ts`, shared with the tier ladder that measures a guest by
// the same figure — that file says why one implementation of it is the whole
// value of §7 having chosen net.

import { PROPERTY_TIME_ZONE } from "@mariva/shared";
import { Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import type { DbExecutor } from "../../database/database.module.js";
import { booking } from "../../database/schema/booking.js";
import { folio, folioPosting } from "../../database/schema/folio.js";
import { loyaltyLedger } from "../../database/schema/loyalty.js";
import {
  afterCommit,
  TransactionRunner,
} from "../../database/transaction-runner.js";
import { OpsAlertService } from "../notification/ops-alert.service.js";
import { SystemConfigService } from "../system-config/system-config.service.js";
import { netRoomRevenue } from "./net-room-revenue.js";

/**
 * §7's expiry, as the date each row carries.
 *
 * Computed by Postgres from the same `now()` that stamps `earned_at` — inside a
 * transaction that is one instant, so the two columns cannot disagree about
 * which year the points were earned in — and read in the property's own zone
 * before the year is taken off it. Taken in UTC instead, a stay closed at 00:30
 * on 1 January in Ho Chi Minh City would be earning in the year before and
 * expiring a whole year early.
 *
 * Not the business date, deliberately. §2's rollover hour decides which
 * *trading day* an instant is reported under, and a property auditing at 04:00
 * would then have a January stay expiring against the previous December. §7
 * states a calendar rule, so this reads the calendar.
 */
const EXPIRES_AT_THE_END_OF_THE_FOLLOWING_YEAR = sql`make_date(
  extract(year from (now() at time zone ${PROPERTY_TIME_ZONE}))::int + 1, 12, 31
)`;

@Injectable()
export class LoyaltyService {
  constructor(
    // The runner rather than the client, because the accrual needs a boundary
    // of its own: the close's transaction is over by the time this runs, and
    // the config read, the revenue sum and the insert have to see one snapshot
    // of the property's configuration and its ledger.
    private readonly transactions: TransactionRunner,
    private readonly configuration: SystemConfigService,
    private readonly alerts: OpsAlertService,
  ) {}

  /**
   * Turns one closed folio into the points it earned, once the close is
   * durable.
   *
   * Takes the closing transaction's executor and writes nothing on it. What it
   * does with it is register the work against it — the shape
   * `PaymentService.pageIfNobodyCanHonour` takes, and for the reason the header
   * gives: awaiting this is not awaiting the accrual, and a caller learns
   * nothing about how it went because there is nothing it could usefully do
   * about it from inside a transaction that has to commit either way.
   *
   * **Nothing raises into the caller, including the second call.** A retried
   * close, a support script and a double-fired job all arrive as the same
   * accrual, and the unique key on the folio is what settles it — quietly,
   * because a second attempt at a stay that has already earned its points is
   * the mechanism working rather than a fault. Anything else that goes wrong
   * pages instead, so the one outcome this cannot have is the silent one.
   */
  async accruePoints(exec: DbExecutor, folioId: string): Promise<void> {
    await afterCommit(exec, async () => {
      try {
        await this.transactions.run((accrual) => this.accrue(accrual, folioId));
      } catch (error) {
        // Whether the page was delivered is not read: a send that failed has
        // already been logged in full by `OpsAlertService`, and this is on the
        // far side of a commit it cannot influence either way.
        await this.alerts.page({
          kind: "loyalty-accrual-failed",
          text:
            `The folio ${folioId} was closed and its loyalty points could not ` +
            "be worked out, so the stay earned nothing. The account is agreed " +
            "and the invoice stands — what is missing is the ledger row, and " +
            "it has to be written by hand once the cause is fixed",
          details: {
            folio: folioId,
            // Rendered rather than narrowed to `Error`, because a responder
            // wants the sentence whatever was raised, and a branch here would
            // be one this file could not honestly exercise.
            cause: String(error),
          },
        });
      }
    });
  }

  /**
   * The ledger row itself, inside its own transaction.
   *
   * **A stay with no account behind it earns nothing, and that is §7 rather
   * than a shortcut.** Points belong to a guest account, and a walk-in the desk
   * registered at the counter has none: `booking.user_id` is null, and
   * `loyalty_ledger.user_id` is `NOT NULL` because there is nobody to credit.
   * `FR-GST-05` says the same in its acceptance note. So the read below asks
   * one question of the stay and stops on the answer, before it reads a
   * configuration it would have no use for.
   *
   * The rate is read here rather than passed in, on `system-config.service.ts`'s
   * rule: what a point is worth is a figure the property may have edited since
   * the desk started the checkout, and the accrual is the moment §7 prices.
   */
  private async accrue(exec: DbExecutor, folioId: string): Promise<void> {
    const [stay] = await exec
      .select({ userId: booking.userId })
      .from(folio)
      .innerJoin(booking, eq(booking.id, folio.bookingId))
      .where(eq(folio.id, folioId))
      .limit(1);

    if (!stay?.userId) {
      return;
    }

    const { pointsPerUnit, earnUnitVnd } =
      await this.configuration.loyaltyRules(exec);
    // One folio, by its id. The scope is the whole of what this caller decides;
    // what counts as room revenue is `net-room-revenue.ts`'s and is the same
    // answer the tier ladder gets.
    const earnedOn = await netRoomRevenue(exec, [
      eq(folioPosting.folioId, folioId),
    ]);

    // Integer arithmetic the whole way, and divided before it is multiplied,
    // which is what §7's two halves actually say: a stay below one earn unit
    // earns nothing at all, and `bigint` division truncates rather than rounds
    // so the property never awards a fraction of a unit it did not sell.
    // `pointsPerUnit` is a count and is widened here, at the one point the two
    // scales meet.
    const earned =
      earnedOn <= 0n
        ? // An account whose room charges were all reversed billed nothing for
          // rooms, and the row still goes in at zero: `schema/loyalty.ts` says a
          // stay that earned nothing still occupies its folio's one row, and
          // `loyalty_ledger_accrues_only` refuses a negative one outright.
          0n
        : (earnedOn / earnUnitVnd) * BigInt(pointsPerUnit);

    await exec
      .insert(loyaltyLedger)
      .values({
        userId: stay.userId,
        folioId,
        pointsEarned: earned,
        expiresAt: EXPIRES_AT_THE_END_OF_THE_FOLLOWING_YEAR,
      })
      // The idempotency, named. `do nothing` rather than a caught `23505`
      // because a caught unique violation has already aborted the transaction
      // it was raised in — the row would be refused and so would everything
      // after it — and rather than a read first, because two accruals racing
      // would both read no row and both insert.
      .onConflictDoNothing({ target: loyaltyLedger.folioId });
  }
}
