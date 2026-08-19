"use client";

// The panel under `/bookings/<reference>` where an upcoming stay is called off.
//
// **It draws nothing until the API says there is something to draw.** Whether a
// stay can still be cancelled is the property's decision — `state-machine.ts`
// §2 gives `HELD` and `CONFIRMED` a `→ CANCELLED` and gives the other four
// nothing — and this asks rather than working it out from a booking it happens
// to be holding. The quote is that question: a figure comes back, or the call is
// refused, and a refusal shows nothing at all. A guest looking at a stay they
// have already left should see no trace of a cancel button, not a disabled one.
//
// **It is a panel on this route rather than a screen of its own**, because
// `screens.md` §Account puts every act a stay allows on the stay's own surface:
// cancelling an upcoming stay and leaving post-stay feedback both happen on
// `/bookings/<reference>`, each appearing only when the booking's state allows
// it. `stays-list.tsx` is the other half of that argument — the account's list
// only navigates.
//
// **The price is shown before the press, and that is the whole point of the
// quote.** The stay is paid in full, so the question a guest is actually asking
// is how much comes back; `property-and-tariff.md` §4's rule on its own would
// leave them subtracting a figure they have never seen. What the panel shows is
// the calculator's own number, which is the number the folio will post — proven
// end to end in `guest-own-booking.e2e-spec.ts` rather than by a second
// implementation of the grid living here.
//
// **Nothing is destroyed on one press.** The stay is prepaid and a cancellation
// cannot be taken back, so the button arms a confirmation and the confirmation
// is a second, separate press with the charge still on screen beside it.

import { useEffect, useId, useRef, useState } from "react";
import { Money } from "@/features/booking/components/money";
import { whenArrived } from "@/lib/booking-links";
import {
  type CancellationQuote,
  cancelStay,
  quoteCancellation,
} from "./cancellation";
import { priceOfCancelling } from "./cancellation-price";
import styles from "./stay-cancellation.module.css";

