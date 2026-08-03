// The obligation in docs/architecture/rbac-matrix.md §4, discharged.
//
// "P0.03 ships a test that, for **every** row above, asserts the allowed roles
// get through and at least one denied role gets a 403." That is what the first
// describe block below does, driven off `CAPABILITIES` so a row added to the
// matrix is a row this file covers without being edited — a row added with no
// test is the gap §4 names, and the only way to close it permanently is for the
// test to enumerate the table rather than restate it.
//
// Every row is put to the guard twice, once as a route that reads it and once
// as a route that writes it, because a grant is not a yes or a no. The 👁
// column is a third answer and the only one that depends on which of the two a
// route is; asserting a row only as a read would let a receptionist's view of
// the rate calendar pass for permission to reprice it.
//
// The subject is the guard, not a route. Fifty-four capabilities do not have
// fifty-four endpoints yet and most never will have exactly one; what decides
// access is this class, so this class is what is put under test, with the
// realms stubbed at the seam where they hand it a principal.

// The metadata the decorators write and `Reflector` reads is `Reflect`
// metadata, which does not exist until this polyfill is evaluated. main.ts
// imports it first for the same reason; a test file has no main.ts above it.
import "reflect-metadata";

import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  type Capability,
} from "../../modules/identity/rbac/matrix.js";
import {
  CAPABILITY_ACTIONS,
  type CapabilityAction,
  type Grant,
  STAFF_ROLES,
  type StaffRole,
} from "../../modules/identity/rbac/roles.js";
import { CAPABILITY_KEY, UNGUARDED_KEY } from "./access.decorators.js";
import { AccessGuard, type StaffJwtGuard } from "./access.guard.js";
import type { GuestAuthService } from "../../modules/auth/guest/guest-auth.service.js";
import { ACCESS_DECISION, type Principal } from "./principal.js";

/** The identities a request can arrive with. `null` is the anonymous one. */
type Caller = Principal | null;

const GUEST: Principal = {
  realm: "guest",
  userId: "guest-1",
  email: "anh@example.com",
  emailVerified: true,
  sessionId: "session-1",
};

function staffCaller(role: StaffRole): Principal {
  return {
    realm: "staff",
    userId: `staff-${role}`,
    email: `${role.toLowerCase()}@mariva.vn`,
    role,
  };
}

/**
 * Builds the guard with both realms stubbed.
 *
 * The stubs replace exactly one thing: the step that turns a request into a
 * principal. Everything the test is about — reading the metadata, looking the
 * row up, comparing the grant, choosing 401 or 403 — is the real code.
 */
function guardFor(caller: Caller) {
  const request: Record<string, unknown> & { headers: Record<string, string> } = {
    headers: caller?.realm === "staff" ? { authorization: "Bearer stub" } : {},
  };

  if (caller?.realm === "staff") {
    request.user = caller;
  }

  const guestAuth = {
    principalFrom: async () => (caller?.realm === "guest" ? caller : null),
  } as unknown as GuestAuthService;

  const staffJwt = { canActivate: () => true } as unknown as StaffJwtGuard;

  return {
    guard: new AccessGuard(new Reflector(), guestAuth, staffJwt),
    request,
  };
}

