"use client";

// Things that move against the page as it scrolls.
//
// The page is smoothed once by Lenis. These layers are smoothed a second time
// (`SCRUB_DRIFT`), so they trail the hand and go on settling for half a second
// after it stops — which is the single device most responsible for the
// reference reading as cinema rather than as a document with animations on it.
//
// Three pieces:
//
//   `Drift`       a block that travels ±10% of its own height across its
//                 passage through the viewport. `down` trails the page and
//                 `up` leads it; two neighbouring columns given one each is the
//                 reference's contrast device (its `interior-s_l` / `_r`).
//   `DriftFrame`  a clipped window with a height of its own.
//   `DriftImage`  the photograph inside it, bleeding past the window by exactly
//                 the distance it travels so no edge ever shows. `through` is
//                 the classic parallax; `in` slides up into place as the frame
//                 enters and then holds; `out` starts sliding down as the frame
//                 leaves.
//
// And one hook, `useBlockArrival`, for a block that should visibly grow into
// place — the reference's footer and its location block both scale in from
// three quarters under the scrub.
//
// Nothing here runs on a clock. Every tween is scrubbed off the element's own
// position, and every one sits behind the reduced-motion query, like the rest
// of the vocabulary.

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  createElement,
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
} from "react";
import {
  BLOCK_ARRIVAL_SCALE,
  DRIFT_BLOCK,
  DRIFT_IMAGE,
  DRIFT_IMAGE_EDGE,
  SCRUB_DRIFT,
} from "@/lib/motion-tokens";
import styles from "./vocabulary.module.css";

const NO_PREFERENCE = "(prefers-reduced-motion: no-preference)";

/** The block tags a drift can be. Block-level only: a transform does not apply
 *  to an inline box, and a `div` inside a `p` is not HTML. */
type BlockTag = "div" | "span" | "figure" | "li";

export type DriftMode = "down" | "up";

export interface DriftProps {
  /** `down` trails the page (the reference's `ctn-down`); `up` leads it. */
  mode: DriftMode;
  /** Travel, in per cent of the element's own height. The reference's is 10. */
  amount?: number;
  as?: BlockTag;
  className?: string;
  children: ReactNode;
}

export function Drift({
  mode,
  amount = DRIFT_BLOCK,
  as = "div",
  className,
  children,
}: DriftProps) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    gsap.registerPlugin(ScrollTrigger);

    const mm = gsap.matchMedia();
    mm.add(NO_PREFERENCE, () => {
      const sign = mode === "down" ? -1 : 1;
      gsap.fromTo(
        el,
        { yPercent: sign * amount },
        {
          yPercent: -sign * amount,
          ease: "none",
          scrollTrigger: {
            trigger: el,
            // A quarter-screen either side of the viewport, so the block is
            // already moving when it appears and still moving when it leaves.
            start: "top 125%",
            end: "bottom -25%",
            scrub: SCRUB_DRIFT,
          },
        },
      );
    });

    return () => mm.revert();
  }, [mode, amount]);

  return createElement(
    as,
    {
      ref,
      "data-drift": mode,
      className: [styles.drift, className].filter(Boolean).join(" "),
    },
    children,
  );
}

export interface DriftFrameProps {
  as?: BlockTag;
  className?: string;
  children: ReactNode;
}

/**
 * The window a `DriftImage` moves behind. It clips, and it has to have a height
 * of its own — an aspect-ratio, or a height from the caller's stylesheet —
 * because the image inside is absolute and gives it none.
 */
export function DriftFrame({
  as = "div",
  className,
  children,
}: DriftFrameProps) {
  return createElement(
    as,
    {
      "data-drift-frame": "",
      className: [styles.driftFrame, className].filter(Boolean).join(" "),
    },
    children,
  );
}

export type DriftImageMode = "through" | "in" | "out";

/**
 * How each image mode moves: travel as a share of the frame's height, and the
 * stretch of the frame's passage it moves across. Travel is in pixels of the
 * frame rather than per cent of the image, so the bleed the image is given is
 * exactly the distance it goes and not a per cent of a bigger box.
 *
 * `in` is scrubbed hard, as it is on the reference: the picture is landing in
 * its frame, and a landing that lags reads as the frame arriving empty.
 */
const IMAGE_MODES: Record<
  DriftImageMode,
  {
    from: number;
    to: number;
    start: string;
    end: string;
    scrub: number | true;
  }
