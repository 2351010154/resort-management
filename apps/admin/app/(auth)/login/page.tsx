// The login route. `(auth)` is a route group, so this is `/login`.
//
// A server component whose only job is to read one query parameter. The guard
// under `(app)` puts the interrupted destination there, and reading it here
// rather than with `useSearchParams` in the form is what keeps the form out of
// a Suspense boundary it would otherwise need — a screen that suspends on its
// own URL renders nothing on the first paint, and this is the one screen that
// has to be there immediately.
//
// The parameter is handed down as it arrived and sanitised where it is used:
// `safeReturnPath` is the one place that decides whether a destination is this
// origin's to go to.

import { LoginForm } from "@/features/staff-auth/login-form";
import { RETURN_PARAM } from "@/lib/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requested = params[RETURN_PARAM];

  // A repeated parameter arrives as an array. Two destinations is one too many
  // to be a real interruption, so it is treated as none.
  return (
    <LoginForm returnTo={typeof requested === "string" ? requested : null} />
  );
}
