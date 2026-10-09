// The account area's bar: the house's name, the two destinations, the way back
// into the funnel, and the guest.
//
// **One component because both screens draw it.** `/account` and
// `/account/stays` are two halves of one area — each links to the other — and a
// bar written into each screen would be two menus that drift. `account-frame`
// places it once for both.
//
// **The page the guest is on is ringed, as the arrival's bar rings its act.**
// The landing marks the part of the ride a reader is in with a pill drawn
// round its name; the account marks its page the same way. No stroke is drawn
// under any link.
//
// Plain anchors rather than `next/link`, on `funnel-nav.tsx`'s reasoning: these
// are two documents in the same route group, and nothing here is worth
// prefetching behind a guest who is reading their own details.

import { AccountMenu } from "./account-menu";
import styles from "./account-bar.module.css";

/** Which of the two screens is drawing the bar. */
export type AccountPlace = "profile" | "stays";

/** Where a guest is sent back to when the bar has to send them to the login. */
const RETURN_TO: Readonly<Record<AccountPlace, string>> = {
  profile: "/account",
  stays: "/account/stays",
};

export function AccountBar({ here }: { readonly here: AccountPlace }) {
  return (
    <header className={styles.bar}>
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
  );
}
