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
//
// The strip's last panel is not a photograph but a statement screen wider than
// the frame, on the act's one bright ground. It is what ends the dark half of
// the chapter: the corridor does not fade out, it is covered, and the ink the
// nav bar is drawn in flips as the cover completes. The dark furniture on the
// stage — the chapter mark and the foot rule — fades on the same figure, since
// both are sand-on-dark and the panel underneath them is not dark any more.

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useRef } from "react";
import { useArrivalActStore } from "@/features/arrival/lib/act-store";
import { arrivalImages } from "@/features/arrival/lib/image-manifest";
import { tierSrc, tierSrcSet } from "@/features/arrival/lib/image-srcset";
import styles from "./act-4-stay.module.css";
import { FIELD_HANDOFF } from "./experience-field";

const PANELS_IMG = arrivalImages["act-4-corridor"];
const pick = (slug: string) => PANELS_IMG.find((i) => i.src.includes(slug))!;

/** Measured against oryzo.ai: photography runs at 0.937 of the track. */
const PHOTO_LAG = 0.063;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

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
      kicker?: string;
      line: string;
      quiet?: boolean;
    }
  // The statement is one line and nothing else. It is the act's hinge and it
  // arrives on a frame the reader has just watched go from dark to ivory, so a
  // chapter mark above it and an instruction below it are both things standing
  // in front of the only sentence that had to be there.
  | {
      kind: "statement";
      w: number;
      mw: number;
      line: string;
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
    line: "Forty rooms.\nFive kinds of morning.",
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
    caption: "Suite 508.",
  },
  {
    kind: "statement",
    w: 100,
    mw: 100,
    line: "A day here does not end.\nIt turns.",
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
    const stage = stageRef.current;
    const track = trackRef.current;
    if (!section || !stage || !track) return;
    gsap.registerPlugin(ScrollTrigger);

    const ctx = gsap.context(() => {
      const media = gsap.utils.toArray<HTMLElement>("[data-media]", track);
      const setters = media.map((el) => gsap.quickSetter(el, "x", "px"));
      const trackX = gsap.quickSetter(track, "x", "px");
      const statement = track.querySelector<HTMLElement>("[data-statement]");

      // Distance the track must travel for its tail to reach the right edge.
      let travel = 0;
      const measure = () => {
        travel = Math.max(0, track.scrollWidth - window.innerWidth);
      };
      measure();

      // How much of the frame the statement panel owns, 0 before it enters and
      // 1 once it is the whole of it. Read off the panel's real position rather
      // than off a scroll fraction: the strip's travel is measured, so any
      // fraction of it would have to be re-derived every time a panel width
      // changes, and would be wrong at the width it was not derived for.
      let cover = 0;
      let coverWritten = -1;
      // Written on every update rather than only on a change. `setNavDark` is
      // idempotent and returns the same state object when the claim already
      // matches, so a repeat costs one array lookup and re-renders nothing —
      // and the claim is not this movement's alone. Both movements in the act
      // write the same act's claim and one of them releases it on teardown, so
      // a component that only speaks when its own opinion changes can be
      // silently overruled and never notice: the corridor held "dark" as a
      // local belief while the bar it was describing had gone light.
      const syncNav = () => setNavDark(4, cover < 0.5);

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

        if (!statement) return;
        const vw = window.innerWidth;
        // The panel is wider than the frame, so its leading edge reaching the
        // left of the frame is the moment it covers all of it — one subtraction
        // rather than a pair of edge tests.
        cover = clamp01((vw - (statement.offsetLeft + x)) / vw);
        // Shaped so the furniture is fully gone by the time the ink flips, and
        // written only when it has actually moved: two stage-wide elements read
        // this as an opacity, which is a repaint rather than a composite.
        const shaped = smoothstep(0.08, 0.5, cover);
        if (Math.abs(shaped - coverWritten) > 0.004) {
          coverWritten = shaped;
          stage.style.setProperty("--cover", shaped.toFixed(3));
        }
        syncNav();
      };

      // The pin outlives the scrub, which is what buys the statement its dwell:
      // the track finishes travelling at this section's own bottom and the
      // bright panel then holds the frame until the rooms' stage pins over it.
      // Released at `bottom bottom` the stage would scroll away over the
      // viewport the next movement rises through, and what that viewport would
      // show is the corridor's dark ground with nothing on it.
      //
      // It outlives the rooms' arrival too, by exactly the hand-off the rooms
      // run their opening on. The statement is not faded out by this movement —
      // it is covered, in place, by an ivory sheet the movement above draws over
      // it — and a sentence being covered has to be standing still while it
      // happens. Released the moment the rooms pin, this stage would come off
      // its pin and start scrolling away under that sheet, and the reader would
      // watch the line slide upward as it went.
      const rooms = document.querySelector<HTMLElement>(
        '[data-movement="experiences"]',
      );
      ScrollTrigger.create({
        trigger: section,
        start: "top top",
        endTrigger: rooms ?? section,
        end: rooms
          ? () =>
              `top top-=${Math.round(
                Math.max(1, rooms.offsetHeight - window.innerHeight) *
                  FIELD_HANDOFF,
              )}`
          : "bottom bottom",
        pin: stage,
        pinSpacing: false,
      });

      ScrollTrigger.create({
        trigger: section,
        start: "top top",
        end: "bottom bottom",
        invalidateOnRefresh: true,
        onRefresh: (self) => {
          measure();
          apply(self.progress);
        },
        onUpdate: (self) => apply(self.progress),
      });

      // The ink at the two boundaries, where a scrub update is not guaranteed
      // to arrive. Both read the same `cover` the scrub writes, so the corridor
      // has exactly one opinion about the bar: dark under the filmstrip, light
      // under the statement — including on the way back up, where forcing dark
      // on re-entry used to put an ink bar on the ivory panel.
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
        onEnter: syncNav,
        onEnterBack: syncNav,
      });

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
        .fromTo(fillRef.current, { scaleX: 0 }, { scaleX: 1, duration: 1 }, 0);
    }, section);

    return () => ctx.revert();
  }, [setNavDark]);

  return (
    <section
      ref={sectionRef}
      data-movement="corridor"
      className={styles.corridor}
      // Up a screen from what the filmstrip alone asked for: the statement
      // panel is a viewport of its own to travel across, and at the old height
      // the whole strip simply ran faster to fit it in.
      style={{ height: mobile ? "300vh" : "560vh" }}
      aria-label="The corridor"
    >
      <div ref={stageRef} className={styles.corridorStage}>
        <p className={`caps-label ${styles.chapterMark}`}>Mariva — Stay</p>

        <div ref={trackRef} className={styles.track}>
          {PANELS.map((panel, i) =>
            panel.kind === "statement" ? (
              <div
                key="statement"
                data-statement
                className={`${styles.panel} ${styles.statementPanel}`}
                style={
                  {
                    "--w": `${mobile ? panel.mw : panel.w}vw`,
                  } as React.CSSProperties
                }
              >
                <p className={`font-display ${styles.statementLine}`}>
                  {panel.line}
                </p>
              </div>
            ) : panel.kind === "tone" ? (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: PANELS is a module constant of fixed length and order — the index is the panel's identity, and there is no other field that distinguishes two quiet tone panels.
                key={`tone-${i}`}
                className={`${styles.panel} ${styles.tonePanel} ${
                  panel.quiet ? styles.toneQuiet : ""
                }`}
                style={
                  {
                    "--w": `${mobile ? panel.mw : panel.w}vw`,
                  } as React.CSSProperties
                }
              >
                {panel.kicker ? (
                  <p className={`caps-label ${styles.toneKicker}`}>
                    {panel.kicker}
                  </p>
                ) : null}
                <p className={`font-display ${styles.toneLine}`}>
                  {panel.line}
                </p>
              </div>
            ) : (
              <div
                key={panel.slug}
                className={styles.panel}
                style={
                  {
                    "--w": `${mobile ? panel.mw : panel.w}vw`,
                  } as React.CSSProperties
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
                  <p className={`caps-label ${styles.panelCaption}`}>
                    {panel.caption}
                  </p>
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

const STATEMENT = PANELS.find(
  (p): p is Extract<Panel, { kind: "statement" }> => p.kind === "statement",
);

/** Reduced motion: the panels as a plain grid, copy intact, and the statement
 *  as the bright block that ends the chapter's dark half. */
export function CorridorStatic() {
  const setNavDark = useArrivalActStore((s) => s.setNavDark);

  // No scroll trigger runs on this path, so nothing else would ever tell the
  // bar that Act 4 is a dark act. The static composition is dark apart from the
  // statement block, so one claim for the whole act is the honest answer.
  useEffect(() => {
    setNavDark(4, true);
    return () => setNavDark(4, false);
  }, [setNavDark]);

  return (
    <section className={styles.corridor} aria-label="The corridor">
      <div className={styles.staticCorridor}>
        {PANELS.filter(
          (p): p is Extract<Panel, { kind: "photo" }> => p.kind === "photo",
        ).map((panel) => (
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
              <p className={`caps-label ${styles.toneKicker}`}>
                {panel.caption}
              </p>
            ) : null}
          </figure>
        ))}
      </div>

      {STATEMENT ? (
        <div className={styles.staticStatement}>
          <p className={`font-display ${styles.statementLine}`}>
            {STATEMENT.line}
          </p>
        </div>
      ) : null}
    </section>
  );
}
