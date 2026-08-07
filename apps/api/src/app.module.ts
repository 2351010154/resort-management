import { randomUUID } from "node:crypto";
import { Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import { ConfigModule } from "./config/config.module.js";
import { ENV, type Env } from "./config/env.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthModule } from "./health/health.module.js";
import { JobsModule } from "./jobs/jobs.module.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { BookingModule } from "./modules/booking/booking.module.js";
import { GuestModule } from "./modules/guest/guest.module.js";
import { HousekeepingModule } from "./modules/housekeeping/housekeeping.module.js";
import { IdentityModule } from "./modules/identity/identity.module.js";
import { InventoryModule } from "./modules/inventory/inventory.module.js";
import { NotificationModule } from "./modules/notification/notification.module.js";
import { PaymentModule } from "./modules/payment/payment.module.js";
import { PricingModule } from "./modules/pricing/pricing.module.js";
import { SystemConfigModule } from "./modules/system-config/system-config.module.js";

// The header a load balancer or an upstream service may already have stamped.
// Reusing it is what makes a correlation id correlate across two processes
// rather than two halves of one request.
const CORRELATION_HEADER = "x-request-id";

// The root module is a registry, not a place logic lives. Domain modules from
// docs/architecture/repository-structure.md register here as they are built —
// identity and auth first (P0-AUTH), then inventory and pricing at M3. Nothing
// is registered speculatively: an empty folder is a reservation, an imported
// empty module is a lie the dependency graph tells.
@Module({
  imports: [
    ConfigModule,

    // Structured logging — `P0-API-05`. pino-http emits exactly one line per
    // completed request; nothing in the app calls console.log, because a line
    // without the request id cannot be joined to anything.
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          genReqId: (request, response) => {
            const existing = request.headers[CORRELATION_HEADER];
            const id = (Array.isArray(existing) ? existing[0] : existing)
              ?.trim();
            const correlationId = id && id.length > 0 ? id : randomUUID();

            // Echoed back so a client can quote the id from a failed call
            // instead of describing the failure.
            response.setHeader(CORRELATION_HEADER, correlationId);
            return correlationId;
          },
          // Every request, including the health probes, emits its line. Quiet
          // probes look like a quiet system right up to the moment the question
          // is "when did it last answer".
          customLogLevel: (_request, response, error) => {
            if (error || response.statusCode >= 500) return "error";
            if (response.statusCode >= 400) return "warn";
            return "info";
          },

          // pino's default error serializer copies every own property off the
          // error. `pg` hangs its whole client — connection parameters
          // included — on a connection error, so the default turns one failed
          // query into kilobytes of log carrying credentials-adjacent fields.
          // Four fields diagnose an error; the object graph behind it does not.
          serializers: {
            err: (error: Error & { code?: string }) => ({
              // `pg` throws errors whose `name` is unset, and the class is the
              // first thing worth knowing when triaging one.
              type: error.name ?? error.constructor?.name,
              message: error.message,
              code: error.code,
              stack: error.stack,
            }),
          },
          redact: {
            paths: [
              "req.headers.authorization",
              "req.headers.cookie",
              "res.headers['set-cookie']",
            ],
            censor: "[redacted]",
          },
        },
      }),
    }),

    DatabaseModule,
    HealthModule,

    // `AuthModule` registers the global `AccessGuard`, so importing it changes
    // every route in the application: one without a `@RequiresCapability()` or
    // an `@Unguarded()` stops answering. That is the intended effect —
    // docs/architecture/rbac-matrix.md §2 — and it is why the two modules it
    // depends on are listed above it rather than pulled in implicitly.
    NotificationModule,
    IdentityModule,
    AuthModule,

    // M6, and before every module that will read it. It registers no route
    // today; what it registers is the boot provider that writes `system_config`
    // from the environment, and the service a posting reads the VAT and
    // service-charge figures back through. Ahead of the domain modules so the
    // row exists by the time anything posts against it — and after `AuthModule`
    // because the `ADMIN` screen that edits it is governed by the guard that
    // module installs.
    SystemConfigModule,

    // After `AuthModule`, because every route it registers is governed by the
    // guard that module installs — including the two availability routes, whose
    // matrix row is the one that lets a stranger through.
    InventoryModule,

    // After `InventoryModule` only to read in the order the two are built.
    // Neither imports the other: availability reaches the rate calendar in SQL,
    // which is a read across the boundary and not a dependency Nest resolves.
    PricingModule,

    // M4. `BookingModule` genuinely depends on `InventoryModule` — every
    // creating and cancelling transition ends in `InventoryService` — so it is
    // listed after it. The other two do not: a room's condition and a guest's
    // record are written beside a booking, never through it.
    BookingModule,
    HousekeepingModule,
    GuestModule,

    // M6, and after both of the modules it reaches into: `FolioModule` for the
    // account a verified callback posts to, `BookingModule` for the rollover
    // rule that dates the posting. It registers the two routes VNPay calls —
    // both unguarded, and both governed by the guard `AuthModule` installs like
    // every other route here — and the binding of `PAYMENT_GATEWAY` to the one
    // adapter that knows what VNPay is, which is the whole of `FR-PAY-01`.
    PaymentModule,

    // Last, and after every module that could register a sweep. `JobsModule`
    // starts pg-boss on `onApplicationBootstrap`, so anything it is meant to
    // schedule has to have been provided by then — and its own trigger route is
    // governed by the guard `AuthModule` installs, like every other route here.
    JobsModule,
  ],
})
export class AppModule {}
