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
  //
  // The bar was briefly rendered here, outside the boundary, so that it painted
  // with the document. It has moved inside `BookingScreen`: the screen is two
  // grounds side by side and the bar belongs to the left one, which means it has to
  // narrow when the stay panel opens — and a `<header>` above the boundary cannot
  // know that the panel exists. See the note beside `<FunnelNav />` there.
  return (
    <Suspense fallback={null}>
      <BookingScreen />
    </Suspense>
  );
}
