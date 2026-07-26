"use client";

// The last band of the page: the house name over a frame that was already there
// behind the footer, uncovered as the footer rides up (wolverine finale cue).
//
// The band's own box is a window — `clip-path` clips its subtree without
// becoming the containing block for it, so the frame inside can be viewport-
// fixed and stay put while the window grows over it. That is the whole illusion:
// nothing slides, the page simply stops covering it.
//
// The frame also breathes on the way in (scale scrubbed off the reveal), so the
// last screen answers scroll the same way the invitation does.

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useRef } from "react";
import { arrivalImages } from "@/lib/arrival-image-manifest";
import { tierSrc, tierSrcSet } from "@/lib/arrival-image-srcset";
import { prefersReducedMotion } from "@/lib/webgl-support";
import styles from "./act-6-turndown.module.css";

// A guest walking out along the walkway at golden hour — the only frame in the
// library that reads as leaving rather than arriving.
const PLATE = arrivalImages["act-1-converge"].find((img) =>
  img.src.includes("resort-walkway"),
)!;

/** Scale the frame is uncovered at, and the scale it settles to. */
const PLATE_SCALE = [1.16, 1] as const;

export function WordmarkReveal() {
  const bandRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const band = bandRef.current;
    if (!band || prefersReducedMotion()) return;
    gsap.registerPlugin(ScrollTrigger);

    const ctx = gsap.context(() => {
      // From the band's top edge touching the bottom of the screen to the page
      // running out of scroll — the exact window of the uncovering.
      const scrollTrigger = {
        trigger: band,
        start: "top bottom",
        end: "bottom bottom",
        scrub: true,
      } as const;

      gsap.fromTo(
        `.${styles.revealImage}`,
        { scale: PLATE_SCALE[0] },
        { scale: PLATE_SCALE[1], ease: "none", scrollTrigger },
      );
      // The name comes up with it rather than sitting fully lit behind the
      // footer, so the reveal has a subject and not just a wipe.
      gsap.fromTo(
        `.${styles.revealWordmark}`,
        { yPercent: 26, autoAlpha: 0.25 },
        { yPercent: 0, autoAlpha: 1, ease: "none", scrollTrigger },
      );
    }, band);
    return () => ctx.revert();
  }, []);

  return (
    <div ref={bandRef} className={styles.reveal} aria-hidden>
      <div className={styles.revealLayer}>
        <img
          className={styles.revealImage}
          src={tierSrc(PLATE.src, 1920)}
          srcSet={tierSrcSet(PLATE)}
          sizes="100vw"
          width={PLATE.width}
          height={PLATE.height}
          alt=""
          loading="lazy"
          decoding="async"
        />
        <div className={styles.revealScrim} />
        <div className={styles.revealMark}>
          <span className={styles.revealWordmark} />
        </div>
      </div>
    </div>
  );
}
