// `/account/stays` — the stay history, beside the profile rather than instead of
// it.
//
// `screens.md` §Account gives the area two addresses: `/account` is the profile
// and this is the history, where each stay leads back to the same
// `/bookings/<reference>` surface the funnel's confirmation ended on. There is
// no redirect at `/account` for this route to be the target of — that route
// shows the profile.
//
// In `(booking)` for the reason `login/page.tsx` gives: the route group carries
// the funnel's bundle budget, and a guest who has just booked and wants to see
// their stays should not pull the arrival's bundle in behind them.
//
// The screen is a client because the list is read with the guest's session
// cookie from the browser, and because the boundary between an upcoming stay and
// a past one is drawn against today.

import type { Metadata } from "next";
import { StaysList } from "@/features/account/components/stays-list/stays-list";

export const metadata: Metadata = {
  title: "Your stays | Mariva",
  description: "Every stay this account has taken, and the ones still to come.",
};

export default function StaysPage() {
  return <StaysList />;
}
