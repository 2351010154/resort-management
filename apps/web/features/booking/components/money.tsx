// An amount, with its currency mark set in a face that has one.
//
// ₫ (U+20AB) is a Vietnamese glyph. DM Mono — the house's UI face and the default
// on `body` — has no Vietnamese coverage at all, and `next/font` appends its own
// metric-adjusted `"DM Mono Fallback"` immediately after it, so every price rendered
// its digits in DM Mono and borrowed the mark from that fallback, where `size-adjust`
// drew it small and above the baseline. Adding Literata to the stack after DM Mono
// does not help: the fallback is reached first, and it *can* draw the glyph, badly.
//
// So the mark gets its own element and Literata is named on it directly. Literata
// carries the `vietnamese` subset (see `app/layout.tsx`) and draws it properly. The
// digits stay mono, which is what every other number on the site is set in.
//
// One component rather than a rule per price line: money appears in five places on
// this screen and they all have to agree, including inside a 44px calendar cell and
// on the dark summary bar.

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
