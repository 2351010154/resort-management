import { Global, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { AuditActorInterceptor } from "../../common/audit/audit.interceptor.js";
import { AuditController } from "./audit.controller.js";
import { AuditService } from "./audit.service.js";

// The change log — docs/architecture/repository-structure.md's `audit` row,
// "the change log every state-changing action writes to".
//
// Two halves that have to arrive together. The interceptor puts the acting
// member of staff into scope for the whole request; the service files rows
// against them. Registering one without the other gives either an actor nothing
// reads or a writer with nobody to name, so they are one module.
//
// The controller is the third half and the only one anybody outside this module
// calls directly: `FR-AUD-01` is what the two above write, and `FR-AUD-02` is
// the viewer that reads it back. It is a controller in a `@Global()` module,
// which sounds like a mistake and is not — Nest mounts a module's routes once
// whether or not anything imports it, and globality is about what the *providers*
// are visible to. The alternative, a fourth module holding one controller that
// injects a service from this one, would put the read and the write of one table
// behind two boundaries for no rule either of them enforces.
//
// `@Global()`, and it is the same reason `DatabaseModule` is — but the reason
// is now the interceptor below rather than the service beside it. The
// interceptor has to run on every route in the application, including ones
// written months from now by somebody who has not read this file, and a module
// that has to be imported to take effect is a module somebody forgets. What
// `FR-AUD-01` asks of the modules that write state is answered by the triggers
// on their tables, so none of them injects anything from here.
//
// Registering `APP_INTERCEPTOR` here changes every route in the application,
// exactly as `AuthModule` registering `APP_GUARD` does. Nest runs global
// interceptors outermost, so this wraps the one `@Implement` installs and the
// actor is in scope before an oRPC handler starts.
@Global()
@Module({
  controllers: [AuditController],
  providers: [
    AuditService,
    { provide: APP_INTERCEPTOR, useClass: AuditActorInterceptor },
  ],
  exports: [AuditService],
})
export class AuditModule {}
