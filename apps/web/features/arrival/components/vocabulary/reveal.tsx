"use client";

// The entrance devices, their exits, and the one place that decides when they
// play.
//
// Two pieces, because an entrance has two authors. `Reveal` marks an element
// with the device it should enter by and nothing else — it registers no
// trigger, holds no effect, and is a plain element the writer can put anywhere.
// `useRevealBatch` walks an act's subtree once and builds the triggers for
// everything it finds.
//
// Every device has three states, and that is the change from the version that
// had two. A block *arrives* when its top clears the fold on the way down, and
// it *leaves* — fast, accelerating, at half the stagger — when the reader
// scrolls back up past it; coming down again replays the arrival. The reference
// does exactly this on its section blocks, and it is most of what makes that
// page feel inhabited rather than laid out: nothing on it is ever simply there.
//
// The six devices exist so that consecutive blocks can enter differently,
// which is the rule they were built for. They are deliberately not
// interchangeable: `lines` is for reading type, `chars` for display type, `clip`
// for a rule or a plate, `wipe` for a photograph, `rise` for a card or a
// caption, `fade` for anything that should arrive without being noticed.

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  Children,
  isValidElement,
  useEffect,
  type ElementType,
  type ReactNode,
  type RefObject,
} from "react";
import { registerArrivalEases } from "@/features/arrival/lib/motion-eases";
import {
  DUR_ENTER,
  DUR_EXIT,
  EASE_ENTER,
  EASE_EXIT,
  EASE_WIPE,
  RISE_DISTANCE,
  STAGGER_CASCADE,
  STAGGER_CHARS,
} from "@/lib/motion-tokens";
import styles from "./vocabulary.module.css";

export type RevealMode = "lines" | "chars" | "clip" | "wipe" | "rise" | "fade";

/** Where in the viewport a block's top edge has to be for it to arrive. A little
 *  inside the fold: firing on the exact edge means the first frame of the
 *  entrance happens where nobody is looking. */
const ARRIVE_AT = "top 88%";

const NO_PREFERENCE = "(prefers-reduced-motion: no-preference)";

/**
 * The devices that animate the marked element itself.
 *
 * `rise` climbs a length, not a share of its own height — see `RISE_DISTANCE`.
 * `y: 0` in the hide state is not decoration: the element is left where it
 * landed and only fades, so the next arrival's `fromTo` is the only thing that
 * ever puts it back below its mark.
 */
const ELEMENT_DEVICES: Record<
  "clip" | "rise" | "fade",
  { from: gsap.TweenVars; to: gsap.TweenVars; hide: gsap.TweenVars }
> = {
  clip: {
    from: { clipPath: "inset(0% 0% 100% 0%)" },
    to: { clipPath: "inset(0% 0% 0% 0%)" },
    hide: { clipPath: "inset(100% 0% 0% 0%)" },
  },
  rise: {
    from: { autoAlpha: 0, y: RISE_DISTANCE },
    to: { autoAlpha: 1, y: 0 },
    hide: { autoAlpha: 0, y: 0 },
  },
  fade: {
    from: { autoAlpha: 0 },
    to: { autoAlpha: 1 },
    hide: { autoAlpha: 0 },
  },
};

/**
 * The wipe, in the reference's own polygons. The photograph is uncovered by a
 * slanted edge travelling right-to-left while it settles out of an over-scale
 * and a sideways offset; it leaves by the same edge travelling on, and the
 * picture pulls away in the other direction. Four vertices on every polygon,
 * so GSAP can interpolate between them.
 */
const WIPE = {
  enterFrom: "polygon(100% 0%, 100% 0%, 101% 100%, 125% 100%)",
  open: "polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)",
  leaveFrom: "polygon(0% 0%, 100% 0%, 125% 100%, 0% 100%)",
  gone: "polygon(0% 0%, 0% 0%, 0% 100%, 0% 100%)",
  inner: { scale: 1.5, xPercent: 25 },
  innerGone: { scale: 1.5, xPercent: -25 },
} as const;

