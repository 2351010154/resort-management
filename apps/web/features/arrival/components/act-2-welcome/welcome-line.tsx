"use client";

// Act 2 — "The Welcome": one centered display line, per-line mask-up reveal
// (izanami text treatment), on a bare wall with foliage shadow cast in from the
// top right.
//
// The reveal is the vocabulary's `lines` device rather than a tween of its own.
// It used to be a one-shot: the words rose once and were then simply there for
// the rest of the ride. Now they leave when the reader scrolls back up past
// them and rise again on the way down, which is the difference between a page
// that has been animated and a page that is alive while it is being read.

import { useRef } from "react";
import {
  Reveal,
  RevealLine,
  RevealScope,
} from "@/features/arrival/components/vocabulary/reveal";
import { FoliageGobo } from "./foliage-gobo";
import { OrbitingImageField } from "./orbiting-image-field";
import { WelcomeChapters } from "./welcome-chapters";
import styles from "./act-2-welcome.module.css";

export function WelcomeLine() {
  const sectionRef = useRef<HTMLElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);

  return (
    <section ref={sectionRef} data-act={2} className={styles.section}>
      <FoliageGobo />
      <OrbitingImageField sectionRef={sectionRef} />
      <div className={styles.stage}>
        {/* Scoped to the copy block, not the section: the chapters below carry
            reveal lines of their own and must not fire with the welcome line. */}
        <RevealScope rootRef={copyRef} className={styles.copy}>
          <Reveal mode="lines">
            <RevealLine className={`caps-label ${styles.kicker}`}>
              Mariva — Rest, Relax, Rejuvenate
            </RevealLine>
          </Reveal>
          <Reveal
            mode="lines"
            as="h1"
            className={`font-display ${styles.display}`}
          >
            <RevealLine>You have been expected.</RevealLine>
          </Reveal>
        </RevealScope>
      </div>
      {/* The kicker names three words; the chapters are those three words. */}
      <WelcomeChapters />
    </section>
  );
}
