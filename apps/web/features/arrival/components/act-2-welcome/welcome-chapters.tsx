"use client";

// Act 2, second half — three ruled chapters hanging off the welcome line, on
// the same wall and under the same foliage shadow (izanami "Philosophy"
// composition: vertical rail label, ragged display line, and photographs
// stacked on the far side).
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
//
// The three panels are not one template filled three times. Each carries an
// archetype — a tile count, tile shapes, and an overlap — and the seam flip
// carries the rest: which tiles turn over, which way, and when in the run.
// The flip is the only thing that happens while a panel is held, so the same
// move landing in the same slot three times stopped reading as motion and
// started reading as machinery. Percentages were no answer either: a pinned
// panel holds still for a whole viewport, long enough to notice that the frame,
// the satellite, and the corner are where they were last time.
//
// The run is triggered by the landing and then plays at its own speed. Scrubbing
// it against scroll tied the seam to the wheel, so the same gesture crossed in
// two frames for anyone moving quickly — on a panel that is pinned and otherwise
// motionless, that is the whole of what there is to see.
//
// Every tile in the act turns over. What separates the panels is the shape of
// the run: 01 descends, largest tile first; 02 has two tiles and takes the
// shorter breath between, its sideways seam mirrored with the panel; 03 climbs,
// smallest first, and finishes on the tall frame. 01 and 03 share an archetype,
// so the direction and the order of their runs is the whole of what tells them
// apart.

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useRef } from "react";
import { arrivalImages } from "@/features/arrival/lib/image-manifest";
import { tierSrc, tierSrcSet } from "@/features/arrival/lib/image-srcset";
import { useScrollWeight } from "@/features/arrival/lib/lenis-scroll-provider";
import { prefersReducedMotion } from "@/features/arrival/lib/webgl-support";
import {
  DUR_SCENE,
  EASE_SCENE,
  EASE_UI,
  STAGGER_CASCADE,
} from "@/lib/motion-tokens";
import styles from "./act-2-welcome.module.css";

const CONVERGE = arrivalImages["act-1-converge"];
const ORBIT = arrivalImages["act-2-orbit"];
const ROOMS = arrivalImages["act-4-rooms"];

type ManifestImage = (typeof arrivalImages)[keyof typeof arrivalImages][number];

const bySlug = <T extends { src: string }>(set: readonly T[], slug: string) =>
  set.find((img) => img.src.includes(`/${slug}-`))!;

/** Indent of a display line, in em of its own size. */
type Line = readonly [text: string, indent: number];

/** Which composition a chapter's photographs take. The geometry itself lives in
 *  the archetype blocks of the stylesheet, selected on `data-arch`. */
type Arch = "stamps" | "shingle";

/** A tile's place in its archetype, and its class key in the stylesheet. */
type Slot = "frame" | "stampIn" | "stampOut" | "pairFar" | "pairNear";

/**
 * Which way a seam travels. Physical, not logical: `clip-path: inset()` is
 * measured against the box's physical edges and is not mirrored by the
 * `direction: rtl` that flips a left-side panel, so "rightward" means rightward
 * on every panel. The sideways pair is used on the wide tile of a composition,
 * and each runs out towards the page edge that tile already hangs over rather
 * than in towards the reading — which is why both exist: a right-side panel
 * hangs its wide tile off the right edge and a mirrored one off the left, and
 * neither seam can turn around on its own.
 */
type Seam = "down" | "up" | "rightward" | "leftward";

/**
 * The second photograph a tile turns over to during the panel's dwell — the
 * stretch where the panel itself is motionless, so the seam is the only thing
 * travelling. Carried by the tile rather than the chapter, which is what lets a
 * panel run one flip or a sequence of them without a second shape of data.
 */
interface Flip {
  image: ManifestImage;
  seam: Seam;
  /** Seconds into the panel's flip run when this seam starts, and how long it
   *  takes to cross. Real seconds, not shares of scroll: the run is played, not
   *  scrubbed, so a panel that flips more than once spaces its tiles along its
   *  own clock. */
  at: number;
  dur: number;
}

interface Tile {
  slot: Slot;
  image: ManifestImage;
  /** Set when this tile turns over. A tile without one is a plain photograph. */
  flip?: Flip;
}

interface Chapter {
  index: string;
  /** Which side the photographs take. Alternates down the act. */
  side: "right" | "left";
  rail: string;
  lines: readonly Line[];
  body: string;
  caption: string;
  arch: Arch;
  /** Painted in this order, and the lag table is read by position. */
  tiles: readonly Tile[];
}

