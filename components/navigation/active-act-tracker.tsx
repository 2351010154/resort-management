"use client";

// Watches [data-act] sections and reports which one owns the viewport center.
// Drives the nav theme + active pill; act sections themselves stay dumb.

import { useEffect } from "react";
import { useArrivalActStore } from "@/lib/arrival-act-store";

export function ActiveActTracker() {
  const setActiveAct = useArrivalActStore((s) => s.setActiveAct);

  useEffect(() => {
    // Measured on every settled frame rather than driven by IntersectionObserver
    // entries. Two sections cross the centre band together at every seam, and an
    // observer hands them over in one batch with no guaranteed order — take the
    // last entry and the act *behind* the seam can win, which then sticks for the
    // whole next act because no further crossing is ever reported. Measuring the
    // centre answers the question directly, and re-answers it after a pin
    // refresh, a resize, or a reload that restores scroll mid-act.
    let raf = 0;

    const resolve = () => {
      raf = 0;
      const centre = window.innerHeight / 2;
      const sections = document.querySelectorAll<HTMLElement>("[data-act]");
      for (const section of sections) {
        const { top, bottom } = section.getBoundingClientRect();
        if (top <= centre && bottom > centre) {
          const act = Number(section.dataset.act);
          if (act) setActiveAct(act);
          return;
        }
      }
    };

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(resolve);
    };

    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    resolve();
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [setActiveAct]);

  return null;
}
