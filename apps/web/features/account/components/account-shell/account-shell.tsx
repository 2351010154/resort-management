// The frame the account area's two screens share — `screens.md` §Account.
//
// A third shell rather than a reuse of either existing one, and the two of them
// argue why from their own side. `auth-shell.module.css` is for a guest holding
// an email in the other hand, reached once; `stay-shell.tsx` is standing on a
// single booking and says so in a summary. The account area is neither: it is
// somewhere a guest returns to, and the one thing both its screens need that no
// other screen does is a way across to the other one.
//
// So the bar is the first reason this component exists. `/account` and
// `/account/stays` are two halves of one area — the profile links to the stays
// and the stays link back — and a page that has to remember to draw that bar is
// a page that will one day forget.
//
// **The second reason is the column, and it is new.** Both screens hold two
// kinds of thing at once: what the guest is working on, and what the property
// states back at them. The profile has four editable boxes beside a tier and a
// points balance nobody can move; the stays have a list beside the one way back
// into the funnel. Stacked in a single measure the read-only half reads as
// preamble to be scrolled past. So the frame offers a rail, on the grid
// `details-screen.module.css` already sets the funnel's review screen to, and a
// screen that has nothing to put in it simply passes no `aside` and gets its
// measure back.
//
// Plain anchors rather than `next/link`, on `funnel-nav.tsx`'s reasoning: these
// are two documents in the same route group, and nothing here is worth
// prefetching behind a guest who is reading their own details.
//
// **The bar spans the window and the rest of the screen does not.** It is the
// one band on the page that belongs to the product rather than to the document
// — the mark at one edge, the guest at the other — and a rule inset to an 80rem
// measure reads as the top of a card instead of as the top of the app. So the
// bar sits outside `.frame` and pads itself to the window's own margin, while
// everything under it keeps the measure the title and the three columns share.

import type { ReactNode } from "react";
import { AccountMenu } from "./account-menu";
import styles from "./account-shell.module.css";

/** Which of the two screens is drawing the frame. */
export type AccountPlace = "profile" | "stays";

/** Where a guest is sent back to when the bar has to send them to the login. */
const RETURN_TO: Readonly<Record<AccountPlace, string>> = {
  profile: "/account",
  stays: "/account/stays",
};

export function AccountShell({
  here,
  title,
  subtitle,
  meta,
  leftRail,
  leftRailLabel,
  aside,
  asideLabel,
  children,
}: {
  readonly here: AccountPlace;
  readonly title: string;
  readonly subtitle: string;
  /** One line of provenance under the title — what the reference screens set
   *  beside a booking's creation date. Absent on a screen that has none. */
  readonly meta?: ReactNode;
  /** The narrow account ledger shown before the working column on wide
   *  screens. It folds after the main content on narrow screens. */
  readonly leftRail?: ReactNode;
  /** Names the account ledger for assistive technology. */
  readonly leftRailLabel?: string;
  /** The rail. Absent means one column, and the main content keeps the measure
   *  rather than being left with a gap where a rail would have gone. */
  readonly aside?: ReactNode;
  /** Names the complementary rail for assistive technology. */
  readonly asideLabel?: string;
  readonly children: ReactNode;
}) {
  const layout = leftRail
    ? aside
      ? styles.threeColumn
      : styles.leftGrid
    : aside
      ? styles.grid
      : styles.solo;

  return (
    <main className={styles.screen}>
      <header className={styles.bar}>
        {/* Two elements, because the band and the type inside it hold different
            widths: the hairline is the window's, and the mark and the links are
            inset to the window's margin. */}
        <div className={styles.barInner}>
          <a aria-label="Mariva home" className={styles.brand} href="/">
            <span className={styles.wordmark} />
          </a>

          <div className={styles.barEnd}>
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
              {/* The way back into the funnel, from both screens. A guest
                  reading their own history is the likeliest person in the
                  product to want another stay. */}
              <a className={`${styles.navLink} caps-label`} href="/booking">
                Book a stay
              </a>
            </nav>

            <AccountMenu returnTo={RETURN_TO[here]} />
          </div>
        </div>
      </header>

      <div className={styles.frame}>
        <div className={styles.head}>
          <h1 className={`${styles.title} font-display`}>{title}</h1>
          <p className={styles.subtitle}>{subtitle}</p>
          {meta ? <p className={styles.meta}>{meta}</p> : null}
        </div>

        {/* The single-column case is a class rather than a second element: the
            children sit in the same box either way, so a screen that gains a
            rail later does not move in the DOM to get one. */}
        <div className={layout}>
          {leftRail ? (
            <aside aria-label={leftRailLabel} className={styles.leftAside}>
              {leftRail}
            </aside>
          ) : null}
          <div className={styles.column}>{children}</div>
          {aside ? (
            <aside aria-label={asideLabel} className={styles.aside}>
              {aside}
            </aside>
          ) : null}
        </div>
      </div>
    </main>
  );
}
