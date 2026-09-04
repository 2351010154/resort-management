// Chapter 5 — "Rituals". Three of them, read down the page on ink.
//
// Three, not eight, and no wheel: the old field spun eight cards past a reader
// who could not have said afterwards what any of them was.
//
// The names, the notes and every fact under them are `act-4-stay/experiences.ts`
// — one content source, cut to three, and the only place this chapter's copy is
// written. What that file does not carry, this chapter does not print: the
// property publishes no hour and no length for any of the three, so where a
// window would go each entry states that its hours are published at booking and
// hands the reader the one thing that is true and actionable today — the stay
// itself, with whatever the page's draft already holds.

import { ApertureFrame } from "@/features/arrival/components/aperture/aperture-frame";
import {
  EXPERIENCES,
  experiencePlate,
} from "@/features/arrival/components/act-4-stay/experiences";
import { ChooseDatesLink } from "@/features/arrival/components/booking/choose-dates-link";
import { tierSrc, tierSrcSet } from "@/features/arrival/lib/image-srcset";
import styles from "./chapter-5-rituals.module.css";

/**
 * What an entry says where its hours would be.
 *
 * Not a hedge: it is a sentence a reader can act on, and the `Choose dates` link
 * beside it is the action. The alternative — printing nothing, or printing an
 * hour nobody decided — either drops the question or answers it untruthfully.
 */
const HOURS_UNPUBLISHED = "Hours published at booking";

const pad = (n: number) => String(n).padStart(2, "0");

export function Chapter5Rituals() {
  return (
    <section data-act={5} className={styles.section}>
      <header className={styles.head}>
        <span className={`caps-label ${styles.eyebrow}`}>Rituals</span>
        <h2 className={`font-display ${styles.headline}`}>
          Three things the evening is for.
        </h2>
      </header>

      <ol className={styles.list}>
        {EXPERIENCES.map((ritual, index) => {
          const plate = experiencePlate(ritual);
          // Only the fields the content source actually carries, plus the one
          // honest line where the hour is missing — which today is all three.
          const meta = [ritual.place, ritual.time, ritual.duration].filter(
            (value): value is string => Boolean(value),
          );
          if (!ritual.time) meta.push(HOURS_UNPUBLISHED);
          return (
            <li key={ritual.slug} className={styles.item}>
              <ApertureFrame ratio="3 / 4" tone="ink" className={styles.plate}>
                <img
                  src={tierSrc(plate.src, 1280)}
                  srcSet={tierSrcSet(plate)}
                  sizes="(max-width: 767px) 88vw, 32vw"
                  width={plate.width}
                  height={plate.height}
                  alt={plate.alt}
                  loading="lazy"
                  decoding="async"
                />
              </ApertureFrame>

              <div className={styles.copy}>
                <span className={`caps-label ${styles.index}`}>
                  {pad(index + 1)}
                </span>
                <h3 className={`font-display ${styles.name}`}>{ritual.name}</h3>
                {ritual.note ? (
                  <p className={styles.note}>{ritual.note}</p>
                ) : null}
                <ul className={styles.meta}>
                  {meta.map((value) => (
                    <li key={value} className={`caps-label ${styles.fact}`}>
                      {value}
                    </li>
                  ))}
                </ul>
                <ChooseDatesLink
                  className={`caps-label ${styles.action}`}
                  context={ritual.name}
                />
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
