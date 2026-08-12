import type { ReactNode } from "react";
import styles from "./stat-card.module.css";

export interface StatCardProps {
  icon: ReactNode;
  number: number;
  label: string;
  sublabel: string;
}

/** A single figure from the business day: how many arrivals, how many rooms
 *  still dirty. The figure is the point, so it is the largest thing in the card
 *  and the only one in the display face.
 *
 *  The icon is decorative — `aria-hidden`, and the label beside it already says
 *  what the figure counts. An icon that carried the only meaning would have to
 *  be labelled instead. */
export default function StatCard({
  icon,
  number,
  label,
  sublabel,
}: StatCardProps) {
  return (
    <article className={styles.card}>
      <span className={styles.icon} aria-hidden="true">
        {icon}
      </span>
      <p className={`${styles.figure} font-display`}>{number}</p>
      <h3 className={`${styles.label} caps-label`}>{label}</h3>
      <p className={styles.sublabel}>{sublabel}</p>
    </article>
  );
}
