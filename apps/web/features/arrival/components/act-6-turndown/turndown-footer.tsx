"use client";

// Chapter 8 — "The Turndown": the dark stone panel the arrival settles into.
// Embossed monogram (Act 1's coalesced mark, now pressed into stone) tilts with
// scroll; quiet columns and the decorative "Letters from Mariva" line sit under
// it; the panel then rides up off the house name, which was behind it the whole
// time — see wordmark-reveal.

import {
  CHECK_IN_TIME,
  CHECK_OUT_TIME,
  PROPERTY_ADDRESS_LINES,
} from "@mariva/shared";
import { useRef } from "react";
import {
  useLenis,
  useScrollWeight,
} from "@/features/arrival/lib/lenis-scroll-provider";
import { scrollToAct } from "@/features/arrival/components/navigation/nav-hover-link";
import {
  draftHref,
  useArrivalDraft,
} from "@/features/arrival/lib/arrival-booking-draft";
import { ApertureFrame } from "@/features/arrival/components/aperture/aperture-frame";
import { arrivalImages } from "@/features/arrival/lib/image-manifest";
import { tierSrc, tierSrcSet } from "@/features/arrival/lib/image-srcset";
import { EmbossedMonogram, type EmbossIntensity } from "./embossed-monogram";
import { LettersFromMariva } from "./letters-from-mariva-form";
import { WordmarkReveal } from "./wordmark-reveal";
import styles from "./act-6-turndown.module.css";

// Entries with an `act` ride the same lenis scroll as the nav; the rest are the
// house's own facts — where it stands and when its doors open — and render as
// plain text: no dead href, no focus stop.
//
// The facts are read from `@mariva/shared` rather than typed here, so the footer,
// the review screen and the pre-arrival mail cannot disagree about the address or
// the clock. They are what the end of the page is for: the last beat above is a
// mood, and a reader who scrolled all the way down came here for where the house
// is and when it opens its doors.
//
// The destinations are buttons, not links. There is no `#chapter-2` on the page to
// link to — the chapters are found by `[data-act]` and scrolled to by lenis — so an
// anchor here would carry an href that resolves nowhere, breaking the one thing a
// link promises: that the address in the status bar goes somewhere. `Book your
// stay` is the exception below, because `/booking` is a real address.
const COLUMNS = [
  {
    title: "The resort",
    links: [
      { label: "Stay", act: 2 },
      { label: "Table", act: 3 },
      { label: "Rituals", act: 5 },
      { label: "Place", act: 6 },
      { label: "Choose dates", act: 7 },
      { label: "Book your stay", booking: true },
    ],
  },
  {
    title: "Find us",
    links: [
      { label: PROPERTY_ADDRESS_LINES[0] },
      { label: PROPERTY_ADDRESS_LINES[1] },
      { label: `Check-in from ${CHECK_IN_TIME}` },
      { label: `Check-out by ${CHECK_OUT_TIME}` },
    ],
  },
] as const;

// The aperture, closed down to the size of a lit window at the end of a corridor.
// Same arch, last role: it is the only thing still lit on the page, and it is
// small enough that nothing about it competes with the columns beside it.
const WINDOW_PLATE = arrivalImages["act-6-invite"].find((img) =>
  img.src.includes("welcome-pavilion"),
)!;

export function TurndownFooter({
  embossIntensity = "soft",
}: {
  embossIntensity?: EmbossIntensity;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const lenis = useLenis();
  // The one link on the page that is a real address carries what the guest has
  // already said, like every other Book on the ride — never a bare `/booking`.
  const draft = useArrivalDraft();

  // Columns, a form, and a wordmark: the one screen of the ride that is a page.
  // The glide that carries a camera move is only in the way of a reader looking
  // for a link.
  useScrollWeight(sectionRef, "light");

  return (
    <footer ref={sectionRef} data-act={8} className={styles.section}>
      <div className={styles.inner}>
        <EmbossedMonogram intensity={embossIntensity} triggerRef={sectionRef} />

        <ApertureFrame ratio="3 / 4" tone="ink" className={styles.window}>
          <img
            src={tierSrc(WINDOW_PLATE.src, 640)}
            srcSet={tierSrcSet(WINDOW_PLATE)}
            sizes="12rem"
            width={WINDOW_PLATE.width}
            height={WINDOW_PLATE.height}
            alt={WINDOW_PLATE.alt}
            loading="lazy"
            decoding="async"
          />
        </ApertureFrame>

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
                  ) : "booking" in link ? (
                    <a
                      key={link.label}
                      href={draftHref(draft)}
                      className={styles.columnLink}
                    >
                      {link.label}
                    </a>
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
