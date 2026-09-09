// Does deny-by-default survive the contract layer?
//
// `access.guard.spec.ts` proves the guard itself decides all fifty-four matrix
// rows correctly, with the execution context built by hand. That proof says
// nothing about whether the guard still *runs* on a route whose handler is an
// `@Implement`ed oRPC procedure rather than a `@Get`, because `@Implement`
// installs its own interceptor and returns a router object instead of a
// response.
//
// The question is not academic. Every M3 endpoint is written this way, and the
// two ways it could fail are opposite and both silent: metadata the guard
// cannot see means a declared route authorises nobody, and a guard that never
// runs means an undeclared route authorises everybody. So both directions are
// asserted here, on fixture controllers rather than on endpoints that do not
// exist yet.

import "reflect-metadata";

import type { ExecutionContext, INestApplication } from "@nestjs/common";
import { Controller } from "@nestjs/common";
import { APP_GUARD, Reflector } from "@nestjs/core";
import { oc } from "@orpc/contract";
import { Implement, implement } from "@orpc/nest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { z } from "zod";
import { afterEach, describe, expect, it } from "vitest";
import type { BookingTokenService } from "../../modules/auth/booking-token/booking-token.service.js";
import type { GuestAuthService } from "../../modules/auth/guest/guest-auth.service.js";
import type { Principal } from "./principal.js";
import { CurrentPrincipal, RequiresCapability } from "./access.decorators.js";
import { AccessGuard, StaffJwtGuard } from "./access.guard.js";

const reached = z.object({ reached: z.literal(true) });

/**
 * What the public route answers: that it was reached, and by whom.
 *
 * The second field is the one `availability.controller.ts` depends on. An
 * unauthenticated row is reachable by a stranger *and* carries a principal when
 * a session happens to arrive on it, which is what lets a search quote a member
 * their own price. The guard resolves the caller before it takes the public
 * branch; if it ever stopped, every signed-in guest would silently read as a
 * stranger and be quoted the rack rate — a failure with no error and no test
 * anywhere else to catch it.
 */
const reachedBy = z.object({
  reached: z.literal(true),
  caller: z.string().nullable(),
});

// Three fixture routes, one per outcome the guard can produce on an oRPC
// handler. Real capability keys, because `RequiresCapability` is typed against
// the matrix and inventing one would not compile.
const fixture = {
  // `unauthenticated: true` in the matrix — anyone, signed in or not.
  public: oc
    .route({ method: "GET", path: "/fixture/public" })
    .output(reachedBy),
  // MANAGER and ADMIN only. A guest must not reach it.
  managerOnly: oc
    .route({ method: "GET", path: "/fixture/manager-only" })
    .output(reached),
  // Declares nothing. Under rbac-matrix.md §2 this must be unreachable.
  undeclared: oc
    .route({ method: "GET", path: "/fixture/undeclared" })
    .output(reached),
  // The two halves of one row a receptionist holds 👁 over.
  rateRead: oc
    .route({ method: "GET", path: "/fixture/rates" })
    .output(reached),
  rateWrite: oc
    .route({ method: "PUT", path: "/fixture/rates" })
    .output(reached),
};

@Controller()
class FixtureController {
  @RequiresCapability("availability.search")
  @Implement(fixture.public)
  publicRoute(@CurrentPrincipal() principal: Principal | null) {
    return implement(fixture.public).handler(() => ({
      reached: true as const,
      // Narrowed by realm, as `availability.controller.ts` narrows it: a
      // booking credential carries no account, and a staff one is not a guest
      // whose loyalty standing a price could be quoted against.
      caller: principal?.realm === "guest" ? principal.userId : null,
    }));
  }

  @RequiresCapability("inventory.close-room")
  @Implement(fixture.managerOnly)
  managerRoute() {
    return implement(fixture.managerOnly).handler(
      () => ({ reached: true }) as const,
    );
  }

  // Deliberately bare: no @RequiresCapability, no @Unguarded.
  @Implement(fixture.undeclared)
  undeclaredRoute() {
    return implement(fixture.undeclared).handler(
      () => ({ reached: true }) as const,
    );
  }

  @RequiresCapability("pricing.rate-plans", "read")
  @Implement(fixture.rateRead)
  rateReadRoute() {
    return implement(fixture.rateRead).handler(
      () => ({ reached: true }) as const,
    );
  }

  // No second argument, so this is a write — the strict default.
  @RequiresCapability("pricing.rate-plans")
  @Implement(fixture.rateWrite)
  rateWriteRoute() {
    return implement(fixture.rateWrite).handler(
      () => ({ reached: true }) as const,
    );
  }
}

