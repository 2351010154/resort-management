"use client";

// The fixed bar that arrives once a room is chosen: the total, and the way forward.
//
// Limehome's measured 82px, rounded to 80, and hidden until there is something to
// summarise — a bar reading "0 ₫ · 0 guests · Reserve" from the first paint spends
// the bottom of every phone screen saying nothing.
//
// The total carries `aria-live="polite"`, which is Eventbrite's one good idea about
// its own checkout: a figure that changes without being announced is a figure a
// screen-reader guest has to go back and hunt for.

import { type RoomTypeOffer, roundVndForDisplay } from "@mariva/shared";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import {
  stillMotion,
  summaryBarMotion,
} from "@/features/booking/lib/booking-motion";
import { roomType } from "@/features/booking/lib/room-types";
import { Money } from "../money";
import styles from "./summary-bar.module.css";

export function SummaryBar({
  offer,
  nights,
  guests,
  onContinue,
}: {
  readonly offer: RoomTypeOffer | null;
  readonly nights: number;
  readonly guests: number;
  readonly onContinue: () => void;
}) {
  const reduced = useReducedMotion();

  return (
    <AnimatePresence>
      {offer ? (
        <m.div
          animate="animate"
          className={styles.bar}
          exit="exit"
          initial="initial"
          variants={reduced ? stillMotion : summaryBarMotion}
        >
          <div className={styles.figures}>
            <p className={styles.total} aria-live="polite">
              <Money amount={roundVndForDisplay(offer.stayTotalGross)} />
            </p>
            <p className={styles.detail}>
              {roomType(offer.code).name} ·{" "}
              {nights === 1 ? "1 night" : `${nights} nights`} ·{" "}
              {guests === 1 ? "1 guest" : `${guests} guests`}
            </p>
          </div>

          <button
            className={styles.continue}
            onClick={onContinue}
            type="button"
          >
            Continue
          </button>
        </m.div>
      ) : null}
    </AnimatePresence>
  );
}
