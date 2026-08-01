"use client";

// The flat foreground: the sea with the monogram punched out of it.
//
// The fallback for the WebGL lens, and static by design — no magnification, no
// distortion, just the window at rest. So it is drawn on a 2D canvas: one draw
// per resize, crisp at device resolution, no per-frame cost. The scene behind
// it still scrubs, so the act reads as a push through a fixed opening.
//
// It draws the loop's poster rather than the loop. This path exists for
// reduced motion and for machines without WebGL; on the first that is the
// point, and on the second a fullscreen video decode is the last thing to ask
// for.

import { useEffect, useRef } from "react";
import {
  FOCUS_Y,
  loadMonogramGlyph,
  traceMonogram,
  type MonogramGlyph,
} from "@/features/arrival/lib/monogram-glyph";
import { APERTURE_UNITS, sceneUnitPx } from "./intro-camera-model";
import {
  HORIZON_POSTER,
  horizonPlacement,
  horizonScreenY,
} from "./horizon-plate";

/**
 * The reflection, matched to the shader's: the same warm lift, and a reach and
 * falloff that trace the same exponential closely enough that the two paths
 * open on the same picture. Three stops rather than two because a straight ramp
 * loses the bright first few pixels that make it read as a reflection at all.
 */
const REFLECT_TONE = "255, 230, 188";
const REFLECT_REACH = 0.9;
const REFLECT_STOPS: [number, number][] = [
  [0, 0.16],
  [0.34, 0.053],
  [1, 0],
];

export function ApertureSheet({ onReady }: { onReady?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: onReady is a stable callback from the orchestrator and the assets load once — listing it would re-run the whole load on every parent render.
  useEffect(() => {
    let live = true;
    let glyph: MonogramGlyph | null = null;
    let sea: HTMLImageElement | null = null;

    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas || !glyph || !sea) return;
      const { clientWidth: w, clientHeight: h } = canvas;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const markPx = APERTURE_UNITS * sceneUnitPx(w, h);
      const box = horizonPlacement(
        w,
        h,
        sea.naturalWidth,
        sea.naturalHeight,
        horizonScreenY(h, markPx),
      );
      ctx.drawImage(sea, box.left, box.top, box.width, box.height);

      // The mark, given back by the water below its baseline. Drawn before the
      // cut-out: it belongs to the sea, not to what shows through the letter.
      //
      // Built on its own canvas because the fade has to be applied to the
      // silhouette after it is drawn. A gradient fill would not do it: canvas
      // resolves gradient coordinates against the transform in force when the
      // path is filled, and the mark arrives inside a flip and a scale.
      const baseY = h / 2 + (1 - FOCUS_Y) * markPx;
      const mirror = document.createElement("canvas");
      mirror.width = canvas.width;
      mirror.height = canvas.height;
      const mc = mirror.getContext("2d")!;
      mc.setTransform(dpr, 0, 0, dpr, 0, 0);
      mc.save();
      mc.translate(0, 2 * baseY);
      mc.scale(1, -1);
      mc.translate(w / 2, h / 2);
      mc.fillStyle = `rgb(${REFLECT_TONE})`;
      traceMonogram(mc, glyph, markPx);
      mc.restore();
      const fade = mc.createLinearGradient(
        0,
        baseY,
        0,
        baseY + REFLECT_REACH * markPx,
      );
      for (const [at, alpha] of REFLECT_STOPS) {
        fade.addColorStop(at, `rgba(255, 255, 255, ${alpha})`);
      }
      mc.globalCompositeOperation = "destination-in";
      mc.fillStyle = fade;
      mc.fillRect(0, baseY, w, h - baseY);

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(mirror, 0, 0, w, h);
      ctx.restore();

      ctx.globalCompositeOperation = "destination-out";
      ctx.save();
      ctx.translate(w / 2, h / 2);
      traceMonogram(ctx, glyph, markPx);
      ctx.restore();
      ctx.globalCompositeOperation = "source-over";
    };

    const ready = () => {
      if (!live || !glyph || !sea) return;
      draw();
      onReady?.();
    };

    loadMonogramGlyph().then((loaded) => {
      glyph = loaded;
      ready();
    });
    const image = new Image();
    image.src = HORIZON_POSTER;
    image
      .decode()
      .then(() => {
        sea = image;
        ready();
      })
      .catch(() => {});

    window.addEventListener("resize", draw);
    return () => {
      live = false;
      window.removeEventListener("resize", draw);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
    />
  );
}
