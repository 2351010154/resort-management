import type { Metadata } from "next";
import { CancellableStay } from "@/features/booking/components/stay-cancellation/cancellable-stay";
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
// guest holds from here on and what `booking.readOwn` answers to.
//
// **The cancellation travels with the stay rather than beside it.** The screen
// and the panel that calls the stay off read and write one row on one
// credential, and the screen states the very thing the panel changes — so
// `cancellable-stay.tsx` composes the two and makes the screen read again once
// the stay has moved. It also owns the Suspense boundary the screen needs for
// reading `?booked` off the query.
//
// **The feedback panel sits under both, on the same route and by another rule.**
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
// It stands outside that boundary because it reads no search parameter: its
// whole input is the reference in the path, which this component already has.
// It is untouched by a cancellation for the same reason — a stay that can still
// be called off has not been left yet, so there is nothing there to say.
export default async function BookingPage({
  params,
}: {
  readonly params: Promise<{ readonly reference: string }>;
}) {
  const { reference } = await params;

  return (
    <div className={styles.route}>
      <CancellableStay reference={reference} />

      {/* Keyed by the stay, so moving to another booking takes the whole of
          this one's panel with it — the answer already read, a rating and a
          comment typed and not sent, and a write still in flight. A stay is
          spoken about once and cannot be edited afterwards, so a draft that
          survived onto the next booking is a sentence filed against the wrong
          stay for good. Structural rather than a list of resets the panel has
          to remember to keep in step with its own state. */}
      <StayFeedbackPanel key={reference} reference={reference} />
    </div>
  );
}
