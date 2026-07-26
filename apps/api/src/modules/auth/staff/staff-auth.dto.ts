import { z } from "zod";

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
