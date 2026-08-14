// Two properties, and the second one is the one that could go wrong quietly.
//
// The first is that a defect is written down: an unknown throw out of an oRPC
// handler produces a log line carrying its message and its stack. The second is
// that the caller learns nothing from it — the body and the status of a 500
// must be byte-for-byte what they were before any of this existed, because the
// detail behind a 500 describes the schema or the credential that failed and
// the caller is a browser on the public internet.
//
// Both are asserted through a real request against a real `@Implement`ed route
// rather than by calling the interceptor directly, for the reason
// `access.guard.orpc.spec.ts` gives about the same boundary: `@Implement`
// installs its own interceptor and catches what a handler throws, so whether a
// hook placed outside it ever runs is a question only a request can answer.

import "reflect-metadata";

import { Controller, Get, UnauthorizedException } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { oc } from "@orpc/contract";
import { Implement, implement, ORPCError, ORPCModule } from "@orpc/nest";
import { PinoLogger } from "nestjs-pino";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { UnknownErrorFilter } from "./unknown-error.filter.js";
import { isDeliberateRefusal, unknownErrorInterceptor } from "./unknown-error.js";

const reached = z.object({ reached: z.literal(true) });

const fixture = {
  // Throws the way a missing column throws: an ordinary `Error` nobody
  // anticipated, from inside the handler.
  broken: oc.route({ method: "GET", path: "/fixture/broken" }).output(reached),
  // The refusal that happens all day and must not read as an incident.
  absent: oc.route({ method: "GET", path: "/fixture/absent" }).output(reached),
};

@Controller()
class FixtureController {
  @Implement(fixture.broken)
  brokenRoute() {
    return implement(fixture.broken).handler(() => {
      throw new Error("column booking.anon_access_revoked_at does not exist");
    });
  }

  @Implement(fixture.absent)
  absentRoute() {
    return implement(fixture.absent).handler(() => {
      throw new ORPCError("NOT_FOUND", { message: "no such booking" });
    });
  }

  // Not an oRPC route, and that is its whole purpose: it throws into Nest's
  // exception layer, which is the half the filter covers.
  @Get("/fixture/nest-broken")
  nestBroken(): never {
    throw new Error("a job trigger blew up");
  }

  @Get("/fixture/nest-refused")
  nestRefused(): never {
    throw new UnauthorizedException();
  }
}

/** A logger that records rather than writes. `Pick<PinoLogger, "error">` is all
 *  either half uses, and a recorder is the only way to assert on a stack. */
function aRecorder() {
  return { error: vi.fn() };
}

async function appWith(logger: ReturnType<typeof aRecorder>) {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ORPCModule.forRoot({
        interceptors: [unknownErrorInterceptor(logger)],
      }),
    ],
    controllers: [FixtureController],
    providers: [
      // The recorder stands in for the one `PinoLogger` the application shares,
      // which is what the filter is injected with in `app.module.ts`.
      { provide: PinoLogger, useValue: logger },
      { provide: APP_FILTER, useClass: UnknownErrorFilter },
    ],
  }).compile();

  // `logger: false` silences Nest's own console logger, which would otherwise
  // print the stack of every deliberately broken fixture route into the suite's
  // output. The application replaces that logger with pino anyway.
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();

  return app;
}

describe("an unknown throw out of an oRPC handler", () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  // The wire contract. Written out in full rather than matched loosely: the
  // point of the test is that this exact object is what a caller receives, and
  // a partial matcher would pass while a new field leaked beside it.
  it("tells the caller nothing it did not tell them before", async () => {
    const logger = aRecorder();
    app = await appWith(logger);

    const response = await request(app.getHttpServer()).get("/fixture/broken");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      defined: false,
      code: "INTERNAL_SERVER_ERROR",
      status: 500,
      message: "Internal server error",
    });
  });

  it("writes the message and the stack to the server log", async () => {
    const logger = aRecorder();
    app = await appWith(logger);

    await request(app.getHttpServer()).get("/fixture/broken");

    expect(logger.error).toHaveBeenCalledTimes(1);

    const [payload] = logger.error.mock.calls[0]!;
    const { err } = payload as { err: Error };

    expect(err.message).toContain("anon_access_revoked_at");
    expect(err.stack).toContain("unknown-error.spec.ts");
  });

  it("stays quiet about a refusal the handler chose", async () => {
    const logger = aRecorder();
    app = await appWith(logger);

    const response = await request(app.getHttpServer()).get("/fixture/absent");

    expect(response.status).toBe(404);
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe("a throw that reaches Nest rather than an oRPC handler", () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("is logged, and still answers with Nest's own 500", async () => {
    const logger = aRecorder();
    app = await appWith(logger);

    const response = await request(app.getHttpServer()).get(
      "/fixture/nest-broken",
    );

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      statusCode: 500,
      message: "Internal server error",
    });
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when a guard refuses a caller", async () => {
    const logger = aRecorder();
    app = await appWith(logger);

    const response = await request(app.getHttpServer()).get(
      "/fixture/nest-refused",
    );

    expect(response.status).toBe(401);
    expect(logger.error).not.toHaveBeenCalled();
  });
});

// The predicate on its own, for the two cases a request cannot produce here.
describe("telling a deliberate refusal from a defect", () => {
  // 503 and 502 are chosen by the health probe and the payment adapter. A rule
  // written as "status < 500" would call both of them incidents.
  it("accepts a 5xx the code chose on purpose", () => {
    expect(
      isDeliberateRefusal(
        new ORPCError("SERVICE_UNAVAILABLE", { status: 503 }),
      ),
    ).toBe(true);
    expect(isDeliberateRefusal(new ORPCError("BAD_GATEWAY"))).toBe(true);
  });

  // oRPC raises this itself when a handler's return value fails its output
  // schema — a bug in this codebase wearing an `ORPCError`'s clothes.
  it("refuses to accept the one code no handler here writes", () => {
    expect(isDeliberateRefusal(new ORPCError("INTERNAL_SERVER_ERROR"))).toBe(
      false,
    );
  });

  it("treats a thrown non-error as a defect", () => {
    expect(isDeliberateRefusal("boom")).toBe(false);
  });
});
