import type { Page } from "@playwright/test";

/* Whether an operational screen makes the operator wait for it to arrive.
 *
 * `NFR-04` forbids entrance animation on the console's operational surfaces,
 * and the screens themselves say why: a row that expands with a transition is a
 * row an operator is waiting on mid-conversation. So this catches the thing at
 * the only moment it exists — while it is running — rather than by reading
 * class names, which a build step is free to rename.
 *
 * ## What is an entrance animation and what is not
 *
 * A **keyframe animation** on anything inside the shell counts, running or
 * merely declared. Nothing in an operational screen has a reason to declare
 * one.
 *
 * A **transition** counts only when it moves one of the properties an entrance
 * is made of — opacity, transform, size, filter. The console transitions
 * colours deliberately: a rail entry and a count card both tint under the
 * pointer, and `count-card.tsx` states outright that the hover colour is the
 * only transition it has. Failing that would be failing the design the
 * requirement is written to protect.
 *
 * The recorder starts before the document does and samples every frame, so an
 * animation that plays for 200 ms during hydration is caught rather than missed
 * by a check that looked once, too late.
 */

/** The properties an entrance is made of. A transition over any of these,
 *  played while a screen arrives, is an entrance animation whatever it is
 *  called. */
const ENTRANCE_PROPERTIES = [
  "opacity",
  "transform",
  "translate",
  "scale",
  "rotate",
  "height",
  "max-height",
  "width",
  "max-width",
  "filter",
  "clip-path",
];

/** Where the console's own surfaces are. Deliberately not the whole document:
 *  Next's development overlay is not a screen the requirement is about. */
const SHELL_ROOTS = 'main, nav[aria-label="Console sections"]';

export interface AnimationSighting {
  /** `animation` for a keyframe animation, `transition` for a transition. */
  readonly kind: string;
  /** The keyframe name, or the property being transitioned. */
  readonly name: string;
  readonly target: string;
  readonly durationMs: number;
}

declare global {
  interface Window {
    __marivaAnimationSightings?: Map<string, AnimationSighting>;
  }
}

/** Starts watching. Call before the first navigation. */
export async function installAnimationWatch(page: Page): Promise<void> {
  await page.addInitScript(
    ({ properties, roots }) => {
      const sightings = new Map<string, AnimationSighting>();
      window.__marivaAnimationSightings = sightings;

      const name = (target: Element): string => {
        const id = target.id === "" ? "" : `#${target.id}`;
        const classes = target.className;

        return `${target.tagName.toLowerCase()}${id}${
          typeof classes === "string" && classes !== ""
            ? `.${classes.trim().split(/\s+/).slice(0, 3).join(".")}`
            : ""
        }`;
      };

      const inShell = (target: Element | null): boolean =>
        target !== null &&
        [...document.querySelectorAll(roots)].some((root) =>
          root.contains(target),
        );

      const frame = (): void => {
        for (const animation of document.getAnimations()) {
          const effect = animation.effect;
          const target =
            effect !== null && "target" in effect
              ? ((effect as KeyframeEffect).target as Element | null)
              : null;

          if (!inShell(target) || effect === null) {
            continue;
          }

          const durationMs = Number(effect.getComputedTiming().activeDuration);

          if (!Number.isFinite(durationMs) || durationMs <= 0) {
            continue;
          }

          const keyframes = (animation as { animationName?: string })
            .animationName;
          const transitioned = (animation as { transitionProperty?: string })
            .transitionProperty;

          if (keyframes !== undefined) {
            const sighting = {
              kind: "animation",
              name: keyframes,
              target: name(target as Element),
              durationMs,
            };
            sightings.set(
              `${sighting.kind}:${sighting.name}:${sighting.target}`,
              sighting,
            );
            continue;
          }

          if (transitioned !== undefined && properties.includes(transitioned)) {
            const sighting = {
              kind: "transition",
              name: transitioned,
              target: name(target as Element),
              durationMs,
            };
            sightings.set(
              `${sighting.kind}:${sighting.name}:${sighting.target}`,
              sighting,
            );
          }
        }

        requestAnimationFrame(frame);
      };

      requestAnimationFrame(frame);
    },
    { properties: ENTRANCE_PROPERTIES, roots: SHELL_ROOTS },
  );
}

/**
 * Everything seen so far, plus a fresh sweep for a keyframe animation that is
 * declared on an element but was not caught mid-play — one that has already
 * finished, or that is waiting on a delay.
 */
export async function entranceAnimations(
  page: Page,
): Promise<AnimationSighting[]> {
  return await page.evaluate((roots) => {
    const seen = [...(window.__marivaAnimationSightings?.values() ?? [])];

    for (const root of document.querySelectorAll(roots)) {
      for (const element of [root, ...root.querySelectorAll("*")]) {
        const style = getComputedStyle(element);

        if (style.animationName === "none") {
          continue;
        }

        const durationMs =
          Number.parseFloat(style.animationDuration) *
          (style.animationDuration.endsWith("ms") ? 1 : 1000);

        if (!Number.isFinite(durationMs) || durationMs <= 0) {
          continue;
        }

        seen.push({
          kind: "declared",
          name: style.animationName,
          target: element.tagName.toLowerCase(),
          durationMs,
        });
      }
    }

    return seen;
  }, SHELL_ROOTS);
}

/** One sighting as a line a failure message can carry. */
export function describeSighting(sighting: AnimationSighting): string {
  return `${sighting.kind} “${sighting.name}” on ${sighting.target} for ${Math.round(sighting.durationMs)} ms`;
}
