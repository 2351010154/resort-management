"use client";

// One address for every act that has something to say and nothing to prove.
//
// The table and the rituals are the two places the house cannot publish an hour
// yet, and a section that ends in "not yet published" leaves a reader holding a
// sentence they can do nothing with. The act can still hand over the one
// thing that is true and actionable: the stay itself. This is that link, and it
// carries whatever the page's draft already holds — a range typed into the Menu
// sheet arrives with it, an empty one lands on the calendar with the party
// intact. An address cannot refuse to navigate, so it never validates.
//
// `context` is only ever an accessible name. Three "Choose dates" links in a
// screen reader's list are three identical links.

import {
  draftHref,
  useArrivalDraft,
} from "@/features/arrival/lib/arrival-booking-draft";

export function ChooseDatesLink({
  className,
  context,
}: {
  readonly className?: string;
  readonly context?: string;
}) {
  const draft = useArrivalDraft();

  return (
    <a
      className={className}
      href={draftHref(draft)}
      aria-label={context ? `Choose dates — ${context}` : undefined}
    >
      Choose dates
    </a>
  );
}
