"use client";

// Phase 3 of the concierge nav: dark rounded panel unfolds downward from the
// bar (wolverine dynamic island). Cards cascade in with the measured stagger.

import gsap from "gsap";
import { useEffect, useRef } from "react";
import { arrivalImages } from "@/lib/arrival-image-manifest";
import { tierSrc, tierSrcSet } from "@/lib/arrival-image-srcset";
import { useArrivalActStore } from "@/lib/arrival-act-store";
import { useLenis } from "@/lib/lenis-scroll-provider";
import { prefersReducedMotion } from "@/lib/webgl-support";
import { DUR_UI, EASE_UI, STAGGER_CASCADE } from "@/lib/motion-tokens";
import { NavHoverLink, scrollToAct, scrollToRoom } from "./nav-hover-link";
import styles from "./dynamic-island-menu.module.css";

// Dine and Restore used to share Act 5 with Stay's neighbour, so three cards
// resolved to two places. All three now live inside Act 4, aimed at the deck
// card each one is actually about: the first suite, The Table, the Onsen Villa.
const CARDS = [
  { slug: "island-stay", label: "Stay", room: 0 },
  { slug: "island-dine", label: "Dine", room: 7 },
  { slug: "island-restore", label: "Restore", room: 6 },
].map((card) => ({
  ...card,
  image: arrivalImages["nav-island"].find((img) => img.src.includes(card.slug))!,
}));

export const NAV_LINKS = [
  { act: 2, label: "Welcome" },
  { act: 3, label: "The Approach" },
  { act: 4, label: "Stay" },
  { act: 5, label: "Begin" },
];

export function DynamicIslandMenu() {
  const panelRef = useRef<HTMLDivElement>(null);
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
    const ctx = gsap.context(() => {
      if (menuOpen) {
        gsap.to(panel, { height: "auto", duration: reduce ? 0 : DUR_UI, ease: EASE_UI });
        gsap.fromTo(
          cards,
          { autoAlpha: 0, y: 16 },
          {
            autoAlpha: 1,
            y: 0,
            duration: reduce ? 0 : DUR_UI,
            ease: EASE_UI,
            stagger: reduce ? 0 : STAGGER_CASCADE,
            delay: reduce ? 0 : DUR_UI * 0.4,
          },
        );
      } else {
        gsap.to(panel, { height: 0, duration: reduce ? 0 : DUR_UI * 0.8, ease: EASE_UI });
      }
    });
    return () => ctx.revert();
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
          <p>Every arrival is prepared before you ask. Choose where to begin.</p>
          <a
            href="#act-5"
            className={`${styles.viewLink} caps-label`}
            onClick={(e) => {
              e.preventDefault();
              scrollToAct(lenis, 5, close);
            }}
          >
            View →
          </a>
          <div className={styles.mobileLinks}>
            {NAV_LINKS.map((link) => (
              <NavHoverLink key={link.act} {...link} onNavigate={close} />
            ))}
          </div>
        </div>
        <div className={styles.cards}>
          {CARDS.map(({ slug, label, room, image }) => (
            <a
              key={slug}
              href="#act-4"
              className={styles.card}
              data-cascade
              onClick={(e) => {
                e.preventDefault();
                scrollToRoom(lenis, room, close);
              }}
            >
              <img
                src={tierSrc(image.src, 640)}
                srcSet={tierSrcSet(image)}
                sizes="(max-width: 767px) 92vw, 30vw"
                alt={image.alt}
              />
              <span className={`${styles.cardLabel} caps-label`}>{label}</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
