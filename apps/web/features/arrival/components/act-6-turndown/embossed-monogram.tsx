"use client";

// The MA monogram, embossed into the dark stone panel — the bookend of Act 1's
// coalesced monogram. Podium's slowly-rotating footer rock, translated to a
// subtle CSS-3D tilt scrubbed across the footer's entry (no WebGL down here:
// both canvases are far offscreen by now and must stay asleep).

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useRef, type RefObject } from "react";
import { prefersReducedMotion } from "@/features/arrival/lib/webgl-support";
import { SCRUB_DRIFT } from "@/lib/motion-tokens";
import styles from "./act-6-turndown.module.css";

export type EmbossIntensity = "soft" | "deep";

export function EmbossedMonogram({
  intensity,
  triggerRef,
}: {
  intensity: EmbossIntensity;
  triggerRef: RefObject<HTMLElement | null>;
}) {
  const embossRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const emboss = embossRef.current;
    const trigger = triggerRef.current;
    if (!emboss || !trigger || prefersReducedMotion()) return;
    gsap.registerPlugin(ScrollTrigger);

    const ctx = gsap.context(() => {
      // ±6° across the footer's rise into view. Linear, and on the drift lag:
      // the mark is pressed into the stone rather than laid against an edge, so
      // it may trail the page and go on turning after the reader has stopped —
      // which is what makes the tilt read as weight rather than as a slider.
      gsap.fromTo(
        emboss,
        { rotateX: 6, rotateY: -5 },
        {
          rotateX: -6,
          rotateY: 5,
          ease: "none",
          scrollTrigger: {
            trigger,
            start: "top bottom",
            end: "bottom bottom",
            scrub: SCRUB_DRIFT,
          },
        },
      );
    }, emboss);
    return () => ctx.revert();
  }, [triggerRef]);

  return (
    <div className={styles.embossWrap}>
      <div
        ref={embossRef}
        className={styles.emboss}
        data-intensity={intensity}
        role="img"
        aria-label="Mariva monogram"
      >
        <span className={styles.embossShadow} />
        <span className={styles.embossLight} />
        <span className={styles.embossFace} />
      </div>
    </div>
  );
}
