// The wiring, and only the wiring.
//
// The service is exported so the checkout transition can reach it inside its
// own transaction. A module that provides it without exporting it compiles, and
// the failure arrives later as a dependency Nest cannot resolve in whichever
// module imports this one — so the export is asserted here, where the answer is
// one line instead of a boot log.
//
// No database is involved: the service injects nothing, because the executor
// every one of its methods works against is an argument.

import "reflect-metadata";

import { Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";
import { HousekeepingModule } from "./housekeeping.module.js";
import { HousekeepingService } from "./housekeeping.service.js";

// A stand-in for the booking module, which reaches the service the same way.
@Module({ imports: [HousekeepingModule] })
class ConsumerModule {}

describe("the housekeeping module", () => {
  it("hands the service to a module that imports it", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConsumerModule],
    }).compile();

    expect(moduleRef.get(HousekeepingService)).toBeInstanceOf(
      HousekeepingService,
    );
  });
});
