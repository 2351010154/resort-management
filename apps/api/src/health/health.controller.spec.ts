// The liveness probe, now that a contract sits between the handler and the wire.
//
// What is under test is not "does the query run" — it is that routing this
// endpoint through `@Implement` did not change the two things outside callers
// actually depend on: the path Better Stack polls, and the status line Fly
// restarts on. oRPC encodes handler results itself and has its own error type,
// so neither survives the move by default; they survive because this file says
// they must.
//
// No database. The pool is the seam, stubbed both ways, because an outage is
// the case that matters and a real Postgres is hard to break on cue.

import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { getLoggerToken } from "nestjs-pino";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { PG_POOL } from "../database/database.module.js";
import { HealthController } from "./health.controller.js";

/** Stands in for `pg.Pool`. `select 1` either returns or throws — the two
 *  states the probe exists to tell apart. */
function poolThat(outcome: "answers" | "is down") {
  return {
    query: async () => {
      if (outcome === "is down") {
        throw new Error("connection terminated unexpectedly");
      }

      return { rows: [{ "?column?": 1 }] };
    },
  };
}

async function appWith(outcome: "answers" | "is down"): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [
      { provide: PG_POOL, useValue: poolThat(outcome) },
      // The probe logs the error it caught; the assertions are about the
      // response, so the sink is a no-op rather than a spy.
      {
        provide: getLoggerToken("HealthController"),
        useValue: { error: () => {}, info: () => {}, warn: () => {} },
      },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();

  return app;
}

describe("health probe through the oRPC contract", () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("answers 200 at the path the contract declares, not a prefixed one", async () => {
    app = await appWith("answers");

    const response = await request(app.getHttpServer()).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", database: "up" });
  });

  // The regression this file exists for. `ServiceUnavailableException` is a Nest
  // exception thrown inside an oRPC handler, and 503 is what every uptime
  // monitor in front of this process reads. If the contract layer ever swallows
  // it into a 500 — or worse, a 200 carrying an error body — the probe stops
  // meaning anything and this test is what says so.
  it("answers 503, not 200 or 500, when the database is unreachable", async () => {
    app = await appWith("is down");

    const response = await request(app.getHttpServer()).get("/health");

    expect(response.status).toBe(503);
  });
});
