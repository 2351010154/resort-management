// One stay, as a line of the register — and a link to the surface that owns it.
//
// **The whole line is the link and nothing else.** `screens.md` §Account:
// cancelling and post-stay feedback happen on `/bookings/<reference>`, the one
// surface that knows which of those the stay's state allows. So nothing here
// acts on a stay, and the target is the whole line rather than a word inside
// it — a guest reaching for one stay on a phone should not have to find four
// underlined characters.
//
// **The room, then when, then the rest** — the order the profile's next stay
// is set in, so a stay reads the same wherever the account shows it. The
// dates are a sentence ("13 to 16 October 2026", `longDateRange`) rather than
// a block of large numerals: the list sits beside the heaviest thing on the
// page, and a column of big figures down its left edge was a second weight
// set against the stone. Then the plan and the party, which the payload has
// always carried, and the total the API sent — never a breakdown of it, which
// would be arithmetic the API did not do. A stay that did not happen keeps its
// line, quieter, because a history that dropped it would answer "where did my
// booking go?" with nothing.
//
// The reference is encoded because it is composed into an address — it is the
// property's own string and not a credential.

import { parseDate } from "@internationalized/date";
import { nightCount, roundVndForDisplay } from "@mariva/shared";
import {
  longDateRange,
  occupancySpecs,
} from "@/features/account/lib/stay-display";
import { standingOf } from "@/features/account/lib/stay-history";
import type { OwnStay } from "@/features/account/lib/stays";
import { Money } from "@/features/booking/components/money";
import { planName } from "@/features/booking/lib/rate-plans";
import {
  roomLead,
  tierSrc,
  tierSrcSet,
} from "@/features/booking/lib/room-images";
import { roomType } from "@/features/booking/lib/room-types";
import styles from "./stays-list.module.css";

export function StayRow({
  stay,
  onShow,
}: {
  readonly stay: OwnStay;
  /** Points the stone's arch at this stay. */
  readonly onShow: (id: OwnStay["id"]) => void;
}) {
  const checkIn = parseDate(stay.checkIn);
  const checkOut = parseDate(stay.checkOut);
  const standing = standingOf(stay.state);
  const frame = roomLead(stay.roomType);
  const specs = [
    planName(stay.plan),
    ...occupancySpecs(
      nightCount({ checkIn, checkOut }),
      stay.adults,
      stay.childAges.length,
    ),
  ];

  return (
    <li className={styles.item}>
      <a
        className={styles.row}
        data-tone={standing.tone}
        href={`/bookings/${encodeURIComponent(stay.reference)}`}
        onFocus={() => onShow(stay.id)}
        onPointerEnter={() => onShow(stay.id)}
      >
        {/* The room in a small arch, on a phone only — where there is no
            stone beside the list to show it in. */}
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

        <span className={styles.what}>
          <span className={`${styles.room} font-display`}>
            {roomType(stay.roomType).name}
          </span>
          <span className={`${styles.dates} font-display`}>
            {longDateRange(checkIn, checkOut)}
          </span>
          <span className={styles.specs}>{specs.join(" · ")}</span>
          <span className={`${styles.reference} caps-label`}>
            {stay.reference}
          </span>
        </span>

        <span className={styles.end}>
          {/* `lining-nums` travels with `.font-display` — see `.price`. */}
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
