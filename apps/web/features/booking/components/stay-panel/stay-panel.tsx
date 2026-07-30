"use client";

// The stay, stated back, with the way forward in it.
//
// This panel is the screen's answer to a problem the two-view funnel had and
// never named: choosing a departure date used to *replace* the calendar with a
// list of rooms. The guest's last act — pressing a second date — was answered by
// the whole screen changing, with no moment in between where what they had just
// chosen was written down. If they had mis-clicked, they found out from a price.
//
// So the dates step now ends here. The range is repeated in words, the party is
// beside it, and one button moves on. Nothing in this panel is a question the
// guest has not already been asked; it is a receipt with an edit on it.
//
// **It is an extension of the same screen, not a step of its own.** The calendar
// stays mounted and selectable at 70% while this opens at 30% — see
// `booking-screen.module.css` for the one property that animates — because the
// most likely thing a guest does when they read their dates back is change one of
// them, and a confirmation screen that hides the control you would need is a
// confirmation screen you have to leave to use.
//
// **The property line is the two facts the repository actually holds.** The comp
// this was drawn from names a hotel and a city under a pin icon. The name is
// Mariva; the place is Vietnam, which is what `stay-date.ts`, the đồng tariff and
// the property's own timezone all agree on. A street address would be invented,
// and an invented address on a booking summary is the one kind of placeholder a
// guest could act on.

import type { StayRange } from "@mariva/shared";
import { formatStayEnd } from "@/features/booking/lib/booking-search";
import type { Party } from "@/features/booking/lib/stay-quote";
import { PartyRows } from "./party-rows";
import styles from "./stay-panel.module.css";

export function StayPanel({
  range,
  party,
  nights,
  onPartyChange,
  onContinue,
}: {
  /** Null until the guest has both ends. The panel has nothing to say before. */
  readonly range: StayRange | null;
  readonly party: Party;
  readonly nights: number;
  readonly onPartyChange: (party: Party) => void;
  readonly onContinue: () => void;
}) {
  if (!range) return null;

  const arrival = formatStayEnd(range.checkIn);
  const departure = formatStayEnd(range.checkOut);

  return (
    <div className={styles.panel}>
      <div className={styles.section}>
        <h2 className={`${styles.kicker} caps-label`}>Your stay</h2>
        <p className={`${styles.property} font-display`}>Mariva</p>
        <p className={styles.place}>Vietnam</p>
      </div>

      {/* The two ends, side by side, with the arrow between them carrying the
          direction. Read-only: the calendar is still on screen, and it is a better
          way to change a date than any pair of controls this panel could hold. */}
      <div className={styles.section}>
        <div className={styles.ends}>
          <div className={styles.end}>
            <p className={`${styles.endLabel} caps-label`}>Check in</p>
            <p className={styles.endDate}>{arrival.day}</p>
            <p className={styles.endDay}>{arrival.weekday}</p>
          </div>

          <span aria-hidden="true" className={styles.arrow} />

          <div className={styles.end}>
            <p className={`${styles.endLabel} caps-label`}>Check out</p>
            <p className={styles.endDate}>{departure.day}</p>
            <p className={styles.endDay}>{departure.weekday}</p>
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <PartyRows nights={nights} onChange={onPartyChange} party={party} />
      </div>

      <div className={styles.action}>
        <button className={styles.continue} onClick={onContinue} type="button">
          Choose your room
        </button>

        {/* What the button leads to, qualified before it is pressed rather than
            under the first price the guest reads. */}
        <p className={styles.terms}>Every price includes VAT and service.</p>
      </div>
    </div>
  );
}