/** An ExecutionContext carrying the metadata a decorated route would carry. */
function contextWith(
  metadata: Record<string, unknown>,
  request: unknown,
): ExecutionContext {
  const handler = () => undefined;

  for (const [key, value] of Object.entries(metadata)) {
    Reflect.defineMetadata(key, value, handler);
  }

  return {
    getType: () => "http",
    getHandler: () => handler,
    getClass: () => class Anonymous {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

async function attempt(
  caller: Caller,
  metadata: Record<string, unknown>,
): Promise<{ allowed: boolean; status?: number; request: Record<string, unknown> }> {
  const { guard, request } = guardFor(caller);

  try {
    const allowed = await guard.canActivate(contextWith(metadata, request));

    return { allowed, request };
  } catch (error) {
    if (error instanceof ForbiddenException) {
      return { allowed: false, status: 403, request };
    }

    if (error instanceof UnauthorizedException) {
      return { allowed: false, status: 401, request };
    }

    throw error;
  }
}

const reach = (
  caller: Caller,
  capability: Capability,
  action: CapabilityAction,
) => attempt(caller, { [CAPABILITY_KEY]: { key: capability.key, action } });

/** Every identity the matrix names on a row, beside the grant it holds. */
function holdersOf(capability: Capability): {
  name: string;
  caller: Caller;
  grant: Grant;
}[] {
  return [
    { name: "GUEST", caller: GUEST, grant: capability.guest },
    ...STAFF_ROLES.map((role) => ({
      name: role,
      caller: staffCaller(role),
      grant: capability.staff[role],
    })),
  ];
}

describe("every row of the RBAC matrix", () => {
  for (const capability of CAPABILITIES) {
    describe(`${capability.section} — ${capability.row}`, () => {
      const holders = holdersOf(capability);

      if (capability.unauthenticated) {
        // The one explicitly public row. §2 requires public routes to be
        // marked, and this is the mark: anyone reaches it, signed in or not.
        // Its role columns describe what a screen should offer, not a wall —
        // enforcing them would 403 a housekeeper on a page any stranger can
        // load, and that bypass sits above the read/write comparison for the
        // same reason.
        it("is reachable with no session at all", async () => {
          const outcome = await reach(null, capability, "read");

          expect(outcome.allowed).toBe(true);
        });

        for (const { name, caller } of holders) {
          it(`lets ${name} through whatever their column says`, async () => {
            const outcome = await reach(caller, capability, "write");

            expect(outcome.allowed).toBe(true);
          });
        }

        return;
      }

      it("refuses an anonymous caller with 401", async () => {
        const outcome = await reach(null, capability, "read");

        expect(outcome.status).toBe(401);
      });

      for (const { name, caller, grant } of holders) {
        // §4's "at least one denied role gets a 403", strengthened to every
        // denied role — there is no reason to check one when the table names
        // them all. Strengthened again to both actions: a row a role cannot
        // read is not a row they may write.
        if (grant === "denied") {
          it(`refuses ${name} with 403, reading or writing`, async () => {
            for (const action of CAPABILITY_ACTIONS) {
              const outcome = await reach(caller, capability, action);

              expect(outcome.status, action).toBe(403);
            }
          });

          continue;
        }

        it(`lets ${name} read`, async () => {
          const outcome = await reach(caller, capability, "read");

          expect(outcome.allowed).toBe(true);
          expect(outcome.request[ACCESS_DECISION]).toMatchObject({
            capabilityKey: capability.key,
            principal: caller,
            grant,
          });
        });

        // 👁 in the document. The row is visible to this role and the routes
        // that change it are not — which is only true if the guard compares
        // the grant to what the route does, and is what this line is for.
        if (grant === "read") {
          it(`refuses ${name} a write with 403`, async () => {
            const outcome = await reach(caller, capability, "write");

            expect(outcome.status).toBe(403);
          });

          continue;
        }

        it(`lets ${name} write`, async () => {
          const outcome = await reach(caller, capability, "write");

          expect(outcome.allowed).toBe(true);
        });
      }
    });
  }
});

describe("the two realms", () => {
  // rbac-matrix.md §4: "Cross-realm assertions are separate and
  // non-negotiable." Asserted here in both directions, and asserted as 403
  // rather than 401 — the token is valid, the realm is wrong.
  const staffOnly = CAPABILITIES.filter(
    (row) => row.guest === "denied" && !row.unauthenticated,
  );

  const guestOnly = CAPABILITIES.filter((row) =>
    STAFF_ROLES.every((role) => row.staff[role] === "denied"),
  );

  it("has rows that only staff may reach, and rows that only guests may", () => {
    expect(staffOnly.length).toBeGreaterThan(0);
    expect(guestOnly.length).toBeGreaterThan(0);
  });

  it("refuses a guest session on every staff-only capability with 403", async () => {
    for (const capability of staffOnly) {
      const outcome = await reach(GUEST, capability, "read");

      expect(outcome.status, capability.key).toBe(403);
    }
  });

  it("refuses a staff token on every guest-only capability with 403", async () => {
    for (const capability of guestOnly) {
      for (const role of STAFF_ROLES) {
        const outcome = await reach(staffCaller(role), capability, "read");

        expect(outcome.status, `${capability.key} / ${role}`).toBe(403);
      }
    }
  });
});

describe("deny by default", () => {
  // rbac-matrix.md §2: "A route with no `@Roles()` is unreachable, not public."
  it("refuses a route that declares no capability, whoever asks", async () => {
    for (const caller of [null, GUEST, ...STAFF_ROLES.map(staffCaller)]) {
      const outcome = await attempt(caller, {});

      expect(outcome.status).toBe(403);
    }
  });

  it("lets an explicitly unguarded route through", async () => {
    const outcome = await attempt(null, {
      [UNGUARDED_KEY]: "sign-in issues the session everything else requires",
    });

    expect(outcome.allowed).toBe(true);
  });

  it("refuses anything that is not an HTTP request", async () => {
    const { guard, request } = guardFor(null);
    const context = {
      ...contextWith({ [UNGUARDED_KEY]: "would otherwise pass" }, request),
      getType: () => "rpc",
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(false);
  });
});

describe("the read-only grants", () => {
  // The per-row loop above would still pass if the matrix had no 👁 in it at
  // all — every assertion about the split would simply never be generated. This
  // is the line that fails when the last read grant is edited away, which is
  // the moment the comparison in the guard stops being exercised by anything.
  // Staff columns only, and the compiler agrees: no row gives the guest realm
  // 👁. A guest either owns the record or does not, so their column is ✅, ⚠ or
  // —, and a `row.guest === "read"` here is a comparison against a type that
  // cannot hold it.
  const readOnly = CAPABILITIES.filter(
    (row) =>
      !row.unauthenticated &&
      STAFF_ROLES.some((role) => row.staff[role] === "read"),
  );

  it("exist in the matrix, on rows the guard actually enforces", () => {
    expect(readOnly.map((row) => row.key)).toContain("pricing.rate-plans");
    expect(readOnly.length).toBeGreaterThan(1);
  });
});

describe("the conditional grants", () => {
  // A `conditional` row is granted by the guard and still owes an ownership or
  // scope check in the handler. The decision is handed on so the handler can
  // see which of the two it was — without this, "the guard said yes" and "the
  // guard said yes, subject to ownership" are indistinguishable at the point
  // where the difference decides whether one guest can read another's folio.
  const conditional = CAPABILITIES.filter(
    (row) =>
      row.guest === "conditional" ||
      STAFF_ROLES.some((role) => row.staff[role] === "conditional"),
  );

  it("exists in the matrix", () => {
    expect(conditional.length).toBeGreaterThan(0);
  });

  it("passes the condition to the handler rather than resolving it", async () => {
    for (const capability of conditional) {
      const callers: Caller[] =
        capability.guest === "conditional" ? [GUEST] : [];

      for (const role of STAFF_ROLES) {
        if (capability.staff[role] === "conditional") {
          callers.push(staffCaller(role));
        }
      }

      for (const caller of callers) {
        // Asserted on a *write* route. `conditional` is a full grant whose
        // scope the guard cannot see, not a lesser one — reading it as
        // read-only would refuse a receptionist their own cash drawer, which
        // is exactly what the row grants them.
        const outcome = await reach(caller, capability, "write");

        expect(outcome.allowed, capability.key).toBe(true);
        expect(outcome.request[ACCESS_DECISION]).toMatchObject({
          grant: "conditional",
        });
      }
    }
  });
});
