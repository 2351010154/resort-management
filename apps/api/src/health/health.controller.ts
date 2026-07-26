import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from "@nestjs/common";
import { InjectPinoLogger, type PinoLogger } from "nestjs-pino";
import type pg from "pg";
import { Unguarded } from "../common/auth/access.decorators.js";
import { PG_POOL } from "../database/database.module.js";

type HealthReport = {
  readonly status: "ok";
  readonly database: "up";
};

// The endpoint Better Stack polls and Fly restarts on — `P0-INF-07`. What it
// must never do is report the process, because a Node process that has lost
// Postgres still answers, and a probe that only proves the event loop turns
// pages nobody.
@Controller("health")
export class HealthController {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @InjectPinoLogger("HealthController") private readonly logger: PinoLogger,
  ) {}

  // The probe holds no credential and could not be given one: Fly restarts this
  // process on the answer, and Better Stack polls it from outside the network.
  // What it discloses is whether the process can reach its database, which is
  // what an unanswered TCP connection would disclose anyway.
  @Unguarded("liveness probe — reveals only up or down, and holds no session")
  @Get()
  async check(): Promise<HealthReport> {
    try {
      // A real round-trip: checked out of the pool, executed by the server,
      // returned. It fails when the database is down, when the pool is
      // exhausted, and when credentials have been rotated out from under the
      // app — all three of which are outages.
      await this.pool.query("select 1");
    } catch (error) {
      this.logger.error({ err: error }, "health check failed");

      // 503, never 200 with a body saying "degraded": every uptime monitor and
      // load balancer reads the status line, and most read nothing else.
      throw new ServiceUnavailableException({
        status: "error",
        database: "down",
      });
    }

    return { status: "ok", database: "up" };
  }
}
