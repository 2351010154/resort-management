import { Global, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { AuditActorInterceptor } from "../../common/audit/audit.interceptor.js";
import { AuditService } from "./audit.service.js";

// The change log — docs/architecture/repository-structure.md's `audit` row,
// "the change log every state-changing action writes to".
//
// Two halves that have to arrive together. The interceptor puts the acting
// member of staff into scope for the whole request; the service files rows
// against them. Registering one without the other gives either an actor nothing
// reads or a writer with nobody to name, so they are one module.
//
// `@Global()`, and it is the same reason `DatabaseModule` is. Every module that
// writes state will eventually inject `AuditService` — `FR-AUD-01` says every
// one — and an import line in each of them is a list that has to be kept
// complete by hand, whose omission is a module that silently audits nothing.
// The alternative to a global is not a tighter boundary, it is a boundary
// nobody notices is missing.
//
// Registering `APP_INTERCEPTOR` here changes every route in the application,
// exactly as `AuthModule` registering `APP_GUARD` does. Nest runs global
// interceptors outermost, so this wraps the one `@Implement` installs and the
// actor is in scope before an oRPC handler starts.
@Global()
@Module({
  providers: [
    AuditService,
    { provide: APP_INTERCEPTOR, useClass: AuditActorInterceptor },
  ],
  exports: [AuditService],
})
export class AuditModule {}
