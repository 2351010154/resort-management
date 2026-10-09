// One framed part of an account screen: its name, its one control, and what
// it holds.
//
// **A panel, so nothing on the page floats.** Every part of an account screen
// stands on an ivory sheet set on the warmer ground of the page, so a guest can
// see at a glance where one thing ends and the next begins.
//
// **The heading is the panel's name and the only words it adds.** "Your
// details", not a sentence about them: the rows say what the panel holds. The
// one control that acts on the whole panel — "Edit details", "All your stays" —
// stands at the far end of the heading's line, where it is found without being
// looked for.

import { type ReactNode, useId } from "react";
import styles from "./panel.module.css";

export function Panel({
  title,
  action,
  children,
}: {
  readonly title: string;
  /** One control that acts on the whole panel, at the heading's far end. */
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className={styles.panel}>
      <div className={styles.head}>
        <h2 className={`${styles.title} font-display`} id={headingId}>
          {title}
        </h2>
        {action ? <div className={styles.action}>{action}</div> : null}
      </div>

      <div className={styles.body}>{children}</div>
    </section>
  );
}
