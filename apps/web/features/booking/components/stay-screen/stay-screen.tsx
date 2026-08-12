"use client";

// `/bookings/<reference>` — the booking, and the confirmation that it happened.
//
// **One route for both, and `repository-structure.md` §`(booking)` argues why.**
// `rbac-matrix.md` §3 has a single row — read own booking / stay history — and a
// confirmation page is that row read four seconds after payment. Two routes
// rendering one booking would be two things to keep in step forever, so the
// freshly-booked state is a banner rather than a page of its own.
//
// The banner is decided by where the guest came from, which is the one thing
// this screen cannot read off the record: a booking does not remember that it
// was confirmed a moment ago. `confirming/` replaces its url with this one, so
// arriving with no referrer within the session is the ordinary case for somebody
// checking a stay they made last week — and both readings are true statements
// about the same row, which is why getting it wrong is a warmer sentence rather
// than a wrong fact.
//
// Addressed by the reference and not by the hold's id, because from here on the
// guest holds a booking rather than a hold — it is the string on their
// confirmation, the one they read down a telephone, and the one
// `booking.readOwn` answers to.

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  StayShell,
  stayStyles as styles,
} from "@/features/booking/components/stay-shell/stay-shell";
import type { HeldStay } from "@/features/booking/lib/stay-funnel";
import { api, apiMessage } from "@/lib/api";

export function StayScreen({ reference }: { readonly reference: string }) {
  const router = useRouter();
  const justBooked = useSearchParams().get("booked") !== null;

  const [stay, setStay] = useState<HeldStay>();
  const [refusal, setRefusal] = useState<string>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;

    async function read(): Promise<void> {
      try {
        const answer = await api.booking.readOwn({ reference });

        if (live) {
          setStay(answer);
          setLoading(false);
        }
      } catch (error) {
        if (live) {
          setRefusal(
            apiMessage(
              error,
              "That booking could not be read just now. Check your connection and try again.",
            ),
          );
          setLoading(false);
        }
      }
    }

    void read();

    return () => {
      live = false;
    };
  }, [reference]);

  if (loading) {
    return (
      <StayShell
        step="Your booking"
        subtitle="One moment while the property reads your booking."
        title={reference}
      />
    );
  }

  if (!stay) {
    return (
      <StayShell
        step="Your booking"
        subtitle="The property could not open this booking."
        title={reference}
      >
        <p className={styles.error} role="alert">
          {refusal}
        </p>
        <button
          className={styles.submit}
          onClick={() => router.push("/booking")}
          type="button"
        >
          Book a stay
        </button>
      </StayShell>
    );
  }

  return (
    <StayShell
      footnote="Keep this reference. It is how the property finds your stay at the desk and on the telephone."
      stay={stay}
      step={justBooked ? "Confirmed" : "Your booking"}
      subtitle={SUBTITLES[stay.state] ?? SUBTITLES.CONFIRMED}
      title={justBooked ? "You are booked" : stay.reference}
    >
      {justBooked ? (
        <p className={styles.notice} role="status">
          Thank you. The property has your payment and the room is held in your
          name.
        </p>
      ) : null}
    </StayShell>
  );
}

/**
 * What each state means to the person who booked it.
 *
 * Keyed on the booking's own state rather than on what brought the guest here,
 * because this route is also how a stay is looked at weeks later — by which time
 * it may have been stayed in, or called off. The states a guest can reach are
 * the ones written out; anything else falls back to the confirmed sentence,
 * which is the only one that is true of every state a booking can be in and
 * still be a booking.
 */
const SUBTITLES: Readonly<Record<string, string>> = {
  HELD: "This stay is being held while the payment is completed.",
  CONFIRMED: "Confirmed. The property is expecting you.",
  CHECKED_IN: "You are checked in. Enjoy your stay.",
  CHECKED_OUT: "This stay is complete. Thank you for staying with us.",
  CANCELLED: "This stay was cancelled.",
  NO_SHOW: "This stay is recorded as a no-show. Please speak to the desk.",
};
