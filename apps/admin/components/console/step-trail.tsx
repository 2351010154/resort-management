import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Where the operator is in an in-place sequence, and how much of it is left.
 *
 * Numbered, ticked and counted rather than a row of words. A trail that told
 * the steps apart by colour alone reads as a sentence nobody wrote — "Guest
 * Document Room Check in", "Charges Balance Check out" — and answers neither of
 * the two questions it exists for: which one am I on, and how many are left. So
 * each step carries its ordinal, a finished one carries a tick instead, the
 * rule between two steps is drawn in the accent once it has been walked, and
 * the count is stated in words above the list for anyone who would rather read
 * it than count discs.
 *
 * It lives here rather than in a feature because both worked queues have one
 * and the desk works both in a shift: the check-in and the checkout are the
 * same control with different words in it, and two copies of it are two things
 * to drift apart.
 *
 * **The ordinals are drawn by CSS counters and are not in the markup.** The
 * step a sequence is showing is read off this list's current item as text — by
 * `aria-current` for a screen reader, and by the keyboard runs in
 * `e2e/nfr-11-keyboard-checkin.spec.ts` and `e2e/keyboard-checkout.spec.ts` —
 * and a numeral inside the element would change the name of the room step from
 * "Room" to "3Room". A counter is generated content, so it is drawn and not
 * said.
 */
export interface StepTrailProps<Step extends string> {
  /** What the sequence is called, in the count above the list. */
  sequence: string;
  /** The steps this particular run of the sequence has, in order. */
  steps: readonly Step[];
  /** The one being worked. */
  current: Step;
  /** The words each step is drawn with. */
  labels: Readonly<Record<Step, string>>;
}

function StepTrail<Step extends string>({
  sequence,
  steps,
  current,
  labels,
}: StepTrailProps<Step>) {
  const at = steps.indexOf(current);

  return (
    <div className="mb-4">
      {/* The count in words, for the operator who would rather read how far
          along they are than count discs. `indexOf` answers -1 for the one case
          that happens under the operator — a folio settled at another desk
          drops a step out of the list while the sequence is still standing on
          it — and a trail is not the place to say "step 0". */}
      <p className="text-muted-foreground text-xs tracking-caps uppercase">
        {at < 0
          ? `${sequence}, ${steps.length} steps`
          : `${sequence}, step ${at + 1} of ${steps.length}`}
      </p>

      <ol className="mt-2 flex flex-wrap items-center gap-y-2 text-sm [counter-reset:step]">
        {steps.map((step, index) => {
          const state = trailState(index, at);

          return (
            <li
              key={step}
              aria-current={step === current ? "step" : undefined}
              className={cn(
                "flex items-center gap-2 [counter-increment:step]",
                TRAIL_LABEL[state],
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-full text-xs leading-none",
                  TRAIL_MARKER[state],
                )}
              >
                {state === "done" ? (
                  <Check className="size-3" strokeWidth={3} />
                ) : null}
              </span>
              {labels[step]}
              {index < steps.length - 1 ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-px w-6 shrink-0",
                    state === "done" ? "bg-accent-line" : "bg-border",
                  )}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** A step the operator has left behind, the one they are on, or one to come. */
type TrailState = "done" | "current" | "todo";

function trailState(index: number, at: number): TrailState {
  if (index < at) {
    return "done";
  }

  return index === at ? "current" : "todo";
}

/* The disc beside each step. Told apart by shape as well as by colour — a tick
 * for a step that is behind the operator, a filled ordinal for the one they are
 * on, an outlined one for a step still to come — because a trail whose only
 * difference was a shade of brown is the trail this replaced. */
const TRAIL_MARKER: Record<TrailState, string> = {
  done: "bg-accent-soft text-accent-strong",
  current: "bg-primary text-primary-foreground before:[content:counter(step)]",
  todo: "border border-line text-muted-foreground before:[content:counter(step)]",
};

const TRAIL_LABEL: Record<TrailState, string> = {
  done: "text-muted-foreground",
  current: "font-semibold text-foreground",
  todo: "text-muted-foreground",
};

export { StepTrail };
