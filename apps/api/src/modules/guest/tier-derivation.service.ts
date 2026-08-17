// What tier a guest is standing at, worked out from what they have actually
// done — `FR-GST-04`, and `docs/architecture/property-and-tariff.md` §7.
//
// **Nothing here writes, and that is the requirement rather than a property of
// this implementation.** `FR-GST-04` opens with "VIP tier is a **derived
// value**, never hand-set", and the schema is built to keep it that way: no
// table carries a tier column, and `schema/config.ts` stores the four
// thresholds precisely so the answer can be recomputed instead of remembered. A
// stored tier is a second authority that goes stale the moment a stay ages out
// of the window — silently, because nothing recomputes it on the way past. So
// {@link TierDerivationService.deriveTier} takes thresholds and history in and
// hands a tier back, and a caller that wants one asks again.
//
// **MEMBER is the absence of a match.** `packages/shared/src/rate-calendar.ts`
// fixes `LOYALTY_TIERS` at Silver and Gold and says why: that tuple types a
// *promotion's gate*, §7 gives the base tier no discount, and a promotion gated
// on MEMBER would be gated on nothing. The base tier therefore has no row, no
// enum member and nothing to look up — it is what a guest who reached neither
// rung is, and it is spelled out in this file's return type and nowhere else.
//
// ## The window, and why both axes share one
//
// §7 measures "trailing 12 months" and `FR-GST-04` "rolling-12-month stay count
// **or** net room revenue". Two axes, one window: a stay either falls inside the
// trailing year or it does not, and it has to give the same answer to both
// questions. A window that ran on the departure date for one axis and on the
// close of the account for the other would let a stay count toward the stays and
// not toward the revenue it billed, which is a ladder nobody could reconcile
// against the guest's own history.
//
// The window runs on `booking.check_out_date` — the date the stay ended, which
// is what "trailing 12 months" is trailing from. It is a `date` and not an
// instant, deliberately, and `schema/booking.ts` gives the reason: the property's
// stay dates are calendar dates in its own zone, so the comparison needs no
// timezone arithmetic and cannot pick up the off-by-one night that classifying a
// timestamp invites. `assignment.service.ts` moves that column back when a stay
// is shortened, so it is the departure that happened rather than the one that
// was sold.
//
// The window's far end is the property's own today — `BusinessDateService`,
// not the calendar — because §2's rollover hour is what the rest of the system
// means by "today" and a derivation run during the night audit would otherwise
// be measuring against a day the property has not started yet.
//
// ## What each axis counts
//
// **Stays** are bookings that reached `CHECKED_OUT`. `state-machine.ts` makes
// that terminal and reachable only from `CHECKED_IN`, so it is exactly the set
// of stays the guest slept: a cancellation, a no-show and a hold that expired
// are all structurally excluded without a rule saying so — the same property
// §7 relies on when it puts the accrual at the folio close.
//
// **Net room revenue** is the same figure the accrual earns points on, summed
// over the closed accounts of those same stays, and it is read through the one
// implementation in `net-room-revenue.ts`. Closed, because `FR-GST-05` calls the
// closed folio "the final settled folio total" and an account still taking lines
// has not said what the stay came to yet. Net, because `FR-GST-04` requires that
// "a change to the `ASM-01` tax config cannot silently move tier boundaries" —
// and it cannot, because no VAT or service-charge line is ever selected.

import type { StayDate } from "@mariva/shared";
import { Injectable } from "@nestjs/common";
import { and, count, eq, gte, type SQL } from "drizzle-orm";
import type { DbExecutor } from "../../database/database.module.js";
import { booking } from "../../database/schema/booking.js";
import { folio } from "../../database/schema/folio.js";
import { BusinessDateService } from "../booking/business-date.service.js";
import { SystemConfigService } from "../system-config/system-config.service.js";
import { netRoomRevenue } from "./net-room-revenue.js";

/**
 * The three rungs of §7's ladder, as an answer rather than as stored state.
 *
 * `LOYALTY_TIERS` holds the two a promotion can be gated on and is not widened
 * to hold the third — see the header. This union is where the base tier is
 * named, and it is named as a literal because there is no row it could be read
 * from.
 */
