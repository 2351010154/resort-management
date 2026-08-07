"use client";

// Act 4 — "Stay". Two movements on one vertical scrollbar, the oryzo.ai /
// trionn.com mechanic: a dark horizontal corridor scrubs sideways to a bright
// statement screen, and that screen is what the experience field pins over and
// takes the frame from — four words at the largest type in the ride, shattered
// letter by letter, and the experiences arriving on two wheels around the
// sentence that takes their place.
//
// Each movement owns one pin and one scrub. Everything either of them draws is
// a function of its own section's progress — nothing here captures wheel or
// touch, and nothing runs on a clock. The hand-off between them is a contract
// the two movements hold jointly; see `FIELD_HANDOFF` in `experience-field.tsx`.

import { useEffect, useState } from "react";
import { prefersReducedMotion } from "@/features/arrival/lib/webgl-support";
import styles from "./act-4-stay.module.css";
import { CorridorStatic, CorridorTrack } from "./corridor-track";
import { ExperienceField, ExperienceFieldStatic } from "./experience-field";

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
        // Remounting on the breakpoint flip is deliberate: both movements
        // build their measurements — the corridor's panel widths, the field's
        // wheels and its cut letters — from the layout they measured at mount.
        <>
          <CorridorTrack key={`corridor-${mobile}`} mobile={mobile} />
          <ExperienceField key={`field-${mobile}`} mobile={mobile} />
        </>
      ) : (
        <>
          <CorridorStatic />
          <ExperienceFieldStatic />
        </>
      )}
    </section>
  );
}
