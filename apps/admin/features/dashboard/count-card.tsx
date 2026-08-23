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
 * stops in reading order, Enter follows, and the focus ring is the 3px accent
 * outline `globals.css` draws on every `:focus-visible` in the console.
 *
 * **The figure leads and the words follow.** The number sits on the top line
 * beside its icon rather than under the label, because the four cards are read
 * as a row of four figures — the eye crosses the screen once at the same height
 * and only comes back for the sentence under whichever number was surprising.
 *
 * **The three states occupy the same box.** A card that is one height while
 * counting and another once counted moves the three cards beside it as each
 * answer lands, which on a screen the desk glances at is worse than a slow
 * number. So the value line is a fixed row and every state fills it.
 *
 * **Nothing here animates in.** `NFR-04` forbids entrance animation on
 * operational surfaces, and the reason is this screen exactly: it is read at a
 * glance, mid-conversation, by somebody who has already looked away by the time
 * a fade would finish. The only transitions are hover ones.
 */

export interface CountCardProps {
  /** The set being counted — "Arrivals awaiting", above the title. */
  label: string;
  /** What the operator does about it — "Check-in". */
  title: string;
  /** The family screen the count leads into. */
  href: string;
  /** A sentence about what they will find there. */
  description: string;
  action: string;
  icon: LucideIcon;
  reading: CountReading;
}

export function CountCard({
  label,
  title,
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
        className="group flex h-full flex-col rounded-lg bg-card p-5 shadow-card transition-[box-shadow,transform] duration-200 ease-ui hover:-translate-y-0.5 hover:shadow-raised active:translate-y-px"
      >
        {/* `items-center` on a fixed row: the badge and the figure share one
            optical centre whichever of the three states the figure is in. */}
        <span className="flex h-12 items-center gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-strong">
            <Icon aria-hidden="true" className="size-5" strokeWidth={1.6} />
          </span>
          <CountValue reading={reading} />
        </span>

        <span className="mt-5 block text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </span>
        <span className="mt-1 block text-xl font-semibold tracking-[-0.01em]">
          {title}
        </span>
        <span className="mt-2 block text-sm text-muted-foreground">
          {description}
        </span>

        {/* `mt-auto`, so the four links sit on one line however long the
            sentences above them run. */}
        <span className="mt-auto flex items-center justify-between gap-3 border-border border-t pt-4 text-sm font-semibold">
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
    // A rule on the leading edge rather than colour alone, so the state
    // survives being read by somebody who does not separate the danger red
    // from the umber beside it.
    return (
      <span className="border-danger text-danger border-l-2 pl-3 text-sm">
        Unavailable
      </span>
    );
  }

  return (
    <span className="text-[2.5rem] font-semibold leading-none lining-nums tabular-nums">
      {reading.count}
      {/* The search answers at most fifty stays, so a full page means the
          figure is a floor. `+` is the honest way to print a number the API
          would not finish. */}
      {reading.truncated ? "+" : ""}
    </span>
  );
}
