"use client";

// Floema frame-1 mini-gallery: small detail images floating slowly around the
// centered line, with scroll parallax; they drift outward and fade as Act 3
// approaches. Behind ORBIT_ENABLED so the act reads clean without it.

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useRef, type RefObject } from "react";
import { arrivalImages } from "@/features/arrival/lib/image-manifest";
import { prefersReducedMotion } from "@/features/arrival/lib/webgl-support";
import { SCRUB_DRIFT } from "@/lib/motion-tokens";
import styles from "./act-2-welcome.module.css";

// Off since the act took the slide-2 comp: the comp's wall carries the foliage
// shadow and nothing else, and floating photographs read as clutter against it.
export const ORBIT_ENABLED = false;

const ORBIT = arrivalImages["act-2-orbit"];

const prand = (i: number, salt: number) => {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// Ring placement around the centered text, biased away from the copy block.
function orbitSlot(i: number) {
  const angle = (i / ORBIT.length) * Math.PI * 2 + prand(i, 1) * 0.45;
  const radius = 30 + prand(i, 2) * 16; // vmin
  return {
    x: Math.cos(angle) * radius * 1.35, // widescreen ellipse
    y: Math.sin(angle) * radius * 0.8,
    depth: 0.35 + prand(i, 3) * 0.65, // parallax factor
    width: 6 + prand(i, 4) * 4.5, // vmin
  };
}

export function OrbitingImageField({
  sectionRef,
}: {
  sectionRef: RefObject<HTMLElement | null>;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const section = sectionRef.current;
    if (!root || !section || prefersReducedMotion()) return;
    gsap.registerPlugin(ScrollTrigger);

    const ctx = gsap.context(() => {
      const items = gsap.utils.toArray<HTMLElement>("img", root);
      items.forEach((el, i) => {
        // slow time-based float
        gsap.to(el, {
          y: `+=${6 + prand(i, 5) * 10}`,
          duration: 3 + prand(i, 6) * 2.5,
          ease: "sine.inOut",
          yoyo: true,
          repeat: -1,
        });
        // scroll parallax + outward drift/fade toward the act's end
        const slot = orbitSlot(i);
        gsap.to(el, {
          xPercent: slot.x * 0.6,
          yPercent: -140 * slot.depth,
          autoAlpha: 0.15,
          ease: "none",
          scrollTrigger: {
            trigger: section,
            start: "top bottom",
            end: "bottom top",
            // Parallax against the page and nothing else, so it takes the
            // second smoothing: the field goes on drifting outward for half a
            // second after the reader stops, which is what keeps it reading as
            // depth rather than as a layer bolted to the scrollbar.
            scrub: SCRUB_DRIFT,
          },
        });
      });
    }, root);
    return () => ctx.revert();
  }, [sectionRef]);

  if (!ORBIT_ENABLED) return null;

  return (
    <div ref={rootRef} className={styles.orbit} aria-hidden>
      {ORBIT.map((img, i) => {
        const slot = orbitSlot(i);
        return (
          <img
            key={img.src}
            src={img.src.replace(/-\d+\.webp$/, "-640.webp")}
            alt=""
            loading="lazy"
            className={styles.orbitImage}
            style={{
              width: `${slot.width}vmin`,
              transform: `translate(-50%, -50%) translate(${slot.x}vmin, ${slot.y}vmin)`,
            }}
          />
        );
      })}
    </div>
  );
}