/** Split display type: the reference's `h` device, character by character. */
const CHARS = {
  from: { opacity: 0, yPercent: 50, rotateY: 90 },
  to: { opacity: 1, yPercent: 0, rotateY: 0 },
  hide: { opacity: 0, yPercent: -50, rotateY: -90 },
} as const;

/** Masked reading lines: the reference's `p` device. */
const LINES = {
  from: { yPercent: 115, y: 0 },
  to: { yPercent: 0, y: 0 },
  hide: { yPercent: -115, y: 0 },
} as const;

/**
 * What `as` is allowed to be.
 *
 * Parameterised rather than a bare `ElementType`, which is the union of every
 * intrinsic tag there is — and TypeScript resolves the children of such a union
 * to `never`, so a bare one type-checks the component and then rejects every
 * use of it. Naming the three props actually passed narrows it to the tags that
 * can accept them, which is all of them and is checked rather than assumed.
 */
type RevealTag = ElementType<{
  className?: string;
  "data-reveal": RevealMode;
  children?: ReactNode;
}>;

export interface RevealProps {
  mode: RevealMode;
  /**
   * The element to render. A div by default, and that default is load-bearing:
   * most of the devices move the element, and a transform does not apply to an
   * inline box at all — a `Reveal` rendered as a bare span would fade and
   * silently refuse to rise.
   */
  as?: RevealTag;
  className?: string;
  children: ReactNode;
}

/**
 * Cut a run of text into words of characters, at render time.
 *
 * At render rather than in the effect, so the server sends the spans and React
 * owns them: an effect that rewrote the block's text nodes would leave React
 * holding references to nodes that no longer exist, and the next re-render of
 * anything above it would throw. Whitespace is left as text between the word
 * spans so the line still wraps where the browser would have wrapped it; an
 * element child — an accent word, a link — travels as one character.
 *
 * Code points rather than grapheme segmentation: the display type on this page
 * is Latin and precomposed Vietnamese, and a segmenter whose output depended on
 * the ICU build would be a hydration mismatch waiting for one exotic glyph.
 */
function splitIntoChars(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === "string" || typeof child === "number") {
      return String(child)
        .split(/(\s+)/)
        .map((part, i) => {
          if (part === "") return null;
          if (/^\s+$/.test(part)) return part;
          return (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: the words are a static split of a static string — the index is the word's identity.
              key={i}
              className={styles.revealWord}
            >
              {Array.from(part).map((glyph, g) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: same — the position in a fixed word.
                  key={g}
                  data-reveal-char
                  className={styles.revealChar}
                >
                  {glyph}
                </span>
              ))}
            </span>
          );
        });
    }
    if (isValidElement(child)) {
      return (
        <span data-reveal-char className={styles.revealChar}>
          {child}
        </span>
      );
    }
    return child;
  });
}

export function Reveal({
  mode,
  as: Tag = "div",
  className,
  children,
}: RevealProps) {
  return (
    <Tag
      data-reveal={mode}
      className={[styles.reveal, className].filter(Boolean).join(" ")}
    >
      {mode === "chars" ? splitIntoChars(children) : children}
    </Tag>
  );
}

/**
 * One line inside a `lines` reveal. Its own clip, so the line rides up out of
 * the edge of the block rather than fading where it stands.
 */
export function RevealLine({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={styles.revealLineClip}>
      <span
        data-reveal-line
        className={[styles.revealLine, className].filter(Boolean).join(" ")}
      >
        {children}
      </span>
    </span>
  );
}

/** Arrive and leave, for one device's worth of targets. */
interface Player {
  reveal(targets: Element[]): void;
  hide(targets: Element[]): void;
}

const enter = (
  targets: gsap.TweenTarget,
  from: gsap.TweenVars,
  to: gsap.TweenVars,
  stagger = STAGGER_CASCADE,
) =>
  gsap.fromTo(targets, from, {
    ...to,
    duration: DUR_ENTER,
    ease: EASE_ENTER,
    stagger,
    overwrite: true,
  });

