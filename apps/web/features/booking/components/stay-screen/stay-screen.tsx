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
//
// **It is also where the confirmation email's stay link lands.** A guest who
// cleared their cookies, changed device or is reading the message on a phone
// arrives holding nothing, and the link in their hand is what proves the stay.
// It is exchanged for the booking cookie on the way in, spent by the exchanging,
// and taken off the address the moment it has been read — `use-presented-link.ts`
// argues both halves. A link that was already spent is an ordinary arrival and
// not a failure: `openStay` says why, and the guest sees their booking.
//
// The link arrives in the fragment, which only a browser can read, so the
// arrival below waits for the address to have been consulted. Starting it before
// that would read the stay without the credential the guest is holding — and the
// arrival is remembered per booking, so the read would never be retried.

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  StayShell,
  stayStyles as styles,
} from "@/features/booking/components/stay-shell/stay-shell";
import {
  ATTACHING_BOOKING_PARAM,
  isUnattached,
  openStay,
  STAY_LINK_PARAM,
  type StayArrival,
} from "@/features/booking/lib/booking-links";
import { usePresentedLink } from "@/features/booking/lib/use-presented-link";
import type { HeldStay } from "@/features/booking/lib/stay-funnel";

export function StayScreen({ reference }: { readonly reference: string }) {
  const router = useRouter();
  const justBooked = useSearchParams().get("booked") !== null;
  const presented = usePresentedLink(STAY_LINK_PARAM);

  const [stay, setStay] = useState<HeldStay>();
  const [refusal, setRefusal] = useState<string>();
  const [loading, setLoading] = useState(true);

  // The arrival, started once per booking and remembered. The link is good for a
  // single use, so a second run of the effect below — React's strict
  // double-invoke in development, a re-render while the exchange is in flight —
  // must join the arrival already happening rather than spend the credential
  // again and find it gone. It is tagged with the stay it was started for
  // because this component survives a change of route parameter, and an untagged
  // one would answer the next booking with the last one's.
  const arrival = useRef<{
    readonly reference: string;
    readonly answer: Promise<StayArrival>;
  } | null>(null);

  useEffect(() => {
    let live = true;

    if (!presented.read) {
      return;
    }

    if (arrival.current?.reference !== reference) {
      arrival.current = {
        reference,
        answer: openStay(reference, presented.link),
      };
    }

    void arrival.current.answer.then((answer) => {
      if (!live) {
        return;
      }

      setStay(answer.stay);
      setRefusal(answer.refusal);
      setLoading(false);
    });

    return () => {
      live = false;
    };
  }, [reference, presented]);

  if (loading) {
    return (
      <StayShell
        step="Your booking"
        subtitle="One moment while the property reads your booking."
        title={reference}
      />
    );
  }

  // No stay, and two ways to arrive at that: a link that was already used or has
  // run out, and a reference this browser cannot open. The API's own sentence
  // says which, and the way forward is the same either way — the message the
  // property sent still holds a link, and a stay already in an account is opened
  // by signing in rather than by a credential at all.
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
        <p className={styles.notice}>
          Open the link in your confirmation email again, or log in if this stay
          is already in your account.
        </p>
        <div className={styles.actions}>
          <button
            className={styles.submit}
            onClick={() => router.push("/login")}
            type="button"
          >
            Log in
          </button>
          <button
            className={styles.secondary}
            onClick={() => router.push("/booking")}
            type="button"
          >
            Book a stay
          </button>
        </div>
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

      {/* Offered on a stay nobody has claimed, and that is a fact about this
          booking rather than about the address on it — `isUnattached` carries
          the argument. The offer is the same for every guest who sees it: what
          differs between an address with an account and one without is in the
          confirmation email, which reaches that address and nobody else. */}
      {isUnattached(stay) ? (
        <div className={styles.actions}>
          <button
            className={styles.secondary}
            onClick={() =>
              router.push(
                `/login?${ATTACHING_BOOKING_PARAM}=${encodeURIComponent(stay.id)}`,
              )
            }
            type="button"
          >
            Add this stay to your account
          </button>
        </div>
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
