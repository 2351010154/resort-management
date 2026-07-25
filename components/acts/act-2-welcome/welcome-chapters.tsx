"use client";

// Act 2, second half — three ruled chapters hanging off the welcome line, on
// the same wall and under the same foliage shadow (izanami "Philosophy"
// composition: vertical rail label, ragged display line, and a stack of three
// overlapping photographs on the far side).
//
// They live inside Act 2's section rather than in one of their own so the gobo
// keeps casting over them: its canvas sticks for the length of the act, and the
// act is now four viewports instead of one and a bit.

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useRef } from "react";
import { arrivalImages } from "@/lib/arrival-image-manifest";
import { tierSrc, tierSrcSet } from "@/lib/arrival-image-srcset";
import { prefersReducedMotion } from "@/lib/webgl-support";
import { DUR_SCENE, EASE_SCENE, EASE_UI, STAGGER_CASCADE } from "@/lib/motion-tokens";
import styles from "./act-2-welcome.module.css";

const CONVERGE = arrivalImages["act-1-converge"];
const ORBIT = arrivalImages["act-2-orbit"];
const ROOMS = arrivalImages["act-4-rooms"];

type ManifestImage = (typeof arrivalImages)[keyof typeof arrivalImages][number];

const bySlug = <T extends { src: string }>(set: readonly T[], slug: string) =>
  set.find((img) => img.src.includes(`/${slug}-`))!;

/** Indent of a display line, in em of its own size. */
type Line = readonly [text: string, indent: number];

interface Chapter {
  index: string;
  /** Which side the photographs take. Alternates down the act. */
  side: "right" | "left";
  rail: string;
  lines: readonly Line[];
  body: string;
  caption: string;
  /** Big frame, the tile breaking inward over it, the tile dropping outward. */
  images: readonly [ManifestImage, ManifestImage, ManifestImage];
  /** Per-panel proportions, so no two stacks sit the same way. */
  vars: Record<string, string>;
}

const CHAPTERS: Chapter[] = [
  {
    index: "01",
    side: "right",
    rail: "Rest",
    lines: [
      ["Rooms that keep", 0],
      ["the quiet you", 0],
      ["came for.", 2.4],
    ],
    body:
      "Ten suites and villas, each turned toward its own piece of the garden. " +
      "Cedar, linen, and lamplight kept low enough to hear the room. Nothing " +
      "here asks anything of you.",
    caption: "Suites & Villas",
    images: [
      bySlug(ROOMS, "room-cedar"),
      bySlug(ORBIT, "round-window-detail"),
      bySlug(ROOMS, "room-library"),
    ],
    vars: { "--over-w": "52%", "--over-y": "-9%", "--under-w": "42%" },
  },
  {
    index: "02",
    side: "left",
    rail: "Relax",
    lines: [
      ["Water first,", 0],
      ["then the rest", 1.6],
      ["of the day.", 3.2],
    ],
    body:
      "The bath house opens at six and stays warm until ten. Thermal stone, a " +
      "lap pool under standing light, and treatments drawn from whatever is " +
      "growing on the ridge above the property.",
    caption: "The Bath House",
    images: [
      bySlug(ORBIT, "water-ladle"),
      bySlug(CONVERGE, "spa-pool-lightshafts"),
      bySlug(CONVERGE, "spa-treatment-room"),
    ],
    vars: { "--over-w": "60%", "--over-y": "-12%", "--under-w": "38%" },
  },
  {
    index: "03",
    side: "right",
    rail: "Rejuvenate",
    lines: [
      ["The day begins", 0],
      ["somewhere", 1.8],
      ["up the hill.", 3.6],
    ],
    body:
      "Dawn walks up the cedar steps, a garden three minutes from the kitchen, " +
      "and one table of eight for whatever was picked that morning. You leave " +
      "lighter than you arrived.",
    caption: "Land & Table",
    images: [
      bySlug(CONVERGE, "forest-steps-kimono"),
      bySlug(ORBIT, "tea-terrace-sunset"),
      bySlug(ORBIT, "kaiseki-bento"),
    ],
    vars: { "--over-w": "48%", "--over-y": "-6%", "--under-w": "46%" },
  },
];

