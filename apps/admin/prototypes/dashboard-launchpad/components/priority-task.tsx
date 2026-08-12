import type { ReactNode } from "react";
import styles from "./priority-task.module.css";

export interface PriorityTaskProps {
  icon: ReactNode;
  title: string;
  subtitle: string;
}

/** One line on the shift's to-do list.
 *
 *  Presentational and inert: no `onClick`, so no `button`, no `cursor:
 *  pointer` and no focus ring — a row that looks pressable and does nothing is
 *  worse than a row that looks like text. The hover tint is an aid to reading
 *  across a long list. Whatever makes these actionable wraps them and brings
 *  its own semantics. */
export default function PriorityTask({
  icon,
  title,
  subtitle,
}: PriorityTaskProps) {
  return (
    <article className={styles.task}>
      <span className={styles.icon} aria-hidden="true">
        {icon}
      </span>
      <span className={styles.body}>
        <h3 className={styles.title}>{title}</h3>
        <p className={styles.subtitle}>{subtitle}</p>
      </span>
    </article>
  );
}
