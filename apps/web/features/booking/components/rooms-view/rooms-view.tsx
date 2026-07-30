"use client";

// View B. One question: which room.
//
// The date summary, the sentence that qualifies every price under it, and the
// grid. Round 1 printed that sentence on all five cards — sixty words where
// twelve were needed — and printed "N nights · N guests" five times as well. Said
// once, above the prices it qualifies, it costs the view twenty words and reads
// as what it is: a term, not a feature of a room.
//
// The hold sentence is one string with one id, and every `Choose` button on the
// screen points at it with `aria-describedby`. A sighted guest and a
// screen-reader guest read the same sentence, once.

import type { RoomTypeCode, RoomTypeOffer, StayRange } from "@mariva/shared";
import { useId, useLayoutEffect } from "react";
import { takeRoomsScroll } from "@/features/booking/lib/booking-view";
import type {
  Party,
  RoomTypePartition,
} from "@/features/booking/lib/stay-quote";
import { RoomTypeList } from "../room-type-list/room-type-list";
import { DateSummary } from "./date-summary";
import styles from "./rooms-view.module.css";

export function RoomsView({
  range,
  party,
  offers,
  partition,
  nights,
  chosen,
  onChoose,
  onLookCloser,
  onChangeDates,
}: {
  readonly range: StayRange;
  readonly party: Party;
  readonly offers: readonly RoomTypeOffer[];
  readonly partition: RoomTypePartition;
  readonly nights: number;
  readonly chosen: RoomTypeCode | null;
  readonly onChoose: (code: RoomTypeCode) => void;
  readonly onLookCloser: (code: RoomTypeCode) => void;
  readonly onChangeDates: () => void;
}) {
  const holdNoteId = useId();

  // Where the guest was, put back before the browser paints.
  //
  // This view is unmounted while the calendar is open, so its scroll position
  // exists nowhere but `booking-view.ts` — and a guest who changes one date and
  // lands back at the top of the list has been punished for correcting
  // themselves. A layout effect rather than an effect: the restore has to happen
  // between the mount and the paint, or the guest sees the top of the list first
  // and then a jump.
  //
  // The offset is safe to apply immediately because every card reserves its own
  // height: the photograph's box is an `aspect-ratio`, so the list is its final
  // height before a single image has decoded.
  useLayoutEffect(() => {
    const y = takeRoomsScroll();
    if (y > 0) window.scrollTo(0, y);
  }, []);

  return (
    <section className={styles.view} data-view="rooms">
      <DateSummary onChange={onChangeDates} party={party} range={range} />

      {/* "Prices include VAT and service." is not here any more: it is the view's
          own lede, above the title, where it qualifies the prices before the first
          one is read rather than in a line between the summary and the grid. */}
      <p className={styles.terms} id={holdNoteId}>
        Choosing a room holds it while you finish. Nothing is charged yet.
      </p>

      <div className={styles.rooms}>
        <RoomTypeList
          chosen={chosen}
          holdNoteId={holdNoteId}
          nights={nights}
          offers={offers}
          onChoose={onChoose}
          onLookCloser={onLookCloser}
          partition={partition}
          party={party}
        />
      </div>
    </section>
  );
}