> = {
  through: {
    from: -DRIFT_IMAGE,
    to: DRIFT_IMAGE,
    start: "top bottom",
    end: "bottom top",
    scrub: SCRUB_DRIFT,
  },
  in: {
    from: -DRIFT_IMAGE_EDGE,
    to: 0,
    start: "top bottom",
    end: "bottom bottom",
    scrub: true,
  },
  out: {
    from: 0,
    to: DRIFT_IMAGE_EDGE,
    start: "bottom bottom",
    end: "bottom top",
    scrub: SCRUB_DRIFT,
  },
};

export interface DriftImageProps {
  mode?: DriftImageMode;
  className?: string;
  /** The `img` (or `video`). One child; it is sized to fill the bleed box. */
  children: ReactNode;
}

export function DriftImage({
  mode = "through",
  className,
  children,
}: DriftImageProps) {
  const ref = useRef<HTMLDivElement>(null);
  const spec = IMAGE_MODES[mode];
  const bleed = Math.max(Math.abs(spec.from), Math.abs(spec.to));

  useEffect(() => {
    const el = ref.current;
    const frame = el?.closest<HTMLElement>("[data-drift-frame]");
    if (!el || !frame) return;
    gsap.registerPlugin(ScrollTrigger);

    const mm = gsap.matchMedia();
    mm.add(NO_PREFERENCE, () => {
      // Function-valued so a resize re-reads the frame's height rather than
      // keeping the pixel travel it was built with.
      gsap.fromTo(
        el,
        { y: () => (spec.from / 100) * frame.clientHeight },
        {
          y: () => (spec.to / 100) * frame.clientHeight,
          ease: "none",
          scrollTrigger: {
            trigger: frame,
            start: spec.start,
            end: spec.end,
            scrub: spec.scrub,
            invalidateOnRefresh: true,
          },
        },
      );
    });

    return () => mm.revert();
  }, [spec]);

  return (
    <div
      ref={ref}
      data-drift-image={mode}
      className={[styles.driftMedia, className].filter(Boolean).join(" ")}
      style={{ "--drift-bleed": `${bleed}%` } as CSSProperties}
    >
      {children}
    </div>
  );
}

/**
 * Grow a block into place as it arrives: opacity 0 → 1 and scale 0.75 → 1,
 * scrubbed from the block's top reaching 30% down the viewport to its bottom
 * reaching the bottom edge. The reference's `.loc-info-s` and `.footer-s`.
 *
 * `opacity`, not `autoAlpha`: the block's links stay in the tab order while it
 * is still faint, which is where a keyboard reader expects them to be.
 *
 * The default end is the later of two marks. "Bottom reaches the fold" is the
 * reference's, and it is only reachable for a block at least seven tenths of
 * a viewport tall — on a shorter one that scroll position lies *above* the
 * start, ScrollTrigger collapses the range, and the block pops from faint to
 * whole in one frame. A short block therefore finishes as its top nears the
 * top of the frame instead, which is the same gesture at the same pace.
 *
 * Both marks are held inside the page. The last block on it is the case that
 * needs it: the footer's top never reaches 30% of a tall viewport, because the
 * document stops scrolling before it gets there — so the start lay past the
 * furthest the reader can go, the scrub never began, and the footer stayed at
 * opacity 0 with its links still in the tab order. This is the bottom-of-page
 * half of what `reveal.tsx` sweeps for at the top, where a start above the
 * first screen is never crossed either.
 */
export function useBlockArrival(
  ref: RefObject<HTMLElement | null>,
  { start = "top 30%", end }: { start?: string; end?: string } = {},
) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    gsap.registerPlugin(ScrollTrigger);

    // A mark the reader cannot scroll to, brought back to the last one they
    // can. `clamp()` below is ScrollTrigger's own form of this for the marks
    // written as strings; the end this hook computes itself is a number, and a
    // number is not something `clamp()` parses.
    const reachable = (mark: number) =>
      Math.min(mark, ScrollTrigger.maxScroll(window));

    const laterMark = () => {
      const rect = el.getBoundingClientRect();
      const y = window.scrollY;
      const bottomAtFold = y + rect.bottom - window.innerHeight;
      const topNearTop = y + rect.top - window.innerHeight * 0.05;
      return reachable(Math.max(bottomAtFold, topNearTop));
    };

    const mm = gsap.matchMedia();
    mm.add(NO_PREFERENCE, () => {
      gsap.fromTo(
        el,
        { opacity: 0, scale: BLOCK_ARRIVAL_SCALE },
        {
          opacity: 1,
          scale: 1,
          ease: "none",
          scrollTrigger: {
            trigger: el,
            start: `clamp(${start})`,
            end: end === undefined ? laterMark : `clamp(${end})`,
            scrub: SCRUB_DRIFT,
            invalidateOnRefresh: true,
          },
        },
      );
    });

    return () => mm.revert();
  }, [ref, start, end]);
}
