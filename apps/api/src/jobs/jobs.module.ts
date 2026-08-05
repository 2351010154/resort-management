import { Module } from "@nestjs/common";
import { BookingModule } from "../modules/booking/booking.module.js";
import { HoldExpirySweep } from "../modules/booking/hold-expiry-sweep.js";
import { JobRunner } from "./job-runner.service.js";
import { JobScheduler } from "./job-scheduler.service.js";
import { JobTriggerController } from "./job-trigger.controller.js";
import { SWEEP_JOBS, type SweepJob } from "./sweep-job.js";

// The scheduler and the sweeps that run on it —
// docs/architecture/repository-structure.md §apps/api, and `prd-m4.md`'s third
// scope decision, which fixes the scale of this: a minimal scheduler carrying
// exactly two sweeps, both idempotent and both reachable by hand.
//
// This is not a domain module. It owns no table and answers no question about
// the property; it is the machinery a sweep is mounted on, and the sweeps
// themselves belong to whichever requirement asked for them.
//
// `BookingModule` is imported for two providers. `BusinessDateService` is what
// the scheduled path asks what day it is — reading the rollover hour out of the
// environment here instead would be a second implementation of the 04:00 rule,
// and the two would agree right up until one of them was changed.
// `BookingService` is what `HoldExpirySweep` cancels through, for the same kind
// of reason, which `hold-expiry-sweep.ts` argues where it belongs.
//
// The sweep classes themselves are provided here rather than by the modules they
// belong to. A sweep is only ever resolved through the registry below, so
// providing it next to the registry is what keeps "which sweeps run" answerable
// from this one file; what it owns — the question it asks and the rows it
// writes — stays in its own module.
//
// `DatabaseModule` is global, so nothing is imported for the pool pg-boss
// borrows or for the transaction runner that opens a run's boundary.
@Module({
  imports: [BookingModule],
  controllers: [JobTriggerController],
  providers: [
    {
      provide: SWEEP_JOBS,
      // The registry, and it is deliberately a list somebody has to edit. A
      // sweep joins by being added to `providers` above and to `inject` below;
      // the factory collects them in that order. Discovery by decorator scan
      // would save the line and cost the ability to read this file and know
      // what runs.
      //
      // The no-show sweep lands here as its own requirement is built.
      inject: [HoldExpirySweep],
      useFactory: (...jobs: SweepJob[]): readonly SweepJob[] => jobs,
    },
    HoldExpirySweep,
    JobRunner,
    JobScheduler,
  ],
  // Exported so a sweep's own module could run it directly if one ever needs to
  // — and so a spec can reach the runner without going through HTTP.
  exports: [JobRunner],
})
export class JobsModule {}
