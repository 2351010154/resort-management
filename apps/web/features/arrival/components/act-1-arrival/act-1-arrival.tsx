"use client";

// Act 1 — "The Arrival". One pinned scene in three beats, all of them the same
// photograph seen through a changing aperture:
//
//   the morph  four skewed windows hold slices of the picture, pulled apart
//              over ivory. Their edges straighten, their content slides back
//              into register, and the panels become one rectangle.
//   the seam   the last hairline between them closes.
//   the push   that rectangle grows past the edges of the viewport, and the
//              bougainvillea in front of it — nearer the camera — swells
//              faster and runs off the sides before the picture is full.
//              Nothing fades.
//   the hold   the full photograph stays pinned for one more viewport while
//              Act 2's ivory ribbon is born over it — a band of sheet rising
//              from the foot, with its first opening looking back through at
//              this picture.
//
// The act ends on the photograph at full size rather than blooming to ivory. It
// does not need to: the stage is pinned with `pinSpacing: false`, and Act 2
// paints no ground of its own under its first stretch, so the ribbon rises
// over this one picture and the picture goes on being the ground under the
// ribbon after the pin lets go. One image spans the two acts; a bloom would be
// a cut in the middle of it.
//
// The ground is ivory and the bar is ink over it for as long as that is what the
// bar is standing on. Once the growing photograph reaches it the act claims the
// dark bar, on the same reasoning Act 3 uses when its own frame swells: the bar
// is told what is under it, never which act is on screen.

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useRef, useState } from "react";
import { ACT2_OVERHANG } from "@/features/arrival/lib/act-seams";
import { useArrivalActStore } from "@/features/arrival/lib/act-store";
import { tierSrcSet } from "@/features/arrival/lib/image-srcset";
import { registerArrivalEases } from "@/features/arrival/lib/motion-eases";
import { prefersReducedMotion } from "@/features/arrival/lib/webgl-support";
import {
  DUR_ENTER,
  DUR_SCENE,
  EASE_ENTER,
  EASE_UI,
  STAGGER_CASCADE,
} from "@/lib/motion-tokens";
import styles from "./act-1-arrival.module.css";
import { FLOWER_LEFT, FLOWER_RIGHT, HERO_PLATE } from "./hero-plate";

/**
 * The act's beats as scroll lengths, in viewport heights. Written as lengths
 * rather than as shares of the pin so that adding a beat at the end — which
 * the seam hold is — leaves the others exactly the length they were tuned to.
 *
 * The morph owns the first ~53vh and the push ~76vh: joining the windows is a
 * reading of geometry and wants room, while the push is one accelerating
 * gesture and gets heavy if it is given more scroll than it has motion to
 * fill. Between them is the join hold — a beat with nothing moving, so the
 * reader sees that the two halves are one picture before that picture starts
 * coming at them. Cut it and the join is never actually witnessed; it is
 * simply overtaken.
 *
 * The seam hold is Act 2's number, not this act's: it is how long the ribbon
 * takes to be born over the held picture, and the picture holds for exactly
 * that.
 */
const MORPH_TRAVEL = 53;
const JOIN_HOLD = 11;
const PUSH_TRAVEL = 76;
const SEAM_HOLD = ACT2_OVERHANG;

const PIN_TRAVEL = MORPH_TRAVEL + JOIN_HOLD + PUSH_TRAVEL + SEAM_HOLD;
/** The section: the pinned travel plus the screen the stage occupies. */
const ACT_HEIGHT = `${PIN_TRAVEL + 100}vh`;

/** Progress at which the two windows have become one rectangle. */
const MORPH_END = MORPH_TRAVEL / PIN_TRAVEL;
/** Progress at which the joined frame starts growing. */
const PUSH_START = (MORPH_TRAVEL + JOIN_HOLD) / PIN_TRAVEL;
/** Progress at which the push is done and the picture is held for the seam. */
const PUSH_END = (MORPH_TRAVEL + JOIN_HOLD + PUSH_TRAVEL) / PIN_TRAVEL;

