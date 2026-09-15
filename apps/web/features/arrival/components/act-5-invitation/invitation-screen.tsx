"use client";

// Act 5 — "The Invitation": the last full screen before the house's own pages.
// One held photograph at dusk, a three-line address set small against the right
// edge, and nothing else but the filled pill that hands over to the booking
// funnel (wolverine finale composition). The middle is left deliberately
// empty so the last beat reads as calm rather than as more copy. The pill is
// the handoff into the booking funnel, not another stop in the arrival.
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
import { useEffect, useRef, useState } from "react";
import { BorderGlowPill } from "@/features/arrival/components/act-5-invitation/border-glow-pill";
import { ACT4_OVERHANG } from "@/features/arrival/lib/act-seams";
import { arrivalImages } from "@/features/arrival/lib/image-manifest";
import { tierSrc, tierSrcSet } from "@/features/arrival/lib/image-srcset";
import { registerArrivalEases } from "@/features/arrival/lib/motion-eases";
import { prefersReducedMotion } from "@/features/arrival/lib/webgl-support";
import {
  DUR_ENTER,
  DUR_EXIT,
  EASE_ENTER,
  SCRUB_DRIFT,
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
  const plateRef = useRef<HTMLImageElement>(null);
  const [plateReady, setPlateReady] = useState(false);

  // An eager image can finish between the server paint and hydration, before
  // React has attached onLoad. Read the element once on mount as well as
  // listening below, so a cached frame cannot remain on its fallback forever.
  useEffect(() => {
    const image = plateRef.current;
    setPlateReady(Boolean(image?.complete && image.naturalWidth > 0));
  }, []);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || prefersReducedMotion()) return;
    gsap.registerPlugin(ScrollTrigger);
    registerArrivalEases();

    const ctx = gsap.context(() => {
      const lines = section.querySelectorAll("[data-invite-line]");
      // The hidden state is set here rather than in the stylesheet: a CSS
      // `translateY(115%)` is parsed into a *pixel* y that `yPercent: 0` cannot
      // undo, and the address would never arrive. Written on mount, with the act
      // several screens below the fold, so there is nothing to flash.
      gsap.set(lines, { yPercent: 115 });

      // Let the photograph enter and settle for one screen before the address
      // arrives. The frame itself is already fully visible during that entry.
      //
      // Paused and played rather than fired by the trigger, so the address can
      // also leave: scrolling back up over the mark empties the corner and
      // coming down writes it again, at three times the speed going out. The
      // one-screen wait is the composition's, not the vocabulary's, which is
      // why this keeps its own mark instead of joining the reveal batch.
      const address = gsap
        .timeline({ paused: true, defaults: { ease: EASE_ENTER } })
        .to(lines, {
          yPercent: 0,
          duration: DUR_ENTER,
          stagger: STAGGER_CASCADE,
        })
        .fromTo(
          section.querySelectorAll("[data-invite-fade]"),
          { autoAlpha: 0, y: 18 },
          {
            autoAlpha: 1,
            y: 0,
            duration: DUR_ENTER * 0.75,
            stagger: STAGGER_CASCADE,
          },
          0.35,
        );

      ScrollTrigger.create({
        trigger: section,
        start: "top -100%",
        onEnter: () => address.timeScale(1).play(),
        onEnterBack: () => address.timeScale(1).play(),
        onLeaveBack: () => address.timeScale(DUR_ENTER / DUR_EXIT).reverse(),
      });

      // The breath across the held screen: settling while the reading is on it,
      // then swelling again as the footer takes over.
      //
      // The drift scrub, not the hard one. The plate shares no edge with
      // anything — it is a photograph changing size inside its own frame — so
      // it takes the second smoothing and goes on breathing for half a second
      // after the reader's hand has stopped, which is the difference between a
      // frame answering the reader and a frame tracking the scrollbar.
      gsap
        .timeline({
          defaults: { ease: "none" },
          scrollTrigger: {
            trigger: section,
            start: "top top",
            end: "bottom bottom",
            scrub: SCRUB_DRIFT,
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
        );
    }, section);
    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      data-act={5}
      className={styles.section}
      // The act starts under Act 4's last screen rather than after it: the
      // stage below is sticky, so from this section's own top the Invitation is
      // held at the top of the viewport, behind Act 4's still-pinned stage,
      // for exactly as long as that act's bands take to close over it. The
      // stylesheet spends it as a negative margin, and drops it where there is
      // no pinned stage to stand behind.
      style={{ "--overhang": `${ACT4_OVERHANG}vh` } as React.CSSProperties}
    >
      <div className={styles.stage} data-plate-ready={plateReady}>
        <div className={styles.plate}>
          <img
            ref={plateRef}
            className={styles.plateImage}
            src={tierSrc(PLATE.src, 1920)}
            srcSet={tierSrcSet(PLATE)}
            sizes="100vw"
            width={PLATE.width}
            height={PLATE.height}
            alt={PLATE.alt}
            loading="eager"
            fetchPriority="high"
            decoding="async"
            onLoad={() => setPlateReady(true)}
            onError={() => setPlateReady(false)}
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
            <BorderGlowPill href="/booking">Begin your stay</BorderGlowPill>
          </div>
        </div>
      </div>
    </section>
  );
}
