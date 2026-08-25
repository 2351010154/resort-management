"use client";

// The room's frames, full-window, over the screen that asked for them.
//
// **Why this exists on a payment screen at all.** The review screen prints two
// photographs of the room and a count of how many there are; a guest who reads
// "6 photos" and cannot get at the other four has been shown a label rather than
// a control. The room step has the gallery and the way back to it is the
// `Change` link, but that link is a different promise — it goes back to the list
// to pick a *different* room, and a guest who only wanted a second look at the
// one they chose would have to find their way forward again.
//
// **A native `<dialog>`, opened with `showModal`.** The focus trap, the inert
// background, the Escape key and the top layer are all things the element does
// and a `<div role="dialog">` would have to be given — badly, and again on the
// next screen that wants one. What is left to write is the walk.
//
// **One frame in the DOM.** `room-ground.tsx` argues this at length for the
// booking step's ground and the argument carries: mounting six full-window
// photographs of one room costs a guest five downloads they did not ask for.
// Both neighbours are preloaded, so a press in either direction is instant.

import { preload } from "react-dom";
import { useEffect, useId, useRef, useState } from "react";
import type { RoomFrame } from "@/features/booking/lib/room-images";
import { tierSrcSet } from "@/features/booking/lib/room-images";
import styles from "./room-gallery.module.css";

/** What the frame is worth downloading at: the window, less the margin around it. */
const FRAME_SIZES = "min(92vw, 76rem)";

export function RoomGallery({
  frames,
  name,
  open,
  startAt = 0,
  onClose,
}: {
  readonly frames: readonly RoomFrame[];
  /** The room, for the dialog's own name and the caption under the walk. */
  readonly name: string;
  readonly open: boolean;
  /** Which frame the press was made from, so the walk opens where the eye was. */
  readonly startAt?: number;
  readonly onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const labelId = useId();
  const [at, setAt] = useState(startAt);

  // `showModal` and `close` are imperative and the element is the one holding
  // the state, so this is an effect rather than an attribute: `<dialog open>`
  // renders the element *non*-modally, which is the one thing this must not be.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) {
      return;
    }

    if (open && !dialog.open) {
      setAt(startAt);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, startAt]);

  const frame = frames[at] ?? frames[0];

  // Both neighbours, because the walk wraps and the guest may go either way.
  for (const step of [1, -1]) {
    const next = frames[(at + step + frames.length) % frames.length];
    if (next) {
      preload(next.src, {
        as: "image",
        imageSrcSet: tierSrcSet(next),
        imageSizes: FRAME_SIZES,
      });
    }
  }

  const step = (by: number) =>
    setAt((from) => (from + by + frames.length) % frames.length);

  return (
    // `onClose` catches every way the element can be dismissed — Escape, the
    // form method, `close()` — so the screen's own state cannot drift out of
    // step with whether the dialog is actually up.
    <dialog
      aria-labelledby={labelId}
      className={styles.dialog}
      onCancel={onClose}
      onClick={(event) => {
        // The backdrop is the dialog's own box outside the frame, so a press
        // that lands on the element itself rather than on anything inside it is
        // a press on the backdrop.
        if (event.target === ref.current) {
          onClose();
        }
      }}
      onClose={onClose}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") {
          step(1);
        } else if (event.key === "ArrowLeft") {
          step(-1);
        }
      }}
      ref={ref}
    >
      <div className={styles.frame}>
        <div className={styles.head}>
          <p className={styles.name} id={labelId}>
            {name}
          </p>
          <button
            aria-label="Close the photographs"
            className={styles.close}
            onClick={onClose}
            type="button"
          >
            <svg
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="1.25"
              viewBox="0 0 24 24"
            >
              <path d="M7 7l10 10M17 7L7 17" />
            </svg>
          </button>
        </div>

        <div className={styles.stage}>
          <img
            alt={frame.alt}
            className={styles.photo}
            decoding="async"
            height={frame.height}
            // Keyed on the source so a step is a new element and the dissolve
            // below has something to run on, rather than one element whose
            // `src` changes under a paint that has already happened.
            key={frame.src}
            sizes={FRAME_SIZES}
            src={frame.src}
            srcSet={tierSrcSet(frame)}
            width={frame.width}
          />
        </div>

        <div className={styles.walk}>
          <button
            aria-label={`Previous photograph, ${at + 1} of ${frames.length}`}
            className={styles.step}
            onClick={() => step(-1)}
            type="button"
          >
            <svg
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="1.25"
              viewBox="0 0 24 24"
            >
              <path d="M14.5 6l-6 6 6 6" />
            </svg>
          </button>

          {/* The count is the picture's own and the two buttons carry the
              position in their names, so a screen reader is told it once. */}
          <p aria-hidden="true" className={styles.count}>
            {pad(at + 1)} / {pad(frames.length)}
          </p>

          <button
            aria-label={`Next photograph, ${at + 1} of ${frames.length}`}
            className={styles.step}
            onClick={() => step(1)}
            type="button"
          >
            <svg
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="1.25"
              viewBox="0 0 24 24"
            >
              <path d="M9.5 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </div>
    </dialog>
  );
}

/** "01", "06" — the comp's own counter, and the review screen's overlay agrees. */
export function pad(value: number): string {
  return String(value).padStart(2, "0");
}
