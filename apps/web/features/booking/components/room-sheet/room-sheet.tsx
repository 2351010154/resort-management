"use client";

// Look closer. The tap the card's twelve words are paid for with.
//
// **The division is the rule, not a convenience: nothing that differs between
// the five types is behind this tap.** Everything here is either identical
// across all five — the amenities, the plan's terms — or a *detail* of a
// difference the card already showed: the dots say the room takes an extra bed,
// this says what it costs; the aspect word says "corner", this says "corner, two
// aspects". A guest who never opens this has still seen every difference.
//
// That is what makes twelve words on the card defensible rather than merely
// short. It is also the thing this component will be under constant pressure to
// break: every fact that "might be useful" will want to live here. The contents
// are the six sections below. A seventh needs a reason written down.
//
// Two presentations, one component. Wide: a centred dialog, focus trapped,
// `Escape` closes and focus returns to the photograph that opened it. Narrow:
// the existing `BottomSheet`, which already carries the sheet and scrim exits
// and their reduced-motion variants. Same contents, same order, so there is one
// mental model rather than a desktop version and a mobile one.

import {
  type RatePlanCode,
  type RoomTypeOffer,
  roundVndForDisplay,
} from "@mariva/shared";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useId, useRef } from "react";
import {
  dialogMotion,
  scrimMotion,
  stillMotion,
} from "@/features/booking/lib/booking-motion";
import { planName, planTerm } from "@/features/booking/lib/rate-plans";
import { roomImage, tierSrcSet } from "@/features/booking/lib/room-images";
import {
  ROOM_AMENITIES,
  type RoomType,
} from "@/features/booking/lib/room-types";
import {
  useViewportMatch,
  WIDE_VIEWPORT,
} from "@/features/booking/lib/use-viewport-match";
import { BottomSheet } from "../bottom-sheet/bottom-sheet";
import { Money } from "../money";
import styles from "./room-sheet.module.css";

/** The gallery is the card's frame again, one step wider. */
const GALLERY_SIZES = "(min-width: 45rem) 55rem, 100vw";

