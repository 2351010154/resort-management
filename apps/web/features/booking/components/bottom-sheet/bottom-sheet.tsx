"use client";

// A full-height panel from the bottom edge — the room sheet's narrow
// presentation.
//
// It used to carry the search band's three collapsed segments as well. It no
// longer does: the screen asks "when" as a whole view now, so at 375 the
// calendar *is* the page and there is nothing left to put in a sheet. What
// survives is this — looking closer at one room, which is a detour from the
// list rather than a view of its own.
//
// This is the component Motion is in the funnel *for*. It has to animate out, and
// CSS has no exit — a dismissed element with a transition is either still mounted
// or already gone. `motion-tokens.ts` named `EASE_UI_EXIT` for exactly this and
// then had to admit "GSAP only — nothing exits under CSS yet". `AnimatePresence`
// is what lets the sheet leave on the accelerating curve instead of crawling out
// on an ease-out, which on a closing panel reads as a snag right at the end.
//
// Under reduced motion it does not translate at all: §9's rule that the reduced
// path is its own composition. The global CSS kill-switch does not reach Motion,
// so without this branch the sheet would still travel a full viewport height.

import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useId, useRef } from "react";
import {
  scrimMotion,
  sheetMotion,
  stillMotion,
} from "@/features/booking/lib/booking-motion";
import styles from "./bottom-sheet.module.css";

export function BottomSheet({
  isOpen,
  title,
  onClose,
  children,
}: {
  readonly isOpen: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const reduced = useReducedMotion();
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Focus goes into it on open and **back to whatever opened it** on close. Not
  // a full focus trap: the page behind is inert to the pointer via the scrim,
  // and a trap that a guest cannot tab out of is worse than one they can when
  // the sheet is the only thing on screen at this width anyway. But the return
  // is not optional — without it a keyboard guest who closes the sheet is
  // dropped at the top of the document, having lost the card they were reading.
  //
  // Keyed on `isOpen` alone. The keydown listener below is a separate effect
  // because it depends on `onClose`, which is a new function on every render of
  // the screen above: folding the two together would re-run this one constantly,
  // pulling focus back into the panel and handing it out again on each render.
  useEffect(() => {
    if (!isOpen) return;

    const opener = document.activeElement;
    panel.current?.focus();

    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen ? (
        <div className={styles.layer}>
          <m.button
            aria-label="Close"
            className={styles.scrim}
            onClick={onClose}
            type="button"
            variants={reduced ? stillMotion : scrimMotion}
            initial="initial"
            animate="animate"
            exit="exit"
          />

          <m.div
            aria-labelledby={titleId}
            aria-modal="true"
            className={styles.sheet}
            ref={panel}
            role="dialog"
            tabIndex={-1}
            variants={reduced ? stillMotion : sheetMotion}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <header className={styles.head}>
              <h2 className={`${styles.title} caps-label`} id={titleId}>
                {title}
              </h2>
              <button className={styles.done} onClick={onClose} type="button">
                Done
              </button>
            </header>

            <div className={styles.body}>{children}</div>
          </m.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
