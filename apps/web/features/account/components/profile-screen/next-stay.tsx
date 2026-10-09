// The book's first chapter: the guest's next stay — or the way to one.
//
// **The room, not a row.** A guest who has a stay coming is reading their
// profile with it in mind, and the funnel already holds a photograph of every
// room type; so the next stay opens the book the way the arrival shows a room
// — the name in the display face, the frame large in the house's arch — with
// how long until it, and the way into it. The history is one link away on the
// screen that owns it.
//
// **No stay ahead is an invitation, not an empty state.** The chapter keeps its
// place and its frame, holds the property at dusk — the photograph the dates
// step stands on, so the link lands where the picture already was — and
// borrows the arrival's last line for its title.
//
// Which stay counts as next is `stay-history.ts`'s decision, made against the
// property's today, so this screen and the stays list cannot disagree about it.

import type { CalendarDate } from "@internationalized/date";
import { parseDate, today } from "@internationalized/date";
import { nightCount, PROPERTY_TIME_ZONE } from "@mariva/shared";
import {
  type ArchPicture,
  ArchFrame,
} from "@/features/account/components/account-frame/arch-frame";
import { Chapter } from "@/features/account/components/account-frame/chapter";
import {
  CircleLink,
  QuietLink,
} from "@/features/account/components/account-frame/circle-link";
import {
  longDate,
  longDateRange,
  occupancySpecs,
  untilArrival,
} from "@/features/account/lib/stay-display";
import { standingOf, stayHistory } from "@/features/account/lib/stay-history";
import type { OwnStay } from "@/features/account/lib/stays";
import { BOOKING_HERO } from "@/features/booking/lib/booking-hero";
import {
  roomLead,
  tierSrc,
  tierSrcSet,
} from "@/features/booking/lib/room-images";
import { roomType } from "@/features/booking/lib/room-types";
import styles from "./next-stay.module.css";

/** The frame beside the words on a wide screen and over them on a phone. */
const FRAME_SIZES = "(width >= 64rem) 22rem, (width >= 40rem) 40vw, 80vw";

/** The property at dusk, framed for the invitation. */
const DUSK: ArchPicture = {
  key: "dusk",
  src: tierSrc(BOOKING_HERO.src, 1280),
  srcSet: tierSrcSet(BOOKING_HERO),
  width: BOOKING_HERO.width,
  height: BOOKING_HERO.height,
  alt: BOOKING_HERO.alt,
  // Held on the door and the loungers under the roofline, as the dates step
  // holds the same photograph.
  position: "58% 58%",
};

export function NextStay({
  number,
  stays,
}: {
  readonly number: string;
  readonly stays: readonly OwnStay[];
}) {
  const now = today(PROPERTY_TIME_ZONE);
  const { upcoming, past } = stayHistory(stays, now.toString());
  const next = upcoming[0];

  if (!next) {
    return (
      <Chapter name="Your next stay" number={number}>
        <div className={styles.stay}>
          <div className={styles.text}>
            <p className={`${styles.title} font-display`}>Until you return.</p>
            <p className={`${styles.line} font-display`}>
              Nothing is booked ahead. The calendar is open whenever you are.
            </p>

            <div className={styles.actions}>
              <CircleLink href="/booking">Choose your dates</CircleLink>
              {past.length > 0 ? (
                <QuietLink href="/account/stays">All your stays</QuietLink>
              ) : null}
            </div>
          </div>

          <ArchFrame
            active="dusk"
            className={styles.arch}
            pictures={[DUSK]}
            setting="paper"
            sizes={FRAME_SIZES}
          />
        </div>
      </Chapter>
    );
  }

  const checkIn = parseDate(next.checkIn);
  const checkOut = parseDate(next.checkOut);
  const frame = roomLead(next.roomType);
  // A stay the guest is standing in is not their next one.
  const present = standingOf(next.state).tone === "present";

  return (
    <Chapter name={present ? "Your stay" : "Your next stay"} number={number}>
      <div className={styles.stay}>
        <div className={styles.text}>
          <p className={`${styles.when} caps-label`}>
            {present
              ? `With us until ${longDate(checkOut)}`
              : untilArrival(now, checkIn)}
          </p>
          <p className={`${styles.title} font-display`}>
            {roomType(next.roomType).name}
          </p>
          <p className={`${styles.dates} font-display`}>
            {longDateRange(checkIn, checkOut)}
          </p>
          <ul className={`${styles.specs} caps-label`}>
            {specsOf(next, checkIn, checkOut).map((spec) => (
              <li key={spec}>{spec}</li>
            ))}
          </ul>

          <div className={styles.actions}>
            <CircleLink
              href={`/bookings/${encodeURIComponent(next.reference)}`}
            >
              Open this stay
            </CircleLink>
            <QuietLink href="/account/stays">All your stays</QuietLink>
          </div>
        </div>

        <ArchFrame
          active={next.roomType}
          className={styles.arch}
          pictures={[
            {
              key: next.roomType,
              src: tierSrc(frame.src, 1280),
              srcSet: tierSrcSet(frame),
              width: frame.width,
              height: frame.height,
              alt: frame.alt,
            },
          ]}
          setting="paper"
          sizes={FRAME_SIZES}
        />
      </div>
    </Chapter>
  );
}

/** Nights, party and the reference the desk will ask for, in that order. */
function specsOf(
  stay: OwnStay,
  checkIn: CalendarDate,
  checkOut: CalendarDate,
): readonly string[] {
  return [
    ...occupancySpecs(
      nightCount({ checkIn, checkOut }),
      stay.adults,
      stay.childAges.length,
    ),
    stay.reference,
  ];
}
