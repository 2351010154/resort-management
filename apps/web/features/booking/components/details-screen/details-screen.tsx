"use client";

// `/booking/<hold>/details` — the stay written back, before anybody is asked
// for money.
//
// The third of `FR-BOOK-06`'s six steps and the first that names a hold. What it
// is *for* is the check the two steps before it could not make: `/booking` prices
// from a fixture and quotes `STANDARD`, and this is where the guest sees the
// figure the property actually priced, against the nights the property actually
// took. A guest who disagrees with it has not paid anything yet.
//
// **It collects no personal details, and that is the contract rather than an
// omission.** `createBookingInput` takes the room, the nights and the party and
// nothing else; the guest is the account the hold was filed under, which the API
// read off the session. A form here asking for a name would be asking for a
// value no route accepts.
//
// **The expiry is shown because it is running.** The hold consumed the nights
// when it was taken, and `hold-expiry-sweep.ts` gives them back two minutes
// after the TTL falls due. A screen that did not say so would let a guest read
// terms at their leisure and find the room gone.

import { useRouter } from "next/navigation";
import { HoldTimer } from "@/features/booking/components/hold-timer/hold-timer";
import {
  StayShell,
  stayStyles as styles,
} from "@/features/booking/components/stay-shell/stay-shell";
import { isLost, isSettled } from "@/features/booking/lib/stay-funnel";
import { useHeldStay } from "@/features/booking/lib/use-held-stay";

export function DetailsScreen({ hold }: { readonly hold: string }) {
  const router = useRouter();
  const { stay, loading, refusal, reread } = useHeldStay(hold);

  if (loading) {
    return (
      <StayShell
        step="Step 3 of 4"
        subtitle="One moment while the property reads your stay back."
        title="Your stay"
      />
    );
  }

  if (!stay) {
    return (
      <StayShell
        step="Step 3 of 4"
        subtitle="The property could not open this stay."
        title="Your stay"
      >
        <p className={styles.error} role="alert">
          {refusal}
        </p>
        <button
          className={styles.submit}
          onClick={() => router.push("/booking")}
          type="button"
        >
          Start again
        </button>
      </StayShell>
    );
  }

  // A stay the sweep has already taken back, or one that was called off. There
  // is nothing on this screen a guest could do with it, and the button below
  // would open a payment page for a room the property has resold.
  if (isLost(stay)) {
    return (
      <StayShell
        stay={stay}
        step="Step 3 of 4"
        subtitle="This hold has been released, so the nights are back on sale."
        title="The hold has gone"
      >
        <p className={styles.notice} role="status">
          Nothing was charged. Choosing the dates again will show what is still
          available.
        </p>
        <button
          className={styles.submit}
          onClick={() => router.push("/booking")}
          type="button"
        >
          Choose again
        </button>
      </StayShell>
    );
  }

  // Already paid for, which is what a guest pressing back after the gateway
  // sees. Sent on to the booking rather than offered a second payment page.
  if (isSettled(stay)) {
    return (
      <StayShell
        stay={stay}
        step="Confirmed"
        subtitle="This stay is already confirmed."
        title="You are booked"
      >
        <button
          className={styles.submit}
          onClick={() => router.push(`/bookings/${stay.reference}`)}
          type="button"
        >
          See your booking
        </button>
      </StayShell>
    );
  }

  return (
    <StayShell
      footnote="Prices include VAT and service. Nothing is charged until you complete payment on the next step."
      stay={stay}
      step="Step 3 of 4"
      subtitle="Check the nights and the room. The next step takes you to the payment page."
      title="Your stay"
    >
      {/* The server's deadline, never a duration counted here — and when it
          falls due the stay is read again rather than assumed lost. The sweep
          runs every two minutes, so a clock reaching zero means the nights are
          *about* to go back, and only the API can say whether they have. */}
      {stay.holdExpiresAt ? (
        <HoldTimer
          expiresAt={new Date(stay.holdExpiresAt)}
          onExpired={reread}
        />
      ) : null}

      <div className={styles.actions}>
        <button
          className={styles.submit}
          onClick={() => router.push(`/booking/${stay.id}/payment`)}
          type="button"
        >
          Continue to payment
        </button>

        <button
          className={styles.secondary}
          onClick={() => router.push("/booking")}
          type="button"
        >
          Change the dates
        </button>
      </div>
    </StayShell>
  );
}
