// The frame the four quiet auth screens share: monogram, a display line that
// states, a caption that qualifies, and whatever the screen itself is.
//
// A component rather than four copies of the same six elements, and a shell
// rather than a layout file: `app/(booking)/layout.tsx` would wrap the funnel's
// future booking screens in this too, and a stay summary does not belong under
// a monogram and a greeting.

import type { ReactNode } from "react";
import styles from "./auth-shell.module.css";

export function AuthShell({
  title,
  subtitle,
  children,
  footnote,
}: {
  readonly title: string;
  readonly subtitle: string;
  readonly children: ReactNode;
  readonly footnote?: ReactNode;
}) {
  return (
    <main className={styles.screen}>
      <div className={styles.column}>
        {/* Decorative: the wordmark it draws is already the page title.
            design-foundations.md §7. */}
        <span className={styles.monogram} aria-hidden="true" />

        <h1 className={`${styles.title} font-display`}>{title}</h1>
        <p className={styles.subtitle}>{subtitle}</p>

        {children}

        {footnote ? <p className={styles.footnote}>{footnote}</p> : null}
      </div>
    </main>
  );
}

export { styles as authStyles };
