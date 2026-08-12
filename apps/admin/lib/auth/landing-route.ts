/* Where a signed-in operator starts, and where they are put back.
 *
 * Two decisions, both pure and both load-bearing, kept out of the components
 * that use them so they can be read and proved in one place.
 */

import { type StaffRole, staffRoleSchema } from "@mariva/shared";

/**
 * The role-aware landing — `docs/screens.md` §"Staff surfaces".
 *
 * Each role starts where its work starts rather than on a screen meant for
 * someone else: housekeeping walks the floors from the board, the accountant
 * opens on payments, and the three roles who work the desk share the dashboard
 * launchpad.
 *
 * **These paths name screens that do not exist yet.** They are the paths those
 * screens will occupy — the families are listed in
 * `docs/architecture/repository-structure.md` §`apps/admin` — and naming them
 * here is what lets the map be settled and tested before the first one is
 * built. Until a family lands, its route is a 404, which is the honest state of
 * a console with a working session and no screens; a placeholder screen behind
 * each of them would be a second opinion about an inventory that has an owner.
 */
export const LANDING_BY_ROLE: Readonly<Record<StaffRole, string>> = {
  RECEPTIONIST: "/dashboard",
  MANAGER: "/dashboard",
  ADMIN: "/dashboard",
  HOUSEKEEPING: "/housekeeping",
  ACCOUNTANT: "/payments",
};

/** Where a role with no entry of its own is sent. The console's general
 *  entrance: a build that meets a role it has never heard of should start the
 *  operator somewhere rather than nowhere, and what they may see once there is
 *  the screen's question, not this one's. */
export const DEFAULT_LANDING = "/dashboard";

/**
 * The landing for a role as the API named it.
 *
 * Takes a `string` rather than a `StaffRole` deliberately. The role arrives
 * over the wire, and an API that has gained a sixth role is exactly the case
 * this has to survive — the schema would have rejected the whole session
 * upstream, but this function is also read by the redirect that runs before
 * anything else and must not be the thing that throws.
 */
export function landingRouteFor(role: string): string {
  const known = staffRoleSchema.safeParse(role);

  return known.success ? LANDING_BY_ROLE[known.data] : DEFAULT_LANDING;
}

/** The login screen. A route group does not appear in a URL, so `(auth)/login`
 *  is reached as `/login`. */
export const LOGIN_ROUTE = "/login";

/** What the guard writes the interrupted destination into, and what the login
 *  screen reads it back out of. */
export const RETURN_PARAM = "next";

/** The login URL that remembers where the operator was going. */
export function loginHref(from?: string | null): string {
  const destination = safeReturnPath(from);

  return destination === null
    ? LOGIN_ROUTE
    : `${LOGIN_ROUTE}?${RETURN_PARAM}=${encodeURIComponent(destination)}`;
}

/**
 * The path the guard saved, if it is safe to go back to.
 *
 * Anything that is not a single-slash-rooted path on this origin is discarded
 * and the caller falls back to the role's landing. `//evil.example` and
 * `https://evil.example` are both what an open redirect looks like: a link to
 * the console's own login carrying somebody else's destination, followed by an
 * operator who has just typed their password and has no reason to read the
 * address bar. A backslash is refused with them because some browsers still
 * normalise it to a slash.
 */
export function safeReturnPath(raw: string | null | undefined): string | null {
  if (!raw?.startsWith("/")) {
    return null;
  }

  if (raw.startsWith("//") || raw.startsWith("/\\")) {
    return null;
  }

  return raw;
}
