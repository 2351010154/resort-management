"use client";

// Movement I — "The Corridor": a horizontal filmstrip on the dark ground, the
// oryzo.ai mechanic. The track is translated by scroll; each panel's photo takes
// a counter-translation so it lags the panel by the measured 6.3%.
//
// The lag is keyed to the panel's position relative to the viewport, NOT to the
// total track distance. Keying it to total distance makes the offset grow
// without bound and slides the photo clean off its own overflow; keying it to
// screen position keeps the slide inside the 116% frame at every point of the
// traverse and still yields the measured 0.937 net rate.

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useRef } from "react";
import { arrivalImages } from "@/lib/arrival-image-manifest";
import { tierSrc, tierSrcSet } from "@/lib/arrival-image-srcset";
import { useArrivalActStore } from "@/lib/arrival-act-store";
import styles from "./act-4-stay.module.css";

const PANELS_IMG = arrivalImages["act-4-corridor"];
const pick = (slug: string) => PANELS_IMG.find((i) => i.src.includes(slug))!;

/** Measured against oryzo.ai: photography runs at 0.937 of the track. */
const PHOTO_LAG = 0.063;

// `w` is the desktop width in vw; `mw` the narrow one. A panel keeps its
// proportion of the desktop track but not its vw figure — 24vw is 346px of
// filmstrip on a laptop and 94px of unreadable sliver on a phone.
type Panel =
  | {
      kind: "photo";
      slug: string;
      w: number;
      mw: number;
      headline?: string;
      caption?: string;
    }
  | {
      kind: "tone";
      w: number;
      mw: number;
      kicker: string;
      line: string;
      quiet?: boolean;
    };

const PANELS: Panel[] = [
  {
    kind: "photo",
    slug: "corridor-lounge",
    w: 54,
    mw: 82,
    headline: "Nothing to do",
    caption: "And all day to do it.",
  },
  {
    kind: "tone",
    w: 26,
    mw: 68,
    kicker: "Four — Stay",
    line: "Twenty-four rooms.\nNo two of them alike.",
  },
  {
    kind: "photo",
    slug: "corridor-colonnade",
    w: 52,
    mw: 78,
    headline: "Still water",
    caption: "36°C, always.",
  },
  {
    kind: "photo",
    slug: "corridor-shelf",
    w: 24,
    mw: 54,
    caption: "Kept, not displayed.",
  },
  {
    kind: "photo",
    slug: "corridor-steam",
    w: 50,
    mw: 78,
    headline: "Warm stone",
    caption: "The bath is already drawn.",
  },
  {
    kind: "tone",
    w: 24,
    mw: 66,
    quiet: true,
    kicker: "The corridor",
    line: "The walk from the door\nis part of the room.",
  },
  {
    kind: "photo",
    slug: "corridor-arva",
    w: 28,
    mw: 58,
    caption: "The last table stays lit.",
  },
  {
    kind: "photo",
    slug: "corridor-arch-hall",
    w: 56,
    mw: 84,
    headline: "Your door",
    caption: "Suite 704.",
  },
];

