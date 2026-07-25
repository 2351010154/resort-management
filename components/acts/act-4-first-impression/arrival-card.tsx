"use client";

// Act 4 orchestrator — "The First Impression". The arrival card pops out of
// Act 3's fullscreen-video center as this pinned section takes over; the dark
// zeroz room settles around it, flanked by the split tagline.

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { arrivalImages } from "@/lib/arrival-image-manifest";
import { shouldRenderFilm } from "@/lib/webgl-support";
import styles from "./act-4-first-impression.module.css";

const ZerozRoomScene = dynamic(
  () => import("./zeroz-room-scene").then((m) => m.ZerozRoomScene),
  { ssr: false },
);

const CARD_IMAGE = arrivalImages["act-4-room"].find((img) =>
  img.src.includes("arrival-card-lobby"),
)!;

export function ArrivalCard() {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [film, setFilm] = useState<boolean | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const scrollRef = useRef(0);

  useEffect(() => {
    setFilm(shouldRenderFilm());
    setIsMobile(window.innerWidth < 768);
  }, []);

  useEffect(() => {
    if (!film) return;
    const section = sectionRef.current;
    if (!section) return;
    gsap.registerPlugin(ScrollTrigger);

    const ctx = gsap.context(() => {
      ScrollTrigger.create({
        trigger: section,
        start: "top top",
        end: "bottom bottom",
        pin: stageRef.current,
        pinSpacing: false,
        onUpdate: (self) => {
          scrollRef.current = self.progress;
        },
      });
      // pop-out from the (viewport-centered) video: card + labels emerge
      // across the first 35% of the pin, then the room holds
      gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: {
          trigger: section,
          start: "top top",
          end: "bottom bottom",
          scrub: true,
        },
      })
        .fromTo(
          cardRef.current,
          { scale: 0.12, autoAlpha: 0 },
          { scale: 1, autoAlpha: 1, duration: 0.35 },
          0,
        )
        .fromTo(
          section.querySelectorAll("[data-flank]"),
          { autoAlpha: 0, y: 14 },
          { autoAlpha: 1, y: 0, duration: 0.18 },
          0.3,
        )
        .to({}, { duration: 0.52 }, 0.48) // settled-room hold
        // room floor dissolves into Act 5's ivory — no cut line at the pin
        .to(`.${styles.tailFade}`, { autoAlpha: 1, duration: 0.14 }, 0.86);
    }, section);
    return () => ctx.revert();
  }, [film]);

  return (
    <section
      ref={sectionRef}
      data-act={4}
      className={styles.section}
      style={{ height: film ? "250vh" : "auto" }}
    >
      <div ref={stageRef} className={styles.stage}>
        <div className={styles.canvasWrap}>
          {film ? (
            <ZerozRoomScene scrollRef={scrollRef} cubeCount={isMobile ? 4 : undefined} />
          ) : film === false ? (
            <FlatRoomFallback />
          ) : null}
        </div>
        <span data-flank className={`caps-label ${styles.flankLabel} ${styles.flankLeft}`}>
          Rest · Relax
        </span>
        <div ref={cardRef} className={styles.card}>
          <img
            src={CARD_IMAGE.src.replace(/-\d+\.webp$/, "-640.webp")}
            alt={CARD_IMAGE.alt}
          />
          <p className={`font-display ${styles.cardName}`}>Mariva</p>
          <p className={`caps-label ${styles.cardCaption}`}>
            Where arrival becomes ritual
          </p>
        </div>
        <span data-flank className={`caps-label ${styles.flankLabel} ${styles.flankRight}`}>
          Rejuvenate
        </span>
        <div className={styles.tailFade} aria-hidden />
      </div>
    </section>
  );
}

// No-WebGL / reduced-motion room: flat positioned detail images in the dark.
function FlatRoomFallback() {
  const cubes = arrivalImages["act-4-room"]
    .filter((img) => img.role === "flank-cube")
    .slice(0, 6);
  return (
    <div style={{ position: "absolute", inset: 0 }} aria-hidden>
      {cubes.map((img, i) => {
        const side = i % 2 === 0 ? -1 : 1;
        const x = 50 + side * (26 + (i % 3) * 7);
        const y = 26 + ((i * 23) % 48);
        return (
          <img
            key={img.src}
            src={img.src.replace(/-\d+\.webp$/, "-640.webp")}
            alt=""
            loading="lazy"
            style={{
              position: "absolute",
              left: `${x}%`,
              top: `${y}%`,
              width: "11vmin",
              transform: "translate(-50%, -50%)",
              opacity: 0.55,
            }}
          />
        );
      })}
    </div>
  );
}
