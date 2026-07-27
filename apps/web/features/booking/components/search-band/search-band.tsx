"use client";

// One band, three answers: when, who, which rate.
//
// Wide screens keep the three open — the calendar drops in place under the dates,
// and guests and rate stand beside it. Narrow screens collapse to three tappable
// lines, each opening its own full-height sheet. Same three segments either way, so
// there is one mental model rather than a desktop layout and a mobile one.
//
// The calendar is rendered **once**, in whichever of the two places is live. Not
// rendered twice and hidden with `display: none`: two React Aria calendars each
// announce their own visible month on mount, and the guest would hear August 2026
// twice before touching anything.
//
// There is no submit button. Every control writes the URL, and the URL *is* the
// search — so there is no state that has been entered but not applied, and no way
// to be looking at prices for a range other than the one in the address bar.

import type { CalendarDate } from "@internationalized/date";
import type { RatePlanCode, StayRange } from "@mariva/shared";
import { useState } from "react";
import { formatStayDates } from "@/features/booking/lib/booking-search";
import {
  type NightIndex,
  type Party,
  partySize,
} from "@/features/booking/lib/stay-quote";
import {
  useViewportMatch,
  WIDE_VIEWPORT,
} from "@/features/booking/lib/use-viewport-match";
import { BottomSheet } from "../bottom-sheet/bottom-sheet";
import { StayCalendar } from "../stay-calendar/stay-calendar";
import { GuestFieldset } from "./guest-fieldset";
import { planName, RatePlanChoice } from "./rate-plan-choice";
import styles from "./search-band.module.css";

/** Which segment is expanded. One at a time, by construction. */
type OpenSegment = "dates" | "guests" | "plan" | null;

export function SearchBand({
  range,
  party,
  plan,
  nights,
  minDate,
  onRangeChange,
  onPartyChange,
  onPlanChange,
}: {
  readonly range: StayRange | null;
  readonly party: Party;
  readonly plan: RatePlanCode;
  readonly nights: NightIndex;
  readonly minDate: CalendarDate;
  readonly onRangeChange: (range: StayRange | null) => void;
  readonly onPartyChange: (party: Party) => void;
  readonly onPlanChange: (plan: RatePlanCode) => void;
}) {
  const isWide = useViewportMatch(WIDE_VIEWPORT);
  // Open on arrival when there are no dates: the screen's whole question is "when",
  // and making the guest press something before they can answer it is a step for
  // nothing. With dates already in the URL it starts folded, because then the
  // answer is on screen and the room list is what they came back for.
  const [open, setOpen] = useState<OpenSegment>(
    range === null ? "dates" : null,
  );

  const stay = range ? formatStayDates(range) : null;
  const guests = partySize(party);

  const calendar = (
    <StayCalendar
      minDate={minDate}
      nights={nights}
      onSelect={(picked) => {
        onRangeChange(picked);
        // A complete range is this control's answer, so it folds away. An
        // incomplete one leaves it open — the guest is mid-sentence.
        if (picked) setOpen(null);
      }}
      selected={range}
    />
  );

  return (
    <section className={styles.band}>
      <div className={styles.summary}>
        <Segment
          isOpen={open === "dates"}
          label="Nights"
          onToggle={() => setOpen(open === "dates" ? null : "dates")}
          value={stay ? `${stay.dates} · ${stay.nights}` : "Choose your dates"}
        />
        <Segment
          isOpen={open === "guests"}
          label="Guests"
          onToggle={() => setOpen(open === "guests" ? null : "guests")}
          value={guests === 1 ? "1 guest" : `${guests} guests`}
        />
        <Segment
          isOpen={open === "plan"}
          label="Rate"
          onToggle={() => setOpen(open === "plan" ? null : "plan")}
          value={planName(plan)}
        />
      </div>

      {isWide ? (
        <div className={styles.wide}>
          {open === "dates" ? (
            <div className={styles.panel}>{calendar}</div>
          ) : null}
          {open === "guests" ? (
            <div className={styles.panel}>
              <GuestFieldset onChange={onPartyChange} party={party} />
            </div>
          ) : null}
          {open === "plan" ? (
            <div className={styles.panel}>
              <RatePlanChoice onChange={onPlanChange} plan={plan} />
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <BottomSheet
            isOpen={open === "dates"}
            onClose={() => setOpen(null)}
            title="Nights of your stay"
          >
            {calendar}
          </BottomSheet>

          <BottomSheet
            isOpen={open === "guests"}
            onClose={() => setOpen(null)}
            title="Who is staying"
          >
            <GuestFieldset onChange={onPartyChange} party={party} />
          </BottomSheet>

          <BottomSheet
            isOpen={open === "plan"}
            onClose={() => setOpen(null)}
            title="Your rate"
          >
            <RatePlanChoice onChange={onPlanChange} plan={plan} />
          </BottomSheet>
        </>
      )}
    </section>
  );
}

function Segment({
  label,
  value,
  isOpen,
  onToggle,
}: {
  readonly label: string;
  readonly value: string;
  readonly isOpen: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <button
      aria-expanded={isOpen}
      className={`${styles.segment}${isOpen ? ` ${styles.segmentOpen}` : ""}`}
      onClick={onToggle}
      type="button"
    >
      <span className={`${styles.segmentLabel} caps-label`}>{label}</span>
      <span className={styles.segmentValue}>{value}</span>
    </button>
  );
}
