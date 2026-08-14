"use client";

// What the property says about the room on the ground, and what it costs.
//
// **The stage stopped being a column and became two plates.** It held the
// photograph, a card straddling its bottom edge and a foot under both, all
// inside the right-hand 68% of the screen. The photograph is the whole window
// now — `room-ground.tsx` — so what is left here is the reading laid on it: a
// wide plate stating the room, and a smaller one beside its bottom edge stating
// the total and offering the one way forward.
//
// **Two plates rather than one, because they are two different kinds of
// sentence.** The first is what is true of the room whether or not the guest
// takes it. The second is what they would be agreeing to. Printing the figure
// inside the same box as the bed size makes the price one more fact about the
// room; giving it its own plate makes it the thing being decided.
//
// **The two plates are separated, not overlapped**, and the separation is the
// composition's own seam rather than a margin. An earlier cut lifted the price
// over the first plate's bottom-right corner; what shipped was neither — the two
// abutted exactly, edge on edge, which reads as one plate with a rule through it
// and loses the distinction the paragraph above is making. A stated gap says
// they are two statements. The room's plate ends, and what it would cost begins.
//
// **The division of prices is the one the funnel has always drawn.** The list
// compares per night, five figures at the same x. This states the total, once,
// in full, beside the button that acts on it. Neither number is on a photograph.
//
// **The plate says what the room is, and it says it without being asked.**
//
// It did not. The facts were a strip of two or three unlabelled glyphs behind a
// `View detail` disclosure, there was no description and no amenity list, and
// what that produced was the widest plate on the screen holding a name, one
// cancellation clause and a hand's width of empty ivory — a box that looked like
// it had failed to load. The disclosure was defensible on its own terms and it
// was answering the wrong question: the plate was not too dense, it was empty.
//
// So the press is gone and the plate is a plate. Two columns, and the division
// is what each half is *for*:
//
// - **Left: what this room is.** The kicker, the name, the two sentences the
//   property says about it, and the plan's terms. It reads top to bottom as one
//   paragraph about one room.
// - **Right: what is true of it.** Four facts, open, each a glyph beside a value
//   and the word for what the value is. Then a rule, and under it the twelve
//   lines that are in every room.
//
// **Both of the things this file used to refuse are now sourced rather than
// written.** `design-foundations.md` §6 forbids a *component* inventing a hotel
// fact — not the property stating one. `property-and-tariff.md` §1 now carries
// the descriptions and the amenity list, ⚑ like everything else in §1–§6, and
// `room-types.ts` is the one place the code reads them from. The old objection
// to the amenity list was about register, and the stylesheet answers it: no
// heading, no glyphs, no ticks, the smallest weight on the plate. It answers
// "what is in the room" and does not pretend to be what makes this room worth
// choosing — the four facts above it are that, and the list beside the plate is
// where the five are compared.
//
// **Occupancy is the fourth fact, and it is the one the strip never had.** "Whom
// does it sleep" is the first question asked of a hotel room and it was the one
// fact on the row in the list that this plate did not repeat.
//
// **No dialog, still.** Everything is in the plate, in flow, with the photograph
// behind it. The thing this composition was built to delete was a scrimmed box
// over the room, and `check-booking-screen.mjs` asserts none exists.
//
// **There is a details control, and it hides nothing.** That is not a
// contradiction of the paragraphs above, it is the shape they argued for: the
// plate keeps every fact open, and the control is a way *to* them rather than a
// way to reveal them. It takes the guest's focus to the facts column — the same
// four facts and twelve lines that were already on screen before it was pressed
// — so a keyboard reaching the plate has one step to what it came for instead of
// tabbing past the prose. Nothing appears, nothing disappears, and there is no
// state to be in: press it twice and the screen is identical both times.
//
// The distinction it must never lose is `data-stage-detail`, which the old
// disclosure carried and which `check-booking-screen.mjs` still asserts is
// absent. A control that hid something would take that attribute back.

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
              <path d="M6 3.5 10.5 8 6 12.5" />
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

          {/* What is in every room. The plainest thing on the plate on purpose —
              see `room-types.ts` for why the list came back and why it is set
              like this rather than as a feature grid. `ul` with no marker: the
              rule above it and the three columns are what say it is a list. */}
          <ul className={styles.amenities}>
            {ROOM_AMENITIES.map((item) => (
              <li className={styles.amenity} key={item}>
                {item}
              </li>
            ))}
          </ul>
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
