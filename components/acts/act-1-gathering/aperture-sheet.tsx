"use client";

// The flat foreground: an ivory sheet with the monogram punched out of it.
//
// The fallback for the WebGL lens, and static by design — no magnification, no
// distortion, just the window at rest. So it is drawn on a 2D canvas: one draw
// per resize, crisp at device resolution, no per-frame cost. The scene behind
// it still scrubs, so the act reads as a push through a fixed opening.

import { useEffect, useRef } from "react";
import { loadMonogramGlyph, traceDilatedMonogram, type MonogramGlyph } from "@/lib/monogram-glyph";
import { APERTURE_UNITS, sceneUnitPx } from "./intro-camera-model";

const SHEET_COLOR = "#f4efe6";

export function ApertureSheet({ onReady }: { onReady?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let live = true;
    let glyph: MonogramGlyph | null = null;

    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas || !glyph) return;
      const { clientWidth: w, clientHeight: h } = canvas;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = SHEET_COLOR;
      ctx.fillRect(0, 0, w, h);

      ctx.globalCompositeOperation = "destination-out";
      ctx.save();
      ctx.translate(w / 2, h / 2);
      traceDilatedMonogram(ctx, glyph, APERTURE_UNITS * sceneUnitPx(w, h));
      ctx.restore();
      ctx.globalCompositeOperation = "source-over";
    };

    loadMonogramGlyph().then((loaded) => {
      if (!live) return;
      glyph = loaded;
      draw();
      onReady?.();
    });

    window.addEventListener("resize", draw);
    return () => {
      live = false;
      window.removeEventListener("resize", draw);
    };
    // onReady is a stable callback from the orchestrator; the glyph loads once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
    />
  );
}
