"use client";

// Act 3 — "The Approach": the arrival loop starts as a centered card and
// swells to fullscreen driven by scroll (floema mechanic). Ends on a
// fullscreen hold beat; Act 4 emerges from the (now viewport-centered) video
// center — the handoff is simply the stable fullscreen end state.
//
// Two things ride that hold beat. The hour goes: once the frame has filled the
// viewport the footage grades down toward dusk, so the flip out of the ivory
// acts into Act 4's dark interior is caused by the light going rather than by
// a section boundary. And the caption arrives, because a label on a picture
// only means anything once the picture is the whole page.
//
// The grade is one number — a `--dusk` custom property on the stage, 0 for the
// light the loop was shot in and 1 for nightfall. Every layer of it is derived
// in the stylesheet; this file only decides when that number moves.

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useArrivalActStore } from "@/features/arrival/lib/act-store";
import { prefersReducedMotion } from "@/features/arrival/lib/webgl-support";
import styles from "./act-3-approach.module.css";
import {
  APPROACH_CLIPS,
  clipPoster,
  clipSource,
  DEFAULT_CLIP_INDEX,
} from "./approach-clips";
import { ClipSelector } from "./clip-selector";
// Imported for the timeline's sake, the way the tail fade is targeted below:
// the column's entry is part of the act's choreography, so the act owns it, and
// a class selector keeps that without threading two refs out of a presentational
// component that has no other reason to expose them.
import selectorStyles from "./clip-selector.module.css";

// Where the swelling frame reaches the bar. The shell is a full viewport scaled
// from 0.42 to 1 across the first 75% of the pin, so its top edge sits
// (1 - scale) / 2 of the viewport down; the bar clears at roughly scale 0.88,
// which is progress 0.6. Handing over slightly early lets the 0.5s tone fade
// settle before the video is actually behind the bar.
//
// Unmoved by the dusk grade below: the grade only starts well after this point
// and only ever subtracts light, so every frame the ivory bar stands on from
// here is darker than the one this threshold was tuned against.
const NAV_HANDOVER = 0.56;

// When the evening starts, as a fraction of the pin. The swell owns the first
// 75%, and the frame has to arrive in the light it was shot in for the swell
// to be worth watching, so nothing touches the grade until the card is already
// most of the way up. Starting a hair before it lands rather than exactly on
// it keeps the darkening off the same frame as the scale settling — the reader
// should see the light going, not a switch being thrown. The remaining ~80% of
// nightfall then falls across the fullscreen hold, which is what leaves Act 4
// a page that is already night to open its corridor on.
const DUSK_START = 0.68;

// When the clip column stops sitting on the page and starts sitting on the
// picture. The column's ink-to-ivory mix rides this span rather than a
// breakpoint, because on a wide viewport the frame's edge reaches it later than
// on a narrow one and a single hard flip would be wrong on one of them.
//
// Timed off the panel's OUTER edge, not the point the frame first reaches the
// type. The shell scales 0.42 -> 1 across the first 75% of the pin, so its right
// edge only clears a panel inset from the viewport edge at about scale 0.96 —
// progress 0.69 on a 1440-wide viewport, and later still on a wider one. Fading
// the glass in any earlier was the visible bug in the first pass: the frosted
// plate reached past the picture and hung its right third over bare ivory,
// which reads as a panel that missed its mark rather than glass on a photo.
// Starting at 0.62 keeps the ramp faint while that overhang is still shrinking
// and full only once the frame is under all of it.
const FILL_START = 0.62;
const FILL_END = 0.74;

// How long one passage takes to become the next. Long enough to read as a
// dissolve rather than a cut, short enough that a reader moving down the four
// labels is not queuing behind their own last choice.
const CROSSFADE_MS = 450;

// Where the column starts arriving, as the section's top measured down the
// viewport — so the entry runs across the last third of the approach and ends
// exactly where the pin begins. Far enough ahead that the column is settled
// before the picture moves, short enough that it is not drifting in for half a
// screen with nothing else happening.
const ENTRY_START_VH = 35;

// Identity for the two stacked video elements. Named rather than indexed so a
// slot keeps the same key for the life of the act no matter which passage is
// currently sitting in it.
const LAYER_KEYS = ["layer-a", "layer-b"] as const;

