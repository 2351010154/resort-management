// §7's two member discounts, as the rows that actually apply them.
//
// `property-and-tariff.md` §7 sets the ladder's discounts at "Silver 5% · Gold
// 10%, applied as a promotions rate modifier (`FR-PRC-03`)", and
// `schema/config.ts` says out loud why they are not `system_config` columns:
// `promotion` already stores them, and a copy in the configuration row would be
// a second authority for one figure. So the discounts exist as two `promotion`
// rows, and this is what puts them there.
//
// **The shape is `SystemConfigSeeder`'s, and so is every argument for it.** It
// writes at boot rather than from `database/seed/`, because that is
// `FR-INV-05`'s demo seed — it empties the property and refuses to run in
// production, and these rows have to exist in production above all. It writes
// once and never again, so a property that retuned Gold to 12% keeps that across
// every later deploy. And a failure is logged rather than thrown, because an
// API that will not boot is worse than one whose Silver guests are quoted the
// undiscounted rate: unseeded, every other route still answers and an `ADMIN`
// can still write the rows.
//
// **The figures are literals here, and that is not §8's "never a constant".**
// §8 forbids the tree from knowing a *tax* rate, on the grounds that a mis-typed
// one produces a legally wrong invoice; `ASM-01` is the open question it is
// waiting on. §7's discounts are the opposite kind of value — the developer's
// proposal until the owner tunes them, marked ⚑ proposed in the same table as
// the tier thresholds, which `schema/config.ts` carries as column defaults for
// exactly this reason. What matters is that the figure is editable without a
// deploy, and the row is what makes it so.
//
// **Both are `PERCENTAGE`.** §7 states them as percentages and
// `rate-calendar.ts` says why the distinction is load-bearing: a percentage
// follows the room rate up when a season changes, which is what a tier discount
// should do, and a fixed amount does not.
//
// No `valid_from` and no `valid_to`. A campaign has a window and a tier discount
// does not — a guest who reached Silver is Silver until the trailing window says
// otherwise, and `promotion`'s nullable ends are what state that.

import { Inject, Injectable, type OnApplicationBootstrap } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import { type Database, DRIZZLE } from "../../database/database.module.js";
import { promotion } from "../../database/schema/pricing.js";

/**
 * The two rows, exactly as §7 states them.
 *
 * Exported so the case that proves a Silver guest is quoted 5% can assert
 * against the same figures the property is seeded with, rather than against a
 * number typed twice.
 */
export const LOYALTY_PROMOTIONS = [
  {
    code: "LOYALTY_SILVER",
    name: "Silver member discount",
    description: "5% off the room rate for guests standing at Silver",
    type: "PERCENTAGE",
    value: -5n,
    requiresLoyaltyTier: "SILVER",
  },
  {
    code: "LOYALTY_GOLD",
    name: "Gold member discount",
    description: "10% off the room rate for guests standing at Gold",
    type: "PERCENTAGE",
    value: -10n,
    requiresLoyaltyTier: "GOLD",
  },
] as const;

@Injectable()
export class LoyaltyPromotionSeeder implements OnApplicationBootstrap {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("LoyaltyPromotionSeeder");
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      // One statement for both rows, and `on conflict do nothing` on the code:
      // a property that retuned one of them keeps that row and still gets the
      // other if it was somehow missing. `returning` distinguishes written from
      // already there, for the reason the configuration seeder gives — an
      // operator who expected a change deserves to be told it had no effect.
      const written = await this.db
        .insert(promotion)
        .values([...LOYALTY_PROMOTIONS])
        .onConflictDoNothing({ target: promotion.code })
        .returning({ code: promotion.code });

      this.logger.info(
        { seeded: written.map((row) => row.code) },
        written.length > 0
          ? "loyalty discounts seeded"
          : "loyalty discounts already set — the proposed figures were not applied, and the rows are the authority from here on",
      );
    } catch (error) {
      this.logger.error(
        { err: error },
        "could not seed the loyalty discounts — guests above MEMBER are quoted the undiscounted room rate until an ADMIN writes the rows",
      );
    }
  }
}
