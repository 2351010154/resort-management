// `/account` — the profile itself, and not a doorway to one.
//
// `screens.md` §Account is explicit about that: the account area holds what a
// guest owns outside any single stay, `/account` is the profile — personal data,
// VIP tier, loyalty — and `/account/stays` is the history beside it. A redirect
// from here to the stays would leave the area's front door showing nothing and
// the profile with no address of its own.
//
// In `(booking)` for the reason `login/page.tsx` gives: that route group carries
// the funnel's bundle budget — zero bytes of three, gsap or lenis — and this
// screen is built to it. A guest reaching their profile from a stay should not
// pull the arrival's bundle in behind them.
//
// The screen is a client because everything on it is read with the guest's
// session cookie from the browser, and because the two credential forms post to
// Better Auth's own routes on the API's origin.

import type { Metadata } from "next";
import { ProfileForm } from "@/features/account/components/profile-form/profile-form";

export const metadata: Metadata = {
  title: "Your profile — Mariva",
  description:
    "Your details, your tier and your loyalty points, and how you sign in.",
};

export default function AccountPage() {
  return <ProfileForm />;
}
