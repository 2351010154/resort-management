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

import type { Metadata } from "next";
import { LoginScreen } from "@/features/auth/components/login-screen";

export const metadata: Metadata = {
  title: "Log in — Mariva",
  description: "Sign in to your Mariva account.",
};

export default async function LoginPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly error?: string }>;
}) {
  const { error } = await searchParams;

  return <LoginScreen googleError={error ?? null} />;
}
