"use client";

// Act 6 — "The Turndown": the dark stone panel the arrival settles into.
// Embossed monogram (Act 1's coalesced mark, now pressed into stone) tilts with
// scroll; quiet columns and the decorative "Letters from Mariva" line sit under
// it; the panel then rides up off the house name, which was behind it the whole
// time — see wordmark-reveal.

import { useRef } from "react";
import {
  useLenis,
  useScrollWeight,
} from "@/features/arrival/lib/lenis-scroll-provider";
import {
  scrollToAct,
  scrollToRoom,
} from "@/features/arrival/components/navigation/nav-hover-link";
import { EmbossedMonogram, type EmbossIntensity } from "./embossed-monogram";
import { LettersFromMariva } from "./letters-from-mariva-form";
import { WordmarkReveal } from "./wordmark-reveal";
import styles from "./act-6-turndown.module.css";

// Entries with an `act` or a `room` ride the same lenis scroll as the nav; the
// rest are decorative (concept piece, no destinations) and render as plain text
// — no dead href, no focus stop. Dine and Restore are rooms inside Act 4, not
// acts of their own.
//
// The destinations are buttons, not links. There is no `#act-5` on the page to
// link to — the acts are found by `[data-act]` and scrolled to by lenis — so an
// anchor here would carry an href that resolves nowhere, breaking the one thing
// a link promises: that the address in the status bar goes somewhere.
const COLUMNS = [
  {
    title: "The resort",
    links: [
      { label: "Stay", room: 0 },
      { label: "Dine", room: 7 },
      { label: "Restore", room: 6 },
      { label: "Begin your stay", act: 5 },
    ],
  },
  {
    title: "The house",
    links: [
      { label: "Contact" },
      { label: "Press" },
      { label: "Careers" },
      { label: "Journal" },
    ],
  },
] as const;

export function TurndownFooter({
  embossIntensity = "soft",
}: {
  embossIntensity?: EmbossIntensity;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const lenis = useLenis();

  // Columns, a form, and a wordmark: the one screen of the ride that is a page.
  // The glide that carries a camera move is only in the way of a reader looking
  // for a link.
  useScrollWeight(sectionRef, "light");

  return (
    <footer ref={sectionRef} data-act={6} className={styles.section}>
      <div className={styles.inner}>
        <EmbossedMonogram intensity={embossIntensity} triggerRef={sectionRef} />

        <div className={styles.body}>
          <nav className={styles.columns} aria-label="Footer">
            {COLUMNS.map(({ title, links }) => (
              <div key={title} className={styles.column}>
                <span className={`caps-label ${styles.columnTitle}`}>
                  {title}
                </span>
                {links.map((link) =>
                  "act" in link ? (
                    <button
                      key={link.label}
                      type="button"
                      className={styles.columnLink}
                      onClick={() => scrollToAct(lenis, link.act)}
                    >
                      {link.label}
                    </button>
                  ) : "room" in link ? (
                    <button
                      key={link.label}
                      type="button"
                      className={styles.columnLink}
                      onClick={() => scrollToRoom(lenis, link.room)}
                    >
                      {link.label}
                    </button>
                  ) : (
                    <span key={link.label} className={styles.columnText}>
                      {link.label}
                    </span>
                  ),
                )}
              </div>
            ))}
          </nav>

          <LettersFromMariva />
        </div>

        <p className={styles.smallPrint}>
          MARIVA — a concept study. Imagery: Aman Resorts.
        </p>
      </div>

      <WordmarkReveal />
    </footer>
  );
}