/** Scroll travel per tile, in % of its own height — the stack reads as depth. */
const TILE_PARALLAX = [-4, -12, -7];

const TILE_CLASS = [styles.tilePrimary, styles.tileOver, styles.tileUnder];
const TILE_SIZES = [
  "(max-width: 900px) 88vw, 28rem",
  "(max-width: 900px) 46vw, 15rem",
  "(max-width: 900px) 40vw, 12rem",
];

export function WelcomeChapters() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || prefersReducedMotion()) return;
    gsap.registerPlugin(ScrollTrigger);

    const ctx = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>(`.${styles.chapter}`, root).forEach((chapter) => {
        const tiles = gsap.utils.toArray<HTMLElement>(`.${styles.tile}`, chapter);

        gsap
          .timeline({ scrollTrigger: { trigger: chapter, start: "top 74%", once: true } })
          .fromTo(
            chapter.querySelectorAll("[data-chapter-line]"),
            { yPercent: 115 },
            { yPercent: 0, duration: 1.2, ease: EASE_SCENE, stagger: STAGGER_CASCADE },
          )
          // The photographs settle out of an over-scale inside their own clip,
          // so nothing moves in the layout and nothing has to start hidden.
          .fromTo(
            chapter.querySelectorAll(`.${styles.tile} img`),
            { scale: 1.09 },
            { scale: 1, duration: DUR_SCENE, ease: EASE_SCENE, stagger: STAGGER_CASCADE },
            0,
          )
          .fromTo(
            chapter.querySelectorAll("[data-chapter-fade]"),
            { autoAlpha: 0, y: 16 },
            { autoAlpha: 1, y: 0, duration: 0.9, ease: EASE_UI, stagger: STAGGER_CASCADE },
            0.3,
          );

        // Differential drift across the panel's own scroll: the frame barely
        // moves, the tile hanging off it moves most.
        tiles.forEach((tile, i) => {
          gsap.to(tile, {
            yPercent: TILE_PARALLAX[i] ?? 0,
            ease: "none",
            scrollTrigger: {
              trigger: chapter,
              start: "top bottom",
              end: "bottom top",
              scrub: true,
            },
          });
        });
      });
    }, root);
    return () => ctx.revert();
  }, []);

  return (
    <div ref={rootRef} className={styles.chapters}>
      {CHAPTERS.map((chapter) => (
        <article
          key={chapter.index}
          data-side={chapter.side}
          className={styles.chapter}
        >
          <p className={`caps-label ${styles.chapterRail}`}>{chapter.rail}</p>

          <div className={styles.chapterText}>
            <p className={`caps-label ${styles.chapterIndex}`} data-chapter-fade>
              {chapter.index}
            </p>
            <h2 className={`font-display ${styles.chapterHead}`}>
              {chapter.lines.map(([text, indent]) => (
                <span key={text} className={styles.lineClip}>
                  <span
                    data-chapter-line
                    className={styles.chapterLine}
                    style={{ display: "block", "--indent": `${indent}em` } as React.CSSProperties}
                  >
                    {text}
                  </span>
                </span>
              ))}
            </h2>
            <p className={styles.chapterBody} data-chapter-fade>
              {chapter.body}
            </p>
            <p className={`caps-label ${styles.chapterCaption}`} data-chapter-fade>
              {chapter.caption}
            </p>
          </div>

          <div className={styles.stack} style={chapter.vars as React.CSSProperties}>
            {chapter.images.map((image, i) => (
              <div key={image.src} className={`${styles.tile} ${TILE_CLASS[i]}`}>
                <img
                  src={tierSrc(image.src, 640)}
                  srcSet={tierSrcSet(image)}
                  sizes={TILE_SIZES[i]}
                  width={image.width}
                  height={image.height}
                  alt={image.alt}
                  loading="lazy"
                  decoding="async"
                />
              </div>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}
