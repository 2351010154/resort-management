"use client";

// The midground: photographs and short loops suspended at different depths in
// front of the interior plate and behind the monogram. They are projected from the
// same camera the monogram uses, so pushing in grows the near ones fast and the
// far ones slowly — that spread is the depth cue the intro is built on.
//
// Every card is a positioned wrapper with the media stretched inside it. The
// ticker only ever touches the wrapper, so a card can swap its poster for a
// video without the transform state living on the element being replaced.

import gsap from "gsap";
import { useEffect, useRef, useState } from "react";
import {
  INTRO_CARDS,
  cardLuminance,
  cardOpacity,
  planeScale,
  sceneUnitPx,
  type IntroCamera,
} from "./intro-camera-model";

/** Amplitude of the idle float, in world units (so it recedes with depth too). */
const DRIFT = 1.1;
/** Bounding-box margin that covers each card's few degrees of rotation. */
const ROTATION_SLACK = 1.15;

/**
 * Matches the plate-shade ramp in the orchestrator's scrub timeline. Full dark
 * well before the mark blows past at p≈0.4, so the letter's last strokes leave
 * against the deep interior rather than dragging the daylight out with them.
 */
const shadeRamp = (progress: number) =>
  Math.min(1, Math.max(0, (progress - 0.08) / 0.18)) *
  (1 - Math.min(1, Math.max(0, (progress - 0.9) / 0.08)));

/**
 * Peak over-exposure at the end of the push, before the ivory settle. Held off
 * until the last tenth: the deepest cards are still opening out until then, and
 * blowing the field out early costs exactly the arrival the act is built toward.
 */
const EXPOSURE = 3.4;
const exposureRamp = (progress: number) =>
  1 + (EXPOSURE - 1) * Math.min(1, Math.max(0, (progress - 0.91) / 0.09));

export function DepthImageField({
  camera,
  /** Reduced motion / no WebGL: render the field parked at rest, no ticker. */
  still = false,
}: {
  camera: IntroCamera;
  still?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  // Posters render first and the loops swap in after mount, so the field is
  // never waiting on video to have something inside the mark. Narrow screens
  // keep the posters: six decoders is past what phones reliably give you.
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (still) return;
    setPlaying(window.matchMedia("(min-width: 700px)").matches);
  }, [still]);

  // Only run while the act is on screen — six loops decoding behind a page the
  // reader has already scrolled past is pure heat.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !playing) return;
    const videos = Array.from(root.querySelectorAll("video"));
    const io = new IntersectionObserver(
      ([entry]) => {
        for (const video of videos) {
          if (entry.isIntersecting) video.play().catch(() => {});
          else video.pause();
        }
      },
      { threshold: 0 },
    );
    io.observe(root);
    return () => io.disconnect();
  }, [playing]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || still) return;
    const nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-depth-card]"));

    let unitPx = 0;
    // cards are laid out in vmin, so their transform scale carries the
    // difference between that and the scene unit
    let unitRatio = 1;
    let halfViewW = 0;
    let halfViewH = 0;
    const onResize = () => {
      const { innerWidth: w, innerHeight: h } = window;
      unitPx = sceneUnitPx(w, h);
      unitRatio = unitPx / (Math.min(w, h) / 100);
      halfViewW = w / 2;
      halfViewH = h / 2;
    };
    onResize();
    window.addEventListener("resize", onResize);

    const tick = () => {
      const { z, entry } = camera;
      const time = gsap.ticker.time;
      for (let i = 0; i < nodes.length; i++) {
        const card = INTRO_CARDS[i];
        const el = nodes[i];
        const apparent = card.depth - z;
        const scale = planeScale(card.depth, z);
        // How many frames across the card has grown, on whichever axis it fills
        // least: the axis that decides whether it could black the viewport out.
        const spanX = card.width * scale * unitPx;
        const coverage = Math.min(spanX / (halfViewW * 2), spanX / card.aspect / (halfViewH * 2));
        const opacity = cardOpacity(coverage) * entry;
        if (opacity <= 0.002) {
          el.style.visibility = "hidden";
          continue;
        }
        const x = (card.x + DRIFT * Math.sin(time * 0.32 + i * 1.7)) * scale * unitPx;
        const y = -(card.y + DRIFT * Math.cos(time * 0.27 + i * 2.3)) * scale * unitPx;
        // Cull off-frame cards. Several sweep well past the edges before they
        // finish fading, and a composited layer that large keeps costing the
        // compositor every frame even though nothing of it is on screen.
        const reachX = (spanX * ROTATION_SLACK) / 2;
        const reachY = reachX / card.aspect;
        if (Math.abs(x) - reachX > halfViewW || Math.abs(y) - reachY > halfViewH) {
          el.style.visibility = "hidden";
          continue;
        }
        el.style.visibility = "visible";
        el.style.opacity = opacity.toFixed(3);
        // Aerial perspective, then a blow-out as the frame arrives into light.
        const shade = 1 - (1 - cardLuminance(apparent)) * shadeRamp(camera.progress);
        el.style.filter = `brightness(${(shade * exposureRamp(camera.progress)).toFixed(3)})`;
        el.style.transform =
          `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) ` +
          `scale(${(scale * unitRatio).toFixed(4)}) rotate(${card.rotation}deg) ` +
          `translate(-50%, -50%)`;
      }
    };

    tick();
    gsap.ticker.add(tick);
    return () => {
      gsap.ticker.remove(tick);
      window.removeEventListener("resize", onResize);
    };
    // `playing` swaps the media inside each wrapper, so the node list is re-read
  }, [camera, still, playing]);

  const media: React.CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
  };

  return (
    <div ref={rootRef} style={{ position: "absolute", inset: 0 }} aria-hidden>
      {INTRO_CARDS.map((card) => {
        const scale = planeScale(card.depth, 0);
        return (
          <div
            key={card.src}
            data-depth-card
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: `${card.width}vmin`,
              aspectRatio: card.aspect,
              zIndex: Math.round(1000 - card.depth * 100),
              opacity: still ? 1 : 0,
              willChange: "transform, opacity, filter",
              backfaceVisibility: "hidden",
              transform:
                `translate3d(${(card.x * scale).toFixed(2)}vmin, ${(-card.y * scale).toFixed(2)}vmin, 0) ` +
                `scale(${scale.toFixed(4)}) rotate(${card.rotation}deg) translate(-50%, -50%)`,
            }}
          >
            {card.video && playing ? (
              <video
                muted
                loop
                playsInline
                autoPlay
                preload="none"
                poster={card.src}
                style={media}
              >
                <source src={card.video.webm} type="video/webm" />
                <source src={card.video.mp4} type="video/mp4" />
              </video>
            ) : (
              <img
                src={card.src}
                srcSet={card.srcSet || undefined}
                // Four times the card's size at rest: its layout box is small
                // but the transform scales it well past that as the camera
                // closes. Every card now arrives, so this is no longer the
                // couple of near ones that used to need the headroom.
                sizes={card.srcSet ? `${Math.round((card.width / card.depth) * 4)}vmin` : undefined}
                alt=""
                decoding="async"
                style={media}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
