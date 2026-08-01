"use client";

// Where the guest is, in two steps.
//
// The screen has always had two of them and never said so: the calendar was
// replaced by a room list and the guest was expected to infer that something had
// advanced. This is that fact, said once, above both views.
//
// **One step is a control and the other is not, and that asymmetry is the point.**
// Step one is a button once the guest is past it, because going back to the dates
// is a thing they will want and this is the shortest way to say it. Step two is
// never a button: forward is the panel's own action, said in full words next to
// the stay it applies to, and a numbered disc that also moved the guest forward
// would be a second, quieter way to do the same thing — the kind of duplicate
// that ends up disagreeing with the primary one.
//
// So this is a progress indicator with a way back in it, not a tab bar.
//
// `<ol>` because the steps are ordered and there are exactly two of them;
// `aria-current="step"` on the one the guest is on, which is what a screen reader
// reads to answer "where am I" without the numbers being spelled out in prose.

import type { ReactNode } from "react";
import type { BookingView } from "@/features/booking/lib/booking-view";
import styles from "./step-rail.module.css";

export function StepRail({
  current,
  onBack,
}: {
  readonly current: BookingView;
  /**
   * Back to the dates step, keeping the range. **Only reachable from step two**,
   * which is why it is optional: on the dates step there is nothing behind the
   * guest, step one renders as a `<span>` rather than a button, and a handler
   * passed in there would be one that can never fire.
   */
  readonly onBack?: () => void;
}) {
  const onRooms = current === "rooms";

  return (
    <nav aria-label="Booking steps" className={styles.rail}>
      <ol className={styles.steps}>
        <li className={styles.step} data-state={onRooms ? "done" : "current"}>
          {onRooms ? (
            <button className={styles.control} onClick={onBack} type="button">
              <StepFace label="Dates" number={1} />
            </button>
          ) : (
            <span aria-current="step" className={styles.control}>
              <StepFace label="Dates" number={1} />
            </span>
          )}
        </li>

        {/* The connector. Decorative: the order is already in the list. */}
        <li aria-hidden="true" className={styles.rule} />

        <li className={styles.step} data-state={onRooms ? "current" : "ahead"}>
          <span
            aria-current={onRooms ? "step" : undefined}
            className={styles.control}
          >
            <StepFace label="Your room" number={2} />
          </span>
        </li>
      </ol>
    </nav>
  );
}

function StepFace({
  number,
  label,
}: {
  readonly number: number;
  readonly label: string;
}): ReactNode {
  return (
    <>
      {/* The disc's number is decorative twice over: the list is ordered and the
          label says which step this is. Read out, it would be "one one Dates". */}
      <span aria-hidden="true" className={styles.disc}>
        {number}
      </span>
      <span className={`${styles.label} caps-label`}>{label}</span>
    </>
  );
}
