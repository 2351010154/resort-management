// The one route behind `system.business-date` — what day the property is
// having, for any screen that needs the day and none of the figures beside it.
//
// **It resolves nothing itself.** `BusinessDateService.current` is the
// property's rollover rule and this hands it a transaction and puts its answer
// on the wire. That is the whole of the file, deliberately: the housekeeping
// board answers the same question on its own response, and two routes that each
// did the arithmetic would eventually do it differently. Both call the one
// service, so the day this returns and the day the board returns are the same
// day for the same moment.
//
// **Here rather than in the booking module the service lives in.** The day is
// derived from `system_config.business_date_rollover_hour`, which is this
// module's row, and the path says so. The service is provided alongside — the
// way `housekeeping.module.ts` and `folio.module.ts` provide it — because it is
// a two-field class over `SystemConfigService`, which is already here.
//
// **A read opens a transaction**, for `system-config.controller.ts`'s reason:
// `database.module.ts` hands a controller a `TransactionRunner` and not the
// client, precisely so a controller cannot run a query of its own. The hour is
// read inside it, so the answer comes from one snapshot.
//
// Nothing about the configuration leaves through here. The response carries the
// resolved date and has no field an hour, a rate or a credential could travel
// in — which is what makes the row grantable to every member of staff while
// `system.config` stays with `MANAGER` and `ADMIN`.

import { contract } from "@mariva/shared";
import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { RequiresCapability } from "../../common/auth/access.decorators.js";
import { TransactionRunner } from "../../database/transaction-runner.js";
import { BusinessDateService } from "../booking/business-date.service.js";

@Controller()
export class BusinessDateController {
  constructor(
    private readonly businessDates: BusinessDateService,
    private readonly transactions: TransactionRunner,
  ) {}

  /** The property's day, as every staff screen renders against it. */
  @RequiresCapability("system.business-date", "read")
  @Implement(contract.businessDate.read)
  read() {
    return implement(contract.businessDate.read).handler(async () => {
      const on = await this.transactions.run((exec) =>
        this.businessDates.current(exec),
      );

      return { businessDate: on.toString() };
    });
  }
}
