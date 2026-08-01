// Detect whether the WebGL layer (goo shader, 3D scenes) should mount at all.
// If WebGL is missing/disabled or the user prefers reduced motion, the landing
// renders the static fallback instead.

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function isWebglAvailable(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl");
    return !!gl;
  } catch {
    return false;
  }
}

// True when the cinematic layer should render.
export function shouldRenderFilm(): boolean {
  return isWebglAvailable() && !prefersReducedMotion();
}
