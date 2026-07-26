"use client";

// Act 3 — "The Approach": the arrival loop starts as a centered card and
// swells to fullscreen driven by scroll (floema mechanic). Ends on a
// fullscreen hold beat; Act 4 emerges from the (now viewport-centered) video
// center — the handoff is simply the stable fullscreen end state.

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
const NAV_HANDOVER = 0.56;

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
    const shell = shellRef.current;
    if (!section || !shell) return;
    gsap.registerPlugin(ScrollTrigger);
    let dark = false;

    const ctx = gsap.context(() => {
      ScrollTrigger.create({
        trigger: section,
        start: "top top",
        end: "bottom bottom",
        pin: stageRef.current,
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
        .to(captionRef.current, { autoAlpha: 0, duration: 0.12 }, 0.55)
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
      <div ref={stageRef} className={styles.stage}>
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
          <div ref={captionRef} className={styles.caption}>
            <span className="caps-label">The journey elsewhere</span>
          </div>
        </div>
        <div className={styles.tailFade} aria-hidden />
      </div>
    </section>
  );
}
