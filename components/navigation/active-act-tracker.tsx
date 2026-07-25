"use client";

// Watches [data-act] sections and reports which one owns the viewport center.
// Drives the nav theme + active pill; act sections themselves stay dumb.

import { useEffect } from "react";
import { useArrivalActStore } from "@/lib/arrival-act-store";

export function ActiveActTracker() {
  const setActiveAct = useArrivalActStore((s) => s.setActiveAct);

  useEffect(() => {
    const sections = document.querySelectorAll<HTMLElement>("[data-act]");
    if (sections.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const act = Number((entry.target as HTMLElement).dataset.act);
          if (act) setActiveAct(act);
        }
      },
      // A section is "active" while it crosses the viewport's center band.
      { rootMargin: "-45% 0px -45% 0px" },
    );
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [setActiveAct]);

  return null;
}