export function CorridorTrack({ mobile }: { mobile: boolean }) {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const setNavDark = useArrivalActStore((s) => s.setNavDark);

  useEffect(() => {
    const section = sectionRef.current;
    const track = trackRef.current;
    if (!section || !track) return;
    gsap.registerPlugin(ScrollTrigger);

    const ctx = gsap.context(() => {
      const media = gsap.utils.toArray<HTMLElement>("[data-media]", track);
      const setters = media.map((el) => gsap.quickSetter(el, "x", "px"));
      const trackX = gsap.quickSetter(track, "x", "px");

      // Distance the track must travel for its tail to reach the right edge.
      let travel = 0;
      const measure = () => {
        travel = Math.max(0, track.scrollWidth - window.innerWidth);
      };
      measure();

      const apply = (p: number) => {
        const x = -travel * p;
        trackX(x);
        // Panel centre relative to viewport centre, in the track's own space.
        const half = window.innerWidth / 2;
        for (let i = 0; i < media.length; i++) {
          const el = media[i];
          const panel = el.parentElement!;
          const centre = panel.offsetLeft + panel.offsetWidth / 2 + x;
          setters[i](PHOTO_LAG * (centre - half));
        }
      };

      ScrollTrigger.create({
        trigger: section,
        start: "top top",
        end: "bottom bottom",
        pin: stageRef.current,
        pinSpacing: false,
        invalidateOnRefresh: true,
        onRefresh: () => {
          measure();
          apply(0);
        },
        onUpdate: (self) => apply(self.progress),
      });

      // The corridor only ever turns the nav dark; the threshold owns turning
      // it light again, so the ink tail between the two pins stays dark.
      //
      // The lead on the start is what makes the nav link work: it scrolls to the
      // act's exact top, which is the pin's own start, and a jump that lands *on*
      // a boundary does not reliably cross it — no enter, no progress change, no
      // callback. `top+=4` aligns the section top with a line 4px below the
      // viewport top, so the trigger is already open by the time that landing
      // happens.
      ScrollTrigger.create({
        trigger: section,
        start: "top top+=4",
        end: "bottom bottom",
        onEnter: () => setNavDark(true),
        onEnterBack: () => setNavDark(true),
      });

      gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: {
          trigger: section,
          start: "top top",
          end: "bottom bottom",
          scrub: true,
        },
      }).fromTo(fillRef.current, { scaleX: 0 }, { scaleX: 1, duration: 1 }, 0);
    }, section);

    return () => ctx.revert();
  }, [setNavDark]);

  return (
    <section
      ref={sectionRef}
      data-movement="corridor"
      className={styles.corridor}
      style={{ height: mobile ? "260vh" : "480vh" }}
      aria-label="The corridor"
    >
      <div ref={stageRef} className={styles.corridorStage}>
        <p className={`caps-label ${styles.chapterMark}`}>Mariva — Stay</p>

        <div ref={trackRef} className={styles.track}>
          {PANELS.map((panel, i) =>
            panel.kind === "tone" ? (
              <div
                key={`tone-${i}`}
                className={`${styles.panel} ${styles.tonePanel} ${
                  panel.quiet ? styles.toneQuiet : ""
                }`}
                style={
                  { "--w": `${mobile ? panel.mw : panel.w}vw` } as React.CSSProperties
                }
              >
                <p className={`caps-label ${styles.toneKicker}`}>{panel.kicker}</p>
                <p className={`font-display ${styles.toneLine}`}>{panel.line}</p>
              </div>
            ) : (
              <div
                key={panel.slug}
                className={styles.panel}
                style={
                  { "--w": `${mobile ? panel.mw : panel.w}vw` } as React.CSSProperties
                }
              >
                <div data-media className={styles.panelMedia}>
                  <img
                    src={tierSrc(pick(panel.slug).src, 1280)}
                    srcSet={tierSrcSet(pick(panel.slug))}
                    sizes={`${mobile ? panel.mw : panel.w}vw`}
                    alt={pick(panel.slug).alt}
                    loading={i > 1 ? "lazy" : undefined}
                  />
                  <div className={styles.panelScrim} aria-hidden />
                </div>
                {panel.headline ? (
                  <p className={`font-display ${styles.panelHeadline}`}>
                    {panel.headline}
                  </p>
                ) : null}
                {panel.caption ? (
                  <p className={`caps-label ${styles.panelCaption}`}>{panel.caption}</p>
                ) : null}
              </div>
            ),
          )}
        </div>

        <div className={styles.corridorFoot}>
          <div className={styles.footRule} aria-hidden>
            <div ref={fillRef} className={styles.footRuleFill} />
          </div>
        </div>
      </div>
    </section>
  );
}

/** Reduced motion: the panels as a plain grid, copy intact. */
export function CorridorStatic() {
  return (
    <section className={styles.corridor} aria-label="The corridor">
      <div className={styles.staticCorridor}>
        {PANELS.filter((p): p is Extract<Panel, { kind: "photo" }> => p.kind === "photo").map(
          (panel) => (
            <figure key={panel.slug}>
              <img
                src={tierSrc(pick(panel.slug).src, 640)}
                srcSet={tierSrcSet(pick(panel.slug))}
                sizes="(max-width: 767px) 92vw, 30vw"
                alt={pick(panel.slug).alt}
                loading="lazy"
              />
              {panel.headline ? (
                <figcaption className={`font-display ${styles.toneLine}`}>
                  {panel.headline}
                </figcaption>
              ) : null}
              {panel.caption ? (
                <p className={`caps-label ${styles.toneKicker}`}>{panel.caption}</p>
              ) : null}
            </figure>
          ),
        )}
      </div>
    </section>
  );
}
