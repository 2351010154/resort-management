// The two things a route may say about access, and the only two.
//
// A route that says neither is unreachable — docs/architecture/rbac-matrix.md
// §2, deny by default. That is enforced in `AccessGuard`, not here; this file
// only names the metadata.

import {
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
} from "@nestjs/common";
import type { CapabilityKey } from "../../modules/identity/rbac/matrix.js";
import type { CapabilityAction } from "../../modules/identity/rbac/roles.js";
import {
  ACCESS_DECISION,
  type AccessDecision,
  type Principal,
  type RequestWithAccess,
} from "./principal.js";

export const CAPABILITY_KEY = "mariva:capability";

/** Which row governs a route, and what the route does with it. */
export interface CapabilityRequirement {
  readonly key: CapabilityKey;
  readonly action: CapabilityAction;
}

/**
 * Declares which matrix row governs this route.
 *
 * The first argument is typed against the matrix, so a capability that does not
 * exist — or one renamed in the matrix and not here — is a compile error rather
 * than a route that quietly authorises nobody.
 *
 * The second says whether the route reads the row or changes it, and it
 * defaults to `write` because that is the safe half of forgetting it. A write
 * route left at the default is enforced strictly; a read route left at the
 * default refuses a role holding 👁 and shows up as a 403 somebody reports. The
 * other default would have the omission hand a read-only role a write path and
 * say nothing.
 */
export const RequiresCapability = (
  capability: CapabilityKey,
  action: CapabilityAction = "write",
) =>
  SetMetadata<string, CapabilityRequirement>(CAPABILITY_KEY, {
    key: capability,
    action,
  });

export const UNGUARDED_KEY = "mariva:unguarded";

/**
 * The deny-by-default rule's only exception, and it costs a sentence.
 *
 * Two kinds of route qualify. The first is how a caller *becomes* somebody —
 * staff sign-in, token refresh, sign-out, and everything Better Auth mounts for
 * guests; there is no capability to hold before you have a session. The second
 * is a route with no subject at all, of which the liveness probe is the only
 * example.
 *
 * Deliberately not called `@Public()`. A decorator called public invites use on
 * anything somebody wants to open up, whereas `@Unguarded("…")` reads, in the
 * diff, as what it is — and the required reason is the sentence a reviewer gets
 * to disagree with.
 */
export const Unguarded = (reason: string) => SetMetadata(UNGUARDED_KEY, reason);

/** The caller, as the guard resolved them. `null` on an unauthenticated
 *  route reached without a session. */
export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal | null => {
    const request = context.switchToHttp().getRequest<RequestWithAccess>();

    return request[ACCESS_DECISION]?.principal ?? null;
  },
);

/**
 * The whole decision, for handlers that must honour a `conditional` grant.
 *
 * A handler reading this is a handler that still owes an ownership or scope
 * check — see {@link AccessDecision}.
 */
export const Access = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AccessDecision | undefined => {
    const request = context.switchToHttp().getRequest<RequestWithAccess>();

    return request[ACCESS_DECISION];
  },
);
