"use client";

// View B, the reading half. One question: which room.
//
// **This is a plate now, not a page.** Round 3 gave the rooms their own
// full-width composition — a narrow rail of terms against a wide column of
// photographic bands — and then put the room a guest wanted to look at behind a
// button, in a dialog, over the top of all of it. The dialog is gone, and so is
// the column that replaced it: the room is the ground of the whole window, and
// this is the plate laid on it that a guest compares against while they look.
//
// So what is left here is the reading: the question this step asks, what was
// answered on the dates step, the five rows, and the one sentence naming
// whatever is not among them. The stay total, the facts, the terms and the way
// forward all belong to the room and are stated on its own plates, once.
//
// The heading lives here rather than in `booking-screen.tsx` for the same reason
// it always did: it is the first line of a plate, not a banner over a page. One
// `<h1>`, still, and still only one view mounted at a time.

import type { RoomTypeCode, RoomTypeOffer, StayRange } from "@mariva/shared";
import { useLayoutEffect } from "react";
import { takeRoomsScroll } from "@/features/booking/lib/booking-view";
import { absenceNotes } from "@/features/booking/lib/room-absence";
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
  selected,
  onSelect,
  onChangeDates,
}: {
  readonly range: StayRange;
  readonly party: Party;
  readonly offers: readonly RoomTypeOffer[];
  readonly partition: RoomTypePartition;
  readonly selected: RoomTypeCode | null;
  readonly onSelect: (code: RoomTypeCode) => void;
  readonly onChangeDates: () => void;
}) {
  // Where the guest was, put back before the browser paints.
  //
  // This view is unmounted while the calendar is open, so its scroll position
  // exists nowhere but `booking-view.ts` — and a guest who changes one date and
  // lands back at the top of the list has been punished for correcting
  // themselves. A layout effect rather than an effect: the restore has to happen
  // between the mount and the paint, or the guest sees the top of the list first
  // and then a jump.
  //
  // It is a no-op at the width where the photograph is the ground, because there
  // the page is exactly the height of the window, nothing on it scrolls but this
  // plate's own list, and there is no page offset to restore. It still matters
  // below that width, where the picture, the list and the room are one scrolling
  // column.
  //
  // The offset is safe to apply immediately because every box on this step
  // reserves its own: the rows carry the thumbnail's intrinsic size, and the
  // ground carries its ratio, so the page is its final height before a single
  // photograph has decoded.
  useLayoutEffect(() => {
    const y = takeRoomsScroll();
    if (y > 0) window.scrollTo(0, y);
  }, []);

  const absent = absenceNotes(partition, party);

  return (
    <section className={styles.view} data-view="rooms">
      {/* The question first, then what was already answered.
          It used to be the other way round — the stay at the top of the column
          with the heading under it — which put a statement of a finished
          decision above the one still open. The plate reads as a page now: its
          title, then the line of context under it, then the rows. The summary is
          still the sticky one, so a guest four rows down can still reach the way
          back without scrolling up for it. */}
      <h1 className={styles.title}>Choose your room</h1>

      {/* The line under the title, which the plate did not have.
          It says what the list *does* rather than restating the heading: the
          rows are a comparison, and the room beside them is whichever one is
          picked. A guest who has not worked that out reads five prices and no
          reason the photograph keeps changing.

          It states the screen's own behaviour and never a fact about the
          property — `design-foundations.md` §6 keeps hotel facts in
          `property-and-tariff.md`, and a sentence invented here that claimed
          one would be exactly the failure that rule exists for. */}
      <p className={styles.lede}>Pick a room to see it in full.</p>

      <DateSummary onChange={onChangeDates} party={party} range={range} />

      <RoomTypeList
        offers={offers}
        onSelect={onSelect}
        selected={selected}
        types={partition.takeable}
      />

      {/* Demoted, never hidden. A guest who cannot see the Superior at all
          concludes the hotel has no such room; a guest who reads one line
          concludes it is not free this week. One sentence, at the weight the
          fact deserves — see `room-absence.ts` for why it stopped being a
          labelled section under the list. */}
      {absent.length === 0 ? null : (
        <p className={styles.absent} data-absent-note>
          {absent.join(" ")}
        </p>
      )}
    </section>
  );
}
