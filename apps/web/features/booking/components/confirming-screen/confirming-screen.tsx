"use client";

// `/booking/<hold>/confirming` — where VNPay puts the payer down, and where the
// funnel waits for the property to agree.
//
// **This step exists because two deliveries race.** The gateway redirects the
// browser and posts an IPN to the API, independently; the redirect can arrive
// first, second, or on its own if the guest's connection dropped on the way
// back. `repository-structure.md` §`(booking)` calls that out as the reason
// `confirming/` is not optional: the landing that receives a redirect cannot be
// the confirmation, because at the moment it paints nobody here knows whether
// the money has been posted.
//
// So the screen holds two different things and never confuses them. The caption
// in the url is what the *gateway* told the browser — `payment.controller.ts`
// sends `confirming` rather than `paid` for exactly this reason — and the stay's
// own state is what this *property* has recorded. Only the second decides
// anything: `payment.service.ts` confirms the stay in the same commit as the
// payment, so a booking that has stopped being `HELD` is a booking whose money
// landed — with one exception, and it is the exception this screen exists at the
// riskiest moment to get right. A hold the sweep released while the guest was at
// the gateway has also stopped being `HELD`, and it is the opposite fact. So a
// lost stay is ruled out before anything here reads a settled one as a booking.
//
// **It resolves rather than reporting.** A settled stay replaces this url with
// `/bookings/<reference>` — replaced, not pushed, so the browser's back button
// does not walk a confirmed guest into a payment page they have finished with.
// A refusal sends them back to `details` with the reason. Only a wait that
// outlasts the poll stops here, and then it says where the booking is rather
// than spinning forever.

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import {
  StayShell,
  stayStyles as styles,
} from "@/features/booking/components/stay-shell/stay-shell";
import {
  isBooked,
  isLost,
  isSettled,
  type PaymentCaption,
  readCaption,
} from "@/features/booking/lib/stay-funnel";
import { useHeldStay } from "@/features/booking/lib/use-held-stay";

/**
 * What each caption means while the property is still deciding.
 *
 * Every one of them is written in the present continuous or the past — none
 * claims the stay is booked, because this screen is never in a position to know
 * that. The one that comes closest, `confirming`, says what is actually
 * happening: VNPay says it took the money and the property is checking.
 */
const WHILE_WAITING: Readonly<Record<PaymentCaption, string>> = {
  confirming:
    "VNPay says your payment went through. The property is confirming it now — this usually takes a few seconds.",
  refused:
    "VNPay did not take the payment. Nothing has been charged, and your room is still held for a little longer.",
  unfinished:
    "The payment was not finished. Nothing has been charged, and your room is still held for a little longer.",
  unverified:
    "That link did not come from VNPay, so nothing on it is being acted on. Your stay is shown as the property has it.",
  unknown:
    "The property is checking where this stay stands. Nothing on this page charges anything.",
};

export function ConfirmingScreen({ hold }: { readonly hold: string }) {
  const router = useRouter();
  const caption = readCaption(useSearchParams().get("payment"));

  // The poll stops the moment the stay stops being held — see `isSettled`. A
  // gateway that refused is not waited on at all: there is nothing coming, and
  // the one read this still performs is what tells the guest whether their hold
  // survived the round trip.
  const waitingForMoney = caption === "confirming" || caption === "unknown";

  const { stay, loading, refusal, gaveUp } = useHeldStay(
    hold,
    waitingForMoney ? isSettled : undefined,
  );

  // The hold went while the guest was away — cancelled by the sweep, or called
  // off — against the stay that actually became a booking. Two questions and not
  // one, because `isSettled` answers both with `true`: `isBooked` is where that
  // is argued and where a spec holds it, and a screen that asked only whether
  // the stay had stopped being held would thank a guest whose room went back on
  // sale for a payment.
  const lost = stay !== undefined && isLost(stay);
  const settled = stay !== undefined && isBooked(stay);
  const reference = stay?.reference;

  useEffect(() => {
    if (settled && reference) {
      // Replaced rather than pushed: this url has done its job, and leaving it
      // in the history would put a payment landing behind the back button of a
      // guest who is now simply looking at their booking.
      // `?booked` is what tells the booking screen to greet rather than simply
      // to display — the record itself does not remember that it was confirmed
      // a moment ago, and this is the only place that knows.
      router.replace(`/bookings/${reference}?booked`);
    }
  }, [settled, reference, router]);

  if (loading) {
    return (
      <StayShell
        step="Confirming"
        subtitle={WHILE_WAITING[caption]}
        title="One moment"
      />
    );
  }

  if (!stay) {
    return (
      <StayShell
        step="Confirming"
        subtitle="The property could not open this stay."
        title="One moment"
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

  // The hold went while the guest was at the gateway. If VNPay took the money
  // anyway, the nightly reconciliation is what surfaces it — `FR-PAY-05` — so
  // this says what the property will do rather than telling the guest to
  // chase it.
  //
  // Read before the settled branch below, and in that order for the reason
  // `lost` exists at all: a cancelled stay is no longer held either, and the
  // screen that told it it was booked would be issuing a receipt for a room the
  // property has resold. `payment-screen.tsx` and `details-screen.tsx` ask the
  // same two questions in the same order.
  if (lost) {
    return (
      <StayShell
        stay={stay}
        step="Confirming"
        subtitle="This hold was released while you were paying, so the nights went back on sale."
        title="The hold has gone"
      >
        <p className={styles.notice} role="status">
          If VNPay took a payment, the property will find it in tonight's
          reconciliation and return it. Keep this reference: {stay.reference}.
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

  // Already on its way to the booking. Rendered rather than returning nothing so
  // that the screen does not blank between the state settling and the
  // replacement landing.
  if (settled) {
    return (
      <StayShell
        stay={stay}
        step="Confirmed"
        subtitle="Your payment is confirmed. Taking you to your booking."
        title="You are booked"
      />
    );
  }

  // Still held, and either the gateway refused or nothing has landed yet. The
  // room is still theirs for as long as the TTL runs, so the offer is to try
  // the payment again rather than to start over.
  //
  // That offer lands on `details` and not on `payment`, because `details` is the
  // screen that now owns this: it writes the contact, opens the attempt and
  // sends the browser to the gateway. The payment page it took that over from is
  // still served, for a bookmark or a press of back out of VNPay, but it is not
  // where this funnel sends anybody. `details` also re-reads the stay as it
  // mounts, so a hold the sweep released between this render and that press is
  // answered on arrival instead of becoming an attempt opened against nights the
  // property has already put back on sale.
  return (
    <StayShell
      stay={stay}
      step="Confirming"
      subtitle={gaveUp ? WAITED_TOO_LONG : WHILE_WAITING[caption]}
      title={gaveUp ? "Still waiting" : "One moment"}
    >
      <div className={styles.actions}>
        <button
          className={styles.submit}
          onClick={() => router.push(`/booking/${stay.id}/details`)}
          type="button"
        >
          Try the payment again
        </button>
      </div>
    </StayShell>
  );
}

/**
 * What the screen says when it has stopped asking.
 *
 * Not a failure and it does not claim to be one. The IPN is retried by the
 * gateway until this property acknowledges it, so a payment that has not landed
 * in ninety seconds may still land; what has run out is this page's patience,
 * and the reference on it is how the guest picks the stay up afterwards.
 */
const WAITED_TOO_LONG =
  "VNPay has not reported back yet. Your room is still held. If the payment did go through it will appear on your booking shortly — the reference below is how to find it.";
