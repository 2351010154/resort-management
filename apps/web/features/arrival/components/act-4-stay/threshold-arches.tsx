"use client";

// Movement II — "The Threshold": three arched openings on the dark ground; the
// centre one opens to full bleed and stays that way.
//
// Each arch is a full-viewport media layer wearing its own `clip-path: inset()`.
// Opening the arch animates the *clip*, never the media, so the footage holds
// dead still while the doorway grows around it. Animating a mask box instead
// would scale the footage with it and read as a zoom, which is the one thing
// the reference is careful not to do.
//
// The stage stays pinned past this movement's own end, all the way to the foot
// of Movement III: once the door is open it is the ground the rooms play on.
// That is why the pin and the scrub are two triggers here rather than one — the
// timeline still finishes with this section, the pin does not.

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useRef } from "react";
import { useArrivalActStore } from "@/features/arrival/lib/act-store";
import styles from "./act-4-stay.module.css";

/** Insets are viewport percentages; the radius is half an arch's width, which
 *  makes the top a true semicircle. */
interface Arch {
  l: number;
  r: number;
  /** Seconds into the clip, so one file reads as three different views. */
  at: number;
}

const ARCHES: Arch[] = [
  { l: 16, r: 68, at: 1.5 },
  { l: 42, r: 42, at: 8.5 },
  { l: 68, r: 16, at: 15 },
];

const ARCH_TOP = 24;
const ARCH_BOTTOM = 22;
const ARCH_RAD = 8; // vw — half of the 16vw opening

export function ThresholdArches({ mobile }: { mobile: boolean }) {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const setNavDark = useArrivalActStore((s) => s.setNavDark);

  // On a phone one opening carries it; three would be slivers and three decodes.
  const arches = mobile ? [ARCHES[1]] : ARCHES;
  const width = mobile ? 760 : 1160;

  useEffect(() => {
    const section = sectionRef.current;
    const stage = stageRef.current;
    if (!section || !stage) return;
    gsap.registerPlugin(ScrollTrigger);

    const ctx = gsap.context(() => {
      const layers = gsap.utils.toArray<HTMLElement>("[data-arch]", stage);
      const centre = layers[mobile ? 0 : 1];
      const flanks = layers.filter((el) => el !== centre);

      // The pin outlives the scrub: it holds the opened door in frame for the
      // whole of Movement III, which renders transparently on top of it, and on
      // to the Invitation's top — the same end the deck's own pin takes, so the
      // ground never drops out from under a deck that is still there.
      const rooms = document.querySelector<HTMLElement>('[data-movement="rooms"]');
      const begin = document.querySelector<HTMLElement>('[data-act="5"]');
      ScrollTrigger.create({
        trigger: section,
        start: "top top",
        endTrigger: begin ?? rooms ?? section,
        end: begin ? "top top" : "bottom bottom",
        pin: stage,
        pinSpacing: false,
      });

      const tl = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: {
          trigger: section,
          start: "top top",
          end: "bottom bottom",
          scrub: true,
          // The arcade is dark on both sides of the opening, and it stays the
          // ground right through the rooms, so the bar never goes light here.
          onToggle: () => setNavDark(4, true),
        },
      });

      // Arches rise in, staggered.
      tl.fromTo(
        layers,
        { autoAlpha: 0, y: 40 },
        { autoAlpha: 1, y: 0, duration: 0.16, stagger: 0.04, ease: "power2.out" },
        0,
      );

      // Held beat: a slow drift so the openings are never quite static.
      tl.to(layers, { y: -18, duration: 0.32 }, 0.18);

      // The doorway opens. Flanks leave outward; the centre's clip runs to zero.
      flanks.forEach((el, i) => {
        tl.to(
          el,
          { xPercent: i === 0 ? -55 : 55, autoAlpha: 0, duration: 0.22, ease: "power2.in" },
          0.5,
        );
      });
      tl.to(
        centre,
        {
          "--l": "0%",
          "--r": "0%",
          "--t": "0%",
          "--b": "0%",
          "--rad": "0vw",
          y: 0,
          duration: 0.32,
          ease: "power2.inOut",
        },
        0.5,
      );

      // The scrim the rooms read on belongs to this pinned stage, not to their
      // own. Movement III's stage slides up into the frame before it pins, so a
      // scrim living there would drag a hard horizontal edge across the door on
      // the way in. Here it is part of the ground and the seam has no line.
      tl.fromTo(
        scrimRef.current,
        { opacity: 0 },
        { opacity: 1, duration: 0.14, ease: "power1.in" },
        0.84,
      );

      // The flanks have left by the time the centre is open, and the stage then
      // stays pinned for another 700vh — three simultaneous decodes for two
      // invisible layers is not a bill worth paying. `data-idle` is the flag the
      // intersection observer below reads, so the two do not fight over play().
      ScrollTrigger.create({
        trigger: section,
        start: () =>
          `top top-=${0.72 * Math.max(1, section.offsetHeight - window.innerHeight)}px`,
        endTrigger: rooms ?? section,
        end: "bottom bottom",
        invalidateOnRefresh: true,
        onToggle: (self) => {
          for (const el of flanks) {
            const video = el.querySelector("video");
            if (!video) continue;
            video.dataset.idle = String(self.isActive);
            if (self.isActive) video.pause();
            else video.play().catch(() => {});
          }
        },
      });
    }, section);

    return () => {
      ctx.revert();
      setNavDark(4, false);
    };
  }, [mobile, setNavDark]);

  // Decode only while the section is near the viewport.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const vids = Array.from(stage.querySelectorAll("video"));
    const io = new IntersectionObserver(
      ([entry]) => {
        for (const v of vids) {
          if (entry.isIntersecting && v.dataset.idle !== "true") v.play().catch(() => {});
          else v.pause();
        }
      },
      { rootMargin: "50%" },
    );
    io.observe(stage);
    return () => io.disconnect();
  }, []);

  return (
    <section
      ref={sectionRef}
      data-movement="threshold"
      className={styles.threshold}
      style={{ height: mobile ? "180vh" : "280vh" }}
      aria-label="The threshold"
    >
      <div ref={stageRef} className={styles.thresholdStage}>
        {arches.map((arch) => (
          <div
            key={arch.l}
            data-arch
            className={styles.arch}
            style={
              {
                "--l": `${arch.l}%`,
                "--r": `${arch.r}%`,
                "--t": `${ARCH_TOP}%`,
                "--b": `${ARCH_BOTTOM}%`,
                "--rad": `${ARCH_RAD}vw`,
              } as React.CSSProperties
            }
          >
            <video
              muted
              loop
              playsInline
              preload="metadata"
              poster="/video/threshold/arcade-poster.webp"
              onLoadedMetadata={(e) => {
                e.currentTarget.currentTime = arch.at;
              }}
            >
              <source src={`/video/threshold/arcade-${width}.webm`} type="video/webm" />
              <source src={`/video/threshold/arcade-${width}.mp4`} type="video/mp4" />
            </video>
            <div className={styles.archTint} aria-hidden />
          </div>
        ))}

        <div ref={scrimRef} className={styles.doorScrim} aria-hidden />
      </div>
    </section>
  );
}

/** Reduced motion: the arch already open, held on the poster frame. */
export function ThresholdStatic() {
  return (
    <section className={styles.threshold} aria-label="The threshold">
      <div className={styles.staticThreshold}>
        <img src="/video/threshold/arcade-poster.webp" alt="Arcade colonnade" />
      </div>
    </section>
  );
}
