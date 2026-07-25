"use client";

// Act 1 — "The Aperture". A single pinned scene rather than a run of screens:
// the coast plate, the photo field and the monogram sheet coexist for the whole
// act. The monogram is a fixed window — it never moves or changes shape — and
// scrolling advances the camera through the world behind it. The act ends by
// surfacing the interior back into daylight and then blooming it to ivory, so
// the window dissolves into the page rather than sliding off it.

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useCallback, useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "@/lib/webgl-support";
import { tierSrcSet } from "@/lib/arrival-image-srcset";
import { ApertureSheet } from "./aperture-sheet";
import { DepthImageField } from "./depth-image-field";
import {
  PLATE_DEPTH,
  PLATE_IMAGE,
  cameraAdvance,
  planeScale,
  type IntroCamera,
} from "./intro-camera-model";
import styles from "./act-1-gathering.module.css";

/** Scroll distance the push is spread over. */
const ACT_HEIGHT = "380vh";
/** The plate is oversized at rest so its slow drift never exposes an edge. */
const PLATE_REST_SCALE = 1.05;

export function Act1Gathering() {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const plateRef = useRef<HTMLImageElement>(null);
  const curtainRef = useRef<HTMLDivElement>(null);
  // null until the client capability probe runs (avoids SSR mismatch)
  const [animate, setAnimate] = useState<boolean | null>(null);
  const cameraRef = useRef<IntroCamera>({ progress: 0, z: 0, entry: 0 });

  useEffect(() => setAnimate(!prefersReducedMotion()), []);

  // Once the sheet has drawn, the scene behind it is safely masked: lift the
  // holding curtain and fade the imagery up inside the window.
  const handleSheetReady = useCallback(() => {
    gsap.to(cameraRef.current, { entry: 1, duration: 1.4, ease: "power2.out", delay: 0.15 });
    if (curtainRef.current) {
      gsap.to(curtainRef.current, {
        autoAlpha: 0,
        duration: 1,
        ease: "power2.inOut",
        onComplete: () => ScrollTrigger.refresh(),
      });
    }
  }, []);

  useEffect(() => {
    if (!animate) return;
    const section = sectionRef.current;
    const stage = stageRef.current;
    if (!section || !stage) return;
    gsap.registerPlugin(ScrollTrigger);
    const camera = cameraRef.current;

    const ctx = gsap.context(() => {
      const timeline = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: {
          trigger: section,
          start: "top top",
          end: "bottom bottom",
          scrub: true, // Lenis is the only smoother
          onUpdate: (self) => {
            camera.progress = self.progress;
            camera.z = cameraAdvance(self.progress);
            // the plate is the far plane: it only creeps forward
            if (plateRef.current) {
              const drift = planeScale(PLATE_DEPTH, camera.z) * PLATE_DEPTH;
              plateRef.current.style.transform = `scale(${(PLATE_REST_SCALE * drift).toFixed(4)})`;
            }
          },
        },
      });

      timeline
        .to(`.${styles.copy}`, { autoAlpha: 0, y: -24, duration: 0.08 }, 0.01)
        // keep in sync with shadeRamp() in depth-image-field
        .to(`.${styles.plateShade}`, { opacity: 1, duration: 0.45 }, 0.14)
        // the interior surfaces back into daylight before the ivory takes over:
        // fading a panel straight over the dark push just turns the window grey
        .to(`.${styles.plateShade}`, { opacity: 0, duration: 0.2 }, 0.68)
        .to(`.${styles.bloom}`, { opacity: 1, duration: 0.14 }, 0.86);

      ScrollTrigger.create({
        trigger: section,
        start: "top top",
        end: "bottom bottom",
        pin: stage,
        pinSpacing: false,
      });
    }, section);

    return () => ctx.revert();
  }, [animate]);

  const copy = (
    <div className={styles.copy}>
      <p className={`font-display ${styles.statement}`}>
        A private retreat of calm, minimalism and elegance.
      </p>
      {animate ? <span className={`caps-label ${styles.cue}`}>Scroll</span> : null}
    </div>
  );

  return (
    <section
      ref={sectionRef}
      data-act={1}
      className={styles.section}
      style={{ height: animate ? ACT_HEIGHT : "auto" }}
    >
      <div ref={stageRef} className={styles.stage}>
        {animate === null ? null : (
          <>
            <img
              ref={plateRef}
              className={styles.plate}
              src={PLATE_IMAGE.src}
              srcSet={tierSrcSet(PLATE_IMAGE)}
              sizes="100vw"
              alt=""
              style={{ transform: `scale(${PLATE_REST_SCALE})` }}
            />
            <div className={styles.plateShade} />
            <DepthImageField camera={cameraRef.current} still={!animate} />
            <div className={styles.aperture}>
              <ApertureSheet onReady={animate ? handleSheetReady : undefined} />
            </div>
            {copy}
            {animate ? (
              <>
                <div className={styles.bloom} />
                <div ref={curtainRef} className={styles.curtain} />
              </>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