/**
 * Frame scale at rest, where 1 is exactly the viewport.
 *
 * The picture has to be the largest thing on the stage at rest. It is what the
 * reader is being asked to walk into, and a photograph smaller than the plants
 * around it is a thumbnail with a border of flowers — which is what 0.46 gave.
 * The reference holds its resting rectangle at 56% of the viewport's width and
 * 66% of its height; 0.62 was the uniform scale between those. It is larger
 * than that now, and on purpose: the branches are in front of the picture, and
 * the depth between the two planes is only stated where one crosses the other.
 * At 0.62 they met at a corner; at 0.70 each branch lies over the picture by a
 * real margin at rest, so the order is read before anything moves.
 *
 * It is also the length of the push, since the act travels FRAME_END /
 * FRAME_REST — 1.51 here, against the reference's ~1.79. Starting smaller would
 * buy a longer journey, but it buys it by giving away the opening frame, and
 * the opening frame is the one the reader actually stops on.
 *
 * Much wider on a phone, and that is a real limit rather than a preference. The
 * rest frame keeps the viewport's own aspect, so on a portrait screen this is a
 * tall narrow box — and halving a tall narrow box gives two slots rather than
 * two windows, which is a different composition from the one the act is about.
 * The phone therefore keeps the short push and spends its room on the windows;
 * there is less screen for the travel to register on anyway.
 */
const FRAME_REST = 0.7;
const FRAME_REST_NARROW = 0.82;
/**
 * Where the push ends. A little past the viewport rather than exactly on it,
 * because a scale that arrives at 1 decelerates into its own last frame — the
 * push would stop while the reader is still scrolling, which reads as the page
 * having run out rather than as an arrival.
 */
const FRAME_END = 1.06;
/** Percent of the stage the resting frame sits above centre. */
const FRAME_RISE = -2.4;
/**
 * Where the frame parks when motion is not wanted, and clearly larger than the
 * rest scale on purpose: a reader who gets no push never sees the picture
 * arrive, so the one frame they do get is the one worth showing at size. It has
 * to stay ahead of FRAME_REST by a real margin to mean anything, which 0.7 stopped
 * doing once the resting frame came up to 0.62, and 0.70 is now the rest itself.
 */
const FRAME_STILL = 0.86;
const FRAME_STILL_RISE = -6;

/**
 * Scale of the picture inside each window at rest.
 *
 * This is the crop, and it is separate from the frame's own scale on purpose.
 * The windows are small at rest and the picture in them is tight; both relax
 * together, so the join is not only two shapes meeting but a view opening out.
 * One scale cannot do both — the frame's would have to grow and shrink at once.
 *
 * Gentle, because the resting frame is no longer small. A crop that opens by a
 * fifth was covering for a picture the reader could barely read; over a frame
 * at 0.70 the same figure reads as the photograph flinching as the halves meet.
 */
const MEDIA_REST = 1.12;
/** Percent each window's content is pulled outward at rest, x and y. */
const SPLIT_X = 4.6;
const SPLIT_Y = 2.8;

/** Below this the frame takes the narrow rest scale and the loops go still. */
const NARROW = "(max-width: 700px)";

/**
 * Magnification of the branches at the end of the push, where 1 is their rest
 * size.
 *
 * Not one plane, and that is the whole difference between walking in and
 * zooming. A camera moving forward magnifies what is near it far harder than
 * what is far from it, and it is that *difference* in rate — not the motion
 * itself — that the eye reads as depth. So the branches are not given a curve
 * of their own: they are put on a plane nearer the camera than the picture and
 * magnified by the same dolly that grows the picture, which is what
 * `flowerMagnification` computes. This number places that plane. It is chosen
 * so the branches have cleared the viewport by the time the picture is about
 * four fifths of it — the reference has them gone well before the frame is
 * full — and everything past that point happens off screen.
 *
 * Both planes scale about the centre of the viewport, never about themselves.
 * One vanishing point is the perspective; a branch scaling about its own middle
 * grows in place, which is a flower swelling, not a flower being passed.
 *
 * The one thing they never do is fade. A branch that thins out is a branch
 * dissolving in place, and nothing you travel toward dissolves; the beat reads
 * as a crossfade between two pictures the moment it happens. These leave by
 * going past the edge of the viewport, which is a real exit.
 */
