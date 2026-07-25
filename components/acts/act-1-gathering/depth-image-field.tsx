"use client";

// The midground: photographs suspended at different depths in front of the
// coast plate and behind the monogram aperture. They are projected from the same
// camera the aperture uses, so pushing in grows the near ones fast and the far
// ones slowly — that spread is the depth cue the intro is built on.

import gsap from "gsap";
import { useEffect, useRef } from "react";
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

/** Matches the plate-shade ramp in the orchestrator's scrub timeline. */
const shadeRamp = (progress: number) =>
  Math.min(1, Math.max(0, (progress - 0.14) / 0.45)) *
  (1 - Math.min(1, Math.max(0, (progress - 0.68) / 0.2)));

/** Peak over-exposure at the end of the push, before the ivory settle. */
const EXPOSURE = 3.4;
const exposureRamp = (progress: number) =>
  1 + (EXPOSURE - 1) * Math.min(1, Math.max(0, (progress - 0.83) / 0.15));

export function DepthImageField({
  camera,
  /** Reduced motion / no WebGL: render the field parked at rest, no ticker. */
  still = false,
}: {
  camera: IntroCamera;
  still?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

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
        const opacity = cardOpacity(apparent) * entry;
        if (opacity <= 0.002) {
          el.style.visibility = "hidden";
          continue;
        }
        const scale = planeScale(card.depth, z);
        const x = (card.x + DRIFT * Math.sin(time * 0.32 + i * 1.7)) * scale * unitPx;
        const y = -(card.y + DRIFT * Math.cos(time * 0.27 + i * 2.3)) * scale * unitPx;
        // Cull off-frame cards. Several sweep well past the edges before they
        // finish fading, and a composited layer that large keeps costing the
        // compositor every frame even though nothing of it is on screen.
        const reachX = (card.width * scale * unitPx * ROTATION_SLACK) / 2;
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
  }, [camera, still]);

  return (
    <div ref={rootRef} style={{ position: "absolute", inset: 0 }} aria-hidden>
      {INTRO_CARDS.map((card, i) => {
        const scale = planeScale(card.depth, 0);
        return (
          <img
            key={card.src}
            data-depth-card
            src={card.src}
            srcSet={card.srcSet}
            // Twice the card's size at rest: its layout box is small but the
            // transform scales it well past that as the camera closes in.
            sizes={`${Math.round((card.width / card.depth) * 2)}vmin`}
            alt=""
            decoding="async"
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: `${card.width}vmin`,
              height: "auto",
              aspectRatio: card.aspect,
              objectFit: "cover",
              zIndex: Math.round(1000 - card.depth * 100),
              opacity: still ? 1 : 0,
              willChange: "transform, opacity, filter",
              backfaceVisibility: "hidden",
              transform:
                `translate3d(${(card.x * scale).toFixed(2)}vmin, ${(-card.y * scale).toFixed(2)}vmin, 0) ` +
                `scale(${scale.toFixed(4)}) rotate(${card.rotation}deg) translate(-50%, -50%)`,
            }}
          />
        );
      })}
    </div>
  );
}
