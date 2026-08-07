import { Module } from "@nestjs/common";
import { SystemConfigModule } from "../system-config/system-config.module.js";
import { FolioService } from "./folio.service.js";

// The append-only ledger one stay runs up — `FR-FOL-01`, and
// docs/architecture/repository-structure.md §apps/api.
//
// `SystemConfigModule` is imported rather than read around: `FR-FOL-02` has the
// rates read at posting time, and `SystemConfigService` is the reader — exported
// by that module for this caller and no other. It takes the posting's executor,
// so the rate and the lines it is applied to come out of one transaction.
//
// The service is exported before this module has a controller, which is the same
// arrangement `guest` and `housekeeping` opened with and for a sharper reason
// here: `booking.module.ts` binds `FOLIO_PORT` to it so the check-out guard reads
// a real balance. Reaching it over HTTP would answer that guard from a different
// connection than the transition it guards.
//
// The dependency between the two modules runs one way at runtime. `booking`
// imports this module for the binding; this module names `booking` only for the
// port's type, which erases, so there is no cycle to break with `forwardRef`.
//
// `DatabaseModule` is global, so nothing is imported for the Drizzle client the
// port's balance read takes or for the executor every write is handed.
@Module({
  imports: [SystemConfigModule],
  providers: [FolioService],
  exports: [FolioService],
})
export class FolioModule {}