const FLOWER_END = 12;

/**
 * Frame scale at which the growing picture has covered the concierge bar.
 *
 * The bar's ground is the top of the stage, so it stops being ivory the moment
 * the frame's top edge passes it: `50 - 50 * scale` percent down the stage, and
 * the bar sits within the first eight of those. Stated as a scale rather than
 * as a push progress so it stays true when the rest scale moves. Act 3 hands
 * the bar over on the same reasoning as its own frame swells — the bar is told
 * what it is standing on, never which act is on screen.
 */
const NAV_COVER_SCALE = 0.84;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ramp = (value: number, from: number, to: number) =>
  clamp01((value - from) / (to - from));

/**
 * The morph's curve. Eased at both ends because this beat is a shape settling
 * into another shape, and a linear polygon interpolation lands on its final
 * geometry with the same speed it left the first — the windows snap square.
 */
const easeInOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

/**
 * The push's curve, and it eases *in* rather than out. A plane approaching a
 * camera grows faster the nearer it gets, so the acceleration is the sensation
 * of travelling toward it; easing out instead spends the travel early and parks,
 * which is the same distance covered and none of the arrival.
 */
const easeIn = (t: number) => t * t;

/**
 * How much a plane nearer the camera has grown, given how much the picture has.
 *
 * A camera that has moved forward by `z` magnifies a plane at distance `d` by
 * `d / (d - z)`. The picture's magnification so far, `picture`, therefore fixes
 * `z` as a fraction of the picture's distance, and the branches' plane is set
 * at the fraction of that distance which lands them on FLOWER_END when the
 * picture lands on `pictureEnd`. Taking the picture's own progress as the
 * input, rather than the scroll's, keeps the two planes on one dolly whatever
 * curve the push is given.
 */
function flowerMagnification(picture: number, pictureEnd: number): number {
  const nearer = (1 - 1 / FLOWER_END) / (1 - 1 / pictureEnd);
  return 1 / (1 - nearer * (1 - 1 / picture));
}

/** A window, as the four corners of its clip polygon in percent. */
type Quad = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/**
 * Rest geometry. The left window is tall and sits low, the right one shorter
 * and high — the stagger is what stops the pair reading as one picture that has
 * simply been cut in half, which is what it will turn out to be.
 *
 * The slant lives here, in the clip, and never in a transform. A skewed
 * transform would take the photograph with it and lean the building; a clipped
 * one cuts an angled edge across content that stays upright, which is the
 * difference between a slanted window and a slanted world.
 */
const LEFT_REST: Quad = [14, 26, 47.4, 14, 47.4, 96, 14, 88];
const RIGHT_REST: Quad = [52.6, 6, 86, 18, 86, 78, 52.6, 90];
const OUTER_LEFT_REST: Quad = [-5, 18, 10, 27, 10, 77, -5, 86];
const OUTER_RIGHT_REST: Quad = [90, 28, 105, 20, 105, 86, 90, 77];

/**
 * Joined geometry: four strips with small overlaps to prevent raster seams.
 *
 * The overlap is the seam. Two windows meeting at exactly 50% leave a sub-pixel
 * crack that the compositor fills with whatever is behind them, and what is
 * behind them is ivory — so the finished picture keeps a bright hairline down
 * its middle at some device pixel ratios and not others.
 */
const LEFT_JOINED: Quad = [9.95, 0, 50.05, 0, 50.05, 100, 9.95, 100];
const RIGHT_JOINED: Quad = [49.95, 0, 90.05, 0, 90.05, 100, 49.95, 100];
const OUTER_LEFT_JOINED: Quad = [0, 0, 10.05, 0, 10.05, 100, 0, 100];
const OUTER_RIGHT_JOINED: Quad = [89.95, 0, 100, 0, 100, 100, 89.95, 100];