const leave = (
  targets: gsap.TweenTarget,
  hide: gsap.TweenVars,
  stagger = STAGGER_CASCADE / 2,
) =>
  gsap.to(targets, {
    ...hide,
    duration: DUR_EXIT,
    ease: EASE_EXIT,
    stagger,
    overwrite: true,
  });

function elementPlayer(mode: keyof typeof ELEMENT_DEVICES): Player {
  const device = ELEMENT_DEVICES[mode];
  return {
    reveal: (targets) => enter(targets, device.from, device.to),
    hide: (targets) => leave(targets, device.hide),
  };
}

const inners = (targets: Element[]) =>
  targets.map((el) => el.firstElementChild).filter(Boolean) as Element[];

const wipePlayer: Player = {
  reveal(targets) {
    const vars = {
      duration: DUR_ENTER,
      ease: EASE_WIPE,
      stagger: STAGGER_CASCADE,
      overwrite: true,
    } as const;
    gsap.fromTo(
      targets,
      { clipPath: WIPE.enterFrom },
      { clipPath: WIPE.open, ...vars },
    );
    gsap.fromTo(inners(targets), WIPE.inner, {
      scale: 1,
      xPercent: 0,
      ...vars,
    });
  },
  hide(targets) {
    // The exit is as long as the entrance and on the same curve: the wipe is a
    // camera move, not a dismissal, and a photograph snapping off screen in
    // 0.4s is a cut.
    const vars = {
      duration: DUR_ENTER,
      ease: EASE_WIPE,
      stagger: STAGGER_CASCADE / 2,
      overwrite: true,
    } as const;
    gsap.fromTo(
      targets,
      { clipPath: WIPE.leaveFrom },
      { clipPath: WIPE.gone, ...vars },
    );
    gsap.to(inners(targets), { ...WIPE.innerGone, ...vars });
  },
};

const charsOf = (block: Element) =>
  Array.from(block.querySelectorAll("[data-reveal-char]"));
const linesOf = (block: Element) =>
  Array.from(block.querySelectorAll("[data-reveal-line]"));

// Blocks that arrive together are offset by one cascade step each — the
// reference's `a * stagger` — so two display lines crossing the fold on the
// same frame read as a sequence rather than a chord.
const charsPlayer: Player = {
  reveal: (blocks) => {
    blocks.forEach((block, i) => {
      enter(charsOf(block), CHARS.from, CHARS.to, STAGGER_CHARS).delay(
        i * STAGGER_CASCADE,
      );
    });
  },
  hide: (blocks) => {
    blocks.forEach((block) => {
      leave(charsOf(block), CHARS.hide, STAGGER_CHARS / 2);
    });
  },
};

const linesPlayer: Player = {
  reveal: (blocks) => {
    blocks.forEach((block, i) => {
      enter(linesOf(block), LINES.from, LINES.to).delay(i * STAGGER_CASCADE);
    });
  },
  hide: (blocks) => {
    blocks.forEach((block) => {
      leave(linesOf(block), LINES.hide);
    });
  },
};

/**
 * The wipe as a pair of functions, for a photograph that changes for a reason
 * other than scroll — a tab or a pager swapping plates. The reference uses the
 * same device for its slider transitions as for its scroll reveals, and so
 * should we: `wipeIn` on the element that has just been given a new picture,
 * `wipeOut` on the one giving it up. Both expect the picture to be the
 * element's first child.
 */
export const wipeIn = (el: Element) => wipePlayer.reveal([el]);
export const wipeOut = (el: Element) => wipePlayer.hide([el]);

const PLAYERS: Record<RevealMode, Player> = {
  clip: elementPlayer("clip"),
  rise: elementPlayer("rise"),
  fade: elementPlayer("fade"),
  wipe: wipePlayer,
  chars: charsPlayer,
  lines: linesPlayer,
};

