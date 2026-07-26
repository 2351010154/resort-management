"use client";

// The concierge: present through all 6 acts. Three phases —
// top (full wordmark, transparent) / scrolled (monogram, translucent blur) /
// island (menu panel open). Theme flips ink<->ivory on dark acts (5, 6).

import { useEffect } from "react";
import { useArrivalActStore } from "@/features/arrival/lib/act-store";
import { NavHoverLink } from "./nav-hover-link";
import { DynamicIslandMenu, NAV_LINKS } from "./dynamic-island-menu";
import styles from "./navigation.module.css";

// Act 4 used to open onto daylight halfway through and drove `navDark` from its
// own scroll position. Its rooms now play on the opened door rather than on
// ivory, so the act is dark end to end and belongs in the set — which is also
// what gets the bar right under reduced motion, where no scroll trigger runs.
const DARK_ACTS = new Set([4, 5, 6]);

export function ConciergeNav() {
  const navPhase = useArrivalActStore((s) => s.navPhase);
  const setNavPhase = useArrivalActStore((s) => s.setNavPhase);
  const menuOpen = useArrivalActStore((s) => s.menuOpen);
  const setMenuOpen = useArrivalActStore((s) => s.setMenuOpen);
  const activeAct = useArrivalActStore((s) => s.activeAct);
  const navDark = useArrivalActStore((s) => s.navDarkActs.length > 0);

  // Scroll phase with hysteresis (enter 80vh / exit 60vh) so the
  // wordmark<->monogram crossfade never flickers at the boundary.
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const { navPhase: phase, menuOpen: open, setNavPhase: set } =
        useArrivalActStore.getState();
      if (open) return; // island phase owns the bar while the menu is open
      const y = window.scrollY;
      const vh = window.innerHeight;
      if (phase !== "scrolled" && y > vh * 0.8) set("scrolled");
      else if (phase !== "top" && y < vh * 0.6) set("top");
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // Menu open forces the island phase; closing restores by scroll position.
  useEffect(() => {
    if (menuOpen) {
      setNavPhase("island");
    } else {
      setNavPhase(window.scrollY > window.innerHeight * 0.6 ? "scrolled" : "top");
    }
  }, [menuOpen, setNavPhase]);

  return (
    <>
      <header
        className={styles.bar}
        data-phase={navPhase}
        data-theme={
          DARK_ACTS.has(activeAct) || navDark || menuOpen ? "dark" : "light"
        }
      >
        <a href="#act-1" className={styles.brand} aria-label="Mariva — home">
          <span className={styles.wordmark} />
          <span className={styles.monogram} />
        </a>
        <nav className={styles.links} aria-label="Acts">
          {NAV_LINKS.map((link) => (
            <NavHoverLink key={link.act} {...link} />
          ))}
        </nav>
        <button
          id="nav-menu-button"
          className={`${styles.menuButton} caps-label`}
          aria-expanded={menuOpen}
          aria-controls="dynamic-island-menu"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <span className={styles.linkClip}>
            <span className={styles.linkInner} data-label={menuOpen ? "Close" : "Menu"}>
              {menuOpen ? "Close" : "Menu"}
            </span>
          </span>
        </button>
      </header>
      <DynamicIslandMenu />
    </>
  );
}
