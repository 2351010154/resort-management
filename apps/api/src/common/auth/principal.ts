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

/**
 * A guest who never signed up, holding the credential their hold issued.
 *
 * The third realm, and the narrowest. It names no account — that is the whole
 * point of it: an anonymous booking has no account for a session to be about,
 * and inventing one would require looking the typed address up, which is the
 * enumeration oracle `booking-token.service.ts` refuses to introduce. What it
 * names instead is one stay, both ways that stay can be addressed, so the
 * ownership check the two `⚠` rows still owe is a `where` clause here exactly
 * as it is for a session.
 *
 * It is not a login and it never widens. `access.guard.ts` names the handful of
 * rows it grants — reading the stay, calling it off, saying where to write about
 * it, paying for it — and refuses every other row, including rows the matrix has
 * not been written yet. A credential that grew as the matrix grew would be a
 * hole nobody edited into existence.
 */
export interface BookingPrincipal {
  readonly realm: "booking";
  readonly bookingId: string;
  readonly reference: string;
}

export type Principal = GuestPrincipal | StaffPrincipal | BookingPrincipal;

/**
 * What the guard decided, handed to the handler.
 *
 * `grant` is the interesting half. `conditional` means the matrix granted
 * access subject to something only the handler can check — that the booking
 * belongs to this guest, that the cash drawer is this receptionist's shift,
 * that the scan being uploaded is for this guest's own stay. The guard cannot
 * see any of that, so it passes the request on with the condition attached
 * rather than pretending the decision is complete.
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