export function RoomSheet({
  type,
  offer,
  plan,
  isOpen,
  isChosen,
  onChoose,
  onClose,
}: {
  /** The room being looked at. Held through the close so the sheet can leave. */
  readonly type: RoomType | null;
  readonly offer: RoomTypeOffer | null;
  readonly plan: RatePlanCode;
  readonly isOpen: boolean;
  readonly isChosen: boolean;
  readonly onChoose: () => void;
  readonly onClose: () => void;
}) {
  const isWide = useViewportMatch(WIDE_VIEWPORT);
  if (!type || !offer) return null;

  const image = roomImage(type.code);

  const body = (
    <div className={styles.body}>
      {/* The frame the guest tapped is the frame they land on. No counter and no
          carousel control, because there is one photograph — a one-slide
          carousel reading "1 / 1" is a control that reads as broken. When the
          real shoot brings more than one frame per room, the counter arrives
          with them and says `2 / 5` honestly. The design degrades here; it does
          not fail, because the measure line on the card carried the difference
          on its own. */}
      <div className={styles.gallery}>
        <img
          alt={image.alt}
          className={styles.photo}
          decoding="async"
          height={image.height}
          sizes={GALLERY_SIZES}
          src={image.src}
          srcSet={tierSrcSet(image)}
          width={image.width}
        />
      </div>

      <dl className={styles.facts}>
        {/* The fact Limehome gets right: a bed with a dimension on it. "One king
            bed" is a category; "one king bed (1.80 m)" is something a guest can
            picture themselves in. */}
        <div className={styles.fact}>
          <dt className={`${styles.factTerm} caps-label`}>The bed</dt>
          <dd className={styles.factValue}>{type.bedding}</dd>
        </div>

        <div className={styles.fact}>
          <dt className={`${styles.factTerm} caps-label`}>What it faces</dt>
          <dd className={styles.factValue}>{type.aspect}</dd>
        </div>

        <div className={styles.fact}>
          <dt className={`${styles.factTerm} caps-label`}>The room</dt>
          <dd className={styles.factValue}>
            {type.squareMetres} m² · sleeps {type.maxOccupancy}
          </dd>
        </div>

        {/* The extra bed, stated here and controlled at `/details`. It posts as a
            **service item, never a rate modifier** — `property-and-tariff.md` §1
            is explicit — so it is its own line with its own price and it does not
            touch the room's rate. The card's open dot said the room allows one;
            this says what it costs. */}
        {offer.extraBedPerNightGross === null ? null : (
          <div className={styles.fact}>
            <dt className={`${styles.factTerm} caps-label`}>An extra bed</dt>
            <dd className={styles.factValue}>
              <Money amount={roundVndForDisplay(offer.extraBedPerNightGross)} />{" "}
              a night, added as a service rather than to the room rate. Asked
              for at the next step.
            </dd>
          </div>
        )}
      </dl>

      <div className={styles.amenities}>
        {ROOM_AMENITIES.map((group) => (
          <div className={styles.amenityGroup} key={group.subject}>
            <h3 className={`${styles.factTerm} caps-label`}>{group.subject}</h3>
            <ul className={styles.amenityList}>
              {group.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <p className={styles.terms}>
        {planName(plan)}. {planTerm(plan)}
      </p>

      {/* The same action as the card's. A guest who came here to look closer
          should not have to close the sheet and hunt for the button they already
          passed. */}
      <button className={styles.choose} onClick={onChoose} type="button">
        {isChosen ? "Chosen" : "Choose"} {type.name}
      </button>
    </div>
  );

  if (isWide) {
    return (
      // The presence boundary lives here rather than in the screen, so the
      // dialog's contents survive the close and it has something to fade out.
      <AnimatePresence>
        {isOpen ? (
          <WideDialog key="room-dialog" onClose={onClose} title={type.name}>
            {body}
          </WideDialog>
        ) : null}
      </AnimatePresence>
    );
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={type.name}>
      {body}
    </BottomSheet>
  );
}

/**
 * The wide presentation: a centred dialog over a scrim.
 *
 * A real focus trap, unlike `BottomSheet`'s. The sheet is the only thing on
 * screen at its width and the page behind it is unreachable by pointer anyway;
 * a dialog at 1440 sits in the middle of a page the guest can still see, so
 * tabbing out of it and landing on a room card behind the scrim is a guest lost
 * inside their own screen.
 *
 * `Escape` closes, and **focus goes back to the photograph that opened it** —
 * not to the top of the document, which is where a browser sends it when the
 * element that had focus is unmounted. That is the part of a dialog that is
 * always tested last and is the only part a keyboard guest feels.
 */
function WideDialog({
  title,
  onClose,
  children,
}: {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const reduced = useReducedMotion();
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Focus in on mount, and back to the opener on unmount. Its own effect with an
  // empty dependency list, because the keydown effect below depends on
  // `onClose` — a new function on every render of the screen above — and folding
  // the two together would hand focus out and pull it back in on each one.
  useEffect(() => {
    const opener = document.activeElement;
    panel.current?.focus();

    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panel.current) return;

      const focusable = panel.current.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || active === panel.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className={styles.layer}>
      <m.button
        animate="animate"
        aria-label="Close"
        className={styles.scrim}
        exit="exit"
        initial="initial"
        onClick={onClose}
        type="button"
        variants={reduced ? stillMotion : scrimMotion}
      />

      <m.div
        animate="animate"
        aria-labelledby={titleId}
        aria-modal="true"
        className={styles.dialog}
        exit="exit"
        initial="initial"
        ref={panel}
        role="dialog"
        tabIndex={-1}
        variants={reduced ? stillMotion : dialogMotion}
      >
        <header className={styles.head}>
          <h2 className={styles.title} id={titleId}>
            {title}
          </h2>
          <button className={styles.done} onClick={onClose} type="button">
            Close
          </button>
        </header>

        {children}
      </m.div>
    </div>
  );
}
