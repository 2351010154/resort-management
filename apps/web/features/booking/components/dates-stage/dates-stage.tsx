"use client";

// The dates step, whole: a photograph with the screen's head on it, a plate laid
// over its bottom edge, and the small print under both.
//
// Round 3 asked this question on ivory — bar, steps, heading, calendar, panel,
// one flat ground from the top of the window to the bottom — and it read as a
// form. Nothing was wrong with it except that the place the guest is committing a
// week of their year to was nowhere on the screen. So the head of the step stands
// on the property, and the calendar is a card laid on that photograph rather than
// a table printed on a page.
//
// **The plate is one card with three columns, not two grounds.** The screen used
// to be a calendar and a warm full-height plate side by side, and that reading
// only worked while both ran the height of the window. Inside a card they are
// sections of one thing, so they are divided by hairlines and share a ground —
// the rail on the left says who the guest is buying from, the calendar answers
// the question, and the panel on the right states the answer back with the way
// forward in it.
//
// **The step's one sentence is up in the head, not over the grid.** It is the
// calendar's own status line — "Choose the night you arrive", then the way to
// start over, then the reason a pick was refused — and it belongs directly under
// the title the way the comp has it, because that is where a lede goes and the
// line *is* the lede. `StayCalendar` hands it up rather than printing it; see
// `onStatus` there. The alternative was a static line in the head and a live one
// over the grid, which is two sentences saying the same thing until the moment
// one of them says something else.
//
// **Only the dates step is composed here.** `booking-screen.tsx` swaps this
// whole layout for the room list's, rather than swapping a view inside a shared
// frame: the two steps no longer have a frame in common, and a bar that belonged
// to both would have to be light over a photograph and dark over ivory at the
// same time.

import type { CalendarDate } from "@internationalized/date";
import type { StayRange } from "@mariva/shared";
import { useState } from "react";
import type { NightIndex, Party } from "@/features/booking/lib/stay-quote";
import { BookingHero } from "../booking-hero/booking-hero";
import { FunnelFoot } from "../funnel-foot/funnel-foot";
import { FunnelNav } from "../funnel-nav/funnel-nav";
import { RatePromise } from "../rate-promise/rate-promise";
import { StayPanel } from "../stay-panel/stay-panel";
import { StepRail } from "../step-rail/step-rail";
import { WhenView } from "../when-view/when-view";
import styles from "./dates-stage.module.css";

/**
 * The head's line before the calendar has said anything.
 *
 * Duplicated from `stay-calendar.tsx`'s resting sentence on purpose: the head
 * paints before the grid's effect has run, and a head that opened empty would
 * reserve a line and then fill it a frame later. The two are the same words, and
 * the calendar owns every one after this.
 */
const OPENING_LINE = "Choose the night you arrive.";

export function DatesStage({
  range,
  party,
  nights,
  stayLength,
  minDate,
  maxDate,
  panelOpen,
  onRangeChange,
  onPartyChange,
  onContinue,
}: {
  readonly range: StayRange | null;
  readonly party: Party;
  readonly nights: NightIndex;
  readonly stayLength: number;
  readonly minDate: CalendarDate;
  /** The far end of the priced window. See `stay-calendar.tsx`. */
  readonly maxDate: CalendarDate;
  readonly panelOpen: boolean;
  readonly onRangeChange: (range: StayRange | null) => void;
  readonly onPartyChange: (party: Party) => void;
  readonly onContinue: () => void;
}) {
  const [status, setStatus] = useState(OPENING_LINE);

  return (
    // The step's own two measures, declared here because all three bands read
    // them and no two of them are nested: the gutter the head, the plate and the
    // foot all stand on, and the distance the plate rides up over the picture —
    // which the band has to know as well, or its last line sits behind the card.
    <div className={styles.step}>
      <BookingHero>
        <FunnelNav />

        {/* The head, on its own vertical: steps, title, line. Wrapped rather
            than laid directly in the band, because the bar carries its own
            gutter and a padded parent would double it. */}
        <div className={styles.head}>
          <StepRail current="when" />
          <h1 className={`${styles.title} font-display`}>Your nights</h1>

          {/* Atomic, so it is read as one sentence rather than as a diff, and it
              never fires on hover — a hover-driven live region announces
              continuously and is worse than silence. */}
          <p className={styles.status} role="status">
            {status}
          </p>
        </div>
      </BookingHero>

      {/* `data-stay` is the whole state machine as far as the stylesheet is
          concerned, and it sits on the plate because the plate is what holds
          both columns whose widths answer to it. */}
      <div className={styles.plate} data-stay={panelOpen ? "open" : "shut"}>
        <div className={styles.stage}>
          <div className={styles.rail}>
            <RatePromise />
          </div>

          <div className={styles.calendar}>
            <WhenView
              maxDate={maxDate}
              minDate={minDate}
              nights={nights}
              onRangeChange={onRangeChange}
              onStatus={setStatus}
              range={range}
            />
          </div>

          {/* Mounted in both readings and clipped to nothing in one of them.
              `inert` is what makes that safe: a collapsed column is zero pixels
              wide, and a stepper inside it would otherwise still be in the tab
              order — a guest tabbing past the calendar would land on controls
              they cannot see. */}
          <aside className={styles.panel} inert={!panelOpen}>
            <StayPanel
              nights={stayLength}
              onContinue={onContinue}
              onPartyChange={onPartyChange}
              party={party}
              range={range}
            />
          </aside>
        </div>
      </div>

      <FunnelFoot nights={nights} />
    </div>
  );
}
