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

/** Stands in for this console wherever a relative path has to be resolved to
 *  decide whether it stays here. Not reachable and not a real origin, which is
 *  the point: anything that resolves away from it resolved somewhere else. */
const SAME_ORIGIN_PROBE = "https://console.invalid";

/** Whether a candidate carries a character a URL parser would drop or refuse
 *  — tab, newline and carriage return above all. A destination containing one
 *  is not a destination anybody typed, and stripping it is what turns a path
 *  that passed a prefix check into a different origin. */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;

    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }

  return false;
}

/**
 * The path the guard saved, if it is safe to go back to.
 *
 * Anything that does not resolve to this origin is discarded and the caller
 * falls back to the role's landing. `//evil.example` and `https://evil.example`
 * are both what an open redirect looks like: a link to the console's own login
 * carrying somebody else's destination, followed by an operator who has just
 * typed their password and has no reason to read the address bar.
 *
 * The decision is made by resolving the candidate rather than by inspecting its
 * first two characters, because a prefix test answers a different question than
 * the browser does. A URL parser strips tab, newline and carriage return before
 * it resolves, so `/\n/evil.example` — three characters that pass any
 * `startsWith` check — is `//evil.example` by the time anything navigates to
 * it. Control characters are refused outright and the rest is settled by the
 * same parser the browser would use, so the answer here and the answer there
 * cannot disagree.
 */
export function safeReturnPath(raw: string | null | undefined): string | null {
  if (!raw?.startsWith("/") || hasControlCharacter(raw)) {
    return null;
  }

  let resolved: URL;

  try {
    resolved = new URL(raw, SAME_ORIGIN_PROBE);
  } catch {
    return null;
  }

  if (resolved.origin !== SAME_ORIGIN_PROBE) {
    return null;
  }

  // Rebuilt from the parsed URL rather than returned as it arrived, so what the
  // caller navigates to is the thing that was judged safe and not a string that
  // merely resolved to it once.
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}
