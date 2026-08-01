"use client";

// The room, as the ground of the whole window.
//
// **This is the photograph promoted out of a column.** It used to be the top
// band of a plate in the right-hand 68% of the screen — a picture of a room
// inside a box beside a list. The room is the screen now: the picture runs edge
// to edge behind everything, and the list, the room's facts and its price are
// plates laid on it. Nothing else changed about what a guest can do; what
// changed is that the thing they are choosing is the size of the thing they are
// choosing it with.
//
// It is the same move the dates step already makes — `booking-hero.tsx` stands
// the step's head on a photograph of the property and lays the calendar over its
// bottom edge — so the two steps are now one composition seen twice, rather than
// a picture on one and a page on the other.
//
// **The gallery lives here rather than on the stage, because the frames are the
// ground.** The stage is the two plates at the foot; walking to the next
// photograph changes what is behind them, not what is in them.
//
// What is deliberately not here:
//
// - **No expand-to-fullscreen control.** The photograph *is* fullscreen. A
//   lightbox over it would be the dialog this whole composition deletes, and
//   `check-booking-screen.mjs` asserts none exists.
// - **No caption.** The frame's description is its `alt`, which is what it is
//   for; printing it would be words spent saying what the picture is already
//   saying at the size of the window.

import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { useState } from "react";
import { preload } from "react-dom";
import {
  frameMotion,
  stillMotion,
} from "@/features/booking/lib/booking-motion";
import {
  type RoomFrame,
  roomGallery,
  tierSrcSet,
} from "@/features/booking/lib/room-images";
import type { RoomType } from "@/features/booking/lib/room-types";
import styles from "./room-ground.module.css";

/**
 * Layout width of the frame, for the browser's tier choice.
 *
 * The picture is the window at every width now — it is behind the plates rather
 * than beside them — so this is the one case where the 100vw default is also the
 * true answer. Stated anyway, because a default that happens to be right is a
 * default that stops being right the first time the composition moves.
 */
const FRAME_SIZES = "100vw";

/**
 * The frames of one room, walked one at a time, under everything else.
 *
 * **One frame in the DOM, and the next one preloaded.** Mounting all six and
 * cross-fading between them with CSS would be simpler and would cost the guest
 * six full-window photographs of a room they may not choose. `preload` from
 * `react-dom` puts a `<link rel=preload>` in the head for the one frame the
 * guest can reach next, so the step forward is instant and nothing is fetched
 * for the five steps they did not take.
 *
 * The counter is honest about the set: `roomGallery` never returns one frame —
 * `room-images.spec.ts` asserts it — so there is no state in which this draws
 * "1 / 1" over a pair of arrows that go nowhere.
 */
export function RoomGround({ type }: { readonly type: RoomType }) {
  const reduced = useReducedMotion();

  // **The gallery resets here rather than being remounted from above, and that
  // is the whole reason changing rooms now dissolves.**
  //
  // `booking-screen.tsx` used to key this component on the room, which reset the
  // walk correctly and destroyed the dissolve doing it: a remount takes the
  // outgoing photograph out of the DOM in the same frame the incoming one enters,
  // and `AnimatePresence` cannot cross-fade against an element that is already
  // gone. What a guest saw was the largest thing on the screen cutting — and, on
  // a frame the browser had not decoded yet, cutting to `--night` first. The list
  // they picked from faded; the room itself did not.
  //
  // So the component stays mounted for the life of the step and the *frame* is
  // what changes, which is the case the dissolve below was written for. The walk
  // still has to go back to the room's lead when the room changes, and this is
  // the state-adjusted-during-render pattern rather than an effect: an effect
  // would paint the previous room's fifth frame for one frame before correcting
  // itself, which is the flash this whole change exists to remove.
  const [walked, setWalked] = useState(type.code);
  const [at, setAt] = useState(0);

  if (walked !== type.code) {
    setWalked(type.code);
    setAt(0);
  }

  const frames: readonly RoomFrame[] = roomGallery(type.code);
  // Read through `walked` rather than trusting `at` on the render that resets
  // it: React re-renders immediately without painting, but this render still
  // runs to completion, and the previous room's index may not exist in this
  // room's set. `frames[undefined]` is how that would surface.
  const index = walked === type.code ? at : 0;
  const frame = frames[index];

  // Both neighbours, because the guest can go either way and the wrap makes the
  // last frame a neighbour of the first.
  for (const step of [1, -1]) {
    const next = frames[(index + step + frames.length) % frames.length];
    preload(next.src, {
      as: "image",
      imageSrcSet: tierSrcSet(next),
      imageSizes: FRAME_SIZES,
    });
  }

  const step = (by: number) =>
    setAt((from) => (from + by + frames.length) % frames.length);

  return (
    <div className={styles.ground} data-room-ground={type.code}>
      {/* Opacity alone. A photograph that slides is a slideshow, and a slideshow
          of a hotel room is marketing; a photograph that dissolves is the same
          room, looked at again.

          Both ways of changing the picture come through here — walking the
          frames of one room, and picking a different room in the list — because
          both are the same key changing on the same element. That is what the
          reset above buys: one dissolve, not a dissolve and a cut.

          `initial={false}` is still the first paint only. A guest arriving on a
          link gets the room immediately; every change after it fades. */}
      <AnimatePresence initial={false}>
        <m.img
          alt={frame.alt}
          animate="animate"
          className={styles.photo}
          decoding="async"
          exit="exit"
          height={frame.height}
          initial="initial"
          key={frame.src}
          sizes={FRAME_SIZES}
          src={frame.src}
          srcSet={tierSrcSet(frame)}
          variants={reduced ? stillMotion : frameMotion}
          width={frame.width}
        />
      </AnimatePresence>

      {/* Two washes, and neither is decoration. The top one is what the bar
          stands on — ivory type over an unknown photograph is a contrast bet,
          and the one pixel that loses it is a wordmark nobody can read. The
          bottom one seats the counter in the corner. Between them the picture
          keeps its own light, which is the whole reason it is the ground. */}
      <div aria-hidden="true" className={styles.scrim} />

      {/* `data-room-walk` is the peek's whole trigger, and it is a data
          attribute rather than a class because the rule that reads it lives in
          another stylesheet: `booking-screen.module.css` owns the plates that
          fade, this file owns the control they fade for, and a CSS-module class
          name is hashed and unreachable across that seam. Reaching for the
          photograph is answered by giving the photograph — see the note there
          for why it is `:has()` and not React state. */}
      <div className={styles.walk} data-room-walk>
        {/* The count is the picture's own, so it is `aria-hidden` and the two
            buttons carry the position in their names instead — "Previous
            photograph, 2 of 6" is one thing to hear rather than three. */}
        <p aria-hidden="true" className={styles.count} data-frame-count>
          {index + 1} / {frames.length}
        </p>

        <button
          aria-label={`Previous photograph, ${index + 1} of ${frames.length}`}
          className={styles.walkButton}
          data-frame-back
          onClick={() => step(-1)}
          type="button"
        >
          <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
            <path
              d="M14.5 6 8.5 12l6 6"
              stroke="currentColor"
              strokeWidth="1.25"
            />
          </svg>
        </button>

        <button
          aria-label={`Next photograph, ${index + 1} of ${frames.length}`}
          className={styles.walkButton}
          data-frame-next
          onClick={() => step(1)}
          type="button"
        >
          <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
            <path d="M9.5 6l6 6-6 6" stroke="currentColor" strokeWidth="1.25" />
          </svg>
        </button>
      </div>
    </div>
  );
}
