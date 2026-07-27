"use client";

// The five types, in one column, in a fixed order.
//
// Ascending by maximum occupancy then by price, which is `ROOM_TYPES`' own order.
// Five items do not need a sort control, and a stable order is the thing that
// lets a guest compare one fact down a column.
//
// Sold-out types stay in the list, in position, with "Not free for these dates"
// where the price was. With five types and forty rooms, four-of-five sold out will
// happen far more often than zero — so the partly-free state is the common case,
// not the edge, and the guest gets to see that the property is nearly full without
// being told to hurry about it.

import type { RoomTypeCode, RoomTypeOffer, StayRange } from "@mariva/shared";
import { m, useReducedMotion } from "motion/react";
import { cardListMotion } from "@/features/booking/lib/booking-motion";
import { ROOM_TYPES } from "@/features/booking/lib/room-types";
import type { Party } from "@/features/booking/lib/stay-quote";
import { RoomTypeCard } from "./room-type-card";
import styles from "./room-type-list.module.css";

export function RoomTypeList({
  offers,
  party,
  range,
  nights,
  chosen,
  onChoose,
}: {
  readonly offers: readonly RoomTypeOffer[];
  readonly party: Party;
  readonly range: StayRange | null;
  readonly nights: number;
  readonly chosen: RoomTypeCode | null;
  readonly onChoose: (code: RoomTypeCode) => void;
}) {
  const reduced = useReducedMotion();
  const byCode = new Map(offers.map((offer) => [offer.code, offer]));

  return (
    <m.ul
      animate="animate"
      className={styles.list}
      // Under reduced motion all five render at once rather than cascading: §9's
      // rule that the reduced path is its own composition, not the same one held
      // still. A stagger cut to nothing is five cards appearing in five frames.
      initial={reduced ? "animate" : "initial"}
      variants={cardListMotion}
    >
      {ROOM_TYPES.map((type) => (
        <RoomTypeCard
          hasDates={range !== null}
          isChosen={chosen === type.code}
          key={type.code}
          nights={nights}
          offer={byCode.get(type.code)}
          onChoose={() => onChoose(type.code)}
          party={party}
          type={type}
        />
      ))}
    </m.ul>
  );
}
