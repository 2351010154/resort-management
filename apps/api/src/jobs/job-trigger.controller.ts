// Running a sweep by hand — `operations.night-audit-trigger`, MANAGER and ADMIN.
//
// The route exists for two people. One is a manager the morning after a night
// the scheduler did not run, who needs yesterday's arrivals marked no-show
// against yesterday's business date rather than today's. The other is a test,
// which is the reason `prd-m4.md` asks for the route at all: a sweep that can
// only be reached by waiting for a cron cannot be asserted on.
//
// No transaction is opened here, and that is the one place this file departs
// from `closure.controller.ts`. The boundary a run needs is the run's, and the
// cron path has no controller to open it — `job-runner.service.ts` argues it out.
// What this does own is the crossing every controller here owns: an ISO date on
// the wire, a `CalendarDate` inside.

import { contract } from "@mariva/shared";
import { Controller } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import { RequiresCapability } from "../common/auth/access.decorators.js";
import { BusinessDateService } from "../modules/booking/business-date.service.js";
import { JobRunner } from "./job-runner.service.js";

@Controller()
export class JobTriggerController {
  constructor(
    private readonly runner: JobRunner,
    private readonly businessDates: BusinessDateService,
  ) {}

  @RequiresCapability("operations.night-audit-trigger")
  @Implement(contract.jobs.trigger)
  trigger() {
    return implement(contract.jobs.trigger).handler(async ({ input }) => {
      const job = this.runner.find(input.job);

      if (!job) {
        // The registered names are in the message because the alternative is a
        // 404 that leaves the operator guessing at a slug. Nothing here is
        // secret: the caller already holds a capability two roles have.
        const known = this.runner.all.map((each) => each.name).join(", ");

        throw new ORPCError("NOT_FOUND", {
          message: `No sweep named ${input.job}. Registered: ${known || "none"}`,
        });
      }

      // Absent, today — the operator's meaning. Present, the date named, which
      // is what makes a second run over the same date something a test can ask
      // for rather than something it has to wait for.
      const businessDate = input.businessDate ?? this.businessDates.current();
      const run = await this.runner.run(job, businessDate, "MANUAL");

      return {
        job: run.job,
        businessDate: run.businessDate.toString(),
        affected: run.affected,
      };
    });
  }
}
