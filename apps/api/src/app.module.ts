import { randomUUID } from "node:crypto";
import { Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import { ConfigModule } from "./config/config.module.js";
import { ENV, type Env } from "./config/env.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthModule } from "./health/health.module.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { IdentityModule } from "./modules/identity/identity.module.js";
import { InventoryModule } from "./modules/inventory/inventory.module.js";
import { NotificationModule } from "./modules/notification/notification.module.js";

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

    // After `AuthModule`, because every route it registers is governed by the
    // guard that module installs — including the two availability routes, whose
    // matrix row is the one that lets a stranger through.
    InventoryModule,
  ],
})
export class AppModule {}
