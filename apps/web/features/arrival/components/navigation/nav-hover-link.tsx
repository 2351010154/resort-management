"use client";

// Podium-style hover link: stacked label copies glide inside a clipped pill;
// the active act's link keeps a pill outline (wolverine cue).

import { roomScrollTarget } from "@/features/arrival/components/act-4-stay/room-deck";
import { useArrivalActStore } from "@/features/arrival/lib/act-store";
import { useLenis } from "@/features/arrival/lib/lenis-scroll-provider";
import { DUR_SCENE } from "@/lib/motion-tokens";
import styles from "./navigation.module.css";

// Matches expo.out for Lenis' easing-function API.
const easeOutExpo = (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));

export function scrollToAct(
  lenis: ReturnType<typeof useLenis>,
  act: number,
  onDone?: () => void,
) {
  const target = document.querySelector<HTMLElement>(`[data-act="${act}"]`);
  if (!target) return;
  if (lenis) {
    lenis.scrollTo(target, { duration: DUR_SCENE, easing: easeOutExpo });
  } else {
    // Reduced motion / no smoother: jump.
    target.scrollIntoView();
  }
  onDone?.();
}

/**
 * Land on one room of Act 4's deck. Stay / Dine / Restore all live inside Act 4
 * now, so they need distinct offsets within it rather than one shared anchor.
 * The reduced-motion variant has no deck to aim at; that falls back to the act.
 */
export function scrollToRoom(
  lenis: ReturnType<typeof useLenis>,
  index: number,
  onDone?: () => void,
) {
  const y = roomScrollTarget(index);
  if (y == null) {
    scrollToAct(lenis, 4, onDone);
    return;
  }
  if (lenis) {
    lenis.scrollTo(y, { duration: DUR_SCENE, easing: easeOutExpo });
  } else {
    window.scrollTo(0, y);
  }
  onDone?.();
}

export function NavHoverLink({
  act,
  label,
  onNavigate,
}: {
  act: number;
  label: string;
  onNavigate?: () => void;
}) {
  const lenis = useLenis();
  const activeAct = useArrivalActStore((s) => s.activeAct);

  return (
    <a
      href={`#act-${act}`}
      className={`${styles.link} caps-label`}
      data-active={activeAct === act}
      onClick={(e) => {
        e.preventDefault();
        scrollToAct(lenis, act, onNavigate);
      }}
    >
      <span className={styles.linkClip}>
        <span className={styles.linkInner} data-label={label}>
          {label}
        </span>
      </span>
    </a>
  );
}
