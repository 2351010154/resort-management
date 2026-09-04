"use client";

// Podium-style hover link: stacked label copies glide inside a clipped pill;
// the active act's link keeps a pill outline (wolverine cue).

import { useArrivalActStore } from "@/features/arrival/lib/act-store";
import { useLenis } from "@/features/arrival/lib/lenis-scroll-provider";
import { DUR_SCENE } from "@/lib/motion-tokens";
import styles from "./navigation.module.css";

// Matches expo.out for Lenis' easing-function API.
const easeOutExpo = (t: number) => (t === 1 ? 1 : 1 - 2 ** (-10 * t));

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
    // A button, not a link: the acts carry no id, so `#act-2` would be an
    // address that goes nowhere. This scrolls the page rather than navigating.
    <button
      type="button"
      className={`${styles.link} caps-label`}
      data-active={activeAct === act}
      onClick={() => scrollToAct(lenis, act, onNavigate)}
    >
      <span className={styles.linkClip}>
        <span className={styles.linkInner} data-label={label}>
          {label}
        </span>
      </span>
    </button>
  );
}
