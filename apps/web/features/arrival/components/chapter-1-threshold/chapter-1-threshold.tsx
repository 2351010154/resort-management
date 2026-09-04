"use client";

// Chapter 1 — "The Threshold". The aperture at rest, opening on one exterior.
//
// The whole viewport is the plaster wall; the monogram is the hole in it; behind
// the hole is a single photograph of the house. Nothing else is on the plate —
// no orbiting field, no gobo, no depth cards — because the first screen has one
// job: say what this is, where it stands, and how to book it, and say all three
// without being scrolled.
//
// Static by construction. The lens still draws the wall (it is the only surface
// that can cut the mark at any size), but the camera it reads is parked at rest,
// so what the shader paints on the first frame is what it paints on the last. The
// scrubbed push belongs to phase 4; this chapter has to read with every scrub
// switched off, and it does because there are none.

import { PROPERTY_ADDRESS_LINES, CHECK_IN_TIME } from "@mariva/shared";
import { useEffect, useRef, useState } from "react";
import { ROOM_COUNT_IN_WORDS } from "@/features/arrival/content/house-facts";
import {
  draftHref,
  useArrivalDraft,
} from "@/features/arrival/lib/arrival-booking-draft";
import { arrivalImages } from "@/features/arrival/lib/image-manifest";
import { tierSrc, tierSrcSet } from "@/features/arrival/lib/image-srcset";
import { shouldRenderFilm } from "@/features/arrival/lib/webgl-support";
import { ApertureSheet } from "@/features/arrival/components/act-1-gathering/aperture-sheet";
import { MonogramLens } from "@/features/arrival/components/act-1-gathering/monogram-lens";
import type { IntroCamera } from "@/features/arrival/components/act-1-gathering/intro-camera-model";
import styles from "./chapter-1-threshold.module.css";

// One exterior, and an exterior it has to be: the mark opens on the house, not on
// a room inside it. The pavilion over still water is the only frame in the library
// that reads as a building seen whole in daylight.
const PLATE = arrivalImages["act-1-converge"].find((img) =>
  img.src.includes("pool-pavilion"),
)!;

/**
 * The camera, parked. `apertureMagnify(0)` is 1 and `sheetOpacity(0)` is 1, so
 * the mark is at its rest size in an opaque wall — the frame the act used to open
 * on, held. `reveal` starts at 0 only because the lens erodes the mark open once
 * its distance field is in hand; nothing moves it afterwards.
 */
const REST: IntroCamera = { progress: 0, z: 0, entry: 1, reveal: 1 };

/** Three facts, and the property file is the authority for all three:
 *  §1's room count, §1's address (via `@mariva/shared`) and §2's clock. */
const FACTS = [
  `${ROOM_COUNT_IN_WORDS} rooms`,
  PROPERTY_ADDRESS_LINES[0],
  `Check-in from ${CHECK_IN_TIME}`,
];

export function Chapter1Threshold() {
  // null until the client probe answers, so the server markup and the first
  // client paint agree on which surface draws the wall.
  const [film, setFilm] = useState<boolean | null>(null);
  // Empty on the first screen almost always, but a guest who filled the rail
  // and scrolled back up keeps what they typed.
  const draft = useArrivalDraft();
  // Both surfaces are drawn client-side and neither is instant — the lens waits
  // on its distance field, the sheet on the glyph. Until one of them is up there
  // is no wall, and the copy would be ink over an unmasked photograph.
  const [wall, setWall] = useState(false);
  const camera = useRef<IntroCamera>({ ...REST, reveal: 1 });

  useEffect(() => {
    const canFilm = shouldRenderFilm();
    // Only the lens can erode the mark open out of its dot; the flat sheet is
    // drawn once, already open.
    if (canFilm) camera.current.reveal = 0;
    setFilm(canFilm);
  }, []);

  return (
    <section data-act={1} className={styles.section}>
      <div className={styles.stage}>
        <img
          className={styles.plate}
          src={tierSrc(PLATE.src, 1920)}
          srcSet={tierSrcSet(PLATE)}
          sizes="100vw"
          width={PLATE.width}
          height={PLATE.height}
          alt={PLATE.alt}
          loading="eager"
          fetchPriority="high"
          decoding="async"
        />
        {/* The wall, before there is a wall. Held over the photograph so the
            first paint — server-rendered, and everything a reader without
            JavaScript ever sees — is the plaster the copy is set on rather than
            ink over an exterior. It is not opaque: the frame behind it stays
            faintly there, which is the same thing the plaster does. */}
        <div className={styles.veil} data-lifted={wall} aria-hidden />

        {film === null ? null : (
          <div className={styles.aperture}>
            {film ? (
              <MonogramLens
                camera={camera.current}
                onReady={() => {
                  camera.current.reveal = 1;
                  setWall(true);
                }}
              />
            ) : (
              <ApertureSheet onReady={() => setWall(true)} />
            )}
          </div>
        )}

        <div className={styles.copy}>
          <div className={styles.head}>
            <span className={`caps-label ${styles.place}`}>Nha Trang</span>
            <h1 className={`font-display ${styles.name}`}>Mariva</h1>
          </div>

          <div className={styles.foot}>
            <p className={`font-display ${styles.promise}`}>
              {ROOM_COUNT_IN_WORDS} rooms on the Trần&nbsp;Phú beachfront, over
              four guest floors in Nha Trang.
            </p>
            <div className={styles.facts}>
              <ul className={styles.factList}>
                {FACTS.map((fact) => (
                  <li key={fact} className={`caps-label ${styles.fact}`}>
                    {fact}
                  </li>
                ))}
              </ul>
              <a
                className={`caps-label ${styles.book}`}
                href={draftHref(draft)}
              >
                Book your stay
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
