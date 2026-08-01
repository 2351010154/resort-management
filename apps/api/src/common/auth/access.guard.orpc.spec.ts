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

import type { INestApplication } from "@nestjs/common";
import { Controller } from "@nestjs/common";
import { APP_GUARD, Reflector } from "@nestjs/core";
import { oc } from "@orpc/contract";
import { Implement, implement } from "@orpc/nest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { z } from "zod";
import { afterEach, describe, expect, it } from "vitest";
import type { GuestAuthService } from "../../modules/auth/guest/guest-auth.service.js";
import type { Principal } from "./principal.js";
import { RequiresCapability } from "./access.decorators.js";
import { AccessGuard, StaffJwtGuard } from "./access.guard.js";

const reached = z.object({ reached: z.literal(true) });

// Three fixture routes, one per outcome the guard can produce on an oRPC
// handler. Real capability keys, because `RequiresCapability` is typed against
// the matrix and inventing one would not compile.
const fixture = {
  // `unauthenticated: true` in the matrix — anyone, signed in or not.
  public: oc.route({ method: "GET", path: "/fixture/public" }).output(reached),
  // MANAGER and ADMIN only. A guest must not reach it.
  managerOnly: oc
    .route({ method: "GET", path: "/fixture/manager-only" })
    .output(reached),
  // Declares nothing. Under rbac-matrix.md §2 this must be unreachable.
  undeclared: oc
    .route({ method: "GET", path: "/fixture/undeclared" })
    .output(reached),
};

@Controller()
class FixtureController {
  @RequiresCapability("availability.search")
  @Implement(fixture.public)
  publicRoute() {
    return implement(fixture.public).handler(() => ({ reached: true }) as const);
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
        useValue: { canActivate: () => true },
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
    expect(response.body).toEqual({ reached: true });
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
});
