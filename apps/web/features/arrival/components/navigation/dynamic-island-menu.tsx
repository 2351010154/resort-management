"use client";

// Phase 3 of the concierge nav: dark rounded panel unfolds downward from the
// bar (wolverine dynamic island). Cards cascade in with the measured stagger.

import gsap from "gsap";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { arrivalImages } from "@/features/arrival/lib/image-manifest";
import { tierSrc, tierSrcSet } from "@/features/arrival/lib/image-srcset";
import { useArrivalActStore } from "@/features/arrival/lib/act-store";
import {
  useArrivalBookingDraftStore,
  useArrivalDraft,
  useEarliestArrival,
  validateDraft,
} from "@/features/arrival/lib/arrival-booking-draft";
import { useLenis } from "@/features/arrival/lib/lenis-scroll-provider";
import { writeBookingSearch } from "@/features/booking/lib/booking-search";
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
  const router = useRouter();
  const lenis = useLenis();
  const menuOpen = useArrivalActStore((s) => s.menuOpen);
  const setMenuOpen = useArrivalActStore((s) => s.setMenuOpen);
  const draft = useArrivalDraft();
  const earliest = useEarliestArrival();
  const setFrom = useArrivalBookingDraftStore((s) => s.setFrom);
  const setTo = useArrivalBookingDraftStore((s) => s.setTo);
  const [error, setError] = useState<string | null>(null);

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

  // A closed sheet forgets its complaint: reopening must not announce an error
  // for a submit the guest has not repeated.
  useEffect(() => {
    if (!menuOpen) setError(null);
  }, [menuOpen]);

  // Escape closes; focus is trapped inside the panel while open.
  useEffect(() => {
    if (!menuOpen) return;
    const panel = panelRef.current;
    if (!panel) return;

    const focusables = () =>
      Array.from(
        // The sheet holds a form now, so the trap has to know about controls as
        // well as links: with only anchors and buttons listed, Tab out of the
        // last date input escaped to the page behind the dialog.
        panel.querySelectorAll<HTMLElement>(
          // The `step` carrier is excluded because a hidden input cannot take
          // focus, and one in the list would make Tab appear to do nothing at
          // the wrap point.
          'a[href], button:not([disabled]), input:not([type="hidden"]), select',
        ),
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

  // The sheet is the one place on the page that asks the question rather than
  // linking to it, so it is the one place that can refuse: an unordered or
  // half-filled range is answered here instead of being dropped by the funnel.
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = validateDraft(draft);
    if (!result.ok) {
      // One line in a column this narrow: the first rule the draft breaks.
      setError(Object.values(result.errors)[0] ?? null);
      return;
    }
    setError(null);
    // Folded before the navigation, so the back button returns to a page whose
    // sheet is shut rather than to an open dialog nobody opened.
    close();
    router.push(`/booking${writeBookingSearch(result.search)}`);
  };

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
          {/* The stay itself, asked where the reader already is. `adults` is
              not offered: the draft's default party is the funnel's own, and a
              third control in this column would cost the sheet a row for an
              answer almost nobody changes here. The funnel's first screen still
              has it. */}
          <form
            className={styles.form}
            action="/booking"
            method="get"
            onSubmit={submit}
            noValidate
          >
            <input type="hidden" name="step" value="rooms" />

            <div className={styles.dates}>
              <label className={styles.field} htmlFor="menu-from">
                <span className="caps-label">From</span>
                <input
                  id="menu-from"
                  className={styles.control}
                  type="date"
                  name="from"
                  min={earliest}
                  value={draft.from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>

              <label className={styles.field} htmlFor="menu-to">
                <span className="caps-label">To</span>
                <input
                  id="menu-to"
                  className={styles.control}
                  type="date"
                  name="to"
                  min={draft.from || earliest}
                  value={draft.to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
            </div>

            <button type="submit" className={`caps-label ${styles.submit}`}>
              Check availability
            </button>

            <p className={styles.error} role="alert">
              {error ?? ""}
            </p>
          </form>
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
