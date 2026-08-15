// /signup — the other half of the door. `/login` links here by this name.
//
// It takes the same `booking` the log-in page does, and means the same thing by
// it: the stay a guest arrived to claim. A guest who booked without an account
// and no longer has the confirmation email has nothing left to press but this
// screen, and the browser they are pressing it in is still the browser holding
// that booking's cookie — so the id is carried through the sign-up and spent at
// the attach, rather than dropped here and the stay left filed under nobody.
//
// A booking id and not a credential: the API attaches only the stay the cookie
// on the request has already proved, so one made up in an address bar is a
// refusal and never somebody else's booking. Nothing is decided from it here.

import type { Metadata } from "next";
import { SignUpScreen } from "@/features/auth/components/sign-up-screen";

export const metadata: Metadata = {
  title: "Create an account — Mariva",
  description: "Create a Mariva account to book and manage your stay.",
};

export default async function SignUpPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly booking?: string }>;
}) {
  const { booking } = await searchParams;

  return <SignUpScreen claiming={booking ?? null} />;
}