const CHAPTERS: Chapter[] = [
  {
    index: "01",
    side: "right",
    rail: "Rest",
    // Corner stamps: one tall mass, two small satellites hanging off opposite
    // corners. The act's establishing composition — the two below reduce away
    // from it rather than restate it.
    arch: "stamps",
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
    // The run descends: the tall frame goes first and the satellites follow it
    // down, largest to smallest, and it is over inside two seconds. 03 runs the
    // same composition the other way — smallest first, every seam climbing —
    // so the two share a silhouette and nothing else.
    tiles: [
      {
        slot: "frame",
        image: bySlug(ROOMS, "room-cedar"),
        // First, and the largest change: the same room at dusk, so the seam has
        // something to show — two warm cedar interiors would turn over
        // invisibly.
        flip: {
          image: bySlug(ROOMS, "room-premier"),
          seam: "down",
          at: 0.35,
          dur: 0.85,
        },
      },
      {
        slot: "stampIn",
        image: bySlug(ORBIT, "round-window-detail"),
        // Last, and the shortest sweep: the smallest tile, and the panel's
        // closing beat. A second round window would have been the invisible
        // flip again, so this one leaves the detail for the room it sits in.
        flip: {
          image: bySlug(ROOMS, "room-washigamine"),
          seam: "down",
          at: 1.5,
          dur: 0.4,
        },
      },
      {
        slot: "stampOut",
        image: bySlug(ROOMS, "room-library"),
        // Second. The wide tile, so the seam crosses sideways and outward, off
        // the page edge this tile already hangs over — and it trades the
        // library's lantern dark for daylight, which is the whole of what makes
        // a seam between two interiors readable at this size.
        flip: {
          image: bySlug(ROOMS, "room-mori"),
          seam: "rightward",
          at: 1.05,
          dur: 0.5,
        },
      },
    ],
  },
  {
    index: "02",
    side: "left",
    rail: "Relax",
    // Shingled pair: two photographs of comparable area but opposite
    // orientation, overlapped shallowly. Nothing hangs off a corner and there
    // is no third tile, which is what keeps it from reading as 01 mirrored.
    arch: "shingle",
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
    // Both turn over, in the order the copy reads: water first, then the rest
    // of the day. Two seams rather than three is the archetype's doing — this
    // is the panel with two tiles — and it is what keeps the middle chapter
    // the shorter breath between the two three-part runs.
    //
    // This is also the one mirrored panel, and the sideways seam is where that
    // shows: the wide tile hangs off the left page edge here, so its seam runs
    // out to the left. The gesture is 01's, reflected.
    tiles: [
      {
        slot: "pairFar",
        image: bySlug(ORBIT, "water-ladle"),
        // First. The pour, then what the pouring is for.
        flip: {
          image: bySlug(ORBIT, "massage-stones"),
          seam: "down",
          at: 0.3,
          dur: 0.55,
        },
      },
      {
        slot: "pairNear",
        image: bySlug(CONVERGE, "spa-pool-lightshafts"),
        // Second, and outward: the lap pool gives way to the room the
        // treatments are drawn in, stone light for pale timber.
        flip: {
          image: bySlug(CONVERGE, "spa-treatment-room"),
          seam: "leftward",
          at: 0.8,
          dur: 0.6,
        },
      },
    ],
  },
  {
    index: "03",
    side: "right",
    rail: "Rejuvenate",
    // 01's composition again, and deliberately: what this panel does with it is
    // run it the other way. Every seam climbs, and the order is reversed —
    // smallest tile first, the tall frame last — so where 01 spends its largest
    // change and settles, this one builds to it. Upward is also the direction
    // the copy walks.
    arch: "stamps",
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
    // The cascade runs smallest first and finishes on the tall frame, so the
    // panel builds to its largest change instead of spending it and decaying,
    // which is 01's order read backwards — this is the last chapter, and the
    // one that hands over to Act 3.
    //
    // Each sweep is timed off how far its own seam has to travel, not given an
    // equal third: the frame is nearly three times the height of the square
    // stamp, so equal durations made its seam cross nearly three times as fast.
    // Not strictly proportional either — a big tile that took three times as
    // long read as slow — so the tall one gets roughly twice the small one's.
    // The gaps between them shrank with the sweeps: they are what makes three
    // seams read as three events, so holding them while the sweeps quickened
    // would have left the run airier than it was. It ends around two and a
    // half seconds in, which is what the longer dwell in the stylesheet keeps
    // the panel on screen for.
    tiles: [
      {
        slot: "frame",
        image: bySlug(CONVERGE, "forest-steps-kimono"),
        // Last, and further up the same climb.
        flip: {
          image: bySlug(CONVERGE, "temple-gate"),
          seam: "up",
          at: 1.5,
          dur: 0.9,
        },
      },
      {
        slot: "stampIn",
        image: bySlug(ORBIT, "kaiseki-bento"),
        // First: the table, then the terrace it is carried out to.
        flip: {
          image: bySlug(ORBIT, "tea-terrace-sunset"),
          seam: "up",
          at: 0.3,
          dur: 0.45,
        },
      },
      {
        slot: "stampOut",
        image: bySlug(CONVERGE, "terrace-lunch-sea"),
        // Second: the sitting, then the kitchen three minutes from it. The one
        // seam in the panel that crosses sideways, because this is the one wide
        // tile — and outward, off the page edge it already hangs over.
        flip: {
          image: bySlug(CONVERGE, "spring-cafe-forest"),
          seam: "rightward",
          at: 0.9,
          dur: 0.42,
        },
      },
    ],
  },
];

