import { Module } from "@nestjs/common";
import { BookingModule } from "../modules/booking/booking.module.js";
import { HoldExpirySweep } from "../modules/booking/hold-expiry-sweep.js";
import { NoShowSweep } from "../modules/booking/no-show-sweep.js";
import { EInvoiceJob } from "../modules/folio/e-invoice.job.js";
import { FolioModule } from "../modules/folio/folio.module.js";
import { RoomChargeSweep } from "../modules/folio/room-charge-sweep.js";
import { NotificationModule } from "../modules/notification/notification.module.js";
import { PaymentModule } from "../modules/payment/payment.module.js";
import { ReconciliationJob } from "../modules/payment/reconciliation.job.js";
import { JobRunner } from "./job-runner.service.js";
import { JobScheduler } from "./job-scheduler.service.js";
import { JobTriggerController } from "./job-trigger.controller.js";
import { SWEEP_JOBS, type SweepJob } from "./sweep-job.js";

// The scheduler and the sweeps that run on it —
// docs/architecture/repository-structure.md §apps/api, and `prd-m4.md`'s third
// scope decision, which fixes the shape of this: a minimal scheduler carrying a
// hand-edited list of sweeps, every one of them idempotent and reachable by
// hand. It opened at two and `M6`'s ledger brought two more, the night's rent
// and the invoice drawn once a stay's account is agreed; what the decision
// pinned was the scheduler's smallness, not a count.
//
// This is not a domain module. It owns no table and answers no question about
// the property; it is the machinery a sweep is mounted on, and the sweeps
// themselves belong to whichever requirement asked for them.
//
// `BookingModule` is imported for two providers. `BusinessDateService` is what
// `JobRunner` asks what day it is when neither entry point named a date —
// reading the rollover hour out of the `system_config` row here instead would be
// a second implementation of the 04:00 rule, and the two would agree right up
// until one of them was changed.
// `BookingService` is what `HoldExpirySweep` cancels through and what
// `NoShowSweep` transitions through, for the same kind of reason, which each of
// `hold-expiry-sweep.ts` and `no-show-sweep.ts` argues where it belongs.
//
// `FolioModule` is imported for `FolioService`, which is what `RoomChargeSweep`
// posts a night through. Same reason again, and sharpest here: `FR-FOL-02` has
// the rates read at posting time and the three lines written by one statement,
// and a sweep that assembled its own `insert` would be a second implementation
// of a decomposition that has to sum back to the figure the guest agreed to.
//
// The sweep classes themselves are provided here rather than by the modules they
// belong to. A sweep is only ever resolved through the registry below, so
// providing it next to the registry is what keeps "which sweeps run" answerable
// from this one file; what it owns — the question it asks and the rows it
// writes — stays in its own module.
//
// `EInvoiceJob` is the exception and is provided by `FolioModule`, which
// exports it for the registry below. It is constructed from `E_INVOICE_PORT`,
// and `folio.module.ts` argues at length that the token binding whoever issues
// the property's invoices does not leave that module. The registry still names
// the job, so this file still answers what runs; it just does not build this
// one.
//
// `PaymentModule` is imported for `ReconciliationService` and for the
// `PAYMENT_GATEWAY` binding behind it, which `ReconciliationJob` needs together:
// the comparison is one module's and the report it compares has to be fetched
// through the port that module binds. Constructing either here would be a second
// `VnpayAdapter` reading the same terminal, and a second comparison for the
// screen that shows what it found to disagree with.
//
// `NotificationModule` is imported for `OpsAlertService`, which is how a
// discrepancy reaches a person. Same reason once more — how anything leaves this
// process is decided in one place, and `notification.module.ts` is it.
//
// `DatabaseModule` is global, so nothing is imported for the pool pg-boss
// borrows or for the transaction runner that opens a run's boundary.
@Module({
  imports: [BookingModule, FolioModule, PaymentModule, NotificationModule],
  controllers: [JobTriggerController],
  providers: [
    {
      provide: SWEEP_JOBS,
      // The registry, and it is deliberately a list somebody has to edit. A
      // sweep joins by being added to `providers` above and to `inject` below;
      // the factory collects them in that order. Discovery by decorator scan
      // would save the line and cost the ability to read this file and know
      // what runs.
      inject: [
        HoldExpirySweep,
        NoShowSweep,
        RoomChargeSweep,
        EInvoiceJob,
        ReconciliationJob,
      ],
      useFactory: (...jobs: SweepJob[]): readonly SweepJob[] => jobs,
    },
    HoldExpirySweep,
    NoShowSweep,
    RoomChargeSweep,
    ReconciliationJob,
    JobRunner,
    JobScheduler,
  ],
  // Exported so a sweep's own module could run it directly if one ever needs to
  // — and so a spec can reach the runner without going through HTTP.
  exports: [JobRunner],
})
export class JobsModule {}
