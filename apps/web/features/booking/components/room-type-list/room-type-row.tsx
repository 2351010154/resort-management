"use client";

// One room, as one line of the list: a thumbnail, a name, three facts, a price.
//
// **Everything that differs between the five types is here, unpressed.**
// Occupancy, size and aspect are on the row, and so is the figure. That rule
// survived every round of this screen and it survives the stage: a guest who
// never moves off the room the list opens on has still read every difference.
// What the stage adds is *scale* — the room at the size of the window, and the
// four or five other frames of it.
//
// The per-night figure, not the stay total. Five totals down a column are five
// numbers a guest has to divide before they can compare them, and the total the
// guest is actually agreeing to is stated once, in full, at the foot of the
// stage. A price list compares per night; a bill states the total.
//
// What is still not here, deliberately:
//
// - **No rooms-remaining count, no struck-through price, no "was", no
//   percentage saved.** `design-foundations.md` §6 forbids scarcity and false
//   discount outright.
// - **No motion on the thumbnail** — no hover zoom. A `transform` on a `cover`
//   image re-rasterises its layer every frame, and a moving photograph of a
//   hotel room is marketing.
// - **No heading element.** The list is a `<ul>` and each row an `<li>`, which
//   is the structure a screen reader announces with a count.
//
// The row is only ever rendered for a type that is free for the range and fits
// the party. A type that is neither is named in one sentence beside the list —
// see `room-absence.ts`. A row with a dead control reads as broken whichever
// reason produced it.

import { type RoomTypeOffer, roundVndForDisplay } from "@mariva/shared";
import { m, useReducedMotion } from "motion/react";
import { cardMotion, stillMotion } from "@/features/booking/lib/booking-motion";
import { roomFacts } from "@/features/booking/lib/room-facts";
import { roomLead, tierSrcSet } from "@/features/booking/lib/room-images";
import type { RoomType } from "@/features/booking/lib/room-types";
import { Money } from "../money";
import styles from "./room-type-list.module.css";

/**
 * Layout width of one thumbnail, for the browser's tier choice.
 *
 * A fixed box rather than a fraction of the row: the thumbnail is never wider
 * than 6rem at any viewport, and left to the 100vw default the browser would
 * fetch a 1920 tier for a 96px box on all five rows. Stated as the widest of
 * the readings rather than each of them — the tiers are 640 and up, so no width
 * this box takes chooses a different file, and a media-query list here would be
 * three numbers to keep level with the stylesheet for no change in what is
 * fetched.
 */
const THUMB_SIZES = "6rem";

export function RoomTypeRow({
  type,
  offer,
  group,
  isSelected,
  onSelect,
}: {
  readonly type: RoomType;
  readonly offer: RoomTypeOffer;
  /** The radio group's shared `name`, so exactly one row can be selected. */
  readonly group: string;
  readonly isSelected: boolean;
  readonly onSelect: () => void;
}) {
  const reduced = useReducedMotion();
  const lead = roomLead(type.code);

  return (
    <m.li
      className={styles.row}
      data-room-row={type.code}
      data-selected={isSelected ? "" : undefined}
      variants={reduced ? stillMotion : cardMotion}
    >
      {/* The whole row is the label, so its accessible name is everything
          printed on it — the room, its three facts and its price — which is what
          a row of a list of rooms should announce. The photograph's description
          is *not* part of that name: the same picture is on the stage at full
          size with the same `alt`, and a radio announcing a paragraph about
          lattice screens before it gets to the price is a control nobody can
          use. */}
      <label className={styles.label}>
        <input
          checked={isSelected}
          className={styles.radio}
          data-room-pick
          name={group}
          onChange={onSelect}
          type="radio"
          value={type.code}
        />

        <img
          alt=""
          className={styles.thumb}
          decoding="async"
          height={lead.height}
          loading="lazy"
          sizes={THUMB_SIZES}
          src={lead.src}
          srcSet={tierSrcSet(lead)}
          width={lead.width}
        />

        <span className={styles.text}>
          <span className={styles.name}>{type.name}</span>
          <span className={styles.facts}>{roomFacts(type)}</span>
          <span className={styles.price}>
            <Money amount={roundVndForDisplay(offer.perNightGross)} /> a night
          </span>
        </span>

        {/* The state, drawn. Not a second control — it is inside the label it
            belongs to, so a guest who aims at it selects the row. */}
        <span aria-hidden="true" className={styles.mark}>
          {/* `aria-hidden` on the SVG as well as its parent: the parent is
              already out of the accessibility tree, and a `<title>` here would
              only add a browser tooltip reading "Chosen" over a control whose
              state the radio inside it already announces. */}
          <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
            {isSelected ? (
              <path
                d="M6 12.5 10.2 16.5 18 8"
                stroke="currentColor"
                strokeWidth="1.5"
              />
            ) : (
              <path
                d="M12 7v10M7 12h10"
                stroke="currentColor"
                strokeWidth="1.25"
              />
            )}
          </svg>
        </span>
      </label>
    </m.li>
  );
}
