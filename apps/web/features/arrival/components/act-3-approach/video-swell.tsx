"use client";

// Act 3 — "The Approach": the arrival loop starts as a centered card and
// swells to fullscreen driven by scroll (floema mechanic). Ends on a
// fullscreen hold beat; Act 4 emerges from the (now viewport-centered) video
// center — the handoff is simply the stable fullscreen end state.
//
// Two things ride that hold beat. The hour goes: once the frame has filled the
// viewport the footage grades down toward dusk, so the flip out of the ivory
// acts into Act 4's dark interior is caused by the light going rather than by
// a section boundary. And the caption arrives, because a label on a picture
// only means anything once the picture is the whole page.
//
// The grade is one number — a `--dusk` custom property on the stage, 0 for the
// light the loop was shot in and 1 for nightfall. Every layer of it is derived
// in the stylesheet; this file only decides when that number moves.

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useRef, useState } from "react";
import { useArrivalActStore } from "@/features/arrival/lib/act-store";
import { prefersReducedMotion } from "@/features/arrival/lib/webgl-support";
import styles from "./act-3-approach.module.css";

// Where the swelling frame reaches the bar. The shell is a full viewport scaled
// from 0.42 to 1 across the first 75% of the pin, so its top edge sits
// (1 - scale) / 2 of the viewport down; the bar clears at roughly scale 0.88,
// which is progress 0.6. Handing over slightly early lets the 0.5s tone fade
// settle before the video is actually behind the bar.
//
// Unmoved by the dusk grade below: the grade only starts well after this point
// and only ever subtracts light, so every frame the ivory bar stands on from
// here is darker than the one this threshold was tuned against.
const NAV_HANDOVER = 0.56;

// When the evening starts, as a fraction of the pin. The swell owns the first
// 75%, and the frame has to arrive in the light it was shot in for the swell
// to be worth watching, so nothing touches the grade until the card is already
// most of the way up. Starting a hair before it lands rather than exactly on
// it keeps the darkening off the same frame as the scale settling — the reader
// should see the light going, not a switch being thrown. The remaining ~80% of
// nightfall then falls across the fullscreen hold, which is what leaves Act 4
// a page that is already night to open its corridor on.
const DUSK_START = 0.68;

export function VideoSwell() {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
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
    const shell = shellRef.current;
    const caption = captionRef.current;
    if (!section || !stage || !shell || !caption) return;
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
            onUpdate: (self) => {
              const next = self.progress > NAV_HANDOVER;
              if (next === dark) return;
              dark = next;
              setNavDark(3, next);
            },
          },
        })
        // card -> fullscreen across the first 75%; hold beat 75-100%
        .fromTo(
          shell,
          { scale: 0.42, borderRadius: 24 },
          { scale: 1, borderRadius: 0, duration: 0.75 },
          0,
        )
        // The hour, held at the loop's own light until the frame is nearly
        // fullscreen and then run down to nightfall at the pin's end. Linear,
        // and deliberately so: under a scrub the reader is the clock, and any
        // curve here shows up as the page disagreeing with the hand about how
        // fast the sun is going down.
        .fromTo(
          stage,
          { "--dusk": 0 },
          { "--dusk": 1, duration: 1 - DUSK_START },
          DUSK_START,
        )
        // The label belongs to the fullscreen frame, so it arrives with it: a
        // short rise out of the foot at the frame the swell completes, then it
        // holds for the rest of the act. Eased, unlike the grade — this is an
        // entrance with a settle, not a quantity the reader is scrubbing.
        .fromTo(
          caption,
          { autoAlpha: 0, y: 14 },
          { autoAlpha: 1, y: 0, duration: 0.08, ease: "power2.out" },
          0.75,
        )
        // the frame's foot dissolves into Act 4's dark — no cut line at the pin
        .to(`.${styles.tailFade}`, { autoAlpha: 1, duration: 0.2 }, 0.76)
        // fullscreen hold beat: pads the timeline so the swell completes at
        // 75% of the pin and the last quarter rides fullscreen into Act 4
        .to({}, { duration: 0.25 }, 0.75);
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
      style={{ height: reduced === false ? "180vh" : "auto" }}
    >
      <div
        ref={stageRef}
        className={styles.stage}
        // Only once the probe has answered true, so the server's markup and
        // the first client paint agree on a frame that carries no still.
        data-still={reduced === true ? "true" : undefined}
      >
        <div ref={shellRef} className={styles.videoShell}>
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
