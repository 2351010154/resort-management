// The bodies these three routes accept, and the session they answer with.
//
// Defined in `@mariva/shared` rather than here. The routes stay outside the
// oRPC contract because they set an httpOnly cookie, so nothing generates the
// console's half of them from this file — the shared schemas are what stops the
// two hand-written ends drifting apart, and re-exporting them here keeps the
// controller importing its DTOs from beside itself.
//
// Both schemas carry their reasoning at the definition. The short version of
// the one that matters: sign-in validates shape, not policy — the password is
// checked for presence and nothing else, because applying the strength rules
// here would reject a valid old password after the rules tighten and lock out
// the accounts most in need of a sign-in. Strength is enforced where a password
// is *set*. And `staffRefreshSchema`'s optional token is for a client that
// cannot hold cookies; the cookie is the normal path and takes precedence.

export {
  type StaffRefreshBody,
  staffRefreshSchema,
  type StaffSession,
  staffSessionSchema,
  type StaffSessionUser,
  type StaffSignInBody,
  staffSignInSchema,
} from "@mariva/shared";
