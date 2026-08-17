// What the module promises the check-in path.
//
// `GuestService` is exported so the booking transition can inject it and write
// a guest inside its own transaction. That export is the only reason this
// module has a shape at all, and it is the kind of claim nothing else notices
// when it breaks: dropping `exports` leaves this file compiling, every other
// test passing, and one unrelated module failing to resolve a dependency at
// boot with a message about the injector rather than about the export.
//
// So the assertion is made from outside, through a consumer that injects the
// service the way check-in will. Resolving it out of the container directly
// would prove nothing — Nest's testing `get` reaches into a module whether or
// not it exports anything.
//
// The stand-ins below are what this module's providers need and what only a
// booted application supplies: the global `DatabaseModule`'s transaction
// runner, the change log, the parsed environment, and the logger `nestjs-pino`
// binds per class. None is ever called — compiling the graph is the whole
// assertion, and what the routes do with a real transaction is
// `test/guest-api.e2e-spec.ts`'s, against a real Postgres. Standing them in is
// what keeps this spec free of one.
//
// The list grew when the module gained `LoyaltyService`, and that is the shape
// of the claim rather than an accident of it: the accrual reads §7's earn rate
// and pages when it fails after a close, so this module now depends on the
// configuration reader and on the on-call endpoint, and a graph that could not
// resolve either would be a boot failure in production.
//
// The tier derivation added no ambient dependency and that is worth noticing
// rather than passing over: it reads the thresholds and the property's own day
// and writes nothing, so it needs no transaction runner of its own and no
// change log. `BusinessDateService` is provided by the module under test, which
// is why it is absent from the list below.
//
// `FR-GST-01`'s profile added the second controller, and it is asserted from
// inside rather than through a consumer because it is the opposite kind of
// claim: `GuestProfileService` is deliberately not exported — nothing outside
// this module has any business reading a guest's account of themselves — so what
// there is to prove is that the controller can be constructed at all. It
// composes the derivation and the ledger sum, both of which live here, and a
// module that provided the controller without them would fail at boot with a
// message about the injector.

import "reflect-metadata";

import { Global, Injectable, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { getLoggerToken } from "nestjs-pino";
import { describe, expect, it } from "vitest";
import { ENV } from "../../config/env.js";
import { TransactionRunner } from "../../database/transaction-runner.js";
import { AuditService } from "../audit/audit.service.js";
import { OpsAlertService } from "../notification/ops-alert.service.js";
import { GuestProfileController } from "./guest-profile.controller.js";
import { GuestModule } from "./guest.module.js";
import { GuestService } from "./guest.service.js";
import { LoyaltyService } from "./loyalty.service.js";
import { TierDerivationService } from "./tier-derivation.service.js";

const AMBIENT = [
  TransactionRunner,
  ENV,
  AuditService,
  getLoggerToken(OpsAlertService.name),
];

@Global()
@Module({
  providers: AMBIENT.map((provide) => ({ provide, useValue: {} })),
  exports: AMBIENT,
})
class AmbientModule {}

@Injectable()
class GuestConsumer {
  constructor(
    readonly guests: GuestService,
    readonly loyalty: LoyaltyService,
    readonly tiers: TierDerivationService,
  ) {}
}

@Module({ imports: [GuestModule], providers: [GuestConsumer] })
class ConsumerModule {}

describe("the guest module", () => {
  it("gives its three services to a module that imports it", async () => {
    // Every export, because each has an importer that would fail at boot
    // without it: check-in injects the guest service, `folio.module.ts` injects
    // the accrual so that agreeing an account earns the stay its points, and a
    // tier is derived on read by whoever is showing or gating on one.
    const moduleRef = await Test.createTestingModule({
      imports: [AmbientModule, ConsumerModule],
    }).compile();

    const consumer = moduleRef.get(GuestConsumer);

    expect(consumer.guests).toBeInstanceOf(GuestService);
    expect(consumer.loyalty).toBeInstanceOf(LoyaltyService);
    expect(consumer.tiers).toBeInstanceOf(TierDerivationService);

    await moduleRef.close();
  });

  it("constructs the guest's own profile routes out of what it provides", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AmbientModule, GuestModule],
    }).compile();

    expect(moduleRef.get(GuestProfileController)).toBeInstanceOf(
      GuestProfileController,
    );

    await moduleRef.close();
  });

  it("needs no database connection to be constructed", () => {
    // The service injects nothing: it holds the rules and every method takes
    // the caller's executor. Asserting it here keeps that true — a constructor
    // dependency appearing later would make the service impossible to use from
    // inside somebody else's transaction, which is its entire purpose.
    expect(() => new GuestService()).not.toThrow();
  });
});
