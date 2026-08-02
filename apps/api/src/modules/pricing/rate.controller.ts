// Rate plans and the rate calendar — the `pricing.rate-plans` row of the
// matrix, which gives `RECEPTIONIST` and `ACCOUNTANT` 👁 and `MANAGER` and
// `ADMIN` ✅.
//
// One controller for two tables because it is one row, and the row is the unit
// of authority: a receptionist quoting a rate at the desk needs to see the
// plans and the published calendar, and neither of them may change a price.
// That split is the second argument to `@RequiresCapability` and nothing else —
// no check written into a handler, no role named in this file.
//
// The row also names promotions, and there is no route for them. The table is
// `M3` task 7 and unbuilt; a route against it would be a promise the client is
// typed against and nobody can keep.

import { contract } from "@mariva/shared";
import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { RequiresCapability } from "../../common/auth/access.decorators.js";
import { RateCalendarService } from "./rate-calendar.service.js";
import { RatePlanService } from "./rate-plan.service.js";

@Controller()
export class RateController {
  constructor(
    private readonly plans: RatePlanService,
    private readonly calendar: RateCalendarService,
  ) {}

  @RequiresCapability("pricing.rate-plans", "read")
  @Implement(contract.pricing.listRatePlans)
  listRatePlans() {
    return implement(contract.pricing.listRatePlans).handler(async () => ({
      plans: await this.plans.list(),
    }));
  }

  @RequiresCapability("pricing.rate-plans")
  @Implement(contract.pricing.updateRatePlan)
  updateRatePlan() {
    return implement(contract.pricing.updateRatePlan).handler(({ input }) =>
      this.plans.update(input),
    );
  }

  @RequiresCapability("pricing.rate-plans", "read")
  @Implement(contract.pricing.readRateCalendar)
  readRateCalendar() {
    return implement(contract.pricing.readRateCalendar).handler(
      async ({ input }) => ({
        roomType: input.roomType,
        // The service already works in the wire's ISO text here — a night of
        // the calendar is read straight out of a `date` column and never
        // becomes a `CalendarDate` on the way, so there is no codec crossing to
        // perform. The two request dates are the ones `stayDateSchema` decoded.
        nights: await this.calendar.read(input),
      }),
    );
  }

  @RequiresCapability("pricing.rate-plans")
  @Implement(contract.pricing.setRateCalendar)
  setRateCalendar() {
    return implement(contract.pricing.setRateCalendar).handler(
      async ({ input }) => ({
        roomType: input.roomType,
        nights: await this.calendar.set(input),
      }),
    );
  }
}
