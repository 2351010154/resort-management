"use client";

// `/booking/<hold>/payment` — where the guest leaves for the gateway.
//
// The fourth of `FR-BOOK-06`'s six steps, and the last one this property draws.
// What it does is small on purpose: it opens an attempt against the stay and
// sends the browser to the address the API hands back. Everything about how the
// money is taken belongs to VNPay's own page, and everything about what became
// of it belongs to the callback — this screen does not learn either.
//
// **The amount is the stay's, read from the API on this page.** Not carried from
// `details`, not held in a store, and never in the url. `payment.service.ts`
// writes the attempt's row with the figure it was asked for and compares every
// callback against it, so a figure that could be edited between the two screens
// would be an attempt opened for a number the guest chose.
//
// **`window.location.assign` and not the router.** The address is VNPay's, on
// another origin; Next's router is for routes this app owns, and handing it an
// external url is how a payment page ends up rendered inside a client-side
// navigation that cannot happen. `sign-in.ts` leaves for Google the same way.
//
// **The button can only be pressed once.** An attempt is a row and a signed url,
// and a double press is two attempts on one stay — both `PENDING`, one of which
// no callback will ever resolve. That is survivable, which is why the guard is a
// disabled button rather than anything cleverer, but it is still noise on a
// table `FR-PAY-05` reconciles every night.

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  StayShell,
  stayStyles as styles,
} from "@/features/booking/components/stay-shell/stay-shell";
import {
  type HeldStay,
  isLost,
  isSettled,
  openPayment,
} from "@/features/booking/lib/stay-funnel";
import { useHeldStay } from "@/features/booking/lib/use-held-stay";
import { apiMessage } from "@/lib/api";

export function PaymentScreen({ hold }: { readonly hold: string }) {
  const router = useRouter();
  const { stay, loading, refusal } = useHeldStay(hold);
  const [leaving, setLeaving] = useState(false);
  const [failed, setFailed] = useState<string>();

  async function leaveForGateway(paying: HeldStay): Promise<void> {
    setLeaving(true);
    setFailed(undefined);

    try {
      // This screen offers no choice of its own — it is the funnel's
      // pre-choice fallback, reachable only by a bookmark or a press of
      // "back" out of the gateway, and its one button has always read "Pay
      // with VNPay". `details-screen.tsx` is where a guest actually picks a
      // provider now; this keeps sending the payer to the gateway it always
      // did.
      const { paymentUrl } = await openPayment(paying, "VNPAY");

      window.location.assign(paymentUrl);
    } catch (error) {
      // The button comes back, because every refusal this call can carry is one
      // a second press might get past — a gateway with no credentials
      // configured, a stay whose hold has just expired, a network that was not
      // there. Leaving it disabled would strand a guest on a dead page.
      setLeaving(false);
      setFailed(
        apiMessage(
          error,
          "The payment page could not be opened just now. Nothing has been charged.",
        ),
      );
    }
  }

  if (loading) {
    return (
      <StayShell
        step="Step 4 of 4"
        subtitle="One moment while the property reads your stay back."
        title="Payment"
      />
    );
  }

  if (!stay) {
    return (
      <StayShell
        step="Step 4 of 4"
        subtitle="The property could not open this stay."
        title="Payment"
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

  if (isLost(stay)) {
    return (
      <StayShell
        stay={stay}
        step="Step 4 of 4"
        subtitle="This hold has been released, so there is nothing to pay for."
        title="The hold has gone"
      >
        <p className={styles.notice} role="status">
          Nothing was charged.
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

  // Paid for already — a guest who pressed back after the gateway, or who has
  // this page open in a second tab. Offering the button again would open a
  // second attempt against a stay that owes nothing.
  if (isSettled(stay)) {
    return (
      <StayShell
        stay={stay}
        step="Confirmed"
        subtitle="This stay is already paid for and confirmed."
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
      footnote="You will be taken to VNPay to pay. The property never sees your card. When you are finished VNPay brings you back here."
      stay={stay}
      step="Step 4 of 4"
      subtitle="This is what the property will collect. Paying confirms the stay."
      title="Payment"
    >
      <div className={styles.actions}>
        <button
          className={styles.submit}
          disabled={leaving}
          onClick={() => void leaveForGateway(stay)}
          type="button"
        >
          {leaving ? "Opening VNPay…" : "Pay with VNPay"}
        </button>

        <button
          className={styles.secondary}
          onClick={() => router.push(`/booking/${stay.id}/details`)}
          type="button"
        >
          Back to the stay
        </button>
      </div>

      {failed ? (
        <p className={styles.error} role="alert">
          {failed}
        </p>
      ) : null}
    </StayShell>
  );
}
