// The band the dates step opens on: one photograph, and the screen's own head
// standing on it.
//
// The funnel used to begin on ivory — bar, steps, heading, calendar, all on one
// ground — and it read as a form. The screen is the moment a guest commits a week
// of their year to a place, and the place was nowhere on it. So the head of the
// step is a photograph, the plate below overlaps it, and the calendar is a card
// laid on the property rather than a table printed on a page.
//
// **The band carries no controls of its own.** What stands on it is passed in:
// the bar, the steps, the heading and the one sentence that says what to do next.
// This component owns the picture, the scrim and the light-on-dark palette, and
// nothing else — which is what lets `dates-stage.tsx` compose the head without
// this file knowing what a booking step is.
//
// **The palette is handed down as custom properties, not as props.** `FunnelNav`
// and `StepRail` are used on both grounds, and a `tone="dark"` prop would mean
// two branches in each of their stylesheets kept level by hand. They read
// `--funnel-ink` and friends with their ivory-ground values as the fallbacks
// instead, so the rooms step is untouched and the override lives in one block
// here, where the ground it answers to is declared.

import type { ReactNode } from "react";
import { BOOKING_HERO } from "@/features/booking/lib/booking-hero";
import { tierSrc, tierSrcSet } from "@/features/booking/lib/room-images";
import styles from "./booking-hero.module.css";

export function BookingHero({ children }: { readonly children: ReactNode }) {
  return (
    <div className={styles.hero}>
      {/* The band spans the window at every size, so `100vw` is the honest
          `sizes` and the browser can pick before layout. `fetchPriority="high"`
          and no `loading="lazy"`: this is the step's LCP element and it is above
          the fold by construction — lazily fetching the largest paint on the
          screen is the one place the attribute costs rather than saves. */}
      <img
        alt={BOOKING_HERO.alt}
        className={styles.photo}
        decoding="async"
        fetchPriority="high"
        height={BOOKING_HERO.height}
        sizes="100vw"
        src={tierSrc(BOOKING_HERO.src, 1280)}
        srcSet={tierSrcSet(BOOKING_HERO)}
        width={BOOKING_HERO.width}
      />

      {/* Two washes rather than one. A single flat scrim dark enough for type in
          the corner would put the whole photograph behind a grey pane; these
          darken the corner the type is in and the edge the plate meets, and
          leave the middle of the frame alone. */}
      <div aria-hidden="true" className={styles.scrim} />

      <div className={styles.inner}>{children}</div>
    </div>
  );
}
