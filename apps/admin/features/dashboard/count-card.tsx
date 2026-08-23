"use client";

import type { LucideIcon } from "lucide-react";
import Link from "next/link";

import type { CountReading } from "./day-counts";

/* One count, and the door it opens.
 *
 * A real `<a>` for the reason the rail's entry is one: a card that cannot be
 * middle-clicked, opened in a second tab or read as a link is navigation in
 * name only, and `next/link` prefetches on hover and focus so the queue behind
 * it is already loading by the time the operator arrives. The whole card is the
 * link rather than a heading with a "View" control beside it — the number is
 * the thing being clicked, and a target the size of a word is a target a
 * receptionist misses at two o'clock.
 *
 * Keyboard reach costs nothing extra because of that: four cards are four Tab
 * stops in reading order, Enter follows, and the focus ring is the 2px
 * full-strength outline `globals.css` draws on every `:focus-visible` in the
 * console.
 *
 * **The three states occupy the same box.** A card that is one height while
 * counting and another once counted moves the three cards beside it as each
 * answer lands, which on a screen the desk glances at is worse than a slow
 * number. So the value line is a fixed row and every state fills it.
 *
 * **Nothing here animates in.** `NFR-04` forbids entrance animation on
 * operational surfaces, and the reason is this screen exactly: it is read at a
 * glance, mid-conversation, by somebody who has already looked away by the time
 * a fade would finish. The only transition is the hover colour.
 */

export interface CountCardProps {
  /** What the number is — "Arrivals awaiting check-in". */
  label: string;
  /** The family screen the count leads into. */
  href: string;
  /** A word about what the operator will find there. */
  description: string;
  action: string;
  icon: LucideIcon;
  reading: CountReading;
}

export function CountCard({
  label,
  href,
  description,
  action,
  icon: Icon,
  reading,
}: CountCardProps) {
  return (
    <li>
      <Link
        href={href}
        // `aria-busy` while the number is still being fetched, so the state the
        // muted "Counting" line shows sighted operators is announced rather
        // than being a visual-only fact.
        aria-busy={reading.status === "pending" ? true : undefined}
        className="group flex min-h-40 h-full flex-col rounded-lg bg-card p-5 shadow-card transition-[box-shadow,transform] duration-200 ease-ui hover:-translate-y-0.5 hover:shadow-raised active:translate-y-px"
      >
        <span className="flex items-start justify-between gap-3">
          <span>
            <span className="block text-sm font-semibold">{label}</span>
            <span className="block text-sm text-muted-foreground">
              {description}
            </span>
          </span>
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-accent-soft text-accent-strong">
            <Icon aria-hidden="true" className="size-4" strokeWidth={1.8} />
          </span>
        </span>

        {/* `items-end`, so the figure and the two sentences that stand in for
            it sit on one baseline instead of centring at three different
            heights. */}
        <span className="mt-5 flex h-10 items-end">
          <CountValue reading={reading} />
        </span>

        <span className="mt-4 flex items-center justify-between border-border border-t pt-3 text-sm font-semibold">
          {action}
          <span
            aria-hidden="true"
            className="transition-transform duration-150 ease-ui group-hover:translate-x-0.5"
          >
            →
          </span>
        </span>
      </Link>
    </li>
  );
}

function CountValue({ reading }: { reading: CountReading }) {
  if (reading.status === "pending") {
    return <span className="text-muted-foreground text-sm">Counting</span>;
  }

  if (reading.status === "failed") {
    // The console's error device is a rule on the leading edge and not a
    // colour: --color-destructive and --color-primary are the same umber, so
    // red is not available to mean anything here. The sentence says the number
    // is missing rather than showing a zero, which would be a real and
    // reassuring figure printed over a failure.
    return (
      <span className="border-destructive text-destructive border-l-2 pl-3 text-sm">
        Unavailable
      </span>
    );
  }

  return (
    <span className="text-3xl font-semibold leading-9 lining-nums tabular-nums">
      {reading.count}
      {/* The search answers at most fifty stays, so a full page means the
          figure is a floor. `+` is the honest way to print a number the API
          would not finish. */}
      {reading.truncated ? "+" : ""}
    </span>
  );
}
