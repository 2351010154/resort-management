"use client";

// Act 5 — "The Invitation": the last full screen before the house's own pages.
// One held photograph at dusk, a three-line address set small against the right
// edge, and nothing else but the filled pill that hands over to the footer
// (wolverine finale composition). The middle of the frame is left deliberately
// empty so the last beat reads as calm rather than as more copy.
//
// The frame breathes rather than drifts one way: its scale is scrubbed off the
// act's own progress, so scrolling down relaxes it and scrolling back up swells
// it again. A one-way Ken Burns reads as a video playing; this reads as the
// photograph answering the reader.
//
// The stage is CSS-sticky rather than pinned. A pin with `pinSpacing: false`
// releases the moment the footer's top edge arrives, and the stage snaps out of
// the viewport in one frame; sticky lets the same screen ride up under the
// footer with nothing to hide.

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useRef } from "react";
import { BorderGlowPill } from "@/features/arrival/components/act-5-invitation/border-glow-pill";
import { arrivalImages } from "@/features/arrival/lib/image-manifest";
import { tierSrc, tierSrcSet } from "@/features/arrival/lib/image-srcset";
import { useLenis } from "@/features/arrival/lib/lenis-scroll-provider";
import { scrollToAct } from "@/features/arrival/components/navigation/nav-hover-link";
import { prefersReducedMotion } from "@/features/arrival/lib/webgl-support";
import {
  DUR_SCENE,
  EASE_SCENE,
  EASE_UI,
  STAGGER_CASCADE,
} from "@/lib/motion-tokens";
import styles from "./act-5-invitation.module.css";

// The lit pavilion rather than the onsen: this screen is the door being held
// open, and it is the only frame in the act, so it carries a horizon.
const PLATE = arrivalImages["act-6-invite"].find((img) =>
  img.src.includes("welcome-pavilion"),
)!;

// Three lines, not four, and read at a fraction of the old display size: the
// address is a spoken aside in the corner of the frame rather than a poster over
// it. The turn ("until you return.") carries the italic, so the sentence lands
// on its own change of voice instead of on scale.
const HEADLINE = [
  { text: "The world", italic: false },
  { text: "can wait", italic: false },
  { text: "until you return.", italic: true },
];

/** Scale the frame is held at through the act: entering, settled, leaving. */
const PLATE_SCALE = [1.14, 1.02, 1.1] as const;

export function InvitationScreen() {
  const sectionRef = useRef<HTMLElement>(null);
  const lenis = useLenis();

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || prefersReducedMotion()) return;
    gsap.registerPlugin(ScrollTrigger);

    const ctx = gsap.context(() => {
      const lines = section.querySelectorAll("[data-invite-line]");
      // The hidden state is set here rather than in the stylesheet: a CSS
      // `translateY(115%)` is parsed into a *pixel* y that `yPercent: 0` cannot
      // undo, and the address would never arrive. Written on mount, with the act
      // several screens below the fold, so there is nothing to flash.
      gsap.set(lines, { yPercent: 115 });

      // The address, once the veil is off it (Act 4's deck holds its pin to this
      // act's top and its tail fade then wipes up over the first screen — see
      // room-deck). Anything revealed before that plays behind the wipe.
      gsap
        .timeline({
          scrollTrigger: { trigger: section, start: "top -100%", once: true },
        })
        .to(lines, {
          yPercent: 0,
          duration: DUR_SCENE,
          ease: EASE_SCENE,
          stagger: STAGGER_CASCADE,
        })
        .fromTo(
          section.querySelectorAll("[data-invite-fade]"),
          { autoAlpha: 0, y: 18 },
          {
            autoAlpha: 1,
            y: 0,
            duration: 0.9,
            ease: EASE_UI,
            stagger: STAGGER_CASCADE,
          },
          0.35,
        );

      // The breath, across the held screen — relaxing out of the wipe, settled
      // while the reading is on it, swelling again as the footer takes over.
      gsap
        .timeline({
          defaults: { ease: "none" },
          scrollTrigger: {
            trigger: section,
            start: "top top",
            end: "bottom bottom",
            scrub: true,
          },
        })
        .fromTo(
          `.${styles.plateImage}`,
          { scale: PLATE_SCALE[0] },
          { scale: PLATE_SCALE[1], duration: 0.62 },
          0,
        )
        .to(
          `.${styles.plateImage}`,
          { scale: PLATE_SCALE[2], duration: 0.38 },
          0.62,
        )
        // The frame comes up with the veil, not after it: the wipe's edge would
        // otherwise cut a lit photograph in half for a whole screen of scroll.
        // Half the range is exactly the veil's travel (one viewport of the
        // three this act is long).
        .fromTo(
          `.${styles.plate}`,
          { opacity: 0.18 },
          { opacity: 1, duration: 0.5, ease: "power2.in" },
          0,
        );
    }, section);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} data-act={5} className={styles.section}>
      <div className={styles.stage}>
        <div className={styles.plate}>
          <img
            className={styles.plateImage}
            src={tierSrc(PLATE.src, 1920)}
            srcSet={tierSrcSet(PLATE)}
            sizes="100vw"
            width={PLATE.width}
            height={PLATE.height}
            alt={PLATE.alt}
            loading="lazy"
            decoding="async"
          />
        </div>
        <div className={styles.scrim} aria-hidden />

        <div className={styles.copy}>
          <div className={styles.address}>
            <h2 className={`font-display ${styles.headline}`}>
              {HEADLINE.map((line) => (
                <span key={line.text} className={styles.lineClip}>
                  <span
                    data-invite-line
                    className={styles.line}
                    data-italic={line.italic}
                  >
                    {line.text}
                  </span>
                </span>
              ))}
            </h2>
            <span className={styles.rule} data-invite-fade aria-hidden />
          </div>

          <div className={styles.foot} data-invite-fade>
            <BorderGlowPill onClick={() => scrollToAct(lenis, 6)}>
              Begin your stay
            </BorderGlowPill>
          </div>
        </div>
      </div>
    </section>
  );
}
