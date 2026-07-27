"use client";

// One room type. Four facts, a price block, a disclosure, and one action.
//
// The four facts are in a fixed order on every card, so the eye compares down a
// column rather than hunting across five differently-shaped blocks. Limehome's
// five types differ by 31/30/29/28 m² and its cards are consequently five
// near-identical blocks; these five differ by whom they sleep and what they are
// furnished with, and that is what the card leads with.
//
// What is *not* here, deliberately:
//
// - **No rooms-remaining count.** "2 rooms left" is scarcity, and
//   design-foundations.md §6 forbids it outright.
// - **No struck-through price, no "was", no percentage saved.** Same rule.
// - **No hiding a type the party does not fit.** The card keeps its place and
//   says so instead — hiding it makes the guest think the hotel has no such room.

import { type RoomTypeOffer, roundVndForDisplay } from "@mariva/shared";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { useId, useState } from "react";
import {
  cardMotion,
  priceMotion,
  stillMotion,
} from "@/features/booking/lib/booking-motion";
import {
  ROOM_AMENITIES,
  type RoomType,
} from "@/features/booking/lib/room-types";
import {
  needsExtraBed,
  occupancyFit,
  type Party,
} from "@/features/booking/lib/stay-quote";
import { Money } from "../money";
import styles from "./room-type-list.module.css";

