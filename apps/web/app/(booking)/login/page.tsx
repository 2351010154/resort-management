// /login — the guest realm's door.
//
// In (booking) rather than a group of its own: the route group carries the
// funnel's bundle budget (zero bytes of three / gsap / lenis) and this screen is
// built to it. It has no shell to opt out of yet, and inventing a third group
// to hold one screen would be a structure decision made by a filename.

import type { Metadata } from "next";
import { LoginScreen } from "@/features/auth/components/login-screen";

export const metadata: Metadata = {
  title: "Log in — Mariva",
  description: "Sign in to your Mariva account.",
};

export default function LoginPage() {
  return <LoginScreen />;
}
