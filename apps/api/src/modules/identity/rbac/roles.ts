// The two realms and the roles inside them. Nothing here knows about HTTP: the
// API's guard and the admin console's nav both read these, and a role invented
// in one of them is a role the other cannot check.
//
// Authority for the contents: docs/architecture/rbac-matrix.md §1.

import { z } from "zod";

/**
 * Authentication realms. Two, and no token opens both — a guest session on a
 * staff route is a 403 (the token is valid, the realm is wrong), never a 401.
 */
export const REALMS = ["guest", "staff"] as const;

export const realmSchema = z.enum(REALMS);

export type Realm = z.infer<typeof realmSchema>;

/**
 * Staff roles, in ascending authority. The order is not decorative: `ADMIN`
 * inherits every `MANAGER` permission (rbac-matrix.md §2), and the matrix is
 * asserted against that ordering rather than trusting fifty-four rows to have
 * been typed consistently.
 */
export const STAFF_ROLES = [
  "HOUSEKEEPING",
  "RECEPTIONIST",
  "ACCOUNTANT",
  "MANAGER",
  "ADMIN",
] as const;

export const staffRoleSchema = z.enum(STAFF_ROLES);

export type StaffRole = z.infer<typeof staffRoleSchema>;

/**
 * The guest realm's only role. It exists as a named constant so a capability
 * row reads the same on both sides of the realm boundary, not because guests
 * will ever have a second one — a guest with elevated rights is a staff member.
 */
export const GUEST_ROLE = "GUEST" as const;

export type GuestRole = typeof GUEST_ROLE;

/**
 * What a role may do with one capability.
 *
 * `read` and `conditional` both grant access — the distinction is what the
 * handler must still check. `read` means the route is safe but a write path
 * under the same capability is not; `conditional` means the grant depends on
 * data the guard cannot see (ownership, the requester's own shift, a retention
 * window) and the handler owes that check. `denied` is the only value that
 * stops a request at the guard.
 */
export const GRANTS = ["full", "read", "conditional", "denied"] as const;

export type Grant = (typeof GRANTS)[number];

/** True when the guard lets the request through. See {@link Grant}. */
export function grants(grant: Grant): boolean {
  return grant !== "denied";
}