/** Boots the fixture app with the real guard and the realms stubbed at the one
 *  seam that turns a request into a principal — the same substitution
 *  `access.guard.spec.ts` makes, for the same reason. */
async function appAs(caller: Principal | null): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [FixtureController],
    providers: [
      Reflector,
      {
        provide: StaffJwtGuard,
        useValue: {
          // Passport's whole contribution, in one line: the decoded principal
          // goes on the request, and the guard reads it back from there and
          // from nowhere else. Stubbing it here rather than signing a token
          // keeps the subject of this file the guard and not the strategy.
          canActivate: (context: ExecutionContext) => {
            if (caller?.realm === "staff") {
              Object.assign(context.switchToHttp().getRequest(), {
                user: caller,
              });
            }

            return true;
          },
        },
      },
      {
        provide: "GuestAuthService",
        useValue: {},
      },
      {
        provide: APP_GUARD,
        useFactory: (reflector: Reflector, staffJwt: StaffJwtGuard) =>
          new AccessGuard(
            reflector,
            {
              principalFrom: async () =>
                caller?.realm === "guest" ? caller : null,
            } as unknown as GuestAuthService,
            staffJwt,
            // Never presents one. This file is about how the guard's refusals
            // cross the oRPC boundary, and the third credential changes nothing
            // about that crossing.
            {
              presentedOn: () => undefined,
              verify: () => null,
            } as unknown as BookingTokenService,
          ),
        inject: [Reflector, StaffJwtGuard],
      },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();

  return app;
}

const GUEST: Principal = {
  realm: "guest",
  userId: "guest-1",
  email: "anh@example.com",
  emailVerified: true,
  sessionId: "session-1",
};

// 👁 over "Rate plans, rate calendar, promotions" — the row the read/write
// split was built for.
const RECEPTIONIST: Principal = {
  realm: "staff",
  userId: "staff-1",
  email: "le.tan@mariva.vn",
  role: "RECEPTIONIST",
};

/** A staff request is one carrying a bearer token; the stub above decodes it. */
const asStaff = (agent: request.Test) =>
  agent.set("authorization", "Bearer stub");

describe("deny-by-default on oRPC routes", () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  // The guard runs at all, and reads metadata off an @Implement'ed method.
  it("lets an anonymous caller through a row marked unauthenticated", async () => {
    app = await appAs(null);

    const response = await request(app.getHttpServer()).get("/fixture/public");

    expect(response.status).toBe(200);
    // Reached, and by nobody — a stranger carries no principal for a handler to
    // price against.
    expect(response.body).toEqual({ reached: true, caller: null });
  });

  it("hands a signed-in caller's principal to an unauthenticated row", async () => {
    // The row is public and the caller has a session, and both facts survive
    // together: the guard does not skip resolving a principal merely because
    // the row would admit a stranger. `availability.search` is that row in
    // production, and this is the whole mechanism by which a signed-in guest is
    // quoted §7's member discount before they commit — without it the funnel
    // would quote the rack rate to everybody, answer 200, and break no test.
    app = await appAs(GUEST);

    const response = await request(app.getHttpServer()).get("/fixture/public");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ reached: true, caller: GUEST.userId });
  });

  // The direction that would leak: a guarded route the guard failed to guard.
  it("refuses a guest on a MANAGER-only row", async () => {
    app = await appAs(GUEST);

    const response = await request(app.getHttpServer()).get(
      "/fixture/manager-only",
    );

    expect(response.status).toBe(403);
  });

  // The direction rbac-matrix.md §2 is actually about. A route someone forgot
  // to declare must answer nobody — including, and especially, when the handler
  // is an oRPC procedure that looks nothing like the routes the rule was
  // written for.
  it("refuses everybody on a route that declares no capability", async () => {
    app = await appAs(GUEST);

    const response = await request(app.getHttpServer()).get(
      "/fixture/undeclared",
    );

    expect(response.status).toBe(403);
  });

  // One row, two routes, two answers. The pair is what proves the read/write
  // comparison is made where it has to be made — on a real request through a
  // real interceptor, not only in the hand-built context of the sibling file.
  it("lets a 👁 role read the row it may see", async () => {
    app = await appAs(RECEPTIONIST);

    const response = await asStaff(
      request(app.getHttpServer()).get("/fixture/rates"),
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ reached: true });
  });

  it("refuses that same role the write route on the same row", async () => {
    app = await appAs(RECEPTIONIST);

    const response = await asStaff(
      request(app.getHttpServer()).put("/fixture/rates"),
    );

    expect(response.status).toBe(403);
  });
});
