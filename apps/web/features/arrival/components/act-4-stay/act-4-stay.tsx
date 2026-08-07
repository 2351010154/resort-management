"use client";

// Act 4 — "Stay". Two movements on the one vertical scrollbar: a dark
// horizontal corridor of promises that ends by being covered by a bright
// statement screen, and two wheels of rooms turning against each other while
// the ground under them runs a single day from waking to lights out.
//
// The act is one `[data-act]` section so the tracker and the nav see a single
// chapter; each movement owns its own pin and scrub inside it. Nothing here
// captures wheel or touch — every horizontal move is scrub-driven.
//
// The corridor's pin is held open until the rooms' stage pins over it, so the
// two movements share one continuous ground and the statement panel gets its
// dwell out of that overlap rather than out of a held scrub.

import { useEffect, useState } from "react";
import { prefersReducedMotion } from "@/features/arrival/lib/webgl-support";
import styles from "./act-4-stay.module.css";
import { CorridorStatic, CorridorTrack } from "./corridor-track";
import { RoomOrbit, RoomOrbitStatic } from "./room-orbit";

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
          <RoomOrbit key={`rooms-${mobile}`} mobile={mobile} />
        </>
      ) : (
        <>
          <CorridorStatic />
          <RoomOrbitStatic />
        </>
      )}
    </section>
  );
}
