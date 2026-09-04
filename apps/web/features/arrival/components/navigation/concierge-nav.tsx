"use client";

// The concierge: present through all 6 acts. Three phases —
// top (full wordmark) / scrolled (monogram) / island (menu panel open). Only the
// last has a ground of its own; the bar is otherwise type on the page. So the one
// thing that adapts to what is behind it is the colour of that type: ink over a
// light act, ivory over a dark one.

import { useEffect } from "react";
import { useArrivalActStore } from "@/features/arrival/lib/act-store";
import {
  draftHref,
  useArrivalDraft,
} from "@/features/arrival/lib/arrival-booking-draft";
// The bar and the rail below it have to name the same hour, so the rule they
// both read lives in one module. Under reduced motion, where no scroll trigger
// runs, this is still what gets the chrome right.
import { chapterIsDark } from "@/features/arrival/lib/chapter-tone";
import { DatesRail } from "./dates-rail";
import { NavHoverLink } from "./nav-hover-link";
import { DynamicIslandMenu, NAV_LINKS } from "./dynamic-island-menu";
import styles from "./navigation.module.css";

export function ConciergeNav() {
  const navPhase = useArrivalActStore((s) => s.navPhase);
  const setNavPhase = useArrivalActStore((s) => s.setNavPhase);
  const menuOpen = useArrivalActStore((s) => s.menuOpen);
  const setMenuOpen = useArrivalActStore((s) => s.setMenuOpen);
  const navDark = useArrivalActStore(chapterIsDark);
  const draft = useArrivalDraft();

  // Scroll phase with hysteresis (enter 80vh / exit 60vh) so the
  // wordmark<->monogram crossfade never flickers at the boundary.
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const {
        navPhase: phase,
        menuOpen: open,
        setNavPhase: set,
      } = useArrivalActStore.getState();
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
      setNavPhase(
        window.scrollY > window.innerHeight * 0.6 ? "scrolled" : "top",
      );
    }
  }, [menuOpen, setNavPhase]);

  return (
    <>
      <header
        className={styles.bar}
        data-phase={navPhase}
        data-theme={navDark || menuOpen ? "dark" : "light"}
      >
        {/* A real address, not `#act-1`: the acts carry no id, and the mark is
            the one thing in the bar that should still work as a link. */}
        <a href="/" className={styles.brand} aria-label="Mariva — home">
          <span className={styles.wordmark} />
          <span className={styles.monogram} />
        </a>
        <nav className={styles.links} aria-label="Chapters">
          {NAV_LINKS.map((link) => (
            <NavHoverLink key={link.act} {...link} />
          ))}
        </nav>
        {/* The one thing in the bar that leaves the page, and the reason it is a
            link and not a button: `/booking` is a real address. Present in every
            chapter, including the first screen, so a reader who has already
            decided never has to look for it.

            Its address is the draft, not a bare `/booking`: a reader who has
            already typed a range into the rail or the card would otherwise have
            the bar throw it away and open the calendar on nothing. With an empty
            draft `writeBookingSearch` writes nothing and this is `/booking`. */}
        <a className={`caps-label ${styles.book}`} href={draftHref(draft)}>
          <span className={styles.linkClip}>
            <span className={styles.linkInner} data-label="Book your stay">
              Book your stay
            </span>
          </span>
        </a>
        <button
          id="nav-menu-button"
          type="button"
          className={`${styles.menuButton} caps-label`}
          aria-expanded={menuOpen}
          aria-controls="dynamic-island-menu"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <span className={styles.linkClip}>
            <span
              className={styles.linkInner}
              data-label={menuOpen ? "Close" : "Menu"}
            >
              {menuOpen ? "Close" : "Menu"}
            </span>
          </span>
        </button>
      </header>
      <DatesRail />
      <DynamicIslandMenu />
    </>
  );
}
