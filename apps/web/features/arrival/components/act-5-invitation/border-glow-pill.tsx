"use client";

// The invitation's control, lit rather than merely filled — the BorderGlow
// reading carried into this palette. Two layers of warm light sit behind an
// ivory pill: a bloom that never goes out, and a brighter arc the pointer drags
// around the rim. The pill itself never moves; only the light changes, which is
// the same settlement /login reached about hover (see §5 of design
// foundations).
//
// Only the two live numbers are worked out here — where the pointer lies from
// the centre, and how near the rim it is. Everything drawn from them is in
// act-5-invitation.module.css, so the whole look is readable in one place.

import { type PointerEvent, type ReactNode, useCallback, useRef } from "react";
import styles from "./act-5-invitation.module.css";

export function BorderGlowPill({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick?: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);

  const handlePointerMove = useCallback(
    (e: PointerEvent<HTMLButtonElement>) => {
      const el = ref.current;
      if (!el) return;

      const { left, top, width, height } = el.getBoundingClientRect();
      // Measured in half-extents rather than in pixels. On a pill five times
      // wider than it is tall, a raw atan2 aims the arc at the far cap while the
      // pointer is two px under the top edge; in unit space the arc lands on the
      // rim the cursor is actually near.
      const nx = (e.clientX - left) / (width / 2) - 1;
      const ny = (e.clientY - top) / (height / 2) - 1;

      // 0 dead centre, 1 anywhere on the rim.
      const proximity = Math.min(Math.max(Math.abs(nx), Math.abs(ny)), 1);
      // conic-gradient() measures from noon clockwise; atan2 from three o'clock.
      const angle = (Math.atan2(ny, nx) * (180 / Math.PI) + 450) % 360;

      el.style.setProperty("--edge-proximity", (proximity * 100).toFixed(2));
      el.style.setProperty("--cursor-angle", `${angle.toFixed(2)}deg`);
    },
    [],
  );

  return (
    <button
      ref={ref}
      type="button"
      className={`caps-label ${styles.pill}`}
      onPointerMove={handlePointerMove}
      onClick={onClick}
    >
      {/* An element rather than a pseudo: a conic mask is sized to the box it
          is set on, so the mask has to sit on a box wide enough to hold the
          bloom, and the bloom has to be cast by a box that is the pill. Two
          boxes, one inside the other. */}
      <span className={styles.pillArc} aria-hidden />
      <span className={styles.pillLabel}>{children}</span>
    </button>
  );
}
