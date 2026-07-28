"use client";

// The rooms, in two registers: what the guest can take, and what they cannot.
//
// `ROOM_TYPES`' own order is preserved *within* each group — ascending by
// maximum occupancy then by price. Five items do not need a sort control, and a
// stable order is the thing that lets a guest compare one fact down a column.
//
// The partition itself is `stay-quote.ts`' — presentation over data that already
// exists, and pure, so the rule that decides what a guest sees is testable
// without a browser.

import type { RoomTypeCode, RoomTypeOffer } from "@mariva/shared";
import { m, useReducedMotion } from "motion/react";
import { cardListMotion } from "@/features/booking/lib/booking-motion";
import { sizeBarFills } from "@/features/booking/lib/room-measure";
import type {
  Party,
  RoomTypePartition,
} from "@/features/booking/lib/stay-quote";
import { DemotedRows } from "./demoted-rows";
import { RoomTypeCard } from "./room-type-card";
import styles from "./room-type-list.module.css";

export function RoomTypeList({
  partition,
  offers,
  party,
  nights,
  chosen,
  holdNoteId,
  onChoose,
  onLookCloser,
}: {
  readonly partition: RoomTypePartition;
  readonly offers: readonly RoomTypeOffer[];
  readonly party: Party;
  readonly nights: number;
  readonly chosen: RoomTypeCode | null;
  readonly holdNoteId: string;
  readonly onChoose: (code: RoomTypeCode) => void;
  readonly onLookCloser: (code: RoomTypeCode) => void;
}) {
  const reduced = useReducedMotion();
  const byCode = new Map(offers.map((offer) => [offer.code, offer]));

  // Normalised over the types this list draws a bar for, never over
  // `ROOM_TYPES`. A bar measured against a room the guest cannot have is a bar
  // measured against nothing.
  const fills = sizeBarFills(partition.takeable);

  return (
    <>
      <m.ul
        animate="animate"
        className={styles.list}
        // Under reduced motion they all render at once rather than cascading:
        // §9's rule that the reduced path is its own composition, not the same
        // one held still. A stagger cut to nothing is five cards appearing in
        // five frames.
        initial={reduced ? "animate" : "initial"}
        variants={cardListMotion}
      >
        {partition.takeable.map((type) => {
          const offer = byCode.get(type.code);
          if (!offer) return null;

          return (
            <RoomTypeCard
              holdNoteId={holdNoteId}
              isChosen={chosen === type.code}
              key={type.code}
              nights={nights}
              offer={offer}
              onChoose={() => onChoose(type.code)}
              onLookCloser={() => onLookCloser(type.code)}
              sizeFill={fills.get(type.code) ?? 0}
              type={type}
            />
          );
        })}
      </m.ul>

      <DemotedRows
        party={party}
        soldOut={partition.soldOut}
        tooSmall={partition.tooSmall}
      />
    </>
  );
}
