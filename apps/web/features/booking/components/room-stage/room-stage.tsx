"use client";

import {
  type RatePlanCode,
  type RoomTypeOffer,
  roundVndForDisplay,
} from "@mariva/shared";
import { m, useReducedMotion } from "motion/react";
import type { CSSProperties } from "react";
import { useRef } from "react";
import {
  roomSwapMotion,
  stillMotion,
} from "@/features/booking/lib/booking-motion";
import { planName, planTerm } from "@/features/booking/lib/rate-plans";
import { markedRoomFacts } from "@/features/booking/lib/room-facts";
import {
  ROOM_AMENITIES,
  type RoomType,
} from "@/features/booking/lib/room-types";
import { Money } from "../money";
import styles from "./room-stage.module.css";

// Decorative line icons follow the property's amenity order.
const amenityPaths = [
  "M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9 5l3 3 3-3M9 19l3-3 3 3",
  "M5 12a7 7 0 0 1 14 0H5ZM12 2v3M7 16v2M12 16v4M17 16v2",
  "M5 8h12v8a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V8ZM17 9h2a3 3 0 0 1 0 6h-2M8 3v2M12 3v2",
  "M3 14h18M5 14v7M19 14v7M9 10h10l-3-7h-4l-3 7ZM14 10v4",
  "M7 8h10l2 12H5L7 8ZM9 3h6v5M10 3V1h5",
  "M9 3h6v4l2 3v11H7V10l2-3V3ZM7 13h10",
  "M4 4h16v16H4V4ZM8 4v16M12 12a2 2 0 1 0 4 0 2 2 0 1 0-4 0M18 8v8",
  "M4 5h10a4 4 0 0 1 0 8H9l2 8H7L5 13H4V5ZM18 7h3M18 11h3",
  "M3 8a14 14 0 0 1 18 0M6 11a9 9 0 0 1 12 0M9 14a5 5 0 0 1 6 0M12 18h.01",
  "M5 6l3-3 4 3 4-3 3 3-2 5 3 3-3 6H7l-3-6 3-3-2-5Z",
  "M8 3l4 3 4-3 5 5-3 3-1 10H7L6 11 3 8l5-5ZM12 6v15M7 14h10",
  "M3 4h18v13H3V4ZM8 21h8M12 17v4",
];

