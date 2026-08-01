"use client";

// The rooms, as a list of rooms — one column of short rows on the plate.
//
// **The row stopped being the room.** Round 3 spent the full width of the page
// on a photographic band per type and opened a panel under it; the picture was
// the argument and the panel was where the facts went. That was right when the
// list was the whole screen. It is not the whole screen any more: the room the
// guest is on *is* the screen — it is the ground this plate is laid on, at the
// size of the window — so a second, smaller photograph of it in the row is the
// same picture twice, and the row's job is now to be *comparable*: five names,
// five sets of facts, five prices, all at the same x, short enough that the eye
// runs down them.
//
// So the thumbnail is a thumbnail. It tells the rows apart at a glance and
// nothing more; the ground does the looking.
//
// **One selected room, and selecting is the whole interaction.** There is no
// disclosure to open and no second press to commit — the list is a radio group,
// the selected room is what the stage shows, and `Continue` at the foot of the
// stage is the only thing that moves the guest on. `ROOM_TYPES`' own order is
// preserved, ascending by maximum occupancy then by price, which is what lets
// one fact be compared down one column.
//
// Radios rather than buttons with `aria-pressed`, and it is not a detail: a
// radio group is the one control the platform already knows is "exactly one of
// these", so arrow keys move the selection, the group takes one tab stop instead
// of five, and a screen reader announces "2 of 5" without being told to. The
// grouping is the shared `name` alone — a `role="radiogroup"` on the `<ul>`
// would take the list role away from an element whose children are `<li>`, and
// the count a list announces is worth keeping.

import type { RoomTypeCode, RoomTypeOffer } from "@mariva/shared";
import { m, useReducedMotion } from "motion/react";
import { useId } from "react";
import { cardListMotion } from "@/features/booking/lib/booking-motion";
import type { RoomType } from "@/features/booking/lib/room-types";
import styles from "./room-type-list.module.css";
import { RoomTypeRow } from "./room-type-row";

export function RoomTypeList({
  types,
  offers,
  selected,
  onSelect,
}: {
  /** The types a guest can actually take, in the list's fixed order. */
  readonly types: readonly RoomType[];
  readonly offers: readonly RoomTypeOffer[];
  readonly selected: RoomTypeCode | null;
  readonly onSelect: (code: RoomTypeCode) => void;
}) {
  const reduced = useReducedMotion();
  // One name for the group, unique per mount, so two lists could never share a
  // selection if this screen ever grew a second one.
  const group = useId();
  const byCode = new Map(offers.map((offer) => [offer.code, offer]));

  return (
    <m.ul
      animate="animate"
      className={styles.list}
      // Under reduced motion they all render at once rather than cascading:
      // §9's rule that the reduced path is its own composition, not the same one
      // held still. A stagger cut to nothing is five rows appearing in five
      // frames.
      initial={reduced ? "animate" : "initial"}
      variants={cardListMotion}
    >
      {types.map((type) => {
        const offer = byCode.get(type.code);
        if (!offer) return null;

        return (
          <RoomTypeRow
            group={group}
            isSelected={selected === type.code}
            key={type.code}
            offer={offer}
            onSelect={() => onSelect(type.code)}
            type={type}
          />
        );
      })}
    </m.ul>
  );
}