/** Interpolate two quads into a `clip-path` polygon. */
function quadPath(from: Quad, to: Quad, t: number): string {
  const points: string[] = [];
  for (let i = 0; i < 8; i += 2) {
    const x = from[i] + (to[i] - from[i]) * t;
    const y = from[i + 1] + (to[i + 1] - from[i + 1]) * t;
    points.push(`${x.toFixed(2)}% ${y.toFixed(2)}%`);
  }
  return `polygon(${points.join(", ")})`;
}

/** The transform a window's content carries at morph progress `t`. */
function mediaTransform(side: -1 | 1, t: number): string {
  const held = 1 - t;
  const x = side * SPLIT_X * held;
  const y = -side * SPLIT_Y * held;
  const scale = MEDIA_REST + (1 - MEDIA_REST) * t;
  return `translate(${x.toFixed(3)}%, ${y.toFixed(3)}%) scale(${scale.toFixed(4)})`;
}

export function Act1Arrival() {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const leftMediaRef = useRef<HTMLDivElement>(null);
  const rightMediaRef = useRef<HTMLDivElement>(null);
  const outerLeftRef = useRef<HTMLDivElement>(null);
  const outerRightRef = useRef<HTMLDivElement>(null);
  const outerLeftMediaRef = useRef<HTMLDivElement>(null);
  const outerRightMediaRef = useRef<HTMLDivElement>(null);
  const foregroundRef = useRef<HTMLDivElement>(null);
  /** Whether this act currently holds the bar's dark claim. */
  const navDark = useRef(false);
  // null until the client capability probe has run, so the server and the first
  // client render agree on which of the two scenes is in the tree
  const [animate, setAnimate] = useState<boolean | null>(null);
  // Posters render first and the loops swap in after mount, so the branches are
  // never a hole while two videos decode. Narrow screens keep the posters.
  const [playing, setPlaying] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const setNavDark = useArrivalActStore((s) => s.setNavDark);

  useEffect(() => {
    const motion = !prefersReducedMotion();
    const small = window.matchMedia(NARROW).matches;
    setAnimate(motion);
    setNarrow(small);
    setPlaying(motion && !small);
  }, []);

  // Only decode while the act is on screen — two loops running behind a page the
  // reader has already scrolled past is pure heat.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !playing) return;
    const videos = Array.from(stage.querySelectorAll("video"));
    const io = new IntersectionObserver(
      ([entry]) => {
        for (const video of videos) {
          if (entry.isIntersecting) video.play().catch(() => {});
          else video.pause();
        }
      },
      { threshold: 0 },
    );
    io.observe(stage);
    return () => io.disconnect();
  }, [playing]);

  useEffect(() => {
    if (!animate) return;
    const section = sectionRef.current;
    const stage = stageRef.current;
    const frame = frameRef.current;
    const left = leftRef.current;
    const right = rightRef.current;
    const leftMedia = leftMediaRef.current;
    const rightMedia = rightMediaRef.current;
    const outerLeft = outerLeftRef.current;
    const outerRight = outerRightRef.current;
    const outerLeftMedia = outerLeftMediaRef.current;
    const outerRightMedia = outerRightMediaRef.current;
    const foreground = foregroundRef.current;
    if (!section || !stage || !frame || !left || !right) return;
    if (!leftMedia || !rightMedia || !foreground) return;
    if (!outerLeft || !outerRight || !outerLeftMedia || !outerRightMedia)
      return;
    gsap.registerPlugin(ScrollTrigger);
    registerArrivalEases();

    const ctx = gsap.context(() => {
      // The entrance. The windows arrive before anything is scrolled, so the
      // first thing the reader meets is the pair separating out of the ivory
      // rather than a composition that was already finished when they got here.
      gsap.from([outerLeft, left, right, outerRight], {
        autoAlpha: 0,
        y: 34,
        duration: DUR_ENTER,
        ease: EASE_ENTER,
        stagger: STAGGER_CASCADE,
      });
      // The branches only ever move once, here, arriving with the windows. From
      // then on they are page furniture and the push leaves them where they are.
      gsap.from(`.${styles.flower}`, {
        autoAlpha: 0,
        duration: DUR_SCENE,
        ease: EASE_UI,
        delay: 0.2,
      });
      ScrollTrigger.create({
        trigger: section,
        start: "top top",
        end: "bottom bottom",
        // The act takes the hard scrub. Its windows share an edge with each
        // other and with the frame they are cut into, and a layer lagging the
        // one it is registered against is a visible crack down the seam. The
        // drift lag is for things that move relative to the page, not for
        // things that have to stay welded to each other.
        scrub: true,
        onUpdate: (self) => {
          const morph = easeInOut(ramp(self.progress, 0, MORPH_END));
          const push = easeIn(ramp(self.progress, PUSH_START, PUSH_END));

          left.style.clipPath = quadPath(LEFT_REST, LEFT_JOINED, morph);
          right.style.clipPath = quadPath(RIGHT_REST, RIGHT_JOINED, morph);
          leftMedia.style.transform = mediaTransform(-1, morph);
          rightMedia.style.transform = mediaTransform(1, morph);
          outerLeft.style.clipPath = quadPath(
            OUTER_LEFT_REST,
            OUTER_LEFT_JOINED,
            morph,
          );
          outerRight.style.clipPath = quadPath(
            OUTER_RIGHT_REST,
            OUTER_RIGHT_JOINED,
            morph,
          );
          outerLeftMedia.style.transform = mediaTransform(-1, morph);
          outerRightMedia.style.transform = mediaTransform(1, morph);

          const rest = narrow ? FRAME_REST_NARROW : FRAME_REST;
          const scale = rest + (FRAME_END - rest) * push;
          frame.style.transform =
            `translateY(${(FRAME_RISE * (1 - push)).toFixed(3)}%) ` +
            `scale(${scale.toFixed(4)})`;

          // The branches sit on one layer the size of the viewport, in front
          // of the picture, and that layer is what scales — so both branches
          // fly outward from the same centre the picture grows from, and the
          // one nearer a corner leaves sooner. No opacity is written: they
          // leave the frame, they do not dissolve in it.
          const magnified = flowerMagnification(scale / rest, FRAME_END / rest);
          foreground.style.transform = `scale(${magnified.toFixed(4)})`;

          // The bar is told what it is standing on. Guarded rather than
          // written every frame: the store's setter is idempotent, but a
          // zustand write per scroll frame is a subscription notified sixty
          // times a second to say nothing changed.
          const covered = scale >= NAV_COVER_SCALE;
          if (covered !== navDark.current) {
            navDark.current = covered;
            setNavDark(1, covered);
          }
        },
      });

      ScrollTrigger.create({
        trigger: section,
        start: "top top",
        end: "bottom bottom",
        pin: stage,
        pinSpacing: false,
      });
    }, section);

    return () => {
      ctx.revert();
      // A claim outlives the scroll trigger that made it, and this act is still
      // mounted while Act 2 owns the viewport — an unreleased claim would leave
      // the bar ivory over Act 2's ivory.
      if (navDark.current) {
        navDark.current = false;
        setNavDark(1, false);
      }
    };
  }, [animate, narrow, setNavDark]);

  // Both paths paint their own from-state inline, so the first frame is already
  // the right geometry — an effect that sets it afterwards is one frame of the
  // act with every window square and stacked.
  const still = animate === false;
  const framePose = still
    ? `translateY(${FRAME_STILL_RISE}%) scale(${FRAME_STILL})`
    : `translateY(${FRAME_RISE}%) scale(${narrow ? FRAME_REST_NARROW : FRAME_REST})`;

  const panel = (side: -1 | 1) => {
    const rest = side === -1 ? LEFT_REST : RIGHT_REST;
    const joined = side === -1 ? LEFT_JOINED : RIGHT_JOINED;
    return {
      clipPath: quadPath(rest, joined, still ? 1 : 0),
      transform: mediaTransform(side, still ? 1 : 0),
    };
  };

  const leftPose = panel(-1);
  const rightPose = panel(1);

  const flower = (loop: typeof FLOWER_LEFT, className: string, alt: string) => (
    <div className={`${styles.flower} ${className}`} aria-hidden>
      {playing ? (
        <video
          className={styles.flowerMedia}
          muted
          loop
          playsInline
          autoPlay
          preload="none"
          poster={`${loop.base}.webp`}
        >
          <source src={`${loop.base}.webm`} type="video/webm" />
        </video>
      ) : (
        <img
          className={styles.flowerMedia}
          src={`${loop.base}.webp`}
          alt={alt}
          decoding="async"
        />
      )}
    </div>
  );

  return (
    <section
      ref={sectionRef}
      data-act={1}
      className={styles.section}
      style={{ height: animate ? ACT_HEIGHT : "auto" }}
    >
      <div ref={stageRef} className={styles.stage}>
        {animate === null ? null : (
          <>
            <div
              ref={frameRef}
              className={styles.frame}
              style={{ transform: framePose }}
            >
              {([-1, 1] as const).map((side) => (
                <div
                  key={side}
                  ref={side === -1 ? outerLeftRef : outerRightRef}
                  className={styles.panel}
                  style={{
                    clipPath: quadPath(
                      side === -1 ? OUTER_LEFT_REST : OUTER_RIGHT_REST,
                      side === -1 ? OUTER_LEFT_JOINED : OUTER_RIGHT_JOINED,
                      still ? 1 : 0,
                    ),
                  }}
                  aria-hidden
                >
                  <div
                    ref={side === -1 ? outerLeftMediaRef : outerRightMediaRef}
                    className={styles.panelMedia}
                    style={{ transform: mediaTransform(side, still ? 1 : 0) }}
                  >
                    <img
                      src={HERO_PLATE.src}
                      srcSet={tierSrcSet(HERO_PLATE)}
                      sizes="100vw"
                      width={HERO_PLATE.width}
                      height={HERO_PLATE.height}
                      alt=""
                      decoding="async"
                    />
                  </div>
                </div>
              ))}
              <div
                ref={leftRef}
                className={styles.panel}
                style={{ clipPath: leftPose.clipPath }}
              >
                <div
                  ref={leftMediaRef}
                  className={styles.panelMedia}
                  style={{ transform: leftPose.transform }}
                >
                  <img
                    src={HERO_PLATE.src}
                    srcSet={tierSrcSet(HERO_PLATE)}
                    sizes="100vw"
                    width={HERO_PLATE.width}
                    height={HERO_PLATE.height}
                    alt={HERO_PLATE.alt}
                    decoding="async"
                  />
                </div>
              </div>
              {/* The same photograph, and deliberately not described a second
                  time: the two windows are one picture, and a screen reader
                  that hears the terrace twice is being told there are two. */}
              <div
                ref={rightRef}
                className={styles.panel}
                style={{ clipPath: rightPose.clipPath }}
                aria-hidden
              >
                <div
                  ref={rightMediaRef}
                  className={styles.panelMedia}
                  style={{ transform: rightPose.transform }}
                >
                  <img
                    src={HERO_PLATE.src}
                    srcSet={tierSrcSet(HERO_PLATE)}
                    sizes="100vw"
                    width={HERO_PLATE.width}
                    height={HERO_PLATE.height}
                    alt=""
                    decoding="async"
                  />
                </div>
              </div>
            </div>

            <div ref={foregroundRef} className={styles.foreground}>
              {flower(
                FLOWER_LEFT,
                styles.flowerLeft,
                "Bougainvillea in flower",
              )}
              {flower(
                FLOWER_RIGHT,
                styles.flowerRight,
                "Bougainvillea in flower",
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