export function StayCancellationPanel({
  reference,
  onCancelled,
}: {
  readonly reference: string;
  /** Told once, when the stay has actually moved. The screen above this one
   *  renders the state that just changed and reads it only on mount. */
  readonly onCancelled: () => void;
}) {
  const promptId = useId();

  const [quote, setQuote] = useState<CancellationQuote>();
  const [arming, setArming] = useState(false);
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<string>();
  const [done, setDone] = useState(false);

  const armButton = useRef<HTMLButtonElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  const outcome = useRef<HTMLParagraphElement>(null);

  // **The arrival first, and then the question once.** A guest who came from
  // the confirmation email is holding the only thing that opens this booking,
  // and it is exchanged for the cookie by the screen beside this panel — which
  // mounts in the same commit as this one. Asked before that exchange answers,
  // this question is refused for want of a credential rather than for want of a
  // stay to cancel, and a refusal draws nothing: the guest reading the message
  // on a second device would find no way to call the stay off. `whenArrived`
  // is that ordering made a fact instead of a race, and it costs a guest who
  // presented no link nothing at all.
  //
  // One question, and the answer is believed. A refusal on the far side of the
  // arrival is the property's answer — a stay already called off, one already
  // left, one this browser cannot open — and asking it again would only be the
  // page disagreeing with it.
  useEffect(() => {
    let live = true;

    async function ask(): Promise<void> {
      await whenArrived(reference);

      if (!live) {
        return;
      }

      const answer = await quoteCancellation(reference);

      if (live && answer.ok) {
        setQuote(answer.quote);
      }
    }

    void ask();

    return () => {
      live = false;
    };
  }, [reference]);

  const step = done ? "done" : arming ? "confirming" : "offered";
  const previousStep = useRef(step);

  // **Focus follows the step.** Each one replaces the control that was pressed
  // to reach it, and a browser whose focused element is removed drops focus on
  // the document — which strands a keyboard at the top of the page and leaves a
  // screen reader saying nothing about a confirmation that has just appeared.
  //
  // Never on the first paint. The panel arrives after a round trip, under a
  // screen the guest may be reading, and moving focus into it then would be the
  // page interrupting. Only a change of step moves anything.
  useEffect(() => {
    if (previousStep.current === step) {
      return;
    }

    previousStep.current = step;

    const entry =
      step === "confirming"
        ? keepButton
        : step === "done"
          ? outcome
          : armButton;

    entry.current?.focus();
  }, [step]);

  // The way out of the confirmation, refused once the request has gone. Taking
  // the panel back to its offer while a cancellation is in flight would show a
  // guest a button for something that is already happening.
  function keepIt() {
    if (!pending) {
      setArming(false);
    }
  }

  // Escape is the same way out, because a guest who armed this by accident
  // should not have to find the right control to get back. It hangs on the two
  // buttons rather than on the block around them because they are the only
  // things in it a key can reach — a handler on the container would be the same
  // behaviour claimed over an element nothing can focus.
  function escapes(event: { readonly key: string }) {
    if (event.key === "Escape") {
      keepIt();
    }
  }

  async function cancelNow() {
    if (pending) {
      return;
    }

    setPending(true);
    setRefusal(undefined);

    const answer = await cancelStay(reference);

    if (answer.ok) {
      setArming(false);
      setDone(true);
      onCancelled();
    } else {
      setRefusal(answer.message);
    }

    setPending(false);
  }

  // Nothing to offer: the stay is over, was called off already, or is not this
  // browser's. The panel is absent rather than empty.
  if (!quote) {
    return null;
  }

  const price = priceOfCancelling(quote);

  return (
    <section className={styles.panel}>
      <h2 className={`${styles.heading} caps-label`}>
        {done ? "Cancelled" : "Cancelling this stay"}
      </h2>

      {done ? (
        // The sentence takes focus when the act finishes, because by then the
        // panel has no control left to hold it and this is what the guest is
        // being sent to read.
        <p className={styles.done} ref={outcome} role="status" tabIndex={-1}>
          This stay is cancelled. The property has it, and the room is back on
          sale.
        </p>
      ) : (
        <p className={styles.cost}>{price.cost}</p>
      )}

      {price.amount === null ? null : (
        <div className={styles.charge}>
          <span className={styles.chargeLabel}>Cancellation charge</span>
          <Money amount={price.amount} className={styles.chargeAmount} />
        </div>
      )}

      {price.refund === null ? null : (
        <p className={styles.refund}>{price.refund}</p>
      )}

      {step === "offered" ? (
        <div className={styles.actions}>
          <button
            className={`${styles.arm} caps-label`}
            onClick={() => setArming(true)}
            ref={armButton}
            type="button"
          >
            Cancel this stay
          </button>
        </div>
      ) : null}

      {step === "confirming" ? (
        <div className={styles.confirming}>
          <p className={styles.prompt} id={promptId}>
            This cannot be undone. The room goes back on sale, and a stay called
            off is booked again from the beginning.
          </p>

          {refusal ? (
            <p className={styles.error} role="alert">
              {refusal}
            </p>
          ) : null}

          <div className={styles.actions}>
            {/* The way out comes first and is where focus lands. What opened
                this was a key or a thumb on a control that has just been
                replaced, and a repeat of that press must not land on the
                irreversible half. */}
            <button
              aria-describedby={promptId}
              className={`${styles.keep} caps-label`}
              onClick={keepIt}
              onKeyDown={escapes}
              ref={keepButton}
              type="button"
            >
              Keep this booking
            </button>

            <button
              aria-describedby={promptId}
              className={`${styles.confirm} caps-label`}
              disabled={pending}
              onClick={() => void cancelNow()}
              onKeyDown={escapes}
              type="button"
            >
              {pending ? "Cancelling" : "Yes, cancel this stay"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
