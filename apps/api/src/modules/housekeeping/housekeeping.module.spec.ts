// The wiring, and only the wiring.
//
// The service is exported so the checkout transition can reach it inside its
// own transaction. A module that provides it without exporting it compiles, and
// the failure arrives later as a dependency Nest cannot resolve in whichever
// module imports this one — so the export is asserted here, where the answer is
// one line instead of a boot log.
//
// The stand-ins below are what this module's graph needs and what only a booted
// application supplies: the global `DatabaseModule`'s transaction runner and
// Drizzle client, the environment, and a logger. Nothing is exercised —
// compiling the graph is the whole assertion, and what the routes do with them
// is `test/housekeeping-api.e2e-spec.ts`'s, against a real Postgres. Standing
// them in is what keeps this spec free of one.
//
// The last three arrive with `SystemConfigModule`, which comes in because
// `BusinessDateService` reads the rollover hour off the `system_config` row.
// Providing them here rather than mocking that module out is the point: what
// this file asserts is that the wiring resolves, and a module stubbed away is a
// module whose wiring was not checked.

import "reflect-metadata";

import { Global, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PinoLogger } from "nestjs-pino";
import { describe, expect, it } from "vitest";
import { ENV } from "../../config/env.js";
import { DRIZZLE } from "../../database/database.module.js";
import { TransactionRunner } from "../../database/transaction-runner.js";
import { HousekeepingModule } from "./housekeeping.module.js";
import { HousekeepingService } from "./housekeeping.service.js";

@Global()
@Module({
  providers: [
    { provide: TransactionRunner, useValue: {} },
    { provide: DRIZZLE, useValue: {} },
    // Empty on purpose. The seeder reads it when the application boots, which
    // this spec does not do — nothing here needs a value, and one written in
    // would read as a figure the graph depends on.
    { provide: ENV, useValue: {} },
    // The seeder sets a context on it in its constructor, which is the one call
    // made while the graph is being built.
    { provide: PinoLogger, useValue: { setContext: () => {} } },
  ],
  exports: [TransactionRunner, DRIZZLE, ENV, PinoLogger],
})
class AmbientModule {}

// A stand-in for the booking module, which reaches the service the same way.
@Module({ imports: [HousekeepingModule] })
class ConsumerModule {}

describe("the housekeeping module", () => {
  it("hands the service to a module that imports it", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AmbientModule, ConsumerModule],
    }).compile();

    expect(moduleRef.get(HousekeepingService)).toBeInstanceOf(
      HousekeepingService,
    );
  });
});
