"use client";

// Act 2, second half — three ruled chapters hanging off the welcome line, on
// the same wall and under the same foliage shadow (izanami "Philosophy"
// composition: vertical rail label, ragged display line, and a stack of three
// overlapping photographs on the far side).
//
// They live inside Act 2's section rather than in one of their own so the gobo
// keeps casting over them: its canvas sticks for the length of the act, and the
// act is now several viewports instead of one and a bit.
//
// The panels stack rather than scroll past one another: each pins to the top of
// the viewport, holds for a dwell, and is then covered by the next one rising
// over it. Each panel is two overlaid sticky layers so the shadow can still
// fall between the photographs and the reading — see the chapters block in the
// stylesheet for the z-scale that depends on.

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useRef } from "react";
import { arrivalImages } from "@/features/arrival/lib/image-manifest";
import { tierSrc, tierSrcSet } from "@/features/arrival/lib/image-srcset";
import { prefersReducedMotion } from "@/features/arrival/lib/webgl-support";
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
  /**
   * The second photograph the big frame turns over to during the panel's
   * dwell. Only the big frame carries one: it is the tile the eye rests on
   * while the panel is held, and the only one wide enough for the seam to
   * read as a seam rather than a flicker.
   */
  flip: ManifestImage;
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
    // The same room at dusk, so the seam has something to show: two warm
    // cedar interiors would turn over invisibly.
    flip: bySlug(ROOMS, "room-premier"),
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
    flip: bySlug(CONVERGE, "steam-bath-window"),
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
    flip: bySlug(CONVERGE, "terrace-lunch-sea"),
    vars: { "--over-w": "48%", "--over-y": "-6%", "--under-w": "46%" },
  },
];

/**
 * How far each tile lags the panel as it rises, in % of its own height. They
 * land on the composition as drawn and hold there for the dwell, so the stack
 * reads as depth on the way in and as a photograph once it has arrived.
 */
const TILE_LAG = [4, 12, 7];

/**
 * The seam flip, in % of the tile's own height, measured off the reference
 * capture: the incoming photograph travels a little slower than the seam that
 * uncovers it, and the outgoing one drifts up behind. The two rates are the
 * whole depth of the move — the tile itself never scales.
 */
const FLIP_ENTER = -90;
const FLIP_EXIT = -10;
/** Where the seam sits in the dwell, as shares of it: settle, sweep, hold. */
const FLIP_DELAY = 0.15;
const FLIP_SWEEP = 0.62;

const TILE_CLASS = [styles.tilePrimary, styles.tileOver, styles.tileUnder];
const TILE_SIZES = [
  "(max-width: 900px) 88vw, 28rem",
  "(max-width: 900px) 46vw, 15rem",
  "(max-width: 900px) 40vw, 12rem",
];

function TileImage({ image, tile }: { image: ManifestImage; tile: number }) {
  return (
    <img
      src={tierSrc(image.src, 640)}
      srcSet={tierSrcSet(image)}
      sizes={TILE_SIZES[tile]}
      width={image.width}
      height={image.height}
      alt={image.alt}
      loading="lazy"
      decoding="async"
    />
  );
}

