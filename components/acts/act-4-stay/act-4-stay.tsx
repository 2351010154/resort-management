"use client";

// Act 4 — "Stay". Three movements on the one vertical scrollbar: a dark
// horizontal corridor of promises, an arch that opens onto daylight, and a
// receding deck of rooms that runs a single day from waking to lights out.
//
// The act is one `[data-act]` section so the tracker and the nav see a single
// chapter; each movement owns its own pin and scrub inside it. Nothing here
// captures wheel or touch — every horizontal move is scrub-driven.

import { useEffect, useState } from "react";
import { prefersReducedMotion } from "@/lib/webgl-support";
import { CorridorStatic, CorridorTrack } from "./corridor-track";
import { RoomDeck, RoomDeckStatic } from "./room-deck";
import { ThresholdArches, ThresholdStatic } from "./threshold-arches";
import styles from "./act-4-stay.module.css";

const NARROW = "(max-width: 767px)";

export function Act4Stay() {
  // null until the client probe runs, so SSR and the first paint agree.
  const [animate, setAnimate] = useState<boolean | null>(null);
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    setAnimate(!prefersReducedMotion());
    const narrow = window.matchMedia(NARROW);
    const sync = () => setMobile(narrow.matches);
    sync();
    narrow.addEventListener("change", sync);
    return () => narrow.removeEventListener("change", sync);
  }, []);

  return (
    <section data-act={4} className={styles.act} aria-label="Stay">
      {animate === null ? null : animate ? (
        <>
          {/* Remounting on the breakpoint flip is deliberate: the movements
              build their pins from the layout they measured at mount. */}
          <CorridorTrack key={`corridor-${mobile}`} mobile={mobile} />
          <ThresholdArches key={`threshold-${mobile}`} mobile={mobile} />
          <RoomDeck key={`rooms-${mobile}`} mobile={mobile} />
        </>
      ) : (
        <>
          <CorridorStatic />
          <ThresholdStatic />
          <RoomDeckStatic />
        </>
      )}
    </section>
  );
}