export type DerivedTier = "MEMBER" | "SILVER" | "GOLD";

/** §7's window, stated once. */
const TRAILING_MONTHS = 12;

@Injectable()
export class TierDerivationService {
  constructor(
    private readonly configuration: SystemConfigService,
    private readonly businessDates: BusinessDateService,
  ) {}

  /**
   * The tier this guest is standing at right now.
   *
   * Takes the caller's executor and issues four statements on it, every one of
   * them a read. All four thresholds arrive in the first of them on purpose —
   * `system-config.service.ts` argues it: `READ COMMITTED` takes a fresh
   * snapshot per statement, so a rung read at a time could straddle an `ADMIN`
   * edit and measure a guest against a ladder that never existed. The property's
   * day is read separately because it is a different figure with a different
   * owner, and an edit landing between the two moves the window's edge by a day
   * rather than putting a guest on a ladder nobody set.
   *
   * **Either axis reaches a rung, and the highest one reached is the answer.**
   * §7 spells both rungs with an "or" — 2 stays *or* 15,000,000 ₫ — so a guest
   * who came twice and a guest who came once and spent the same money arrive at
   * Silver by different routes. Gold is tested first because
   * `schema/config.ts` permits a property to set the two rungs equal, and on an
   * equal ladder the guest is at the higher of them.
   *
   * A guest with no history at all reaches neither and is a MEMBER. That branch
   * costs the same two reads as any other, which is what keeps this method one
   * shape: there is no stored tier to short-circuit to and no row whose absence
   * would mean anything.
   */
  async deriveTier(
    exec: DbExecutor,
    guestUserId: string,
  ): Promise<DerivedTier> {
    const { silverStays, silverRevenueVnd, goldStays, goldRevenueVnd } =
      await this.configuration.tierThresholds(exec);

    const today = await this.businessDates.current(exec);
    const since = today.subtract({ months: TRAILING_MONTHS });
    const stayed = staysWithin(guestUserId, since);

    const stays = await this.countStays(exec, stayed);
    // The revenue axis asks about the same stays and adds the one condition the
    // count has no use for: the account has been agreed. A stay whose folio is
    // still open counts as a stay and bills nothing yet, which is the honest
    // reading of both — the guest has been, and what they came to is not
    // settled.
    const revenue = await netRoomRevenue(exec, [
      ...stayed,
      eq(folio.state, "CLOSED"),
    ]);

    if (stays >= goldStays || revenue >= goldRevenueVnd) {
      return "GOLD";
    }

    if (stays >= silverStays || revenue >= silverRevenueVnd) {
      return "SILVER";
    }

    return "MEMBER";
  }

  /**
   * How many stays the guest finished inside the window.
   *
   * Its own statement rather than a second aggregate beside the revenue sum,
   * because the two count different things: joining the postings to reach the
   * revenue multiplies each stay by its lines, and a stay that billed no room
   * charge at all — a comped night, an account still open — would drop out of a
   * count taken across that join. A stay is a stay whatever its account says.
   */
  private async countStays(exec: DbExecutor, stayed: SQL[]): Promise<number> {
    const [counted] = await exec
      .select({ stays: count() })
      .from(booking)
      .where(and(...stayed));

    return counted?.stays ?? 0;
  }
}

/**
 * The guest's finished stays inside §7's trailing window — the one scope both
 * axes are measured over.
 *
 * A function and not two inline predicates, because the two axes agreeing about
 * which stays are in the window is the whole of what makes the ladder
 * reconcilable against a guest's own history.
 *
 * The bound is inclusive: a stay that departed exactly twelve months ago is
 * still inside a trailing twelve months, and it is the last day it is.
 */
function staysWithin(guestUserId: string, since: StayDate): SQL[] {
  return [
    eq(booking.userId, guestUserId),
    eq(booking.state, "CHECKED_OUT"),
    gte(booking.checkOutDate, since.toString()),
  ];
}