export function RoomTypeCard({
  type,
  offer,
  party,
  nights,
  hasDates,
  isChosen,
  onChoose,
}: {
  readonly type: RoomType;
  readonly offer: RoomTypeOffer | undefined;
  readonly party: Party;
  readonly nights: number;
  readonly hasDates: boolean;
  readonly isChosen: boolean;
  readonly onChoose: () => void;
}) {
  const [isOpen, setOpen] = useState(false);
  const [wantsExtraBed, setWantsExtraBed] = useState(false);
  const amenitiesId = useId();
  const noteId = useId();
  const reduced = useReducedMotion();

  const fit = occupancyFit(type, party);
  const extraBedNeeded = needsExtraBed(type, party);
  const canChoose = hasDates && fit.fits && offer?.isAvailable === true;

  return (
    <m.li
      className={`${styles.card}${isChosen ? ` ${styles.cardChosen}` : ""}`}
      variants={reduced ? stillMotion : cardMotion}
    >
      <div className={styles.cardBody}>
        <h3 className={styles.name}>{type.name}</h3>

        {/* The four facts, fixed order. Concrete, with units, separated by a
            middle dot — the arrival's own shape for a qualifying caption. */}
        <p className={styles.facts}>
          Sleeps {type.maxOccupancy}
          {type.takesExtraBed ? " · extra bed available" : ""}
        </p>
        <p className={styles.facts}>{type.bedding}</p>
        <p className={styles.facts}>
          {type.squareMetres} m² · {type.aspect}
        </p>

        <button
          aria-controls={amenitiesId}
          aria-expanded={isOpen}
          className={`${styles.disclosure} caps-label`}
          onClick={() => setOpen((open) => !open)}
          type="button"
        >
          What&rsquo;s in the room {isOpen ? "▴" : "▾"}
        </button>

        {/* Expands in place on grid-template-rows rather than on height, so the
            list is never measured and the card never jumps a frame late. */}
        <div
          className={`${styles.amenitiesWrap}${isOpen ? ` ${styles.amenitiesOpen}` : ""}`}
          id={amenitiesId}
        >
          <ul className={styles.amenities}>
            {ROOM_AMENITIES.map((amenity) => (
              <li key={amenity}>{amenity}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className={styles.priceColumn}>
        <AnimatePresence initial={false} mode="wait">
          <m.div
            className={styles.priceBlock}
            // Keyed on everything that can re-price it, so a plan change
            // crossfades the block rather than mutating digits in place.
            key={`${offer?.stayTotalGross ?? "none"}-${fit.fits}-${hasDates}`}
            variants={reduced ? stillMotion : priceMotion}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            {renderPrice()}
          </m.div>
        </AnimatePresence>

        {/* The extra bed is a service item, never a rate modifier —
            property-and-tariff.md §1 is explicit. So it is its own line with its
            own price, and it does not touch the room's rate above it.

            Only on a card that can actually be chosen: offering to add a bed to a
            room that is not free for these dates, or that does not sleep the party,
            is offering to configure something unbuyable. */}
        {canChoose && offer?.extraBedPerNightGross ? (
          <label className={styles.extraBed}>
            <input
              checked={wantsExtraBed}
              disabled={!extraBedNeeded}
              onChange={(event) => setWantsExtraBed(event.target.checked)}
              type="checkbox"
            />
            <span>
              Extra bed,{" "}
              <Money amount={roundVndForDisplay(offer.extraBedPerNightGross)} />{" "}
              a night
              {extraBedNeeded ? "" : " — your party fits the beds in the room"}
            </span>
          </label>
        ) : null}

        <button
          aria-describedby={canChoose ? noteId : undefined}
          className={styles.choose}
          disabled={!canChoose}
          onClick={onChoose}
          type="button"
        >
          {isChosen ? "Chosen" : "Choose"}
        </button>

        {/* There is no hold on this screen, so there is no clock — and the screen
            says what choosing does rather than showing a countdown for something
            that has not started. Same string as the button's description, because
            a sighted guest and a screen-reader guest should read one sentence. */}
        {canChoose ? (
          <p className={styles.chooseNote} id={noteId}>
            Choosing a room holds it while you finish. Nothing is charged yet.
          </p>
        ) : null}
      </div>
    </m.li>
  );

  function renderPrice() {
    // Limehome's refusal, and the honest one: no price at all until dates exist.
    // A "from" figure that turns out to be a Tuesday in February is the thing
    // being avoided.
    if (!hasDates) {
      return (
        <p className={styles.priceAbsent}>Choose your dates for prices.</p>
      );
    }

    // Occupancy is a fit test, not a filter. The card holds its position.
    if (!fit.fits) {
      return <p className={styles.priceAbsent}>{fit.reason}</p>;
    }

    if (!offer?.isAvailable) {
      return <p className={styles.priceAbsent}>Not free for these dates.</p>;
    }

    // Whether the two figures on the card multiply, **as printed**.
    //
    // The test has to be on the rounded values, because that is what the guest can
    // check. Two causes make them disagree and both are legitimate: Friday and
    // Saturday nights price as weekend, so a per-night figure over an uneven stay
    // is an average; and display rounding to the nearest thousand moves each line
    // independently. A two-night Deluxe crossing a Saturday is 3.062.500 + 2.450.000
    // — printed as 5.513.000 total against 2.756.000 a night, and 2.756.000 × 2 is
    // 5.512.000. Nothing is wrong, and a guest who multiplies is still right to
    // distrust a page that does not say so. One word fixes it.
    //
    // Comparing the un-rounded values instead would report these as equal — the
    // average times the nights *is* the total by construction — and say nothing.
    const printedPerNight = roundVndForDisplay(offer.perNightGross);
    const printedTotal = roundVndForDisplay(offer.stayTotalGross);
    const printedFiguresMultiply =
      printedPerNight * BigInt(nights) === printedTotal;
    const guests = party.adults + party.children.length;

    return (
      <>
        {/* The total leads: it is the figure that settles, and the per-night line
            below it is the qualifier. A headline states, a caption qualifies. */}
        <p className={styles.total}>
          <Money amount={printedTotal} />
        </p>
        <p className={styles.perNight}>
          <Money amount={printedPerNight} /> a night
          {printedFiguresMultiply ? "" : " on average"}
        </p>
        {/* The multiplier spelled out. This is the whole answer to a late-revealed
            fee: there is nothing left to reveal. */}
        <p className={styles.multiplier}>
          {nights === 1 ? "1 night" : `${nights} nights`} ·{" "}
          {guests === 1 ? "1 guest" : `${guests} guests`}
        </p>
        <p className={styles.grossNote}>Includes VAT and service.</p>
      </>
    );
  }
}
