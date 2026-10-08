// The arrival's link: a caps label and a ring with an arrow in it, which fills
// when the link is approached. The ring is decorative — the words are the link.
//
// Shared by both account screens, because the way into a stay and the way
// back into the funnel should be the same object wherever they are offered.

import styles from "./circle-link.module.css";

export function CircleLink({
  href,
  children,
}: {
  readonly href: string;
  readonly children: string;
}) {
  return (
    <a className={`${styles.circleLink} caps-label`} href={href}>
      {children}
      <span aria-hidden="true" className={styles.circle}>
        <svg
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.25"
          viewBox="0 0 16 16"
        >
          <path d="M3 8h10" />
          <path d="m9 4 4 4-4 4" />
        </svg>
      </span>
    </a>
  );
}

/** The quieter of the two: a caps label in the accent and nothing else. */
export function QuietLink({
  href,
  children,
}: {
  readonly href: string;
  readonly children: string;
}) {
  return (
    <a className={`${styles.quietLink} caps-label`} href={href}>
      {children}
    </a>
  );
}
