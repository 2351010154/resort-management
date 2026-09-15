"use client";

import { AnimatePresence, m, useReducedMotion } from "motion/react";

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

const FRAME_SIZES = "100vw";

export function RoomGround({
  type,
  index = 0,
  background = false,
  onStep,
}: {
  readonly type: RoomType;
  readonly index?: number;
  readonly background?: boolean;
  readonly onStep?: (by: number) => void;
}) {
  const reduced = useReducedMotion();

  const frames: readonly RoomFrame[] = roomGallery(type.code);
  const frame = frames[index];

  for (const step of background ? [] : [1, -1]) {
    const next = frames[(index + step + frames.length) % frames.length];
    preload(next.src, {
      as: "image",
      imageSrcSet: tierSrcSet(next),
      imageSizes: FRAME_SIZES,
    });
  }

  return (
    <div
      className={background ? styles.ground : styles.gallery}
      aria-hidden={background || undefined}
      data-room-ground={background ? type.code : undefined}
      data-room-gallery={background ? undefined : type.code}
    >
      <AnimatePresence initial={false}>
        <m.img
          alt={background ? "" : frame.alt}
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

      <div aria-hidden="true" className={styles.scrim} />

      {!background && (
        <>
          <div className={styles.caption}>
            <p className="caps-label">{type.name}</p>
            <p className={styles.aspect}>{type.aspect} view</p>
          </div>
          <div className={styles.walk} data-room-walk>
            <p aria-hidden="true" className={styles.count} data-frame-count>
              {String(index + 1).padStart(2, "0")} /{" "}
              {String(frames.length).padStart(2, "0")}
            </p>

            <button
              aria-label={`Previous photograph, ${index + 1} of ${frames.length}`}
              className={styles.walkButton}
              data-frame-back
              onClick={() => onStep?.(-1)}
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
              onClick={() => onStep?.(1)}
              type="button"
            >
              <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
                <path
                  d="M9.5 6l6 6-6 6"
                  stroke="currentColor"
                  strokeWidth="1.25"
                />
              </svg>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
