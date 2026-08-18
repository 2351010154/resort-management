import type { Metadata } from "next";
import { Suspense } from "react";
import { StayScreen } from "@/features/booking/components/stay-screen/stay-screen";
import { StayFeedbackPanel } from "@/features/feedback/components/stay-feedback/stay-feedback";
import styles from "./stay-route.module.css";

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
//
// **The feedback panel sits under it, on the same route and by the same rule.**
// `screens.md` §Account puts every act a stay allows on the stay's own surface —
// cancelling it, providing the identity document, saying how it went — each
// shown only when the booking's state allows. It is a sibling rather than
// something inside the screen above because the two answer to different
// credentials: the stay reads with whatever opens the booking, including the
// link out of a confirmation email, and feedback is an account's statement,
// which the API refuses to anything else. The panel asks and draws nothing when
// the answer is no, so a stay that is not over — or not this browser's — shows
// exactly what it showed before.
//
// It stands outside the Suspense boundary because it reads no search parameter:
// its whole input is the reference in the path, which this component already
// has.
export default async function BookingPage({
  params,
}: {
  readonly params: Promise<{ readonly reference: string }>;
}) {
  const { reference } = await params;

  return (
    <div className={styles.route}>
      <Suspense fallback={null}>
        <StayScreen reference={reference} />
      </Suspense>

      <StayFeedbackPanel reference={reference} />
    </div>
  );
}