export function WelcomeChapters() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || prefersReducedMotion()) return;
    gsap.registerPlugin(ScrollTrigger);

    const ctx = gsap.context(() => {
      const chapters = gsap.utils.toArray<HTMLElement>(`.${styles.chapter}`, root);
      const marks = chapters.map(
        (chapter) => chapter.querySelector<HTMLElement>("[data-chapter-mark]")!,
      );

      chapters.forEach((chapter, i) => {
        const mark = marks[i];
        const next = marks[i + 1];
        const tiles = gsap.utils.toArray<HTMLElement>(`.${styles.tile}`, chapter);

        // The panel's rise: from its top edge touching the bottom of the
        // screen to the moment it lands and pins.
        const rise = () =>
          ({ trigger: mark, start: "top bottom", end: "top top", scrub: true }) as const;
        // Its dwell: from landing to the next panel's edge appearing, or, for
        // the last one, to the act letting go.
        const dwell = () =>
          ({
            trigger: mark,
            start: "top top",
            endTrigger: next ?? root,
            end: next ? "top bottom" : "bottom bottom",
            scrub: true,
          }) as const;

        gsap
          .timeline({ scrollTrigger: { trigger: mark, start: "top 70%", once: true } })
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

        // Differential drift across the panel's rise: the frame barely lags,
        // the tile hanging off it lags most.
        tiles.forEach((tile, t) => {
          gsap.fromTo(
            tile,
            { yPercent: TILE_LAG[t] ?? 0 },
            { yPercent: 0, ease: "none", scrollTrigger: rise() },
          );
        });

        // The flip, inside the dwell — the one stretch of the act where the
        // panel is motionless, so the seam is the only thing travelling. Scrub
        // rather than a one-shot: the seam follows the reader back up again.
        const incoming = chapter.querySelector<HTMLElement>(`.${styles.tileNext}`);
        if (incoming) {
          const outgoing = incoming.previousElementSibling!;
          gsap
            .timeline({ defaults: { ease: "none", duration: FLIP_SWEEP }, scrollTrigger: dwell() })
            .fromTo(
              incoming,
              { clipPath: "inset(0% 0% 100% 0%)" },
              { clipPath: "inset(0% 0% 0% 0%)" },
              FLIP_DELAY,
            )
            .fromTo(
              incoming.querySelector("img"),
              { yPercent: FLIP_ENTER },
              { yPercent: 0 },
              FLIP_DELAY,
            )
            .fromTo(
              outgoing.querySelector("img"),
              { yPercent: 0 },
              { yPercent: FLIP_EXIT },
              FLIP_DELAY,
            )
            .to({}, { duration: 1 - FLIP_DELAY - FLIP_SWEEP });
        }

        // Covering the panel below. Its plate is occluded by this one outright,
        // but its type sits above every plate — that is what keeps the gobo
        // between the two — so it is clipped to this panel's top edge instead,
        // which is the same straight line doing the covering.
        const covered = chapters[i - 1]?.querySelector<HTMLElement>(`.${styles.panelType}`);
        if (covered) {
          gsap.fromTo(
            covered,
            { clipPath: "inset(0% 0% 0% 0%)" },
            { clipPath: "inset(0% 0% 100% 0%)", ease: "none", scrollTrigger: rise() },
          );
        }
      });
    }, root);
    return () => ctx.revert();
  }, []);

  return (
    <div ref={rootRef} className={styles.chapters}>
      {CHAPTERS.map((chapter, i) => (
        <article
          key={chapter.index}
          data-side={chapter.side}
          className={styles.chapter}
          style={{ "--i": i } as React.CSSProperties}
        >
          <div data-chapter-mark className={styles.chapterMark} aria-hidden />

          <div className={`${styles.panel} ${styles.panelType}`}>
            <div className={styles.panelInner}>
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
                        style={
                          { display: "block", "--indent": `${indent}em` } as React.CSSProperties
                        }
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
            </div>
          </div>

          <div className={`${styles.panel} ${styles.panelPlate}`}>
            <div className={styles.panelInner}>
              <div className={styles.stack} style={chapter.vars as React.CSSProperties}>
                {chapter.images.map((image, t) => (
                  <div key={image.src} className={`${styles.tile} ${TILE_CLASS[t]}`}>
                    {t === 0 ? (
                      <>
                        <div className={`${styles.tileLayer} ${styles.tileCurrent}`}>
                          <TileImage image={image} tile={t} />
                        </div>
                        <div className={`${styles.tileLayer} ${styles.tileNext}`}>
                          <TileImage image={chapter.flip} tile={t} />
                        </div>
                      </>
                    ) : (
                      <TileImage image={image} tile={t} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className={styles.chapterDwell} aria-hidden />
        </article>
      ))}
    </div>
  );
}
