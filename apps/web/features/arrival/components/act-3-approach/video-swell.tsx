"use client";

// Act 3 — "The Approach": the arrival loop, fullscreen, released to the
// reader by Act 2's ribbon. The section reaches up under Act 2's by the
// overlap the two acts agree on (`act-seams.ts`), so the frame is already
// pinned and already the whole screen while the ribbon's last opening grows
// over it until the sheet is gone. The act used to open as a centred card
// swelling up to the frame; the ribbon's exit is that arrival now, and a card
// after it would be the picture arriving twice.
//
// Two things ride the hold that follows. The hour goes: the footage grades
// down toward dusk, so the flip out of the ivory acts into Act 4's dark
// interior is caused by the light going rather than by a section boundary.
// And the caption arrives, because a label on a picture only means anything
// once the picture is the reader's whole page — which is the moment the
// ribbon lets it be.
//
// The grade is one number — a `--dusk` custom property on the stage, 0 for the
// light the loop was shot in and 1 for nightfall. Every layer of it is derived
// in the stylesheet; this file only decides when that number moves.

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useRef, useState } from "react";
import {
  ACT2_ACT3_OVERLAP,
  ACT2_LENS_TRAVEL,
} from "@/features/arrival/lib/act-seams";
import { useArrivalActStore } from "@/features/arrival/lib/act-store";
import { prefersReducedMotion } from "@/features/arrival/lib/webgl-support";
import styles from "./act-3-approach.module.css";

/**
 * The act's beats as scroll lengths, in viewport heights.
 *
 * The lens is Act 2's: the ribbon's last opening takes that much of this
 * act's pin to become the whole screen, and until it has, this frame is
 * seen through it. The hold after it is this act's own, and it is the length
 * the fullscreen hold always was.
 */
const LENS = ACT2_LENS_TRAVEL;
const HOLD = 80;
const PIN_TRAVEL = LENS + HOLD;

/** The frame is the reader's from here: the lens has opened past the corners
 *  and Act 2's stage is nothing. */
const RELEASED = LENS / PIN_TRAVEL;

/**
 * When the evening starts. The frame has to be seen in the light it was shot
 * in through the ribbon's opening, and for a beat after the sheet is gone, so
 * nothing touches the grade until the reader has had the picture whole. The
 * remaining nightfall then falls across the hold, which is what leaves Act 4
 * a page that is already night to open its corridor on.
 */
const DUSK_START = (LENS + 54) / PIN_TRAVEL;

/** The label belongs to the whole frame, so it arrives once the frame is. */
const CAPTION_AT = RELEASED;

export function VideoSwell() {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [reduced, setReduced] = useState<boolean | null>(null);
  const setNavDark = useArrivalActStore((s) => s.setNavDark);

  useEffect(() => setReduced(prefersReducedMotion()), []);

  // Reduced motion holds the frame fullscreen for the whole act, so the bar is
  // over video the entire time it owns the viewport.
  useEffect(() => {
    if (reduced !== true) return;
    setNavDark(3, true);
    return () => setNavDark(3, false);
  }, [reduced, setNavDark]);

  // Play only while on screen (autoplay muted+playsInline for Safari).
  useEffect(() => {
    const video = videoRef.current;
    if (!video || reduced) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) video.play().catch(() => {});
        else video.pause();
      },
      { threshold: 0.1 },
    );
    io.observe(video);
    return () => io.disconnect();
  }, [reduced]);

  useEffect(() => {
    if (reduced !== false) return;
    const section = sectionRef.current;
    const stage = stageRef.current;
    const caption = captionRef.current;
    if (!section || !stage || !caption) return;
    gsap.registerPlugin(ScrollTrigger);
    let dark = false;

    const ctx = gsap.context(() => {
      ScrollTrigger.create({
        trigger: section,
        start: "top top",
        end: "bottom bottom",
        pin: stage,
        pinSpacing: false,
      });
      gsap
        .timeline({
          defaults: { ease: "none" },
          scrollTrigger: {
            trigger: section,
            start: "top top",
            end: "bottom bottom",
            scrub: true,
            // The bar is over video from the moment the sheet is gone. While
            // the lens is still opening the bar is Act 2's to describe — it
            // hands the dark over as the hole takes the top corners — and the
            // two claims overlap rather than meet, which is what keeps the bar
            // from flickering ivory on the frame between them.
            onUpdate: (self) => {
              const next = self.progress >= RELEASED;
              if (next === dark) return;
              dark = next;
              setNavDark(3, next);
            },
          },
        })
        // The hour, held at the loop's own light until the reader has had the
        // frame whole and then run down to nightfall at the pin's end. Linear,
        // and deliberately so: under a scrub the reader is the clock, and any
        // curve here shows up as the page disagreeing with the hand about how
        // fast the sun is going down.
        .fromTo(
          stage,
          { "--dusk": 0 },
          { "--dusk": 1, duration: 1 - DUSK_START },
          DUSK_START,
        )
        // The label arrives as the sheet goes: a short rise out of the foot,
        // then it holds for the rest of the act. Eased, unlike the grade —
        // this is an entrance with a settle, not a quantity the reader is
        // scrubbing.
        .fromTo(
          caption,
          { autoAlpha: 0, y: 14 },
          { autoAlpha: 1, y: 0, duration: 0.05, ease: "power2.out" },
          CAPTION_AT,
        )
        // the frame's foot dissolves into Act 4's dark — no cut line at the pin
        .to(
          `.${styles.tailFade}`,
          { autoAlpha: 1, duration: 0.15 },
          CAPTION_AT + 0.01,
        )
        // holds the timeline open to the pin's end, so every position above
        // is a share of the whole pin and not of the last tween
        .to({}, { duration: 1 - CAPTION_AT }, CAPTION_AT);
    }, section);
    return () => {
      ctx.revert();
      setNavDark(3, false);
    };
  }, [reduced, setNavDark]);

  return (
    <section
      ref={sectionRef}
      data-act={3}
      className={styles.section}
      // The pinned travel plus the screen the stage occupies. The overlap is
      // declared with it so the stylesheet reaches the section up under Act 2
      // by exactly the figure the two acts agree on.
      style={
        {
          height: reduced === false ? `${PIN_TRAVEL + 100}vh` : "auto",
          "--overlap": ACT2_ACT3_OVERLAP,
        } as React.CSSProperties
      }
    >
      <div
        ref={stageRef}
        className={styles.stage}
        // Only once the probe has answered true, so the server's markup and
        // the first client paint agree on a frame that carries no still.
        data-still={reduced === true ? "true" : undefined}
      >
        <div className={styles.videoShell}>
          <video
            ref={videoRef}
            muted
            loop
            playsInline
            autoPlay={reduced === false}
            preload="metadata"
            poster="/video/arrival-loop-poster.webp"
          >
            <source src="/video/arrival-loop.webm" type="video/webm" />
            <source src="/video/arrival-loop.mp4" type="video/mp4" />
          </video>
          <div className={styles.duskGrade} aria-hidden />
        </div>
        <div className={styles.tailFade} aria-hidden />
        <div ref={captionRef} className={styles.caption}>
          <span className="caps-label">The approach, at dusk</span>
        </div>
      </div>
    </section>
  );
}
