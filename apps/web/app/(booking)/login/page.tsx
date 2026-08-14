// /login — the guest realm's door.
//
// In (booking) rather than a group of its own: the route group carries the
// funnel's bundle budget (zero bytes of three / gsap / lenis) and this screen is
// built to it. It has no shell to opt out of yet, and inventing a third group
// to hold one screen would be a structure decision made by a filename.
//
// It is also where the API returns a guest whose Google sign-in did not
// complete, carrying `?error=…`. Read here, on the server, for the reason
// verify-email/page.tsx gives.
//
// The other two are which stay a guest arrived to claim — `booking` when the
// attach is owed after the form, `attach` when they are coming back from Google
// already signed in. Both names are `booking-links.ts`'s, which is where the
// addresses carrying them are composed. Both are booking ids and neither is a
// credential: the API
// attaches only the stay the booking cookie on the request has proved, so these
// are safe in an address in the way the confirmation email's links are not.

import type { Metadata } from "next";
import { LoginScreen } from "@/features/auth/components/login-screen";

export const metadata: Metadata = {
  title: "Log in — Mariva",
  description: "Sign in to your Mariva account.",
};

export default async function LoginPage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly error?: string;
    readonly booking?: string;
    readonly attach?: string;
  }>;
}) {
  const { error, booking, attach } = await searchParams;

  return (
    <LoginScreen
      claiming={booking ?? null}
      claimingNow={attach ?? null}
      googleError={error ?? null}
    />
  );
}
