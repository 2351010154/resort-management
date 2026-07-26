"use client";

// Act 2 — "The Welcome": one centered display line, per-line mask-up reveal
// (izanami text treatment), on a bare wall with foliage shadow cast in from the
// top right.

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "@/lib/webgl-support";
import { EASE_SCENE, STAGGER_CASCADE } from "@/lib/motion-tokens";
import { FoliageGobo } from "./foliage-gobo";
import { OrbitingImageField } from "./orbiting-image-field";
import { WelcomeChapters } from "./welcome-chapters";
import styles from "./act-2-welcome.module.css";

export function WelcomeLine() {
  const sectionRef = useRef<HTMLElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || prefersReducedMotion()) return;
    gsap.registerPlugin(ScrollTrigger);

    const ctx = gsap.context(() => {
      gsap.fromTo(
        // Scoped to the copy block, not the section: the chapters below carry
        // their own reveal lines and must not fire with the welcome line.
        copyRef.current!.querySelectorAll("[data-reveal-line]"),
        { yPercent: 115 },
        {
          yPercent: 0,
          duration: 1.2,
          ease: EASE_SCENE,
          stagger: STAGGER_CASCADE * 2,
          // trigger on the copy, not the section: the section is 130vh with the
          // line centred, so a section-top trigger played the reveal a full
          // viewport before the words were on screen
          scrollTrigger: { trigger: copyRef.current, start: "top 82%", once: true },
        },
      );
    }, section);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} data-act={2} className={styles.section}>
      <FoliageGobo />
      <OrbitingImageField sectionRef={sectionRef} />
      <div className={styles.stage}>
        <div ref={copyRef} className={styles.copy}>
          <span className={styles.lineClip}>
            <span data-reveal-line className={`caps-label ${styles.kicker}`} style={{ display: "block" }}>
              Mariva — Rest · Relax · Rejuvenate
            </span>
          </span>
          <span className={styles.lineClip}>
            <h1 data-reveal-line className={`font-display ${styles.display}`} style={{ display: "block" }}>
              You have been expected.
            </h1>
          </span>
        </div>
      </div>
      {/* The kicker names three words; the chapters are those three words. */}
      <WelcomeChapters />
    </section>
  );
}
