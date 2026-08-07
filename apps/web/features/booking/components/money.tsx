// An amount and its currency mark, kept on one line.
//
// This component was built to work around a missing glyph. ₫ (U+20AB) is Vietnamese,
// the house UI face at the time (DM Mono) had no Vietnamese coverage at all, and
// `next/font` appends its own metric-adjusted fallback immediately after the face —
// so a price drew its digits in the mono and borrowed the mark from that fallback,
// where `size-adjust` put it small and above the baseline. Naming another family
// later in the stack could not help, because the fallback is reached first and it
// *can* draw the glyph, badly. The repair was to give the mark its own element and
// name a face that had it.
//
// The house UI face is now IBM Plex Mono, which carries U+20AB — picking a mono that
// could draw the site's own currency was one of the reasons for that change (see
// `app/layout.tsx`). The mark needs no separate family and no size correction.
//
// What still earns the component is the non-breaking space: a plain one lets a price
// wrap between its number and its mark. Money appears in five places on this screen —
// including inside a 44px calendar cell and on the dark summary bar — and they all
// have to agree about that.

import { splitVnd, type VndAmount } from "@mariva/shared";
import styles from "./money.module.css";

/** A non-breaking space: a plain one wraps a price between its number and its mark. */
const NBSP = " ";

export function Money({
  amount,
  className,
}: {
  readonly amount: VndAmount;
  readonly className?: string;
}) {
  const { amount: figure, currency } = splitVnd(amount);

  return (
    <span className={className}>
      {figure}
      {NBSP}
      <span className={styles.mark}>{currency}</span>
    </span>
  );
}
