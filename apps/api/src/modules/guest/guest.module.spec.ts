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
// The stand-in below is what the module's controller needs and what only a
// booted application supplies: the global `DatabaseModule`'s transaction
// runner. It is never called — compiling the graph is the whole assertion, and
// what the routes do with a real transaction is
// `test/guest-api.e2e-spec.ts`'s, against a real Postgres. Standing it in is
// what keeps this spec free of one.

import "reflect-metadata";

import { Global, Injectable, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";
import { TransactionRunner } from "../../database/transaction-runner.js";
import { GuestModule } from "./guest.module.js";
import { GuestService } from "./guest.service.js";

@Global()
@Module({
  providers: [{ provide: TransactionRunner, useValue: {} }],
  exports: [TransactionRunner],
})
class AmbientModule {}

@Injectable()
class GuestConsumer {
  constructor(readonly guests: GuestService) {}
}

@Module({ imports: [GuestModule], providers: [GuestConsumer] })
class ConsumerModule {}

describe("the guest module", () => {
  it("gives the service to a module that imports it", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AmbientModule, ConsumerModule],
    }).compile();

    expect(moduleRef.get(GuestConsumer).guests).toBeInstanceOf(GuestService);

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
