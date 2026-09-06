// The arrival's one permanent grammar: an arch-topped opening with a hairline
// keyline standing off it.
//
// The acts reuse one silhouette in CSS, at a different aspect and in a different
// role each time — a wide crop over a Table block, a tall crop riding up beside
// it. The shape never changes, which is what keeps the repetition reading as one
// building rather than as a mannerism. Act 1 is the exception and always has
// been: it cuts its own openings, from straight edges rather than this arch,
// because they are a pair of windows resolving into one and an arch that has to
// survive being halved is an arch that reads as damage.
//
// One component rather than a copied border-radius per block: the radii are the
// device, and five near-identical copies of them are five chances for the arch to
// stop being the same arch.

import type { CSSProperties, ReactNode } from "react";
import styles from "./aperture-frame.module.css";

export interface ApertureFrameProps {
  /**
   * The opening's aspect, as a CSS `aspect-ratio` value ("4 / 5", "16 / 9").
   * The one dimension that varies per block.
   *
   * Omitted where the opening holds type rather than a picture — content then
   * sets its own height, and an aspect ratio there would either crop it or leave
   * a hole under it.
   */
  ratio?: string;
  /** Which ground the frame stands on — it decides the keyline's colour. */
  tone?: "ivory" | "ink";
  className?: string;
  children: ReactNode;
}

export function ApertureFrame({
  ratio,
  tone = "ivory",
  className,
  children,
}: ApertureFrameProps) {
  return (
    <div
      className={className ? `${styles.frame} ${className}` : styles.frame}
      data-tone={tone}
      style={
        ratio ? ({ "--aperture-ratio": ratio } as CSSProperties) : undefined
      }
    >
      <div className={styles.opening}>{children}</div>
      <span className={styles.keyline} aria-hidden />
    </div>
  );
}