export function VideoSwell() {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLDivElement>(null);
  const layerARef = useRef<HTMLVideoElement>(null);
  const layerBRef = useRef<HTMLVideoElement>(null);
  // Memoised, and that is load-bearing rather than tidiness: this tuple is a
  // dependency of the observer, the reveal and the pause timer below, and a
  // fresh array each render would rebuild all three on every render — the
  // timer never firing because it is cleared before it lands.
  const layerRefs = useMemo(() => [layerARef, layerBRef] as const, []);
  const [reduced, setReduced] = useState<boolean | null>(null);
  const setNavDark = useArrivalActStore((s) => s.setNavDark);

  // Which format this browser will actually decode, resolved once. Two <source>
  // children would settle this for free, but only on first load: swapping a
  // clip means swapping the element's src, and a src set directly bypasses the
  // source list entirely. Probing once and writing a real URL keeps every
  // subsequent swap on the same footing as the first paint.
  const [format, setFormat] = useState<"webm" | "mp4" | null>(null);

  // Which of the two stacked layers is showing, and what each is holding. Only
  // the default clip has a src at mount; a layer is handed a URL the first time
  // a reader asks for that passage, which is what keeps three of the four off
  // the wire for a reader who never touches the column.
  const [front, setFront] = useState<0 | 1>(0);
  const [layerClips, setLayerClips] = useState<
    readonly [number, number | null]
  >([DEFAULT_CLIP_INDEX, null]);
  // The clip a swap is currently working toward. Held in a ref rather than
  // state because the reveal effect needs to read it without re-running when it
  // changes, and because a second request arriving mid-swap should replace it
  // silently rather than queue behind it.
  const pendingRef = useRef<number | null>(null);

  const activeIndex = layerClips[front] ?? DEFAULT_CLIP_INDEX;

  useEffect(() => setReduced(prefersReducedMotion()), []);

  useEffect(() => {
    const probe = document.createElement("video");
    setFormat(probe.canPlayType('video/webm; codecs="vp9"') ? "webm" : "mp4");
  }, []);

  // Load the requested passage into the hidden layer. Nothing is revealed until
  // that layer has a frame to show — crossfading to a video that has not
  // decoded yet dissolves the picture into black and back, which is worse than
  // the cut the fade was there to avoid.
  const selectClip = useCallback(
    (index: number) => {
      if (index === activeIndex || pendingRef.current === index) return;
      pendingRef.current = index;
      const back = (1 - front) as 0 | 1;
      setLayerClips((prev) =>
        back === 0 ? [index, prev[1]] : [prev[0], index],
      );
    },
    [activeIndex, front],
  );

  useEffect(() => {
    const pending = pendingRef.current;
    if (pending === null) return;
    const back = (1 - front) as 0 | 1;
    const video = layerRefs[back].current;
    if (!video || layerClips[back] !== pending) return;

    let cancelled = false;
    const reveal = () => {
      if (cancelled) return;
      pendingRef.current = null;
      // Reduced motion still gets to choose its view — the column is a choice,
      // not an animation — but it gets it as the poster still the rest of this
      // path is built on. Nothing here starts playing.
      if (!reduced) video.play().catch(() => {});
      setFront(back);
    };
    // HAVE_CURRENT_DATA or better means there is a frame to dissolve into.
    if (video.readyState >= 2) reveal();
    else video.addEventListener("loadeddata", reveal, { once: true });
    return () => {
      cancelled = true;
      video.removeEventListener("loadeddata", reveal);
    };
  }, [front, layerClips, layerRefs, reduced]);

  // Once the dissolve is over, the outgoing passage is a video decoding behind
  // an opaque one. Stop it — four clips are on this page and only one of them
  // is being looked at.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      layerRefs[(1 - front) as 0 | 1].current?.pause();
    }, CROSSFADE_MS);
    return () => window.clearTimeout(timer);
  }, [front, layerRefs]);

  // GSAP transforms its pin wrapper, which makes CSS fixed backgrounds
  // scroll locally. Register each crop against the viewport explicitly.
  useEffect(() => {
    const section = sectionRef.current;
    const stage = stageRef.current;
    const horizon = document.querySelector<HTMLElement>("[data-stone-horizon]");
    if (!section || !stage || !horizon) return;
    const surfaces = [
      { element: horizon, pseudo: "::after" },
      { element: section, pseudo: "::before" },
      { element: stage, pseudo: "::before" },
    ];
    const previous = new Map<HTMLElement, number>();
    const sync = () => {
      for (const { element, pseudo } of surfaces) {
        const rect = element.getBoundingClientRect();
        const layer = getComputedStyle(element, pseudo);
        const offset = -(rect.top + Number.parseFloat(layer.top));
        if (!Number.isFinite(offset) || previous.get(element) === offset)
          continue;
        element.style.setProperty("--stone-offset", `${offset}px`);
        previous.set(element, offset);
      }
    };
    // Run after the pin's scroll update, including its refresh and resize work.
    gsap.ticker.add(sync);
    sync();
    return () => {
      gsap.ticker.remove(sync);
      for (const { element } of surfaces)
        element.style.removeProperty("--stone-offset");
    };
  }, []);

  // Reduced motion holds the frame fullscreen for the whole act, so the bar is
  // over video the entire time it owns the viewport.
  useEffect(() => {
    if (reduced !== true) return;
    setNavDark(3, true);
    return () => setNavDark(3, false);
  }, [reduced, setNavDark]);

  // Play only while on screen (autoplay muted+playsInline for Safari). The
  // stage is what gets observed rather than the video: the shell is scaled by
  // the scrub, and an element transformed down to 42% crosses an intersection
  // threshold on its own account, which would pause the loop for reasons that
  // have nothing to do with whether the reader can see it.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || reduced) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        const video = layerRefs[front].current;
        if (!video) return;
        if (entry.isIntersecting) video.play().catch(() => {});
        else video.pause();
      },
      { threshold: 0.1 },
    );
    io.observe(stage);
    return () => io.disconnect();
  }, [reduced, front, layerRefs]);

  useEffect(() => {
    if (reduced !== false) return;
    const section = sectionRef.current;
    const stage = stageRef.current;
    const shell = shellRef.current;
    const caption = captionRef.current;
    if (!section || !stage || !shell || !caption) return;
    gsap.registerPlugin(ScrollTrigger);
    let dark = false;

    const ctx = gsap.context(() => {
      ScrollTrigger.create({
        trigger: section,
        start: "top top",
        end: "bottom bottom",
        pin: stage,
        pinSpacing: false,
      });
      gsap
        .timeline({
          defaults: { ease: "none" },
          scrollTrigger: {
            trigger: section,
            start: "top top",
            end: "bottom bottom",
            scrub: true,
            onUpdate: (self) => {
              const next = self.progress > NAV_HANDOVER;
              if (next === dark) return;
              dark = next;
              setNavDark(3, next);
            },
          },
        })
        // card -> fullscreen across the first 75%; hold beat 75-100%
        .fromTo(
          shell,
          { scale: 0.42, borderRadius: 24 },
          { scale: 1, borderRadius: 0, duration: 0.75 },
          0,
        )
        // The hour, held at the loop's own light until the frame is nearly
        // fullscreen and then run down to nightfall at the pin's end. Linear,
        // and deliberately so: under a scrub the reader is the clock, and any
        // curve here shows up as the page disagreeing with the hand about how
        // fast the sun is going down.
        .fromTo(
          stage,
          { "--dusk": 0 },
          { "--dusk": 1, duration: 1 - DUSK_START },
          DUSK_START,
        )
        // The clip column crossing from the page onto the picture, over the
        // span where the growing frame actually passes underneath it. Linear
        // and short: this is one ground replacing another, and any ease here
        // would put the type at its least legible mix for longer.
        .fromTo(
          stage,
          { "--frame-fill": 0 },
          { "--frame-fill": 1, duration: FILL_END - FILL_START },
          FILL_START,
        )
        // The label belongs to the fullscreen frame, so it arrives with it: a
        // short rise out of the foot at the frame the swell completes, then it
        // holds for the rest of the act. Eased, unlike the grade — this is an
        // entrance with a settle, not a quantity the reader is scrubbing.
        .fromTo(
          caption,
          { autoAlpha: 0, y: 14 },
          { autoAlpha: 1, y: 0, duration: 0.08, ease: "power2.out" },
          0.75,
        )
        // the frame's foot dissolves into Act 4's dark — no cut line at the pin
        .to(`.${styles.tailFade}`, { autoAlpha: 1, duration: 0.2 }, 0.76)
        // fullscreen hold beat: pads the timeline so the swell completes at
        // 75% of the pin and the last quarter rides fullscreen into Act 4
        .to({}, { duration: 0.25 }, 0.75);

      // The column's entry, and it needs a trigger of its own because the one
      // above cannot reach where this has to happen. That timeline is the pin:
      // its progress 0 is the frame the zoom starts on, so the earliest an
      // entry written into it can possibly begin is the same instant the
      // picture begins to grow — which is late. The card has been sitting on
      // screen at 42% for the whole approach by then, and a control column
      // snapping in on the first frame of movement reads as a thing that was
      // waiting to ambush the scroll.
      //
      // So it runs across the approach instead: from the section's top a third
      // of the way up the viewport to the moment it reaches the top and the pin
      // takes over. The column is fully settled on the frame the zoom begins,
      // and the reader has had it in the corner of their eye for a beat before
      // the picture starts moving.
      gsap
        .timeline({
          scrollTrigger: {
            trigger: section,
            start: `top ${ENTRY_START_VH}%`,
            end: "top top",
            scrub: true,
          },
        })
        // The panel carries the fade and the four labels carry only a rise —
        // deliberately split, because the stylesheet uses opacity to say which
        // clip is playing (0.55 against 1). A tween that touched the labels'
        // opacity would leave an inline 1 on all four and quietly flatten that
        // distinction for the rest of the act.
        .fromTo(
          `.${selectorStyles.panel}`,
          { autoAlpha: 0, x: 18 },
          { autoAlpha: 1, x: 0, duration: 0.7, ease: "power2.out" },
          0,
        )
        .fromTo(
          `.${selectorStyles.label}`,
          { y: 14 },
          { y: 0, duration: 0.7, stagger: 0.08, ease: "power2.out" },
          0.1,
        );
    }, section);
    return () => {
      ctx.revert();
      setNavDark(3, false);
    };
  }, [reduced, setNavDark]);

  return (
    <section
      ref={sectionRef}
      data-act={3}
      className={styles.section}
      style={{ height: reduced === false ? "180vh" : "auto" }}
    >
      <div
        ref={stageRef}
        className={styles.stage}
        // Only once the probe has answered true, so the server's markup and
        // the first client paint agree on a frame that carries no still.
        data-still={reduced === true ? "true" : undefined}
      >
        <div
          ref={shellRef}
          className={styles.videoShell}
          // The dissolve is timed in one place. The stylesheet runs it and this
          // file also has to know when it is over, to stop the outgoing video —
          // so the number is written here and the CSS reads it.
          style={{ "--crossfade": `${CROSSFADE_MS}ms` } as CSSProperties}
        >
          {/* Two layers rather than one element with a swapped src: a src swap
              blanks the frame while the new file opens, and this frame is the
              whole page by the time most swaps happen. The hidden layer loads
              underneath and the pair dissolves. */}
          {layerRefs.map((ref, layer) => {
            const index = layerClips[layer];
            const clip = index === null ? null : APPROACH_CLIPS[index];
            return (
              <video
                // Keyed by stack position, not by the clip it holds: these two
                // elements are fixed slots that passages move through, and
                // keying by clip would remount the very element the dissolve
                // is waiting on.
                key={LAYER_KEYS[layer]}
                ref={ref}
                className={styles.layer}
                data-front={layer === front || undefined}
                muted
                loop
                playsInline
                autoPlay={reduced === false && layer === front}
                // A layer with nothing in it must not fetch. Once it is holding
                // a passage it has to buffer far enough to hand over a frame,
                // which `none` would never let it reach.
                preload={clip && format ? "auto" : "none"}
                src={clip && format ? clipSource(clip, format) : undefined}
                poster={clip ? clipPoster(clip) : undefined}
              />
            );
          })}
          <div className={styles.duskGrade} aria-hidden />
        </div>
        <div className={styles.tailFade} aria-hidden />
        <div ref={captionRef} className={styles.caption}>
          <span className="caps-label">The approach, at dusk</span>
        </div>
        <ClipSelector
          clips={APPROACH_CLIPS}
          activeIndex={activeIndex}
          onSelect={selectClip}
        />
      </div>
    </section>
  );
}
