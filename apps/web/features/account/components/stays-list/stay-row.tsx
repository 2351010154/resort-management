// One past stay, as a line of the register — and a link to the surface that
// owns it.
//
// **The whole line is the link and nothing else.** `screens.md` §Account:
// cancelling and post-stay feedback happen on `/bookings/<reference>`, the one
// surface that knows which of those the stay's state allows. So nothing here
// acts on a stay, and the target is the whole line rather than a word inside
// it — a guest reaching for one stay on a phone should not have to find four
// underlined characters.
//
// **What, when, how much, and what became of it — nothing more.** The room in
// the house's arch and its name, the dates as a sentence ("13 to 16 October
// 2026", `longDateRange`), the total the API sent and the stay's state. The
// party, the plan and the reference are the stay's own page's to show; a
// history line that carried them all would be a form, not a line. A stay that
// did not happen keeps its line, quieter, because a history that dropped it
// would answer "where did my booking go?" with nothing.
//
// The reference is encoded because it is composed into an address — it is the
// property's own string and not a credential.

import { parseDate } from "@internationalized/date";
import { roundVndForDisplay } from "@mariva/shared";
import { longDateRange } from "@/features/account/lib/stay-display";
import { standingOf } from "@/features/account/lib/stay-history";
import type { OwnStay } from "@/features/account/lib/stays";
import { Money } from "@/features/booking/components/money";
import {
  roomLead,
  tierSrc,
  tierSrcSet,
} from "@/features/booking/lib/room-images";
import { roomType } from "@/features/booking/lib/room-types";
import styles from "./stays-list.module.css";

export function StayRow({ stay }: { readonly stay: OwnStay }) {
  const standing = standingOf(stay.state);
  const frame = roomLead(stay.roomType);

  return (
    <li className={styles.item}>
      <a
        className={styles.row}
        data-tone={standing.tone}
        href={`/bookings/${encodeURIComponent(stay.reference)}`}
      >
        {/* Decorative: the line names the room in words beside it. */}
        <span aria-hidden="true" className={styles.thumb}>
          <img
            alt=""
            decoding="async"
            height={frame.height}
            loading="lazy"
            sizes="4.5rem"
            src={tierSrc(frame.src, 640)}
            srcSet={tierSrcSet(frame)}
            width={frame.width}
          />
        </span>

        <span className={styles.names}>
          <span className={`${styles.room} font-display`}>
            {roomType(stay.roomType).name}
          </span>
          <span className={`${styles.dates} font-display`}>
            {longDateRange(parseDate(stay.checkIn), parseDate(stay.checkOut))}
          </span>
        </span>

        <span className={styles.end}>
          <span className={`${styles.price} font-display`}>
            <Money amount={roundVndForDisplay(stay.stayTotalGross)} />
          </span>
          <span className={`${styles.status} caps-label`}>
            {standing.label}
          </span>
        </span>

        <span aria-hidden="true" className={styles.go}>
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
    </li>
  );
}
