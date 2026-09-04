// Chapter 6 — "Place". Where the house stands and how a guest reaches it.
//
// The aperture is a window here, and what is behind it is not a photograph but the
// route: the coast, the airport at the south end of it, the house on Trần Phú at
// the north. Drawn as inline SVG rather than a map tile or a generated image —
// it is four strokes and two labels, it needs no key and no licence, and phase 4
// turns the same path into the border of chapter 7's form. Its caption names what
// it draws, so the drawing itself carries nothing a reader has to see it to get.
//
// The facts are read from `@mariva/shared`, so the address and the clock the page
// prints are the address and the clock the pre-arrival mail prints.
//
// ⚑ No distance and no journey time, and no sentence about either. The property
// file gives neither, and "45 minutes from the airport" is a promise the property
// would have to keep. So the two things the plan has this chapter say — the
// beachfront and the transfer — are headings over the drawing and over the four
// facts, and the facts themselves are the whole of the copy: the address the mail
// prints and the clock the desk keeps. The drawing is a stylisation, not a map,
// so it is decorative and hidden from assistive technology; nothing in it is a
// fact that is not also in the list beside it.

import {
  CHECK_IN_TIME,
  CHECK_OUT_TIME,
  PROPERTY_ADDRESS_LINES,
} from "@mariva/shared";
import { ApertureFrame } from "@/features/arrival/components/aperture/aperture-frame";
import styles from "./chapter-6-place.module.css";

const FACTS = [
  { label: "Address", value: PROPERTY_ADDRESS_LINES[0] },
  { label: "City", value: PROPERTY_ADDRESS_LINES[1] },
  { label: "Check-in", value: `from ${CHECK_IN_TIME}` },
  { label: "Check-out", value: `by ${CHECK_OUT_TIME}` },
];

export function Chapter6Place() {
  return (
    <section data-act={6} className={styles.section}>
      <div className={styles.grid}>
        <figure className={styles.figure}>
          <ApertureFrame ratio="4 / 5" tone="ink" className={styles.window}>
            <svg
              className={styles.route}
              viewBox="0 0 400 500"
              aria-hidden="true"
              focusable="false"
            >
              {/* The water, east of the road. */}
              <path
                className={styles.shore}
                d="M262 -10 C 246 96, 300 176, 268 258 C 238 336, 286 414, 258 510"
                fill="none"
              />
              {/* The road, south to north. */}
              <path
                className={styles.line}
                d="M214 430 C 176 372, 236 318, 208 254 C 184 198, 226 156, 206 106"
                fill="none"
              />
              <circle className={styles.pin} cx="214" cy="430" r="4" />
              <circle
                className={styles.pin}
                data-here
                cx="206"
                cy="106"
                r="6"
              />
              {/* Both labels west of the road, so neither is read across the
                  water's own stroke. */}
              <text
                className={styles.pinLabel}
                x="200"
                y="435"
                textAnchor="end"
              >
                Cam Ranh
              </text>
              <text
                className={styles.pinLabel}
                data-here
                x="192"
                y="110"
                textAnchor="end"
              >
                Mariva
              </text>
            </svg>
          </ApertureFrame>
          <figcaption className={`caps-label ${styles.windowLabel}`}>
            Transfer from Cam Ranh
          </figcaption>
        </figure>

        <div className={styles.copy}>
          <span className={`caps-label ${styles.eyebrow}`}>Place</span>
          <h2 className={`font-display ${styles.headline}`}>
            Trần Phú beachfront.
          </h2>

          <dl className={styles.facts}>
            {FACTS.map((fact) => (
              <div key={fact.label} className={styles.row}>
                <dt className="caps-label">{fact.label}</dt>
                <dd className={styles.value}>{fact.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
