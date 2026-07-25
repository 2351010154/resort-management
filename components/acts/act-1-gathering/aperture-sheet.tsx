"use client";

// The foreground layer: an ivory sheet with the monogram punched out of it.
//
// Static by design — the window never moves, only the scene behind it does. So
// it is drawn on a 2D canvas rather than animated in WebGL: one draw per
// resize, crisp at device resolution, no per-frame cost.
//
// The brand mark is a hairline monogram, which as a literal cut-out would show
// almost no image. Widening it is an outward stroke with round joins and caps,
// which is exactly morphological dilation by a disc — `fill()` plus `stroke()`
// at twice the offset. That is where the rounded stroke ends come from.

import { useEffect, useRef } from "react";
import { APERTURE_UNITS, sceneUnitPx } from "./intro-camera-model";

const SHEET_COLOR = "#f4efe6";
/** Outward offset, as a fraction of the mark's own height. */
const DILATE = 0.047;

interface Glyph {
  path: Path2D;
  /** Ink bounds of the undilated mark, in viewBox units. */
  box: { x: number; y: number; width: number; height: number };
}

/** Ink bounds of a path, by rasterising once and scanning the alpha channel. */
function measureInk(path: Path2D, viewW: number, viewH: number): Glyph["box"] {
  const probe = 512;
  const scale = probe / Math.max(viewW, viewH);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = probe;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.scale(scale, scale);
  ctx.fill(path, "evenodd");
  const { data } = ctx.getImageData(0, 0, probe, probe);
  let minX = probe, minY = probe, maxX = -1, maxY = -1;
  for (let y = 0; y < probe; y++) {
    for (let x = 0; x < probe; x++) {
      if (data[(y * probe + x) * 4 + 3] < 8) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return {
    x: minX / scale,
    y: minY / scale,
    width: (maxX - minX + 1) / scale,
    height: (maxY - minY + 1) / scale,
  };
}

async function loadGlyph(): Promise<Glyph> {
  const source = await fetch("/brand/mariva-monogram.svg").then((r) => r.text());
  const viewBox = (/viewBox="([-\d.\s]+)"/.exec(source)?.[1] ?? "0 0 340 260")
    .trim()
    .split(/\s+/)
    .map(Number);
  const d = /\sd="([^"]+)"/.exec(source)?.[1] ?? "";
  const path = new Path2D(d);
  return { path, box: measureInk(path, viewBox[2], viewBox[3]) };
}

export function ApertureSheet({ onReady }: { onReady?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let live = true;
    let glyph: Glyph | null = null;

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

      const { box } = glyph;
      const offset = DILATE * box.height;
      // the target height is of the *dilated* mark, so the window keeps the same
      // presence whatever the offset is tuned to
      const scale = (APERTURE_UNITS * sceneUnitPx(w, h)) / (box.height + offset * 2);

      ctx.globalCompositeOperation = "destination-out";
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.scale(scale, scale);
      ctx.translate(-(box.x + box.width / 2), -(box.y + box.height / 2));
      ctx.lineWidth = offset * 2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.stroke(glyph.path);
      ctx.fill(glyph.path, "evenodd");
      ctx.restore();
      ctx.globalCompositeOperation = "source-over";
    };

    loadGlyph().then((loaded) => {
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