/**
 * How far each tile lags its panel as it rises, in % of its own height, by
 * position in the archetype's tile list. Per archetype rather than shared: in
 * `stamps` the big frame lags least and the satellite most, in `shingle` the
 * near tile is the steady one, so the two read as different depths rather than
 * as the same parallax applied to different rectangles. They land on the
 * composition as drawn and hold there for the dwell — the stack reads as depth
 * on the way in and as a photograph once it has arrived.
 */
const LAG: Record<Arch, readonly number[]> = {
  stamps: [4, 12, 7],
  shingle: [6, 3],
};

/**
 * When a chapter's flip run is over, in seconds from the panel landing — the
 * last seam to finish, whichever tile it belongs to.
 *
 * This is what the dwell is sized on. It used to be a figure per flip count,
 * written in the stylesheet and kept level with these timings by a comment,
 * which is a pairing that can only ever drift: a seam moved half a second later
 * here left the panel it belongs to scrolling away mid-sweep with nothing to
 * say so. Read off the timings themselves, the dwell cannot be wrong about a
 * run it is derived from.
 */
const runEnd = (chapter: Chapter) =>
  chapter.tiles.reduce(
    (end, tile) =>
      tile.flip ? Math.max(end, tile.flip.at + tile.flip.dur) : end,
    0,
  );

const SLOT_CLASS: Record<Slot, string> = {
  frame: styles.slotFrame,
  stampIn: styles.slotStampIn,
  stampOut: styles.slotStampOut,
  pairFar: styles.slotPairFar,
  pairNear: styles.slotPairNear,
};

/** Rendered width of each slot, from its share of the archetype's stack. */
const SLOT_SIZES: Record<Slot, string> = {
  frame: "(max-width: 900px) 88vw, 28rem",
  stampIn: "(max-width: 900px) 46vw, 15rem",
  stampOut: "(max-width: 900px) 40vw, 12rem",
  pairFar: "(max-width: 900px) 60vw, 19rem",
  pairNear: "(max-width: 900px) 72vw, 22rem",
};

/**
 * Travel of the two photographs behind the seam, in % of the tile's own size,
 * measured off the reference capture: the incoming one arrives a little slower
 * than the seam that uncovers it, and the outgoing one drifts back behind. The
 * two rates are the whole depth of the move — the tile itself never scales.
 */
const FLIP_ENTER = 90;
const FLIP_EXIT = 10;

/**
 * Per seam: the clip the incoming layer starts fully hidden behind, the axis the
 * photographs travel on, and the sign of that travel. The sign is negative when
 * the seam sweeps along the positive axis and positive when it sweeps back, so
 * the incoming photograph always follows the seam and the outgoing one always
 * drifts against it. The overscan that stops that drift uncovering the tile is
 * on the matching side in the stylesheet (`.tile[data-seam] .tileCurrent`).
 */
const SEAM: Record<
  Seam,
  { from: string; axis: "xPercent" | "yPercent"; sign: number }
> = {
  down: { from: "inset(0% 0% 100% 0%)", axis: "yPercent", sign: -1 },
  up: { from: "inset(100% 0% 0% 0%)", axis: "yPercent", sign: 1 },
  rightward: { from: "inset(0% 100% 0% 0%)", axis: "xPercent", sign: -1 },
  leftward: { from: "inset(0% 0% 0% 100%)", axis: "xPercent", sign: 1 },
};

