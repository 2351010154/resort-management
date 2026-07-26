"use client";

// Single scroll smoother for the whole experience. Lenis drives GSAP
// ScrollTrigger; ScrollTrigger scrubs must use `scrub: true` (no scrub-lag) —
// Lenis is the only smoothing layer, doubling it turns motion mushy.

import Lenis from "lenis";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { prefersReducedMotion } from "@/lib/webgl-support";
import { LENIS_LERP, LENIS_WHEEL_MULTIPLIER } from "@/lib/motion-tokens";

const LenisContext = createContext<Lenis | null>(null);

/** Null while mounting, under reduced-motion, or on the server. */
export function useLenis(): Lenis | null {
  return useContext(LenisContext);
}

export function LenisScrollProvider({ children }: { children: ReactNode }) {
  const [lenis, setLenis] = useState<Lenis | null>(null);

  useEffect(() => {
    // Reduced motion: keep native scroll, no scrub animations mount.
    if (prefersReducedMotion()) return;

    gsap.registerPlugin(ScrollTrigger);
    const instance = new Lenis({
      lerp: LENIS_LERP,
      wheelMultiplier: LENIS_WHEEL_MULTIPLIER,
    });
    instance.on("scroll", ScrollTrigger.update);

    const raf = (time: number) => instance.raf(time * 1000);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);
    setLenis(instance);

    // Strict-mode double-mount is safe: cleanup fully tears down the instance.
    return () => {
      gsap.ticker.remove(raf);
      instance.destroy();
      setLenis(null);
    };
  }, []);

  return <LenisContext.Provider value={lenis}>{children}</LenisContext.Provider>;
}
