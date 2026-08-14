import type { Metadata } from "next";
import { Suspense } from "react";
import { BookingAccountScreen } from "@/features/auth/components/booking-account-screen";

export const metadata: Metadata = {
  title: "Keep this stay — Mariva",
  description:
    "Create your Mariva account from the link in your confirmation email and keep this stay with it.",
};

// `/bookings/<reference>/account` — where the confirmation email's second link
// lands. `booking.service.ts` mints that address, so the segment and the
// parameter it carries are that file's and are matched here rather than chosen.
//
// The credential is read in the client component and cannot be read here at
// all, which is the one place this route departs from `verify-email/page.tsx`.
// It arrives in the URL's fragment, and a fragment is the one part of an address
// a browser never puts in a request — so no server on the way sees it, this one
// included. The only thing that should ever happen to it is being posted once,
// in a body, and taken off the address, which is a client's work either way.
//
// The boundary below stays: the screen suspends nothing today, and a route whose
// state is read off the address is one render away from needing it again.
export default function BookingAccountPage() {
  return (
    <Suspense fallback={null}>
      <BookingAccountScreen />
    </Suspense>
  );
}
