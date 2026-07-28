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
// archetype — how many photographs, what shapes, and how they stand against the
// panel — and no two share one:
//
//   01 portal   a tall frame with a brass-ringed circle breaking its top
//               corner, standing on two sheets of glass offset behind and
//               across it
//   02 shingle  two photographs of comparable area and opposite orientation,
//               crossing in a shallow band, the whole panel mirrored
//   03 bleed    one photograph filling the panel, dissolved into the wall down
//               its left edge and along its foot, the reading over the dissolve
//
// They used to be three stacks of rectangles at slightly different percentages,
// and on a screen that is pinned and otherwise still that read as machinery: a
// panel holds for a whole viewport, which is long enough to notice that the
// frame, the satellite, and the corner are where they were last time. The
// compositions also sat too small inside their own panel — a stack capped at
// 28rem on a 1440 wall left a column of nothing between the reading and the
// page edge. Each archetype now sizes off the height it is given rather than a
// figure in rem, and the last one gives up the measure entirely.
//
// Every photograph in the act turns over. The run is triggered by the landing
// and then plays at its own speed — scrubbing it against scroll tied the seam
// to the wheel, so the same gesture crossed in two frames for anyone moving
// quickly, and on a panel that is otherwise motionless that is the whole of
// what there is to see. What separates the runs is their shape: 01 descends
// from the frame to the circle, 02 takes the shorter breath between two and
// runs its sideways seam out over the page edge it is mirrored onto, and 03
// spends its whole dwell on one seam climbing the panel — the last chapter,
// and the one that hands over to Act 3.

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
/** Landscapes cut wide enough to carry a whole panel on their own — the only
 *  set in the manifest that can, which is why the bled chapter draws from it
 *  rather than from the room and detail crops the other two are built out of. */
const PLATES = arrivalImages["act-2-chapters"];

type ManifestImage = (typeof arrivalImages)[keyof typeof arrivalImages][number];

const bySlug = <T extends { src: string }>(set: readonly T[], slug: string) =>
  set.find((img) => img.src.includes(`/${slug}-`))!;

/** Indent of a display line, in em of its own size. */
type Line = readonly [text: string, indent: number];

/** Which composition a chapter's photographs take. The geometry itself lives in
 *  the archetype blocks of the stylesheet, selected on `data-arch`. */
type Arch = "portal" | "shingle" | "bleed";

/** A tile's place in its archetype, and its class key in the stylesheet. */
type Slot = "frame" | "portal" | "pairFar" | "pairNear" | "bleed";

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
    // Portal: one tall frame, a circle set in a brass ring breaking its top
    // corner, and two sheets of glass — one standing behind the frame, one
    // crossing its foot. The act's establishing composition, and the only one
    // holding anything that is not a photograph. The sheets are what stand the
    // frame on something: a rectangle alone on the wall is what the panel used
    // to be, and it read as flat at every size it was tried at.
    arch: "portal",
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
    // The run descends: the frame goes first and largest, the circle closes.
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
          dur: 0.9,
        },
      },
      {
        slot: "portal",
        // Dark, and full to its own edges. The round-window detail was here
        // first for the obvious reason — a circular subject in a circular tile
        // — and it was the wrong picture for exactly that reason: the window is
        // a dark disc on a pale wall, so a circle cut out of it came back as a
        // dark disc inside a ring of that wall, and the ring read as three
        // times its width. What the slot wants is a photograph with no margin
        // of its own.
        image: bySlug(ROOMS, "room-onsen"),
        // Last, and the shorter sweep — the panel's closing beat. Steam at dusk
        // for a room standing in daylight, which at this size is the whole of
        // what makes a seam inside a circle readable.
        flip: {
          image: bySlug(ROOMS, "room-washigamine"),
          seam: "down",
          at: 1.2,
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
    // Shallower steps than the ragged setting used to take. The display size
    // went up with the compositions, and an indent written in em went up with
    // it — at the old figures the last line of a three-line head ran past the
    // column it is set in before the words did.
    lines: [
      ["Water first,", 0],
      ["then the rest", 1.4],
      ["of the day.", 2.8],
    ],
    body:
      "The bath house opens at six and stays warm until ten. Thermal stone, a " +
      "lap pool under standing light, and treatments drawn from whatever is " +
      "growing on the ridge above the property.",
    caption: "The Bath House",
    // Both turn over, in the order the copy reads: water first, then the rest
    // of the day. The run is the shortest in the act — it opens later than 01's
    // and is done sooner — which is what keeps the middle chapter the shorter
    // breath between the establishing panel and the closing one.
    //
    // This is also the one mirrored panel, and the sideways seam is where that
    // shows: the wide tile hangs off the left page edge here, so its seam runs
    // out to the left rather than in towards the reading.
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
    // The panel gives up the measure. One photograph fills it edge to edge and
    // is dissolved back into the wall down its left side and along its foot,
    // and the reading stands on the dissolve rather than beside the picture.
    //
    // Two panels of photographs held at arm's length inside a grid, and then
    // the act stops holding them: the last chapter is the one the reader is
    // standing in rather than looking at, which is the handover Act 3 opens on.
    // `side` still places the rail and the reading — the photograph is behind
    // both and pays no attention to the columns.
    arch: "bleed",
    lines: [
      ["The day begins", 0],
      ["somewhere", 1.5],
      ["up the hill.", 3],
    ],
    body:
      "Dawn walks up the cedar steps, a garden three minutes from the kitchen, " +
      "and one table of eight for whatever was picked that morning. You leave " +
      "lighter than you arrived.",
    caption: "Land & Table",
    // One seam, and it takes the whole dwell. The other two panels spend their
    // hold on a sequence — a change, then another, then the panel is done —
    // and doing that a third time at full-panel scale would have been the act
    // repeating its one trick at its loudest. A single edge crossing a whole
    // screen slowly is the other thing a seam can be, and it is the one the
    // closing chapter wants.
    //
    // Climbing, because the copy does. The photograph is a peak at first light
    // over a village still in shadow; the one it gives way to is the garden the
    // copy walks to, three minutes downhill from the kitchen — full daylight,
    // full green, which at this size is the whole of what makes the seam
    // readable. Two dawn landscapes would have crossed invisibly.
    tiles: [
      {
        slot: "bleed",
        image: bySlug(PLATES, "snow-peak-roofs"),
        flip: {
          image: bySlug(PLATES, "garden-pavilion"),
          seam: "up",
          at: 0.5,
          dur: 1.75,
        },
      },
    ],
  },
];

