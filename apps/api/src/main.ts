// reflect-metadata must be evaluated before any decorated class is loaded, so
// it is the first import in the process and nothing may be hoisted above it.
import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module.js";
import { ENV, type Env, parseEnv } from "./config/env.js";
import { loadDotenv } from "./config/load-dotenv.js";

// The adapter is named rather than left to the default: Nest 11's
// platform-express pins Express 5, and P0-PAY's gateway webhooks need real REST
// on a stack whose body parsing we control. Writing it down means a future
// Fastify experiment is a visible change, not a silent one.
async function bootstrap(): Promise<void> {
  loadDotenv();

  // Parsed here as well as in ConfigModule, and deliberately: reaching the
  // container first means a missing variable prints one line rather than a Nest
  // injection stack wrapped around it. parseEnv is pure, so the second call
  // inside the module costs nothing and keeps that module testable on its own.
  parseEnv();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Nothing is written through Nest's default console logger, so the very
    // first line of a boot is already JSON and already correlatable.
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));

  // SIGTERM is how Fly asks for a deploy. Without this the pool is never
  // drained and in-flight queries are cut at the socket.
  app.enableShutdownHooks();

  const env = app.get<Env>(ENV);

  // One proxy in front of this process — Fly's — and its `X-Forwarded-For` is
  // where the caller's address is. Without this, `request.ip` is the proxy on
  // every deployed request, which would make the funnel's rate limit
  // (`hold-rate-limit.guard.ts`) one shared counter for the whole internet and
  // the staff session log a record of Fly talking to itself. `1` and not `true`:
  // trusting the whole chain would let a caller prepend an address of their
  // choosing and get a private counter per forged hop.
  app.set("trust proxy", 1);

  // Two origins, named rather than wildcarded, credentials on. A guest session
  // is a cookie and a staff session sends a bearer token, and neither crosses
  // an origin the browser has not been told to trust — `credentials: true`
  // with a wildcard origin is rejected by every browser anyway, which is the
  // specification agreeing with the RBAC matrix. The public site and the admin
  // console are the only two the matrix trusts with either kind of session.
  app.enableCors({
    origin: [env.WEB_ORIGIN, env.ADMIN_ORIGIN],
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    // Echoed back so the browser exposes the correlation id to page code; a
    // guest quoting an id from a failed booking is worth the header.
    exposedHeaders: ["x-request-id"],
  });

  await app.listen(env.PORT);
}

// A misconfigured process says which variable and stops, with the exit code a
// process supervisor reads — P0-API-04.
bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
