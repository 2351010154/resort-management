import { Module } from "@nestjs/common";
import { LoyaltyPromotionSeeder } from "./loyalty-promotion.seeder.js";
import { RateCalendarService } from "./rate-calendar.service.js";
import { RatePlanService } from "./rate-plan.service.js";
import { RateController } from "./rate.controller.js";
import { StayRestrictionController } from "./stay-restriction.controller.js";
import { StayRestrictionService } from "./stay-restriction.service.js";

// What a night costs and whether it may be sold —
// docs/architecture/repository-structure.md §apps/api.
//
// The tables here are the ones `InventoryModule`'s availability query reads
// across the boundary, and the direction is one-way on purpose: pricing owns
// `rate_plan`, `rate_calendar` and `stay_restriction` and knows nothing about
// what is left to sell. A rate calendar that consulted inventory would be a
// price that depends on stock, which is a revenue-management feature nobody has
// asked for and a very hard one to take back out.
//
// Two controllers for one module, split where the RBAC matrix splits: rates and
// stay restrictions are separate rows with different columns, so a route that
// moved between them would change who may call it.
//
// Nothing is exported. Every caller of these tables today reaches them through
// SQL in the availability query rather than through a service — the argument is
// in `inventory.module.ts` — so an export would be an interface with no
// implementation behind the need for it.
//
// `DatabaseModule` is global, so nothing is imported here for the
// `TransactionRunner` the controllers open a boundary with. The three writes
// file no change-log rows of their own: the triggers on `rate_plan`,
// `rate_calendar` and `stay_restriction` file them as the rows move.
//
// `LoyaltyPromotionSeeder` is a provider and not a controller's collaborator: it
// runs once at bootstrap and answers nothing. It belongs here because the rows
// it writes are `promotion` rows and this module owns that table — §7 states the
// discount and `FR-PRC-03` is the path it rides, so the discount is a pricing
// row rather than a guest one however much §7 is about guests.
@Module({
  controllers: [RateController, StayRestrictionController],
  providers: [
    RatePlanService,
    RateCalendarService,
    StayRestrictionService,
    LoyaltyPromotionSeeder,
  ],
})
export class PricingModule {}
