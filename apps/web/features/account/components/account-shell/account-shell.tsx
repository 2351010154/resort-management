// The frame the account area's two screens share — `screens.md` §Account.
//
// A third shell rather than a reuse of either existing one, and the two of them
// argue why from their own side. `auth-shell.module.css` is for a guest holding
// an email in the other hand, reached once; `stay-shell.tsx` is standing on a
// single booking and says so in a summary. The account area is neither: it is
// somewhere a guest returns to, and the one thing both its screens need that no
// other screen does is a way across to the other one.
//
// So the bar is the whole reason this component exists. `/account` and
// `/account/stays` are two halves of one area — the profile links to the stays
// and the stays link back — and a page that has to remember to draw that bar is
// a page that will one day forget.
//
// Plain anchors rather than `next/link`, on `funnel-nav.tsx`'s reasoning: these
// are two documents in the same route group, and nothing here is worth
// prefetching behind a guest who is reading their own details.

import type { ReactNode } from "react";
import styles from "./account-shell.module.css";

/** Which of the two screens is drawing the frame. */
export type AccountPlace = "profile" | "stays";

export function AccountShell({
  here,
  title,
  subtitle,
  children,
}: {
  readonly here: AccountPlace;
  readonly title: string;
  readonly subtitle: string;
  readonly children: ReactNode;
}) {
  return (
    <main className={styles.screen}>
      <div className={styles.column}>
        <header className={styles.bar}>
          <a
            aria-label="Mariva — the arrival"
            className={styles.brand}
            href="/"
          >
            <span className={styles.wordmark} />
          </a>

          <nav aria-label="Your account" className={styles.nav}>
            <a
              aria-current={here === "profile" ? "page" : undefined}
              className={`${styles.navLink} caps-label`}
              href="/account"
            >
              Profile
            </a>
            <a
              aria-current={here === "stays" ? "page" : undefined}
              className={`${styles.navLink} caps-label`}
              href="/account/stays"
            >
              Stays
            </a>
            {/* The way back into the funnel, from both screens. A guest reading
                their own history is the likeliest person in the product to want
                another stay. */}
            <a className={`${styles.navLink} caps-label`} href="/booking">
              Book a stay
            </a>
          </nav>
        </header>

        <h1 className={`${styles.title} font-display`}>{title}</h1>
        <p className={styles.subtitle}>{subtitle}</p>

        {children}
      </div>
    </main>
  );
}

export { styles as accountStyles };
