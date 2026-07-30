// The funnel's own bar: the mark, and one way out.
//
// The arrival's `ConciergeNav` cannot be reused and is not a candidate. It reads
// the act store, changes phase on scroll and crossfades a wordmark to a monogram
// — all three only mean something on a scrollytelling page, and the store it
// reads is in the same module graph as `three` / `gsap` / `lenis`. The whole
// reason `(booking)` is a separate route group is that none of that loads here
// (`repository-structure.md` §`(booking)`), so the funnel gets its own bar: two
// links and a hairline.
//
// **The wordmark is a CSS mask over `currentColor`, not an `<img>`.** Same
// technique the concierge bar uses, and it is the reason this file needs no
// image loading state: the mark is painted in the text colour it inherits, so it
// is correct on the first frame and correct if the ground ever changes.
//
// **Nothing here is decorative.** The comp this screen was drawn from carries a
// language selector, a currency selector and a hamburger. The site is one locale,
// the tariff is in đồng and there is no menu behind the funnel — three controls
// that would answer nothing. What is here instead is the mark, which goes back to
// the arrival, and sign-in, which is a route that exists. A guest with a stay
// already booked is the one person likely to want it from this screen.

import styles from "./funnel-nav.module.css";

export function FunnelNav() {
  return (
    // Two elements, because the bar does two things at two different widths: the
    // hairline is the full width of the column it sits in, and the type inside it
    // holds the same measure as the heading and the calendar below. One element
    // could not do both — a rule inset to the measure floats in the middle of the
    // page while the section is centred, and type flush to the column's edge stops
    // lining up with everything under it.
    <header className={styles.bar}>
      <div className={styles.inner}>
        {/* A plain anchor, not `next/link`. Leaving the funnel for the arrival is a
            document load either way — the arrival's bundle shares nothing with this
            one — and a prefetching link would pull that bundle in behind a guest who
            is still choosing dates. */}
        <a aria-label="Mariva — the arrival" className={styles.brand} href="/">
          <span className={styles.wordmark} />
        </a>

        <a className={`${styles.link} caps-label`} href="/login">
          Sign in
        </a>
      </div>
    </header>
  );
}
