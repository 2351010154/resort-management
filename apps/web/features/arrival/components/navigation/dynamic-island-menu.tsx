"use client";

// Phase 3 of the concierge nav: dark rounded panel unfolds downward from the
// bar (wolverine dynamic island). Cards cascade in with the measured stagger.

import gsap from "gsap";
import { useEffect, useRef } from "react";
import { arrivalImages } from "@/features/arrival/lib/image-manifest";
import { tierSrc, tierSrcSet } from "@/features/arrival/lib/image-srcset";
import { useArrivalActStore } from "@/features/arrival/lib/act-store";
import { useLenis } from "@/features/arrival/lib/lenis-scroll-provider";
import { prefersReducedMotion } from "@/features/arrival/lib/webgl-support";
import {
  DUR_UI,
  EASE_UI,
  EASE_UI_EXIT,
  STAGGER_CASCADE,
} from "@/lib/motion-tokens";
import {
  NavHoverLink,
  scrollToAct,
  scrollToExperience,
} from "./nav-hover-link";
import styles from "./dynamic-island-menu.module.css";

// All three destinations live inside Act 4. Dine and Restore are aimed at the
// experience each one is actually about — In-Room Dining and the Wellness Spa —
// and land on the frame that card is settled on. Stay is the chapter itself, so
// it carries no index: it lands on the four words the act opens with.
const CARDS = [
  { slug: "island-stay", label: "Stay" },
  { slug: "island-dine", label: "Dine", experience: 7 },
  { slug: "island-restore", label: "Restore", experience: 6 },
].map((card) => ({
  ...card,
  image: arrivalImages["nav-island"].find((img) =>
    img.src.includes(card.slug),
  )!,
}));

export const NAV_LINKS = [
  { act: 2, label: "Welcome" },
  { act: 3, label: "The Approach" },
  { act: 4, label: "Stay" },
  { act: 5, label: "Begin" },
];

export function DynamicIslandMenu() {
  const panelRef = useRef<HTMLDivElement>(null);
  const opened = useRef(false);
  const lenis = useLenis();
  const menuOpen = useArrivalActStore((s) => s.menuOpen);
  const setMenuOpen = useArrivalActStore((s) => s.setMenuOpen);

  // Unfold / fold.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const reduce = prefersReducedMotion();
    const cards = panel.querySelectorAll("[data-cascade]");
    // The closed panel is height:0/overflow:hidden, so its links stay tabbable
    // while aria-hidden — inert takes them out of the tab order too.
    if (menuOpen) panel.removeAttribute("inert");
    else panel.setAttribute("inert", "");
    if (menuOpen) opened.current = true;
    // Nothing to fold before the first open: the closed geometry is the CSS.
    if (!opened.current) return;

    // One timeline per toggle, killed rather than reverted when the next one
    // takes over. A gsap.context here reverted the open state during React's
    // cleanup — before the fold could run — so the panel snapped to height 0
    // and the closing tween then animated 0 to 0, i.e. nothing at all. Killing
    // leaves the current geometry in place, so an interrupted unfold folds from
    // exactly where it stopped.
    const tl = gsap.timeline({ defaults: { ease: EASE_UI } });
    if (menuOpen) {
      tl.to(panel, { height: "auto", duration: reduce ? 0 : DUR_UI }, 0).fromTo(
        cards,
        { autoAlpha: 0, y: 16 },
        {
          autoAlpha: 1,
          y: 0,
          duration: reduce ? 0 : DUR_UI,
          stagger: reduce ? 0 : STAGGER_CASCADE,
        },
        reduce ? 0 : DUR_UI * 0.4,
      );
    } else {
      // Cards leave in reverse order and the fold follows right behind them, so
      // the sheet is already emptying by the time its edge starts to move.
      tl.to(
        cards,
        {
          autoAlpha: 0,
          y: 10,
          duration: reduce ? 0 : DUR_UI * 0.5,
          ease: EASE_UI_EXIT,
          stagger: reduce ? 0 : { each: STAGGER_CASCADE * 0.5, from: "end" },
        },
        0,
      ).to(
        panel,
        { height: 0, duration: reduce ? 0 : DUR_UI * 0.7, ease: EASE_UI_EXIT },
        reduce ? 0 : DUR_UI * 0.2,
      );
    }
    return () => {
      tl.kill();
    };
  }, [menuOpen]);

  // Escape closes; focus is trapped inside the panel while open.
  useEffect(() => {
    if (!menuOpen) return;
    const panel = panelRef.current;
    if (!panel) return;

    const focusables = () =>
      Array.from(
        panel.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"),
      );
    focusables()[0]?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        document.getElementById("nav-menu-button")?.focus();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [menuOpen, setMenuOpen]);

  const close = () => setMenuOpen(false);

  return (
    <div
      ref={panelRef}
      id="dynamic-island-menu"
      className={styles.panel}
      aria-hidden={!menuOpen}
      role="dialog"
      aria-label="Menu"
    >
      <div className={styles.inner}>
        <div className={styles.intro} data-cascade>
          <p className="caps-label">The concierge</p>
          <p>
            Every arrival is prepared before you ask. Choose where to begin.
          </p>
          <button
            type="button"
            className={`${styles.viewLink} caps-label`}
            onClick={() => scrollToAct(lenis, 5, close)}
          >
            View →
          </button>
          <div className={styles.mobileLinks}>
            {NAV_LINKS.map((link) => (
              <NavHoverLink key={link.act} {...link} onNavigate={close} />
            ))}
          </div>
        </div>
        <div className={styles.cards}>
          {CARDS.map(({ slug, label, experience, image }) => (
            <button
              key={slug}
              type="button"
              className={styles.card}
              data-cascade
              onClick={() =>
                experience == null
                  ? scrollToAct(lenis, 4, close)
                  : scrollToExperience(lenis, experience, close)
              }
            >
              <img
                src={tierSrc(image.src, 640)}
                srcSet={tierSrcSet(image)}
                sizes="(max-width: 767px) 92vw, 30vw"
                alt={image.alt}
              />
              <span className={`${styles.cardLabel} caps-label`}>{label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
