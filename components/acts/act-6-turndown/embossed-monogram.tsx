"use client";

// The MA monogram, embossed into the dark stone panel — the bookend of Act 1's
// coalesced monogram. Podium's slowly-rotating footer rock, translated to a
// subtle CSS-3D tilt scrubbed across the footer's entry (no WebGL down here:
// both canvases are far offscreen by now and must stay asleep).

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useRef, type RefObject } from "react";
import { prefersReducedMotion } from "@/lib/webgl-support";
import styles from "./act-7-turndown.module.css";

export type EmbossIntensity = "soft" | "deep";

export function EmbossedMonogram({
  intensity,
  triggerRef,
}: {
  intensity: EmbossIntensity;
  triggerRef: RefObject<HTMLElement>;
}) {
  const embossRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const emboss = embossRef.current;
    const trigger = triggerRef.current;
    if (!emboss || !trigger || prefersReducedMotion()) return;
    gsap.registerPlugin(ScrollTrigger);

    const ctx = gsap.context(() => {
      // ±6° across the footer's rise into view; ease "none" — Lenis smooths.
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
            scrub: true,
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
