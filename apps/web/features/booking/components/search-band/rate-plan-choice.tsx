"use client";

// The three plans — `property-and-tariff.md` §3.
//
// A radio group, not a segmented control made of buttons: three mutually exclusive
// options with one answer is what a radio group *is*, and the roving arrow-key
// behaviour comes free from the platform. Styling it as a segmented row is a
// stylesheet's business.
//
// `NONREF`'s term sits under its label rather than in a tooltip. It is a 100%
// charge on cancellation and the guest should meet it here, before a room is held,
// not on a confirmation page. Stated plainly and without dressing: the copy voice
// is a good hotel speaking quietly, which includes about its own bad news.

import type { RatePlanCode } from "@mariva/shared";
import styles from "./search-band.module.css";

interface Plan {
  readonly code: RatePlanCode;
  readonly name: string;
  readonly term: string;
}

/** Exported so the collapsed search band names a plan from the same source. */
export const PLANS: readonly Plan[] = [
  {
    code: "STANDARD",
    name: "Standard",
    term: "Free to cancel until three days before you arrive.",
  },
  {
    code: "BB",
    name: "With breakfast",
    term: "Breakfast for everyone staying. Free to cancel until three days before.",
  },
  {
    code: "NONREF",
    name: "Non-refundable",
    term: "10% less. Nothing is refunded if you cancel.",
  },
];

export function planName(plan: RatePlanCode): string {
  return PLANS.find((option) => option.code === plan)?.name ?? plan;
}

export function RatePlanChoice({
  plan,
  onChange,
}: {
  readonly plan: RatePlanCode;
  readonly onChange: (plan: RatePlanCode) => void;
}) {
  return (
    <fieldset className={styles.fieldset}>
      <legend className={`${styles.legend} caps-label`}>Your rate</legend>

      <div className={styles.plans}>
        {PLANS.map((option) => (
          <label
            className={`${styles.plan}${plan === option.code ? ` ${styles.planChosen}` : ""}`}
            key={option.code}
          >
            <input
              checked={plan === option.code}
              className={styles.planInput}
              name="rate-plan"
              onChange={() => onChange(option.code)}
              type="radio"
              value={option.code}
            />
            <span className={styles.planName}>{option.name}</span>
            <span className={styles.planTerm}>{option.term}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
