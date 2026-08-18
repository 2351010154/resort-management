"use client";

// The panel under `/bookings/<reference>` where a finished stay is spoken about.
//
// **It draws nothing until the API says there is something to draw.** The
// property decides whether this stay can be rated — it is over, it is this
// browser's, and there is a session behind the request — and the screen asks
// rather than working it out from a booking it happens to be holding. One read
// answers all three: feedback comes back, `null` comes back, or the call is
// refused. `feedback.ts` maps those onto what is shown, and the refusal shows
// nothing at all: a guest looking at a stay they have not taken yet should see
// no trace of a form, not a disabled one.
//
// **It is a panel on this route rather than a screen of its own**, because
// `screens.md` §Account puts every act a stay allows on the stay's own surface:
// "cancelling an upcoming stay, providing the identity document and leaving
// post-stay feedback all happen on `/bookings/<reference>`", each appearing only
// when the booking's state allows it. A `/feedback/<reference>` route would be a
// second place a stay is looked at, kept in step with the first by hand.
//
// **The rating is a radio group and not five buttons.** A guest arrives with a
// keyboard or a screen reader as often as with a thumb, and radios are what say
// "one of five, and you have picked the third" without a single line of ARIA
// written by hand. The scale's top comes from the contract, so the form cannot
// offer a rung the column refuses.

import { HIGHEST_RATING, LONGEST_FEEDBACK_COMMENT } from "@mariva/shared";
import { type FormEvent, useEffect, useState } from "react";
import {
  readFeedback,
  type StayFeedback,
  submitFeedback,
} from "@/features/feedback/lib/feedback";
import styles from "./stay-feedback.module.css";

/** The scale, from one to its top — built from the contract's own bound rather
 *  than written out, so the two cannot disagree. */
const SCALE = Array.from({ length: HIGHEST_RATING }, (_, index) => index + 1);

/**
 * What each rung means, so a number is not left to stand on its own.
 *
 * Short declaratives, no adjectives doing work numbers already do — the register
 * `design-foundations.md` §6 sets for the funnel, which is where a guest reading
 * this has just come from.
 */
const RUNGS: Readonly<Record<number, string>> = {
  1: "Poor",
  2: "Fair",
  3: "Good",
  4: "Very good",
  5: "Excellent",
};

export function StayFeedbackPanel({
  reference,
}: {
  readonly reference: string;
}) {
  const [left, setLeft] = useState<StayFeedback | null>(null);
  const [offered, setOffered] = useState(false);
  const [rating, setRating] = useState<number>();
  const [comment, setComment] = useState("");
  const [refusal, setRefusal] = useState<string>();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let live = true;

    // Nothing is reset here, because nothing survives to need it: the route
    // keys this panel on the reference, so a change of stay is a fresh panel
    // rather than this one being talked out of the last stay's answer, draft
    // and in-flight write one setter at a time. The flag is still needed —
    // a read started before the unmount must not write into the tree it was
    // started from.
    void readFeedback(reference).then((outcome) => {
      if (!live) {
        return;
      }

      if (outcome.ok) {
        setLeft(outcome.feedback);
        setOffered(true);
      }
    });

    return () => {
      live = false;
    };
  }, [reference]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (pending || rating === undefined) {
      return;
    }

    setPending(true);
    setRefusal(undefined);

    const outcome = await submitFeedback(reference, {
      rating,
      // An empty box is nothing written, and the API takes one value for that.
      // Sending the empty string instead would be refused as a comment that is
      // only whitespace, which is a 400 about a field the guest left alone.
      comment: comment.trim() === "" ? null : comment.trim(),
    });

    if (outcome.ok) {
      setLeft(outcome.feedback);
    } else {
      setRefusal(outcome.message);
    }

    setPending(false);
  }

  // Nothing to say and nothing to ask: the stay is not over, is not this
  // browser's, or nobody is signed in. The panel is absent rather than empty.
  if (!offered) {
    return null;
  }

  if (left) {
    return (
      <section className={styles.panel}>
        <h2 className={`${styles.heading} caps-label`}>Your feedback</h2>

        <p className={styles.thanks}>Thank you. The property has this.</p>

        <dl className={styles.facts}>
          <dt className={styles.factLabel}>Rating</dt>
          <dd className={styles.factValue}>
            {left.rating} of {HIGHEST_RATING} · {RUNGS[left.rating]}
          </dd>

          {left.comment ? (
            <>
              <dt className={styles.factLabel}>What you wrote</dt>
              <dd className={styles.factValue}>{left.comment}</dd>
            </>
          ) : null}
        </dl>
      </section>
    );
  }

  return (
    <section className={styles.panel}>
      <h2 className={`${styles.heading} caps-label`}>Your stay</h2>

      <p className={styles.invitation}>
        You have left us. Tell the property how the stay was — it is read by the
        people who ran it.
      </p>

      <form className={styles.form} onSubmit={onSubmit}>
        <fieldset className={styles.scale}>
          <legend className={styles.legend}>How was it</legend>

          <div className={styles.rungs}>
            {SCALE.map((rung) => (
              <label className={styles.rung} key={rung}>
                <input
                  checked={rating === rung}
                  className={styles.radio}
                  name="rating"
                  onChange={() => setRating(rung)}
                  type="radio"
                  value={rung}
                />
                <span className={styles.rungNumber}>{rung}</span>
                <span className={styles.rungWord}>{RUNGS[rung]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="feedback-comment">
            Anything you would like to add
          </label>
          <textarea
            className={styles.textarea}
            id="feedback-comment"
            maxLength={LONGEST_FEEDBACK_COMMENT}
            name="comment"
            onChange={(event) => setComment(event.target.value)}
            rows={4}
            value={comment}
          />
        </div>

        <p className={styles.hint}>
          A stay is spoken about once, so this cannot be changed afterwards. The
          rating on its own is a complete answer.
        </p>

        {refusal ? (
          <p className={styles.error} role="alert">
            {refusal}
          </p>
        ) : null}

        <button
          className={`${styles.submit} caps-label`}
          disabled={pending || rating === undefined}
          type="submit"
        >
          {pending ? "Sending" : "Send feedback"}
        </button>
      </form>
    </section>
  );
}
