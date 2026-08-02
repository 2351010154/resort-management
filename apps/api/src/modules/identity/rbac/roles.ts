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

/**
 * What a route does with the capability it names.
 *
 * The matrix grants authority over a *row*, and a row is wider than a route:
 * "Rate plans, rate calendar, promotions" is one row that a receptionist may
 * look at and a manager may change. Two routes, one capability, and the
 * difference between them is this.
 */
export const CAPABILITY_ACTIONS = ["read", "write"] as const;

export type CapabilityAction = (typeof CAPABILITY_ACTIONS)[number];

/**
 * Whether a grant lets a route through.
 *
 * `read` is the only grant that turns on the action, and that is what the 👁 in
 * the document means: the row is visible to this role and its write paths are
 * not. Without this comparison a receptionist holding 👁 over the rate calendar
 * could POST a new price, because the guard would only ever have asked whether
 * the grant was `denied`.
 *
 * `conditional` satisfies a write. It is not a lesser grant — it is a full one
 * whose scope the guard cannot see (this guest's booking, this receptionist's
 * shift), and the handler still owes that check. Reading it as read-only would
 * refuse a receptionist their own cash drawer.
 */
export function permits(grant: Grant, action: CapabilityAction): boolean {
  if (grant === "denied") {
    return false;
  }

  return action === "read" || grant !== "read";
}
