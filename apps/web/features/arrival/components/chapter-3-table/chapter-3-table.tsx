// Chapter 3 — "The Table". One venue, stated plainly, in two crops of the same
// aperture: a wide one on the room and a tall one on the detail. The aspect is
// the only thing that changes between them, which is the rule the device is
// meant to prove it can flex without becoming a new shape.
//
// The copy is `dining-room.ts`, and that file exists so this component invents
// nothing: `design-foundations.md` §6 forbids a component making up a hotel fact,
// and a service time typed into JSX would be exactly that.

import { ApertureFrame } from "@/features/arrival/components/aperture/aperture-frame";
import { arrivalImages } from "@/features/arrival/lib/image-manifest";
import { tierSrc, tierSrcSet } from "@/features/arrival/lib/image-srcset";
import { ChooseDatesLink } from "@/features/arrival/components/booking/choose-dates-link";
import {
  DINING_ROOM_NOTE,
  DINING_SERVICE_TIMES,
  DINING_SERVICE_UNPUBLISHED,
} from "./dining-room";
import styles from "./chapter-3-table.module.css";

const WIDE = arrivalImages["act-1-converge"].find((img) =>
  img.src.includes("terrace-lunch-sea"),
)!;

const TALL = arrivalImages["act-1-converge"].find((img) =>
  img.src.includes("patisserie-bread"),
)!;

export function Chapter3Table() {
  return (
    <section data-act={3} className={styles.section}>
      <div className={styles.grid}>
        <ApertureFrame ratio="16 / 9" className={styles.wide}>
          <img
            src={tierSrc(WIDE.src, 1920)}
            srcSet={tierSrcSet(WIDE)}
            sizes="(max-width: 767px) 92vw, 72vw"
            width={WIDE.width}
            height={WIDE.height}
            alt={WIDE.alt}
            loading="lazy"
            decoding="async"
          />
        </ApertureFrame>

        <div className={styles.copy}>
          <span className={`caps-label ${styles.eyebrow}`}>The table</span>
          <h2 className={`font-display ${styles.headline}`}>The Dining Room</h2>
          <p className={styles.note}>{DINING_ROOM_NOTE}</p>

          <dl className={styles.times}>
            {DINING_SERVICE_TIMES.length > 0 ? (
              DINING_SERVICE_TIMES.map((service) => (
                <div key={service.label} className={styles.timeRow}>
                  <dt className="caps-label">{service.label}</dt>
                  <dd className={styles.hours}>{service.hours}</dd>
                </div>
              ))
            ) : (
              <div className={styles.timeRow}>
                <dt className="caps-label">Service</dt>
                {/* Honest, and something to do about it. The property has not
                    set its service windows and a chapter that printed one would
                    be telling a guest something nobody decided — but "not yet
                    published" left a reader holding a sentence they could not
                    act on. The hours reach them with the booking; the link
                    below is how they get there. */}
                <dd className={styles.hours}>{DINING_SERVICE_UNPUBLISHED}</dd>
              </div>
            )}
          </dl>

          <ChooseDatesLink
            className={`caps-label ${styles.action}`}
            context="The Dining Room"
          />
        </div>

        <ApertureFrame ratio="4 / 5" className={styles.tall}>
          <img
            src={tierSrc(TALL.src, 1280)}
            srcSet={tierSrcSet(TALL)}
            sizes="(max-width: 767px) 60vw, 26vw"
            width={TALL.width}
            height={TALL.height}
            alt={TALL.alt}
            loading="lazy"
            decoding="async"
          />
        </ApertureFrame>
      </div>
    </section>
  );
}
