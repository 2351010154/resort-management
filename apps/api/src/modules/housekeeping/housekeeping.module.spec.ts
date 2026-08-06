// The wiring, and only the wiring.
//
// The service is exported so the checkout transition can reach it inside its
// own transaction. A module that provides it without exporting it compiles, and
// the failure arrives later as a dependency Nest cannot resolve in whichever
// module imports this one — so the export is asserted here, where the answer is
// one line instead of a boot log.
//
// The two stand-ins below are what the module's controller needs and what only
// a booted application supplies: the global `DatabaseModule`'s transaction
// runner, and the environment the business-date service reads its rollover hour
// from. Neither is exercised — compiling the graph is the whole assertion, and
// what the routes do with them is `test/housekeeping-api.e2e-spec.ts`'s, against
// a real Postgres. Standing them in is what keeps this spec free of one.

import "reflect-metadata";

import { Global, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";
import { ENV } from "../../config/env.js";
import { TransactionRunner } from "../../database/transaction-runner.js";
import { HousekeepingModule } from "./housekeeping.module.js";
import { HousekeepingService } from "./housekeeping.service.js";

@Global()
@Module({
  providers: [
    { provide: TransactionRunner, useValue: {} },
    { provide: ENV, useValue: { BUSINESS_DATE_ROLLOVER_HOUR: 4 } },
  ],
  exports: [TransactionRunner, ENV],
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
