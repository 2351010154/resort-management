// The account area's bar: the two destinations, the way back into the funnel
// and the guest, with the mark at the other end where the stone does not cut
// it.
//
// **One component because both screens draw it.** `/account` and
// `/account/stays` are two halves of one area — each links to the other — and a
// bar written into each screen would be two menus that drift. `account-frame`
// places it once for both.
//
// **The ground hands the bar its palette, not a prop.** The links and the chip
// read `--bar-quiet`, with the ivory value as the fallback, so the stone a
// phone shows it on declares one property and the bar has no `tone` switch.
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
        {/* Hidden on a wide screen, where the same link is the house's name
            cut into the top of the stone. */}
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