export function RoomStage({
  type,
  offer,
  plan,
  nights,
  note,
  holding,
  onContinue,
}: {
  readonly type: RoomType;
  readonly offer: RoomTypeOffer;
  readonly plan: RatePlanCode;
  /** Nights of the stay — what the total below is the total *of*. */
  readonly nights: number;
  /**
   * What `Continue` had to say for itself, replacing the standing line under it.
   *
   * One slot rather than two, and that is the point: a status message appended
   * below a line the guest has already read is a second line to find, and this
   * screen is the height of the window with nowhere to put one. The standing
   * line and the answer are the same sentence position, so the answer arrives
   * where the guest is already looking.
   */
  readonly note: string | null;
  /**
   * Whether the room is being held right now.
   *
   * A hold is a request that consumes the nights, so the press has to look like
   * it did something for as long as it is in flight — a button that stays
   * pressable and unchanged invites the second press the funnel then has to
   * drop. Optional because it is a state only the screen that takes the hold
   * has; a caller with no request to make renders the button as it always was.
   */
  readonly holding?: boolean;
  readonly onContinue: () => void;
}) {
  const reduced = useReducedMotion();
  const stay = nights === 1 ? "1 night" : `${nights} nights`;

  /**
   * The facts column, as somewhere to be sent rather than somewhere to open.
   *
   * `tabIndex={-1}` puts it out of the tab order and still lets focus be moved
   * to it, which is the whole trick: the region stays exactly as reachable as it
   * was by tabbing, and gains one shortcut into it.
   */
  const factsPane = useRef<HTMLDivElement>(null);

  // The four facts, and the review screen prints the same four from the same
  // list — `room-facts.ts` is where the order and the wording are argued, and
  // where the extra bed is argued out of them.
  const facts = markedRoomFacts(type);

  return (
    // **The plate fades itself, and it has to be this element that does it.**
    //
    // `booking-screen.tsx` keys this component on the room inside an
    // `AnimatePresence`, so one room leaves as the next arrives — the reading's
    // half of the dissolve the photograph behind it is already doing. The fade
    // lives here rather than on a wrapper up there for a reason that is not
    // taste: Motion writes what it animates to the inline style, the plate this
    // sits in is the one the gallery's peek fades out through the stylesheet, and
    // anything in between carrying its own `opacity` would both outrank that rule
    // and displace the element `check-booking-screen.mjs` measures.
    //
    // So the box that says what the room is is also the box that fades, which is
    // the honest arrangement anyway: it is the room that changed.
    <m.div
      animate="animate"
      className={styles.stage}
      data-room-stage={type.code}
      exit="exit"
      initial="initial"
      variants={reduced ? stillMotion : roomSwapMotion}
    >
      <section className={styles.card}>
        <div className={styles.head}>
          <p className={`${styles.kicker} caps-label`}>Your room</p>
          <h2 className={styles.name}>{type.name}</h2>

          {/* What the property says about this room — `property-and-tariff.md`
              §1. Two sentences, and the second one turns toward the reader,
              which is §6's shape for a body. */}
          <p className={styles.blurb}>{type.description}</p>

          {/* The plan's terms, in full, before a room is taken further — not on
              a confirmation page. Last in the column and at the smallest weight
              in it: it is the one thing here a guest can hold the hotel to, and
              it is not what they are reading the plate for. */}
          <p className={styles.terms}>
            {planName(plan)}. {planTerm(plan)}
          </p>

          {/* Last in the column, where the comp puts it, and the only press on
              this plate. Two words rather than a sentence: it is a signpost to
              something already visible, and a longer label would make it sound
              like it was offering more than the plate is showing. */}
          <button
            className={styles.toFacts}
            onClick={() => factsPane.current?.focus()}
            type="button"
          >
            Room details
            <svg
              aria-hidden="true"
              className={styles.toFactsMark}
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
              viewBox="0 0 16 16"
            >
              <path d="M2 8h12M9 3l5 5-5 5" />
            </svg>
          </button>
        </div>

        <div className={styles.detail} ref={factsPane} tabIndex={-1}>
          {/* Four facts, open. `dl` because that is what they are — a value and
              the word for what it is — and the glyph is `aria-hidden` beside
              them, because a screen reader reading "picture of a bed, The bed,
              one king bed" has been told the same thing three times. */}
          <dl className={styles.facts}>
            {facts.map((fact) => (
              <div className={styles.fact} key={fact.term}>
                <span
                  aria-hidden="true"
                  className={styles.factIcon}
                  style={
                    {
                      "--fact-icon": `url("/images/booking/icons/${fact.icon}.svg")`,
                    } as CSSProperties
                  }
                />
                {/* **Not `.caps-label`, and the units are the reason.** The
                    comp sets these values in a caps run, and `text-transform:
                    uppercase` over them prints "28 M²" and "(1.60 M)" — the
                    metre is a lower-case symbol and capitalising it makes it a
                    different unit. So the value is separated from the term by
                    weight and colour instead, which is the same read without
                    rewriting an SI symbol. */}
                {/* `dd` and `dt` sit directly in the one wrapping `div`. A
                    `dl` may group each pair in a single `div` and no deeper, so
                    the stacked column these two read as is made by grid
                    placement in the stylesheet rather than by a second element
                    — which is the nesting `dlitem` was failing on. */}
                <dd className={styles.factValue}>{fact.value}</dd>
                <dt className={styles.factTerm}>{fact.term}</dt>
              </div>
            ))}
          </dl>

          {/* The bed the maximum occupancy needs, stated as what it is: a fact
              about the room rather than a line on the bill. Drawn only where the
              maximum is above what the bedding sleeps — the Junior Suite alone
              under `property-and-tariff.md` §1's mix — because anywhere else the
              sentence would be about a bed nobody is asked to sleep on, and a
              fact the same shape whether or not it is true is one a guest cannot
              read past.

              §1 charges nothing for it: the maximum is a promise and the bed is
              how the property keeps it, so §3's extra-person charge inside the
              total on the next plate is the whole price of the extra head. The
              350,000 ₫ item in §6's catalog is a bed somebody asks the desk for,
              and this screen never offers one. */}
          {type.maxOccupancy > type.beddingSleeps ? (
            <p className={styles.extra}>
              The bedding sleeps {type.beddingSleeps}; an extra bed makes up the
              difference, at no charge.
            </p>
          ) : null}
          <section
            className={styles.amenitiesSection}
            aria-label="Room amenities"
          >
            <h3 className={`${styles.amenitiesTitle} caps-label`}>Amenities</h3>
            <ul className={styles.amenities}>
              {ROOM_AMENITIES.map((item, index) => (
                <li className={styles.amenity} key={item}>
                  <svg
                    aria-hidden="true"
                    className={styles.amenityIcon}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.25"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d={amenityPaths[index]} />
                  </svg>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </section>

      {/* The second plate, clear of the first's bottom edge. */}
      <section className={styles.price}>
        <p className={styles.figures}>
          <span className={`${styles.figuresTerm} caps-label`}>
            Price for {stay}
          </span>
          {/* A figure that changes without being announced is a figure a
              screen-reader guest has to go back and hunt for. */}
          <span aria-live="polite" className={styles.total}>
            <Money amount={roundVndForDisplay(offer.stayTotalGross)} />
          </span>
          <span className={styles.included}>VAT and service included.</span>
        </p>

        {/* Nothing is asked of the guest here any more, and that is the whole
            of what this plate now does: state the total, and offer the one press
            that takes the room. The name and the address moved to the review
            screen — `stay-funnel.ts` says why — so a guest still comparing rooms
            is not being asked who they are. */}
        <div className={styles.act}>
          <button
            className={styles.continue}
            data-stage-continue
            disabled={holding}
            onClick={onContinue}
            type="button"
          >
            {holding ? "Holding the room…" : "Continue"}
          </button>
          <p className={styles.hold} role="status">
            {note ?? "Nothing is charged yet."}
          </p>
        </div>
      </section>
    </m.div>
  );
}
