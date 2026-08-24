"use client";

/* The console's door. One form, two fields, no shell around it.
 *
 * Keyboard-first the way the rest of the console is: focus is placed in the
 * email field on arrival so a receptionist starting their shift types their
 * address and presses Enter twice without touching the mouse. There is no
 * reveal control on the password and no "remember me" — the first is a
 * front-desk screen other people can see, and the second is what the refresh
 * cookie already does.
 *
 * The failure sentence is the API's own, verbatim, and it does not say which
 * half was wrong. That is not vagueness: an error that distinguishes "no such
 * account" from "wrong password" answers "does this person work here?" for
 * anyone who asks, and the API is careful not to answer it either.
 */

import { Building2Icon, ShieldCheckIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  landingRouteFor,
  safeReturnPath,
  staffSession,
  useSessionState,
} from "@/lib/auth";

interface Credentials {
  email: string;
  password: string;
}

export function LoginForm({
  /** Where the guard was taking the operator before it found no session. Read
   *  on the server from the query string and handed down — see the page. */
  returnTo = null,
}: {
  readonly returnTo?: string | null;
}) {
  const router = useRouter();
  const session = useSessionState();
  const [failure, setFailure] = useState<string | null>(null);

  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    setFocus,
  } = useForm<Credentials>({
    // Fields are checked on submit and not before: a validation message
    // appearing under a half-typed address — or under an address the operator
    // has only tabbed out of on the way to the password — is telling somebody
    // they are wrong before they have finished being right.
    mode: "onSubmit",
  });

  useEffect(() => {
    setFocus("email");
  }, [setFocus]);

  // An operator who already has a session does not get asked for it again.
  // Reaching this screen signed in is what a bookmark of `/login` does, and it
  // is also the last frame of signing out — where the state has just become
  // anonymous and this effect is correctly quiet.
  //
  // The form renders while the session is still `restoring` rather than
  // blanking the screen: the common case for this route is nobody signed in,
  // and holding it back would put a blank frame the length of one request in
  // front of every sign-in to spare the rare one a redirect.
  useEffect(() => {
    if (session.status !== "authenticated") {
      return;
    }

    router.replace(
      safeReturnPath(returnTo) ?? landingRouteFor(session.user.role),
    );
  }, [session, returnTo, router]);

  async function onSubmit(credentials: Credentials) {
    setFailure(null);

    const outcome = await staffSession.signIn(credentials);

    if (!outcome.ok) {
      setFailure(outcome.message);
      return;
    }

    // Back to the interrupted destination when there was one, and to the role's
    // own landing otherwise — `docs/screens.md` §"Staff surfaces". `replace`,
    // so the login screen is not behind the back button of a signed-in console.
    router.replace(
      safeReturnPath(returnTo) ?? landingRouteFor(outcome.user.role),
    );
  }

  return (
    <main className="grid min-h-svh bg-background lg:grid-cols-[minmax(320px,0.8fr)_1.2fr]">
      <aside className="hidden flex-col justify-between bg-nav p-10 text-nav-text lg:flex">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-accent-soft font-semibold text-accent-strong">
            M
          </span>
          <span>
            <span className="block text-sm font-semibold tracking-[0.18em]">
              MARIVA
            </span>
            <span className="block text-sm text-nav-muted">Staff console</span>
          </span>
        </div>
        <div className="max-w-md">
          <Building2Icon
            aria-hidden="true"
            className="size-8 text-accent"
            strokeWidth={1.5}
          />
          <p className="mt-5 text-3xl font-semibold leading-tight tracking-[-0.02em]">
            A calm desk for a busy hotel day.
          </p>
          <p className="mt-3 max-w-[42ch] text-sm text-nav-muted">
            Arrivals, rooms, money, and handover stay in one keyboard-ready
            workspace.
          </p>
        </div>
        <p className="flex items-center gap-2 text-sm text-nav-muted">
          <ShieldCheckIcon aria-hidden="true" className="size-4" />
          Protected staff access
        </p>
      </aside>

      <div className="flex items-center justify-center p-4 sm:p-8">
        <Card className="w-full max-w-md p-6 sm:p-8">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <span className="grid size-9 place-items-center rounded-lg bg-primary font-semibold text-primary-foreground">
              M
            </span>
            <span className="text-sm font-semibold tracking-[0.18em]">
              MARIVA
            </span>
          </div>
          <p className="text-sm font-semibold  text-muted-foreground uppercase">
            Staff access
          </p>
          <h1 className="mt-2 text-3xl font-semibold leading-9 tracking-[-0.02em]">
            Welcome back
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in to start your shift.
          </p>

          {/* `noValidate`: the browser's own bubbles are unstyled, untranslated
            and dismissed by a click, which is the one input this screen assumes
            nobody has. The same two rules are enforced below instead. */}
          <form
            className="mt-6 flex flex-col gap-4"
            noValidate
            onSubmit={handleSubmit(onSubmit)}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email address</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                aria-invalid={errors.email ? true : undefined}
                aria-describedby={errors.email ? "email-error" : undefined}
                {...register("email", {
                  required: "Enter your email address.",
                })}
              />
              {errors.email ? (
                <p className="text-destructive text-sm" id="email-error">
                  {errors.email.message}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                aria-invalid={errors.password ? true : undefined}
                aria-describedby={
                  errors.password ? "password-error" : undefined
                }
                {...register("password", { required: "Enter your password." })}
              />
              {errors.password ? (
                <p className="text-destructive text-sm" id="password-error">
                  {errors.password.message}
                </p>
              ) : null}
            </div>

            {/* A live region, because it arrives after a round trip. An operator
              who pressed Enter and is watching the button has no reason to go
              back up the form looking for a sentence that was not there when
              they left it. The rule on the leading edge is the console's error
              device — the palette has no red, and `--umber` text alone would
              read as ordinary copy. */}
            {failure ? (
              <p
                className="border-destructive text-destructive border-l-2 pl-3 text-sm"
                role="alert"
              >
                {failure}
              </p>
            ) : null}

            <Button
              className="mt-2 w-full"
              disabled={isSubmitting}
              type="submit"
            >
              {isSubmitting ? "Signing in" : "Sign in"}
            </Button>
          </form>
        </Card>
      </div>
    </main>
  );
}
