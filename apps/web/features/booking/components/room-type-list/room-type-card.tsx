"use client";

// One room type: a photograph, a name, one drawn line, two prices, one action.
//
// Round 1's card rendered a heading, three sentences, a disclosure, a checkbox
// and a four-line price block — 42 to 64 words, and **no image anywhere**. It
// copied Limehome, whose own room photographs are 100×100 placeholders under a
// printed disclaimer, so what it inherited was five near-identical blocks of
// text. A guest choosing between five rooms is choosing between five rooms, and
// the thing that tells five rooms apart is a picture of them.
//
// So this card is a photograph with eleven or twelve words under it. Everything
// removed has a destination: bedding, amenities and the extra bed moved one tap
// deeper into the room sheet; the tax note, the hold sentence and the
// nights-and-guests line moved up to the view, where they are said once instead
// of five times.
//
// **Nothing that differs between the five types is behind the tap.** That is the
// rule that makes twelve words defensible rather than merely short.
//
// What is still not here, deliberately:
//
// - **No rooms-remaining count, no struck-through price, no "was", no
//   percentage saved.** `design-foundations.md` §6 forbids scarcity and false
//   discount outright.
// - **No motion on the photograph** — no hover zoom, no Ken Burns. A `transform`
//   on a `cover` image re-rasterises its layer every frame, and a moving
//   photograph of a hotel room is marketing.
// - **No heading element.** The list is a `<ul>` and each card an `<li>`, which
//   is the structure a screen reader announces with a count; an `<h3>` wrapping
//   the photo button would fold the picture's description into the heading text,
//   and an `<h3>` beside it would name the room twice in a row.
//
// The card is only ever rendered for a type that is free for the range and fits
// the party. A type that is neither keeps its place in the list as one demoted
// line — see `demoted-rows.tsx`. A full-height card with a dead primary action
// reads as broken whichever reason produced it.

import { type RoomTypeOffer, roundVndForDisplay } from "@mariva/shared";
import { m, useReducedMotion } from "motion/react";
import { cardMotion, stillMotion } from "@/features/booking/lib/booking-motion";
import { roomImage, tierSrcSet } from "@/features/booking/lib/room-images";
import type { RoomType } from "@/features/booking/lib/room-types";
import { Money } from "../money";
import { MeasureLine } from "./measure-line";
import styles from "./room-type-list.module.css";

/**
 * Layout width of one frame, for the browser's tier choice.
 *
 * Two-up inside the screen's 64rem measure above 45rem, one-up below it. Stated
 * as `sizes` rather than left to the browser's 100vw default, which would fetch
 * a 1920 tier for a 500px box on every card.
 */
const FRAME_SIZES = "(min-width: 45rem) 31rem, 100vw";

export function RoomTypeCard({
  type,
  offer,
  nights,
  sizeFill,
  holdNoteId,
  isChosen,
  onChoose,
  onLookCloser,
}: {
  readonly type: RoomType;
  readonly offer: RoomTypeOffer;
  /** Nights of the stay — the multiplier the two printed figures must agree on. */
  readonly nights: number;
  /** Percentage of the size track — normalised over the rendered set. */
  readonly sizeFill: number;
  /** The hold sentence, written once above the grid and pointed at from here. */
  readonly holdNoteId: string;
  readonly isChosen: boolean;
  readonly onChoose: () => void;
  readonly onLookCloser: () => void;
}) {
  const reduced = useReducedMotion();
  const image = roomImage(type.code);

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

  return (
    <m.li
      className={`${styles.card}${isChosen ? ` ${styles.cardChosen}` : ""}`}
      data-room-card={type.code}
      variants={reduced ? stillMotion : cardMotion}
    >
      {/* The photograph and the name are one button, and it opens the room
          sheet. Look closer, and take it: two jobs, two controls, and the larger
          of the two is the one that costs the guest nothing. */}
      <button className={styles.look} onClick={onLookCloser} type="button">
        <span className={styles.frame} data-frame>
          <img
            alt={image.alt}
            className={styles.photo}
            decoding="async"
            height={image.height}
            loading="lazy"
            sizes={FRAME_SIZES}
            src={image.src}
            srcSet={tierSrcSet(image)}
            width={image.width}
          />
        </span>
        <span className={styles.name}>{type.name}</span>
      </button>

      <MeasureLine sizeFill={sizeFill} type={type} />

      {/* Two lines. The total leads because it is the figure that settles, and
          the per-night line under it qualifies it — a headline states, a caption
          qualifies. The multiplier and the tax note used to live here, five
          times over; they are said once, in the view's date summary. */}
      <p className={styles.total}>
        <Money amount={printedTotal} />
      </p>
      <p className={styles.perNight}>
        <Money amount={printedPerNight} /> a night
        {printedFiguresMultiply ? "" : " on average"}
      </p>

      {/* The one primary action, and the one description — the hold sentence is
          rendered once above the grid and every Choose button on the screen
          points at that same string. */}
      <button
        aria-describedby={holdNoteId}
        className={styles.choose}
        data-choose
        onClick={onChoose}
        type="button"
      >
        {isChosen ? "Chosen" : "Choose"}
      </button>
    </m.li>
  );
}
