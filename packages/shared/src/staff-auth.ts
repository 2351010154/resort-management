// The staff realm's door, as schemas both sides read.
//
// These three routes are deliberately outside the oRPC contract: they set and
// clear an httpOnly refresh cookie, which a contract handler has no way to
// reach. That leaves them hand-written on both ends — a Nest controller and a
// `fetch` in the console — and a hand-written pair drifts. So the *shapes* live
// here even though the routes do not: the API validates its bodies against
// these schemas and the console parses its responses through the same ones, and
// a field renamed on either side fails to compile on both.
//
// Nothing here knows a URL or a status code. Those belong to the two callers,
// which is also why this file is a plain module beside `money.ts` rather than
// anything under `contract/`.

import { z } from "zod";

/**
 * Staff roles, in ascending authority — `docs/architecture/rbac-matrix.md` §1.
 *
 * The API keeps its own copy in `modules/identity/rbac/roles.ts`, where the
 * matrix, the guard and the Postgres enum are built on it. This is not a second
 * opinion: the API's sign-in result is typed against *this* union while its
 * account rows are typed against that one, so the two lists agreeing is a
 * compile-time fact rather than a convention.
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

// Sign-in validates shape, not policy. The password is checked for presence and
// nothing else: applying the strength rules here would reject a valid old
// password after the rules tighten, locking out the accounts most in need of a
// sign-in. Strength is enforced where a password is *set*.
export const staffSignInSchema = z.object({
  email: z.email().max(320),
  password: z.string().min(1).max(1024),
});

export type StaffSignInBody = z.infer<typeof staffSignInSchema>;

// Present for a client that cannot hold cookies. The cookie is the normal path
// and takes precedence; this exists so the API is usable from a terminal
// without pretending to be a browser.
export const staffRefreshSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});

export type StaffRefreshBody = z.infer<typeof staffRefreshSchema>;

/** The account as a client may see it. The password digest and the activity
 *  flags are not in it, and the API's own `publicView` is what keeps them out. */
export const staffSessionUserSchema = z.object({
  // Typed as tightly as the row it comes from — `staff_user.id` is a Postgres
  // `uuid` and the address went through `staffSignInSchema` on the way in. A
  // looser field here would let a malformed session through the parse that
  // exists to catch exactly that.
  id: z.uuid(),
  email: z.email().max(320),
  fullName: z.string().min(1),
  role: staffRoleSchema,
});

export type StaffSessionUser = z.infer<typeof staffSessionUserSchema>;

/**
 * What sign-in and refresh answer with.
 *
 * The refresh token is not in it and must never be added. It travels as an
 * httpOnly cookie precisely so the page cannot read it; a field here would put
 * the long-lived half of the session inside reach of any script on the origin.
 * `expiresIn` is seconds, as the API counts them — the console turns it into an
 * instant against its own clock, because a browser's clock is the only one it
 * can schedule a refresh on.
 */
export const staffSessionSchema = z.object({
  user: staffSessionUserSchema,
  accessToken: z.string().min(1),
  expiresIn: z.number().int().positive(),
});

export type StaffSession = z.infer<typeof staffSessionSchema>;