/** Put a device's targets in their from-state before anything is measured. */
function park(mode: RevealMode, targets: Element[]) {
  switch (mode) {
    case "clip":
    case "rise":
    case "fade":
      gsap.set(targets, ELEMENT_DEVICES[mode].from);
      return;
    case "wipe":
      gsap.set(targets, { clipPath: "inset(100% 0% 0% 0%)" });
      gsap.set(inners(targets), WIPE.inner);
      return;
    case "chars":
      for (const block of targets) {
        gsap.set(charsOf(block), CHARS.from);
        // The stylesheet hides the whole block until this moment so that the
        // unsplit line never flashes; now the characters carry the hiding.
        gsap.set(block, { opacity: 1 });
      }
      return;
    case "lines":
      for (const block of targets) gsap.set(linesOf(block), LINES.from);
      return;
  }
}

/**
 * Build the triggers for one act. Call it once, from the act's own component,
 * with a ref to the act's root.
 *
 * Exported as a hook as well as the component below because an act that already
 * has a root ref and an effect of its own should not have to grow a wrapper
 * element to get its reveals.
 */
export function useRevealBatch(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    gsap.registerPlugin(ScrollTrigger);
    registerArrivalEases();

    // Live rather than a one-time read: a reader who turns the preference on
    // half-way down the page gets every unplayed reveal reverted to its
    // finished state, not left hidden at the top of its clip forever.
    const mm = gsap.matchMedia();
    mm.add(NO_PREFERENCE, () => {
      // Which targets are currently shown. `onEnter` and the sweep below can
      // both ask for the same element on the same frame, and an arrival that
      // restarts mid-flight is a flicker.
      const shown = new WeakSet<Element>();
      const armed: {
        trigger: ScrollTrigger;
        reveal: (b: Element[]) => void;
      }[] = [];

      for (const mode of Object.keys(PLAYERS) as RevealMode[]) {
        const targets = Array.from(
          el.querySelectorAll<HTMLElement>(`[data-reveal="${mode}"]`),
        );
        if (targets.length === 0) continue;
        const player = PLAYERS[mode];
        park(mode, targets);

        const reveal = (batch: Element[]) => {
          const fresh = batch.filter((t) => !shown.has(t));
          if (fresh.length === 0) return;
          for (const t of fresh) shown.add(t);
          player.reveal(fresh);
        };
        const hide = (batch: Element[]) => {
          const gone = batch.filter((t) => shown.has(t));
          if (gone.length === 0) return;
          for (const t of gone) shown.delete(t);
          player.hide(gone);
        };

        // One batch per device rather than one trigger per element. An act can
        // easily carry forty marked elements; a batch measures them once and
        // plays the ones that cross the line together as one stagger, which is
        // the difference between a block that arrives and a block that
        // shimmers.
        for (const trigger of ScrollTrigger.batch(targets, {
          start: ARRIVE_AT,
          onEnter: reveal,
          onLeaveBack: hide,
        })) {
          armed.push({ trigger, reveal });
        }
      }

      // Re-measured once every trigger above exists, then swept.
      //
      // The sweep is what makes the first block on a page work at all. A
      // trigger whose start is at or above the top of the document is never
      // *crossed* — the reader is already past it at scroll 0 and can only
      // move away from it — so `onEnter` has no moment to fire on. Anything
      // whose start the scroll has already passed is shown outright.
      ScrollTrigger.refresh();
      for (const { trigger, reveal } of armed) {
        if (trigger.scroll() >= trigger.start) {
          reveal([trigger.trigger as Element]);
        }
      }
    });

    return () => mm.revert();
  }, [root]);
}

/**
 * The batch as a wrapper, for a block that has no root element of its own.
 * Renders nothing but a div; everything marked inside it is one batch.
 */
export function RevealScope({
  className,
  children,
  rootRef,
}: {
  className?: string;
  children: ReactNode;
  /** Supply one to share the element with an act that already holds a ref. */
  rootRef: RefObject<HTMLDivElement | null>;
}) {
  useRevealBatch(rootRef);
  return (
    <div ref={rootRef} className={className}>
      {children}
    </div>
  );
}
