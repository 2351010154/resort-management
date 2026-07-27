import type { Metadata } from "next";
import { Suspense } from "react";
import { BookingScreen } from "@/features/booking/components/booking-screen";

export const metadata: Metadata = {
  title: "Your stay — Mariva",
  description:
    "Choose the nights you are here and the room you would like. Prices include VAT and service.",
};

export default function BookingPage() {
  // `useSearchParams` needs a Suspense boundary above it, because the whole point
  // of this route is that its state is the query string — Next has to render the
  // shell before it knows what the search is.
  //
  // An empty fallback rather than a skeleton: the screen's first paint is already
  // its resting state ("Choose your dates"), so a placeholder would be a second
  // thing that flashes past on the way to the same layout.
  return (
    <Suspense fallback={null}>
      <BookingScreen />
    </Suspense>
  );
}
