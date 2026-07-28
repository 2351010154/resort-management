// Three facts, drawn rather than written.
//
// The card's whole argument is that a guest choosing between five rooms is
// comparing pictures, not reading paragraphs — so the three things that actually
// differ between the types get one strip of glyphs each, in fixed slots at the
// same x-position on every card. The eye runs down a column and the differences
// line up; nothing has to be read twice to be compared.
//
// - **Dots** — one filled per head the room takes, one open if it takes an extra
//   bed. Circles. A star or a square here would read as a rating.
// - **A bar** — the room's size against the largest room in the list, with the
//   number at the bar's end. The bar answers "bigger or smaller", the number
//   answers "by how much"; neither on its own does both.
// - **A word** — what the room faces.
//
// **The whole strip is one `role="img"` with one complete accessible name, and
// every glyph inside it is `aria-hidden`.** That is Booking.com's shape, and it
// is the only part of that page worth copying: a label per dot is four
// announcements that mean nothing separately. The name is built by
// `room-measure.ts` from the same values the strip draws, so the two cannot
// drift.
//
// The size bar is the one part of this card with no verified precedent. It is
// the report's own proposal, and it is here because five room sizes in text are
// five numbers a guest has to hold in their head at once.

import {
  measureLineLabel,
  occupancyDots,
} from "@/features/booking/lib/room-measure";
import type { RoomType } from "@/features/booking/lib/room-types";
import styles from "./room-type-list.module.css";

export function MeasureLine({
  type,
  sizeFill,
}: {
  readonly type: RoomType;
  /** Percentage of the track, normalised over the types the list renders. */
  readonly sizeFill: number;
}) {
  const { filled, open } = occupancyDots(type);

  return (
    <div
      aria-label={measureLineLabel(type)}
      className={styles.measure}
      data-measure
      role="img"
    >
      <span aria-hidden="true" className={styles.dots}>
        {Array.from({ length: filled }, (_unused, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a dot is a position in a run of identical glyphs and has no identity but its index.
          <span className={styles.dotFilled} key={`filled-${index}`} />
        ))}
        {open > 0 ? <span className={styles.dotOpen} /> : null}
      </span>

      <span aria-hidden="true" className={styles.size}>
        <span className={styles.track}>
          <span
            className={styles.fill}
            data-size-fill={sizeFill}
            style={{ width: `${sizeFill}%` }}
          />
        </span>
        <span className={styles.sizeValue}>{type.squareMetres} m²</span>
      </span>

      <span aria-hidden="true" className={styles.aspect}>
        {type.aspect}
      </span>
    </div>
  );
}
