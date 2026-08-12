import type { Metadata } from "next";
import { Suspense } from "react";
import { StayScreen } from "@/features/booking/components/stay-screen/stay-screen";

export const metadata: Metadata = {
  title: "Your booking — Mariva",
  description:
    "Your stay at Mariva: the nights, the room, and the reference the property knows it by.",
};

// Confirmation and stay detail are one route — `repository-structure.md`
// §`(booking)`. `rbac-matrix.md` §3 has one row for reading your own booking,
// and a confirmation page is that row read four seconds after payment; the
// freshly-booked state is a banner, not a second page to keep in step.
//
// Addressed by the reference rather than the hold id, because that is what the
// guest holds from here on and what `booking.readOwn` answers to. The screen
// reads `?booked` to decide whether to greet, so it needs the same Suspense
// boundary every route whose state is the query string does.
export default async function BookingPage({
  params,
}: {
  readonly params: Promise<{ readonly reference: string }>;
}) {
  const { reference } = await params;

  return (
    <Suspense fallback={null}>
      <StayScreen reference={reference} />
    </Suspense>
  );
}
