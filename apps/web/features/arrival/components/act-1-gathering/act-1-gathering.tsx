"use client";

// Act 1 — "The Aperture". A single pinned scene rather than a run of screens:
// the interior plate, the image field and the monogram sheet coexist for the whole
// act. The monogram is the nearest plane in that scene, so scrolling drives it
// at the viewer far faster than anything behind it — the opening swells until
// the frame is inside a single stroke. The act ends by surfacing the interior
// back into daylight and then blooming it to ivory, so the window dissolves
// into the page rather than sliding off it.
//
// The mark stands in a plaster wall of the page's own ivory, so the act is one
// tone from first frame to bloom and the concierge bar is ink over all of it —
// which is why nothing here claims the dark bar from the act store.

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  prefersReducedMotion,
  shouldRenderFilm,
} from "@/features/arrival/lib/webgl-support";
import { tierSrcSet } from "@/features/arrival/lib/image-srcset";
import { DUR_SCENE_SLOW, EASE_UI } from "@/lib/motion-tokens";
import { ApertureSheet } from "./aperture-sheet";
import { DepthImageField } from "./depth-image-field";
import { MonogramLens } from "./monogram-lens";
import {
  PLATE_IMAGE,
  cameraAdvance,
  plateDrift,
  type IntroCamera,
} from "./intro-camera-model";
import styles from "./act-1-gathering.module.css";

/**
 * Scroll distance the push is spread over. The mark is off frame by p≈0.38, so
 * it gets the first ~100vh and the field keeps arriving through the remaining
 * ~160vh — the reference's split, with the longer tail its shallower field does
 * not need.
 */
const ACT_HEIGHT = "260vh";
/** The plate is oversized at rest so its slow drift never exposes an edge. */
const PLATE_REST_SCALE = 1.05;

/** Seconds the holding curtain takes to clear. The mark's opening waits on it. */
const CURTAIN_LIFT = 1;

export function Act1Gathering() {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const plateRef = useRef<HTMLImageElement>(null);
  const curtainRef = useRef<HTMLDivElement>(null);
  // null until the client capability probe runs (avoids SSR mismatch)
  const [animate, setAnimate] = useState<boolean | null>(null);
  // The lens needs WebGL; without it the act still scrubs, behind the flat
  // canvas cut-out.
  const [lens, setLens] = useState(false);
  const cameraRef = useRef<IntroCamera>({
    progress: 0,
    z: 0,
    entry: 0,
    reveal: 1,
  });

  useEffect(() => {
    setAnimate(!prefersReducedMotion());
    const film = shouldRenderFilm();
    setLens(film);
    // only the lens can open the mark out of a dot; the flat sheet is drawn once
    if (film) cameraRef.current.reveal = 0;
  }, []);

  // Once the mark is drawable the scene behind it is safely masked: lift the
  // holding curtain, open the mark out of its dot, and fade the imagery up
  // inside it.
  const handleSheetReady = useCallback(() => {
    const camera = cameraRef.current;
    gsap.to(camera, {
      entry: 1,
      duration: 1.4,
      ease: "power2.out",
      delay: 0.15,
    });
    // Not the scene ease: the mark opens by relaxing an erosion, so an ease
    // that front-loads as hard as expo.out spends the whole tween on the last
    // hairline of the outline and snaps the letter open.
    //
    // Held until the curtain below has finished lifting. The curtain is opaque
    // and takes a second to go, and an erosion that starts under it spends more
    // than half its travel unseen — the letter is already open past its middle
    // by the time there is anything to watch, which is what turns a two-second
    // opening into a flicker. Nothing is at risk in the wait: the sheet is a
    // solid mask while the mark is shut, so it hides the scene on its own.
    if (camera.reveal < 1) {
      gsap.to(camera, {
        reveal: 1,
        duration: DUR_SCENE_SLOW,
        ease: EASE_UI,
        delay: CURTAIN_LIFT * 0.9,
      });
    }
    if (curtainRef.current) {
      gsap.to(curtainRef.current, {
        autoAlpha: 0,
        duration: CURTAIN_LIFT,
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
          // The act is one pinned scene, so it takes the hard scrub: the mark,
          // the field and the plate share edges with each other and with the
          // pin, and a layer lagging the frame it is cut into is a gap. The
          // drift lag is for things that move relative to the page.
          scrub: true,
          onUpdate: (self) => {
            camera.progress = self.progress;
            camera.z = cameraAdvance(self.progress);
            // the plate is the far plane: it only creeps forward
            if (plateRef.current) {
              const drift = PLATE_REST_SCALE * plateDrift(camera.z);
              plateRef.current.style.transform = `scale(${drift.toFixed(4)})`;
            }
          },
        },
      });

      timeline
        .to(`.${styles.copy}`, { autoAlpha: 0, y: -24, duration: 0.06 }, 0.01)
        // keep in sync with shadeRamp() in depth-image-field
        .to(`.${styles.plateShade}`, { opacity: 1, duration: 0.18 }, 0.08)
        // the interior surfaces back into daylight before the ivory takes over:
        // fading a panel straight over the dark push just turns the window grey
        .to(`.${styles.plateShade}`, { opacity: 0, duration: 0.08 }, 0.9)
        .to(`.${styles.bloom}`, { opacity: 1, duration: 0.07 }, 0.93);

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
      {/* The one sentence the opening says. The mark names the house and the
          photographs show its rooms; neither says how big it is or where — and
          a first screen that names neither is a mood, not an arrival. */}
      <p className={`font-display ${styles.statement}`}>
        Forty rooms on the Nha&nbsp;Trang shore.
      </p>
      {animate ? (
        <span className={`caps-label ${styles.cue}`}>Scroll</span>
      ) : null}
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
              {lens ? (
                <MonogramLens
                  camera={cameraRef.current}
                  onReady={handleSheetReady}
                />
              ) : (
                <ApertureSheet
                  onReady={animate ? handleSheetReady : undefined}
                />
              )}
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
