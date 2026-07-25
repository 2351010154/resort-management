"use client";

// Act 6 — "The Invitation": long ivory->dark gradient bridge (no hard cut),
// onsen steam at dusk with slow Ken Burns, centered serif chapter lines
// cross-fading izanami-style, side collages sliding from the edges, and the
// decorative CTA "Begin your stay" (locked wording) scrolling to the footer.

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useRef } from "react";
import { arrivalImages } from "@/lib/arrival-image-manifest";
import { useLenis } from "@/lib/lenis-scroll-provider";
import { scrollToAct } from "@/components/navigation/nav-hover-link";
import { prefersReducedMotion } from "@/lib/webgl-support";
import styles from "./act-6-invitation.module.css";

const BG = arrivalImages["act-6-invite"].find((img) =>
  img.src.includes("onsen-steam-dusk"),
)!;

const CHAPTER_LINES = ["The world can wait.", "Your room cannot wait to meet you."];

const SIDE_IMAGES = {
  left: ["/images/act-6-invite/welcome-pavilion-640.webp", "/images/act-2-orbit/massage-stones-640.webp"],
  right: ["/images/act-2-orbit/forest-champagne-640.webp", "/images/act-2-orbit/water-ladle-640.webp"],
};

const DARK = "#100e0c";

export function InvitationScreen() {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const lenis = useLenis();

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    if (prefersReducedMotion()) {
      gsap.set(section, { backgroundColor: DARK });
      gsap.set(
        section.querySelectorAll(
          `.${styles.bgImage}, .${styles.scrim}, .${styles.cta}, [data-chapter]:last-of-type`,
        ),
        { autoAlpha: 1 },
      );
      return;
    }
    gsap.registerPlugin(ScrollTrigger);

    const ctx = gsap.context(() => {
      ScrollTrigger.create({
        trigger: section,
        start: "top top",
        end: "bottom bottom",
        pin: stageRef.current,
        pinSpacing: false,
      });
      const lines = gsap.utils.toArray<HTMLElement>("[data-chapter]", section);
      const tl = gsap.timeline({
        defaults: { ease: "power2.inOut" },
        scrollTrigger: {
          trigger: section,
          start: "top top",
          end: "bottom bottom",
          scrub: true,
        },
      });
      tl
        // gradient bridge: ivory -> dark across the first 28%
        .fromTo(section, { backgroundColor: "#f4efe6" }, { backgroundColor: DARK, duration: 0.28, ease: "none" }, 0)
        .to(`.${styles.bgImage}`, { autoAlpha: 1, duration: 0.14 }, 0.16)
        .to(`.${styles.scrim}`, { autoAlpha: 1, duration: 0.14 }, 0.18)
        // Ken Burns across the whole dark stretch (izanami slow-media pace)
        .fromTo(`.${styles.bgImage}`, { scale: 1 }, { scale: 1.09, duration: 0.72, ease: "none" }, 0.28)
        // side collages slide in from the edges
        .fromTo(
          `.${styles.sideLeft}`,
          { x: -80, autoAlpha: 0 },
          { x: 0, autoAlpha: 0.85, duration: 0.14 },
          0.3,
        )
        .fromTo(
          `.${styles.sideRight}`,
          { x: 80, autoAlpha: 0 },
          { x: 0, autoAlpha: 0.85, duration: 0.14 },
          0.3,
        )
        // chapter cross-fades
        .fromTo(lines[0], { autoAlpha: 0, yPercent: 20 }, { autoAlpha: 1, yPercent: 0, duration: 0.1 }, 0.32)
        .to(lines[0], { autoAlpha: 0, yPercent: -16, duration: 0.08 }, 0.52)
        .fromTo(lines[1], { autoAlpha: 0, yPercent: 20 }, { autoAlpha: 1, yPercent: 0, duration: 0.1 }, 0.58)
        // CTA arrives on the held final chapter
        .fromTo(`.${styles.cta}`, { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 0.1 }, 0.74)
        .to({}, { duration: 0.16 }, 0.84); // quiet hold
    }, section);
    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      data-act={6}
      className={styles.section}
      style={{ height: "350vh" }}
    >
      <div ref={stageRef} className={styles.stage}>
        <img
          className={styles.bgImage}
          src={BG.src}
          alt={BG.alt}
          loading="lazy"
        />
        <div className={styles.scrim} aria-hidden />
        <div className={`${styles.sideCollage} ${styles.sideLeft}`} aria-hidden>
          {SIDE_IMAGES.left.map((src) => (
            <img key={src} src={src} alt="" loading="lazy" />
          ))}
        </div>
        <div className={`${styles.sideCollage} ${styles.sideRight}`} aria-hidden>
          {SIDE_IMAGES.right.map((src) => (
            <img key={src} src={src} alt="" loading="lazy" />
          ))}
        </div>
        <div className={styles.chapters}>
          {CHAPTER_LINES.map((line) => (
            <p key={line} data-chapter className={`font-display ${styles.chapterLine}`}>
              {line}
            </p>
          ))}
        </div>
        <button
          className={`caps-label ${styles.cta}`}
          onClick={() => scrollToAct(lenis, 7)}
        >
          Begin your stay
        </button>
      </div>
    </section>
  );
}