function TileImage({ image, slot }: { image: ManifestImage; slot: Slot }) {
  return (
    <img
      src={tierSrc(image.src, 640)}
      srcSet={tierSrcSet(image)}
      sizes={SLOT_SIZES[slot]}
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

  // The one stretch of Act 2 that is read rather than watched: three panels
  // that pin, hold still, and turn a photograph over. The act around it keeps
  // the cinematic weight — this claims the light one for its own length and
  // hands it back at the far edge.
  useScrollWeight(rootRef, "light");

  useEffect(() => {
    const root = rootRef.current;
    if (!root || prefersReducedMotion()) return;
    gsap.registerPlugin(ScrollTrigger);

    const ctx = gsap.context(() => {
      const panels = gsap.utils.toArray<HTMLElement>(
        `.${styles.chapter}`,
        root,
      );
      const marks = panels.map(
        (panel) => panel.querySelector<HTMLElement>("[data-chapter-mark]")!,
      );

      panels.forEach((panel, i) => {
        // The panels are rendered from CHAPTERS in order, so position is the
        // link back to the data the archetype and the flip are written in.
        const data = CHAPTERS[i];
        const mark = marks[i];
        const next = marks[i + 1];
        const tiles = gsap.utils.toArray<HTMLElement>(`.${styles.tile}`, panel);

        // The panel's rise: from its top edge touching the bottom of the
        // screen to the moment it lands and pins.
        const rise = () =>
          ({
            trigger: mark,
            start: "top bottom",
            end: "top top",
            scrub: true,
          }) as const;
        // Its dwell: from landing to the next panel's edge appearing, or, for
        // the last one, to the act letting go.
        const dwell = () =>
          ({
            trigger: mark,
            start: "top top",
            endTrigger: next ?? root,
            end: next ? "top bottom" : "bottom bottom",
          }) as const;

        gsap
          .timeline({
            scrollTrigger: { trigger: mark, start: "top 70%", once: true },
          })
          .fromTo(
            panel.querySelectorAll("[data-chapter-line]"),
            { yPercent: 115 },
            {
              yPercent: 0,
              duration: 1.2,
              ease: EASE_SCENE,
              stagger: STAGGER_CASCADE,
            },
          )
          // The photographs settle out of an over-scale inside their own clip,
          // so nothing moves in the layout and nothing has to start hidden.
          .fromTo(
            panel.querySelectorAll(`.${styles.tile} img`),
            { scale: 1.09 },
            {
              scale: 1,
              duration: DUR_SCENE,
              ease: EASE_SCENE,
              stagger: STAGGER_CASCADE,
            },
            0,
          )
          .fromTo(
            panel.querySelectorAll("[data-chapter-fade]"),
            { autoAlpha: 0, y: 16 },
            {
              autoAlpha: 1,
              y: 0,
              duration: 0.9,
              ease: EASE_UI,
              stagger: STAGGER_CASCADE,
            },
            0.3,
          );

        // Differential drift across the panel's rise, in the archetype's own
        // order — which tile is the steady one is part of what tells the three
        // compositions apart.
        tiles.forEach((tile, t) => {
          gsap.fromTo(
            tile,
            { yPercent: LAG[data.arch][t] ?? 0 },
            { yPercent: 0, ease: "none", scrollTrigger: rise() },
          );
        });

        // The flip run, inside the dwell. Played on its own clock rather than
        // scrubbed: a seam tied to scroll crosses as fast as the reader spins
        // the wheel, and a panel that is pinned and motionless is exactly where
        // that reads worst — the one thing moving on screen tearing across in
        // two frames. Fired once the panel has landed, it looks the same to a
        // reader who arrived gently and one who threw the page down.
        //
        // One timeline for the whole panel rather than one per tile, which is
        // what keeps 03's three seams a sequence at any scroll speed: three
        // separate triggers would all fire in the same instant on a fast scroll
        // and the run would collapse into a single event.
        const flips = data.tiles.flatMap((tile, t) =>
          tile.flip ? [{ flip: tile.flip, el: tiles[t] }] : [],
        );

        // Linear, and not for want of a curve: a seam is a straight edge
        // crossing a photograph at a rate, and every eased version of it spends
        // most of the window somewhere it cannot be seen — under expo.out the
        // sweep is three-quarters done in a fifth of its duration, which is the
        // scrubbed-at-speed problem again with a slower number on it.
        if (flips.length > 0) {
          const run = gsap.timeline({
            paused: true,
            defaults: { ease: "none" },
          });
          for (const { flip, el } of flips) {
            const incoming = el.querySelector<HTMLElement>(
              `.${styles.tileNext}`,
            )!;
            const outgoing = incoming.previousElementSibling!;
            const { at, dur: duration } = flip;
            const { from, axis, sign } = SEAM[flip.seam];
            run
              .fromTo(
                incoming,
                { clipPath: from },
                { clipPath: "inset(0% 0% 0% 0%)", duration },
                at,
              )
              .fromTo(
                incoming.querySelector("img"),
                { [axis]: sign * FLIP_ENTER },
                { [axis]: 0, duration },
                at,
              )
              .fromTo(
                outgoing.querySelector("img"),
                { [axis]: 0 },
                { [axis]: sign * FLIP_EXIT, duration },
                at,
              );
          }

          // Rewound when the reader leaves back over the landing edge, so a
          // chapter scrolled up past and come down to again turns over a second
          // time instead of being already spent.
          ScrollTrigger.create({
            ...dwell(),
            onEnter: () => run.play(),
            onEnterBack: () => run.play(),
            onLeaveBack: () => run.reverse(),
          });
        }

        // Covering the panel below. Its plate is occluded by this one outright,
        // but its type sits above every plate — that is what keeps the gobo
        // between the two — so it is clipped to this panel's top edge instead,
        // which is the same straight line doing the covering.
        const covered = panels[i - 1]?.querySelector<HTMLElement>(
          `.${styles.panelType}`,
        );
        if (covered) {
          gsap.fromTo(
            covered,
            { clipPath: "inset(0% 0% 0% 0%)" },
            {
              clipPath: "inset(0% 0% 100% 0%)",
              ease: "none",
              scrollTrigger: rise(),
            },
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
          data-arch={chapter.arch}
          // How many seams this panel has to fit, which is what its dwell is
          // sized on. Derived rather than written down, so the two cannot drift.
          data-flips={chapter.tiles.filter((tile) => tile.flip).length}
          className={styles.chapter}
          style={
            {
              "--i": i,
              // Seconds the flip run takes. The stylesheet turns it into the
              // dwell at one pace for the whole act, and zeroes it where the
              // panels do not pin at all.
              "--run": runEnd(chapter),
            } as React.CSSProperties
          }
        >
          <div data-chapter-mark className={styles.chapterMark} aria-hidden />

          <div className={`${styles.panel} ${styles.panelType}`}>
            <div className={styles.panelInner}>
              <p className={`caps-label ${styles.chapterRail}`}>
                {chapter.rail}
              </p>

              <div className={styles.chapterText}>
                <p
                  className={`caps-label ${styles.chapterIndex}`}
                  data-chapter-fade
                >
                  {chapter.index}
                </p>
                <h2 className={`font-display ${styles.chapterHead}`}>
                  {chapter.lines.map(([text, indent]) => (
                    <span key={text} className={styles.lineClip}>
                      <span
                        data-chapter-line
                        className={styles.chapterLine}
                        style={
                          {
                            display: "block",
                            "--indent": `${indent}em`,
                          } as React.CSSProperties
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
                <p
                  className={`caps-label ${styles.chapterCaption}`}
                  data-chapter-fade
                >
                  {chapter.caption}
                </p>
              </div>
            </div>
          </div>

          <div className={`${styles.panel} ${styles.panelPlate}`}>
            <div className={styles.panelInner}>
              <div className={styles.stack}>
                {chapter.tiles.map(({ slot, image, flip }) => (
                  <div
                    key={slot}
                    className={`${styles.tile} ${SLOT_CLASS[slot]}`}
                    // Read by the stylesheet for the overscan the outgoing
                    // photograph needs on the side it drifts away from.
                    data-seam={flip?.seam}
                  >
                    {flip ? (
                      <>
                        <div
                          className={`${styles.tileLayer} ${styles.tileCurrent}`}
                        >
                          <TileImage image={image} slot={slot} />
                        </div>
                        <div
                          className={`${styles.tileLayer} ${styles.tileNext}`}
                        >
                          <TileImage image={flip.image} slot={slot} />
                        </div>
                      </>
                    ) : (
                      <TileImage image={image} slot={slot} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Carries the dwell as flow height, and is how the capture script
              measures it now that it is not the same for every chapter. */}
          <div data-chapter-dwell className={styles.chapterDwell} aria-hidden />
        </article>
      ))}
    </div>
  );
}
