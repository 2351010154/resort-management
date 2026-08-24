"use client";

import Link from "next/link";

import type { BookingHit, Reading, StaySample } from "./day-counts";

/* The stays behind two of the four figures, as names rather than a number.
 *
 * The cards above say how many; this says who, which is the thing a
 * receptionist is actually holding in their head between the screen and the
 * person in front of them. It is deliberately not a queue: four rows, no
 * sorting, no row actions, and a link into the family screen that owns the
 * work. `docs/screens.md` gives Arrivals a keyboard-driven check-in sequence
 * built for ten guests at two o'clock, and a second half-queue on the launchpad
 * would be somewhere to start that work and nowhere to finish it.
 *
 * **The room is the leading column** because it is the field that decides
 * whether an arrival can be worked at all: a stay sold as a type and not yet
 * given a room is the one the desk has to do something about before the guest
 * is standing there. Unassigned says so in words rather than by being blank.
 */

export interface StaysPreviewProps {
  heading: string;
  /** What is being previewed, for the empty state — "arriving today". */
  subject: string;
  href: string;
  action: string;
  reading: Reading<StaySample>;
}

export function StaysPreview({
  heading,
  subject,
  href,
  action,
  reading,
}: StaysPreviewProps) {
  const headingId = `stays-preview-${href.replaceAll("/", "")}`;

  return (
    <section
      aria-labelledby={headingId}
      aria-busy={reading.status === "pending" ? true : undefined}
      className="flex flex-col"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3
          id={headingId}
          className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground"
        >
          {heading}
        </h3>
        {reading.status === "read" && reading.value.total > 0 ? (
          <p className="text-sm text-muted-foreground lining-nums tabular-nums">
            {reading.value.total}
            {reading.value.truncated ? "+" : ""} in all
          </p>
        ) : null}
      </div>

      <div className="mt-3 flex-1">
        {reading.status === "pending" ? (
          <p className="text-sm text-muted-foreground">Reading the day.</p>
        ) : null}

        {reading.status === "failed" ? (
          <p className="border-danger border-l-2 pl-3 text-sm text-danger">
            These stays could not be read.
          </p>
        ) : null}

        {reading.status === "read" ? (
          <StayRows sample={reading.value} subject={subject} />
        ) : null}
      </div>

      <Link
        href={href}
        className="group mt-4 flex items-center justify-between gap-3 border-border border-t pt-3 text-sm font-semibold"
      >
        {action}
        <span
          aria-hidden="true"
          className="transition-transform duration-150 ease-ui group-hover:translate-x-0.5"
        >
          →
        </span>
      </Link>
    </section>
  );
}

function StayRows({
  sample,
  subject,
}: {
  sample: StaySample;
  subject: string;
}) {
  if (sample.stays.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Nobody is {subject}.</p>
    );
  }

  return (
    <ul className="-my-1">
      {sample.stays.map((stay) => (
        <StayRow key={stay.id} stay={stay} />
      ))}
    </ul>
  );
}

function StayRow({ stay }: { stay: BookingHit }) {
  const guest = stay.guestNames[0];

  return (
    <li className="flex items-baseline gap-3 py-1.5">
      <span
        className={
          stay.roomNumber === null
            ? "w-14 shrink-0 text-sm text-muted-foreground"
            : "w-14 shrink-0 text-sm font-semibold lining-nums tabular-nums"
        }
      >
        {stay.roomNumber ?? "—"}
      </span>
      <span className="min-w-0 flex-1 truncate">
        {guest === undefined ? (
          <span className="text-muted-foreground">Not yet registered</span>
        ) : (
          guest
        )}
        {/* Only when there is more than one, because "+0 others" on every
            single-occupancy stay is noise on four out of five rows. */}
        {stay.guestNames.length > 1 ? (
          <span className="text-muted-foreground">
            {" "}
            +{stay.guestNames.length - 1}
          </span>
        ) : null}
      </span>
      <span className="shrink-0 text-sm text-muted-foreground">
        {stay.reference}
      </span>
    </li>
  );
}
