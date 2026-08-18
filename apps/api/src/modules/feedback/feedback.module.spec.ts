// The wiring, and only the wiring.
//
// The service takes `BookingService` from the module that owns it, which is the
// one thing about this graph that can be got wrong without failing to compile:
// a module that provided its own copy, or one that forgot the import, would
// build and then fail at boot with a dependency Nest cannot resolve. Asserting
// it here makes that answer one line instead of a boot log — and the copy is the
// failure worth catching, because a second `BookingService` would be a second
// place the ownership rule lives.
//
// The stand-ins below are what this graph needs and what only a booted
// application supplies: the global `DatabaseModule`'s transaction runner and
// Drizzle client, the environment, and a logger. Nothing is exercised —
// compiling the graph is the whole assertion, and what the routes do with them
// is `test/feedback.e2e-spec.ts`'s, against a real Postgres. Standing them in is
// what keeps this spec free of one.
//
// `BookingModule` is brought in whole rather than mocked out, because a module
// stubbed away is a module whose wiring was not checked — and the import edge
// this file exists to assert is precisely the one a stub would erase.

import "reflect-metadata";

import { Global, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { LoggerModule } from "nestjs-pino";
import { describe, expect, it } from "vitest";
import { ENV } from "../../config/env.js";
import { DRIZZLE } from "../../database/database.module.js";
import { TransactionRunner } from "../../database/transaction-runner.js";
import { BookingService } from "../booking/booking.service.js";
import { FeedbackController } from "./feedback.controller.js";
import { FeedbackModule } from "./feedback.module.js";
import { FeedbackService } from "./feedback.service.js";

const AMBIENT = [TransactionRunner, DRIZZLE];

/**
 * The environment, with the one value this graph reads while it is being built.
 *
 * `booking-token.service.ts` derives its signing key in its constructor, so an
 * empty object here fails the wiring check with a message about a Buffer rather
 * than about a module. The string is any string: nothing in this file signs or
 * verifies anything, and a value that looked like a real secret would be worse
 * — it would read as a fixture somebody is meant to keep in step.
 */
const AN_ENVIRONMENT = { BETTER_AUTH_SECRET: "not-a-secret-nothing-here-signs" };

@Global()
@Module({
  // The real logger module rather than a stand-in per context. Half this graph
  // injects a logger bound to its own class name, and standing those in one at a
  // time is a list that grows every time a provider anywhere under
  // `BookingModule` starts logging — which is a spec that fails for reasons
  // nothing to do with what it asserts. Silent, because a wiring check has
  // nothing to say on stdout.
  imports: [LoggerModule.forRoot({ pinoHttp: { level: "silent" } })],
  providers: [
    ...AMBIENT.map((provide) => ({ provide, useValue: {} })),
    { provide: ENV, useValue: AN_ENVIRONMENT },
  ],
  exports: [...AMBIENT, ENV, LoggerModule],
})
class AmbientModule {}

describe("the feedback module", () => {
  it("hands its service the booking module's own lookup", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AmbientModule, FeedbackModule],
    }).compile();

    expect(moduleRef.get(FeedbackService)).toBeInstanceOf(FeedbackService);

    // The booking module's, resolved through the import edge rather than
    // provided again here. A copy would compile, answer, and quietly become a
    // second home for the rule that decides whether a stay is the caller's.
    expect(moduleRef.get(BookingService)).toBeInstanceOf(BookingService);

    // The two routes, constructed out of what this module provides. A
    // controller Nest cannot build is a pair of endpoints that answer nothing,
    // and nothing else in the suite would say so until an HTTP call did.
    expect(moduleRef.get(FeedbackController)).toBeInstanceOf(FeedbackController);

    await moduleRef.close();
  });
});