/**
 * How far each tile lags its panel as it rises, in % of its own height, by
 * position in the archetype's tile list. Per archetype rather than shared: in
 * `portal` the frame lags least and the circle most, in `shingle` the near tile
 * is the steady one, so the two read as different depths rather than as the
 * same parallax applied to different rectangles. They land on the composition
 * as drawn and hold there for the dwell — the stack reads as depth on the way
 * in and as a photograph once it has arrived.
 *
 * `bleed` is zero, and not for want of trying: a photograph pinned to the
 * panel's own edges has nowhere to lag to, and any offset uncovers the edge it
 * was bled off. The panel's rise carries it, which is the point of bleeding it
 * — the reader is inside that frame rather than watching it arrive.
 */
const LAG: Record<Arch, readonly number[]> = {
  portal: [4, 13],
  shingle: [6, 3],
  bleed: [0],
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
  portal: styles.slotPortal,
  pairFar: styles.slotPairFar,
  pairNear: styles.slotPairNear,
  bleed: styles.slotBleed,
};

/** Rendered width of each slot, from its share of the archetype's stack. */
const SLOT_SIZES: Record<Slot, string> = {
  frame: "(max-width: 900px) 88vw, 34rem",
  portal: "(max-width: 900px) 34vw, 12rem",
  pairFar: "(max-width: 900px) 60vw, 24rem",
  pairNear: "(max-width: 900px) 76vw, 30rem",
  // The one slot whose width is the window's.
  bleed: "100vw",
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
          const lag = LAG[data.arch][t] ?? 0;
          // A bled tile is pinned to the panel's edges and has none to give;
          // skipped rather than tweened to zero so it does not carry a
          // ScrollTrigger that recalculates on every resize to do nothing.
          if (lag === 0) return;
          gsap.fromTo(
            tile,
            { yPercent: lag },
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
                {/* The sheet the composition stands on, offset up and out
                    behind the frame. Rendered ahead of the tiles because that
                    is the order it paints in — every one of these is
                    positioned, so DOM order is the z-scale inside the stack. */}
                {chapter.arch === "portal" && (
                  <div
                    className={`${styles.glass} ${styles.glassSheet}`}
                    data-chapter-fade
                    aria-hidden
                  />
                )}

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

                {/* And the sheet across its foot, which is the one that reads
                    as glass: it is the only layer in the act with a
                    photograph behind it to frost. */}
                {chapter.arch === "portal" && (
                  <div
                    className={`${styles.glass} ${styles.glassBand}`}
                    data-chapter-fade
                    aria-hidden
                  />
                )}

                {/* The reading's ground on the bled panel. The dissolve gets
                    the photograph most of the way out of the words' way; this
                    settles the rest of it, and holds while the photograph
                    turns over to a darker one halfway through the dwell. */}
                {chapter.arch === "bleed" && (
                  <div
                    className={styles.bleedHaze}
                    data-chapter-fade
                    aria-hidden
                  />
                )}
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
