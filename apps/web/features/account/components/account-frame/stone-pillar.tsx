"use client";

// The account's stone: a limestone pillar with the house's name cut at its
// head and the screen's own line cut in its field — and nothing else. The
// stone is the heavier of the page's two materials, so it says the least.
//
// **Nothing is laid on it.** The profile's first stone wall carried an ivory
// plaque mounted on the flutes, and a plate ridden up over its foot — the dates
// step's composition, in another material — and both read as cards set down on
// a picture. Here the stone is a material and is treated as one: words are
// carved into it (`carving.tsx`), and the one picture it holds is seen through
// an arch cut into it (`arch-frame.tsx`). It stands beside the ivory book, not
// under it, and the two meet at a shadow gap.
//
// **The light is the house's, now.** The pillar is lit by the hour at the
// property (`house-hour.ts`): the foliage shadow from the east in the morning,
// short at midday, long and warm from the west before dusk, and gone after
// dark, when a lamp warms the foot of the wall instead. The shadow still sways
// on a CSS loop and leans from a fine pointer — the arrival's gobo, still
// enough for the funnel's bundle. Nothing on the wall says what time it is;
// the light is the only way the stone tells it.

import { type ReactNode, type RefObject, useEffect, useRef } from "react";
import styles from "./stone-pillar.module.css";

/** The pillar's four cuts, at their real pixel widths — portrait, 2:3. */
const WALL = {
  src: "/images/account/limestone-pillar-960.webp",
  srcSet: [640, 960, 1280, 1536]
    .map((width) => `/images/account/limestone-pillar-${width}.webp ${width}w`)
    .join(", "),
  width: 1536,
  height: 2304,
} as const;

/** The shadow as it falls from the west, and its mirror for the morning sun —
 *  a file of its own, so it sways about its own entry corner. */
const LEAVES = {
  west: leafCuts("leaf-shadow"),
  east: leafCuts("leaf-shadow-east"),
  width: 1536,
  height: 1024,
} as const;

function leafCuts(name: string): {
  readonly src: string;
  readonly srcSet: string;
} {
  return {
    src: `/images/account/${name}-1536.webp`,
    srcSet: [768, 1536]
      .map((width) => `/images/account/${name}-${width}.webp ${width}w`)
      .join(", "),
  };
}

/** The light washes, one per light, crossfaded rather than re-drawn. */
const WASHES = ["morning", "daylight", "golden", "lamplight"] as const;

/**
 * The stone, lit by whatever `data-light` the frame around it carries: until
 * the browser has read the clock the wall is evenly lit, and the hour's light
 * arrives on it a moment later.
 */
export function StonePillar({ children }: { readonly children: ReactNode }) {
  const pillarRef = useRef<HTMLDivElement>(null);

  useLeaningLight(pillarRef);

  return (
    <div className={styles.pillar} ref={pillarRef}>
      {/* `fetchPriority="high"` and no lazy loading: this is the screen's
          largest paint and it is in the first viewport by construction. */}
      <img
        alt=""
        className={styles.wall}
        decoding="async"
        fetchPriority="high"
        height={WALL.height}
        sizes="(width >= 64rem) 42vw, 100vw"
        src={WALL.src}
        srcSet={WALL.srcSet}
        width={WALL.width}
      />

      {WASHES.map((light) => (
        <span
          aria-hidden="true"
          className={styles.wash}
          data-for={light}
          key={light}
        />
      ))}

      <div className={styles.face}>
        <a className={styles.mark} href="/">
          <span aria-hidden="true" className={styles.markLip} />
          <span aria-hidden="true" className={styles.markCut} />
          <span className={styles.markName}>Mariva home</span>
        </a>

        <div className={styles.field}>{children}</div>
      </div>

      {/* Two rigs for one shadow — the branch entering from the west, and its
          mirror for the morning sun from the east — because a shadow cannot
          be eased from one side of a wall to the other. Multiplied over the
          stone and its carvings, under nothing a guest can press. */}
      {(["west", "east"] as const).map((from) => (
        <div
          aria-hidden="true"
          className={styles.rig}
          data-from={from}
          key={from}
        >
          <img
            alt=""
            className={styles.leaves}
            decoding="async"
            height={LEAVES.height}
            sizes="(width >= 64rem) 64vw, 150vw"
            src={LEAVES[from].src}
            srcSet={LEAVES[from].srcSet}
            width={LEAVES.width}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * Leans the light away from a fine pointer, the way the arrival's gobo swings
 * under the cursor.
 *
 * Two custom properties on the pillar, each in −0.5…0.5, written at most once
 * a frame; the stylesheet turns them into a `translate` and eases it, so the
 * listener never animates anything itself. Nothing is registered for a coarse
 * pointer — a finger has no hover to lean away from — or when the guest has
 * asked for less motion, which leaves the shadow exactly where it was drawn.
 */
function useLeaningLight(ref: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const pillar = ref.current;

    if (
      !pillar ||
      !window.matchMedia("(pointer: fine)").matches ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    let frame = 0;

    const lean = (x: number, y: number) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        pillar.style.setProperty("--lean-x", x.toFixed(3));
        pillar.style.setProperty("--lean-y", y.toFixed(3));
      });
    };

    const onMove = (event: PointerEvent) => {
      const box = pillar.getBoundingClientRect();

      lean(
        (event.clientX - box.left) / box.width - 0.5,
        (event.clientY - box.top) / box.height - 0.5,
      );
    };

    const onLeave = () => lean(0, 0);

    pillar.addEventListener("pointermove", onMove);
    pillar.addEventListener("pointerleave", onLeave);

    return () => {
      cancelAnimationFrame(frame);
      pillar.removeEventListener("pointermove", onMove);
      pillar.removeEventListener("pointerleave", onLeave);
    };
  }, [ref]);
}
