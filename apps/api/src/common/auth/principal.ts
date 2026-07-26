// Who is making the request, once both realms have been reduced to one shape.
//
// The guard produces this and nothing else produces it. A handler that wants
// the caller reads `@CurrentPrincipal()`; it never reaches for the raw request,
// because the raw request carries a Better Auth session on one path and a
// Passport payload on the other, and code that knows the difference is code
// that breaks when a realm changes.

import type { Grant, StaffRole } from "../../modules/identity/rbac/roles.js";

/** A signed-in guest. Owns their own records and nothing else. */
export interface GuestPrincipal {
  readonly realm: "guest";
  readonly userId: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly sessionId: string;
}

/** A signed-in staff member, carrying exactly one role. */
export interface StaffPrincipal {
  readonly realm: "staff";
  readonly userId: string;
  readonly email: string;
  readonly role: StaffRole;
}

export type Principal = GuestPrincipal | StaffPrincipal;

/**
 * What the guard decided, handed to the handler.
 *
 * `grant` is the interesting half. `conditional` means the matrix granted
 * access subject to something only the handler can check — that the booking
 * belongs to this guest, that the cash drawer is this receptionist's shift, that
 * the ID scan is inside its retention window. The guard cannot see any of that,
 * so it passes the request on with the condition attached rather than
 * pretending the decision is complete.
 */
export interface AccessDecision {
  readonly principal: Principal | null;
  readonly capabilityKey: string;
  readonly grant: Grant;
}

/** Where the guard leaves its decision on the request object. */
export const ACCESS_DECISION = "marivaAccess" as const;

export interface RequestWithAccess {
  [ACCESS_DECISION]?: AccessDecision;
}
