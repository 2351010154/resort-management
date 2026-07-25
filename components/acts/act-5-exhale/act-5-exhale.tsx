"use client";

// Act 5 — "The Exhale": a breath after Act 4's dark impact. Ivory, a warm
// breathing glow that persists (zeroz orb cue), three info blocks scrubbed
// through Right -> Left -> Middle.

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useRef } from "react";
import { arrivalImages } from "@/lib/arrival-image-manifest";
import { tierSrc, tierSrcSet } from "@/lib/arrival-image-srcset";
import { prefersReducedMotion } from "@/lib/webgl-support";
import styles from "./act-5-exhale.module.css";

const BREATHERS = arrivalImages["act-5-breathe"];

const BLOCKS = [
  {
    slug: "breathe-rooms",
    position: styles.blockRight,
    kicker: "Rooms",
    heading: "Sleep held in timber and stone",
    body: "Quiet suites opening to the city or the sea, drawn in ivory, warm wood, and morning light.",
  },
  {
    slug: "breathe-dining",
    position: styles.blockLeft,
    kicker: "Dining",
    heading: "Seasons served slowly",
    body: "Kaiseki mornings and open-fire evenings, glasses raised against a wall of forest green.",
  },
  {
    slug: "breathe-spa",
    position: styles.blockMiddle,
    kicker: "Spa",
    heading: "Warm water above the skyline",
    body: "Steam, stone, and stillness — a pool held in glass where the city dissolves.",
  },
].map((block) => ({
  ...block,
  image: BREATHERS.find((img) => img.src.includes(block.slug))!,
}));

export function Act5Exhale() {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    if (prefersReducedMotion()) {
      // static: show the middle (spa) block settled
      const blocks = section.querySelectorAll("[data-block]");
      gsap.set(blocks[blocks.length - 1], { autoAlpha: 1 });
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
      const tl = gsap.timeline({
        defaults: { ease: "power2.inOut" },
        scrollTrigger: {
          trigger: section,
          start: "top top",
          end: "bottom bottom",
          scrub: true,
        },
      });
      // each block: drift in from its side, hold, cross-fade out; the glow
      // persists beneath all three
      const blocks = gsap.utils.toArray<HTMLElement>("[data-block]", section);
      const slot = 1 / blocks.length;
      blocks.forEach((el, i) => {
        const at = i * slot;
        const fromX = el.classList.contains(styles.blockRight)
          ? 60
          : el.classList.contains(styles.blockLeft)
            ? -60
            : 0;
        tl.fromTo(
          el,
          { autoAlpha: 0, x: fromX, y: fromX === 0 ? 40 : 0 },
          { autoAlpha: 1, x: 0, y: 0, duration: slot * 0.3 },
          at + slot * 0.08,
        );
        if (i < blocks.length - 1) {
          tl.to(el, { autoAlpha: 0, duration: slot * 0.18 }, at + slot * 0.82);
        }
      });
      // pad to a full 1.0 so scrub progress maps 1:1 onto the block slots
      tl.to({}, { duration: 0.01 }, 0.99);
    }, section);
    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      data-act={5}
      className={styles.section}
      style={{ height: "300vh" }}
    >
      <div ref={stageRef} className={styles.stage}>
        <div className={styles.glow} aria-hidden />
        {BLOCKS.map(({ slug, position, kicker, heading, body, image }) => (
          <div key={slug} data-block className={`${styles.block} ${position}`}>
            <img
              className={styles.blockImage}
              src={tierSrc(image.src, 640)}
              srcSet={tierSrcSet(image)}
              sizes="min(20rem, 60vw)"
              alt={image.alt}
              loading="lazy"
            />
            <span className={`caps-label ${styles.blockKicker}`}>{kicker}</span>
            <h2 className={`font-display ${styles.blockHeading}`}>{heading}</h2>
            <p className={styles.blockBody}>{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
