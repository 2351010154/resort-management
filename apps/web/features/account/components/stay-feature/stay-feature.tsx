// One stay set large — the room in the house's arch, its name and dates, the
// facts a guest checks before they travel, and the way into it — or, when no
// stay is ahead, the invitation to one.
//
// **Shared by both screens.** The profile opens on the guest's next stay and
// the stays page on everything coming up, and a stay ahead should read the
// same wherever the account shows it. Each screen sets it in a panel of its
// own, so the panel's heading says which stay this is and this says what it is.
//
// **Facts, not sentences.** Nights, guests, the total the API sent and the
// reference the desk will ask for, each under its own label — never run
// together in one line behind separator glyphs, and nothing explained that the
// stay's own page explains better. The countdown is the one line about the
// future, in the accent and in a ring of its own, so it reads as the state of
// the stay rather than as one more fact about it.

import { type CalendarDate, parseDate } from "@internationalized/date";
import { nightCount, roundVndForDisplay } from "@mariva/shared";
import type { ReactNode } from "react";
import {
  type ArchPicture,
  ArchFrame,
} from "@/features/account/components/account-frame/arch-frame";
import { CircleLink } from "@/features/account/components/account-frame/circle-link";
import {
  longDate,
  longDateRange,
  partyLine,
  untilArrival,
} from "@/features/account/lib/stay-display";
import { standingOf } from "@/features/account/lib/stay-history";
import type { OwnStay } from "@/features/account/lib/stays";
import { Money } from "@/features/booking/components/money";
import { BOOKING_HERO } from "@/features/booking/lib/booking-hero";
import {
  roomLead,
  tierSrc,
  tierSrcSet,
} from "@/features/booking/lib/room-images";
import { roomType } from "@/features/booking/lib/room-types";
import styles from "./stay-feature.module.css";

/** The frame beside the words in a wide panel and over them in a narrow one. */
const FRAME_SIZES = "(width >= 64rem) 15rem, (width >= 40rem) 32vw, 80vw";

/** The property at dusk, framed for the invitation — held on the door and the
 *  loungers under the roofline, as the dates step holds the same photograph. */
const DUSK: ArchPicture = {
  src: tierSrc(BOOKING_HERO.src, 1280),
  srcSet: tierSrcSet(BOOKING_HERO),
  width: BOOKING_HERO.width,
  height: BOOKING_HERO.height,
  alt: BOOKING_HERO.alt,
  position: "58% 58%",
};

export function StayFeature({
  stay,
  today,
  roomAs = "p",
}: {
  readonly stay: OwnStay;
  /** The property's today, which the countdown is measured from. */
  readonly today: CalendarDate;
  /** `h3` where the panel lists several stays under its own heading. */
  readonly roomAs?: "h3" | "p";
}) {
  const checkIn = parseDate(stay.checkIn);
  const checkOut = parseDate(stay.checkOut);
  const frame = roomLead(stay.roomType);
  // A stay the guest is standing in is counted down to its end, not its start.
  const present = standingOf(stay.state).tone === "present";
  const Room = roomAs;

  return (
    <div className={styles.feature}>
      <ArchFrame
        className={styles.arch}
        picture={{
          src: tierSrc(frame.src, 1280),
          srcSet: tierSrcSet(frame),
          width: frame.width,
          height: frame.height,
          alt: frame.alt,
        }}
        sizes={FRAME_SIZES}
      />

      <div className={styles.text}>
        <p className={`${styles.when} caps-label`}>
          {present
            ? `With us until ${longDate(checkOut)}`
            : untilArrival(today, checkIn)}
        </p>

        <div className={styles.names}>
          <Room className={`${styles.room} font-display`}>
            {roomType(stay.roomType).name}
          </Room>
          <p className={`${styles.dates} font-display`}>
            {longDateRange(checkIn, checkOut)}
          </p>
        </div>

        <dl className={styles.facts}>
          <Fact label="Nights">{nightCount({ checkIn, checkOut })}</Fact>
          <Fact label="Guests">
            {partyLine(stay.adults, stay.childAges.length)}
          </Fact>
          <Fact label="Total">
            <Money amount={roundVndForDisplay(stay.stayTotalGross)} />
          </Fact>
          <Fact label="Reference">{stay.reference}</Fact>
        </dl>

        <div className={styles.actions}>
          {/* The reference is encoded because it is composed into an address
              — it is the property's own string and not a credential. */}
          <CircleLink href={`/bookings/${encodeURIComponent(stay.reference)}`}>
            Open this stay
          </CircleLink>
        </div>
      </div>
    </div>
  );
}

/**
 * No stay ahead, said as an invitation rather than as an empty state: the
 * property at dusk in the same frame a booked room would stand in, a line in
 * the display face, and the way into the calendar.
 */
export function StayInvitation({
  title,
  note,
}: {
  readonly title: string;
  /** One short line, only where a guest needs to be told what to do. */
  readonly note?: string;
}) {
  return (
    <div className={styles.feature}>
      <ArchFrame className={styles.arch} picture={DUSK} sizes={FRAME_SIZES} />

      <div className={styles.text}>
        <p className={`${styles.room} font-display`}>{title}</p>
        {note ? <p className={styles.note}>{note}</p> : null}

        <div className={styles.actions}>
          <CircleLink href="/booking">Choose your dates</CircleLink>
        </div>
      </div>
    </div>
  );
}

function Fact({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className={styles.fact}>
      <dt className={`${styles.factLabel} caps-label`}>{label}</dt>
      <dd className={`${styles.factValue} font-display`}>{children}</dd>
    </div>
  );
}
