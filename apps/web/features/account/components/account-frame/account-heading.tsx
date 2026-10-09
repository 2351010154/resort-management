// The head of an account screen: what the screen is, and the few facts a guest
// reads at a glance.
//
// **The facts are labelled, never run together.** Each fact is its own pair —
// a caps label over its value in the display face — so the eye reads
// "Loyalty points, 500" rather than parsing a line of metadata joined by
// separator glyphs. A pair with nothing to say is left out by the screen, not
// printed as a dash.
//
// **One `h1`, and it is the screen's subject.** On the profile that is the
// guest's name, under a greeting that is not part of the heading; on the stays
// page it is the page's own name. While nothing has been read the heading is
// still there for assistive technology, but nothing is drawn — a name set
// once, when it is known, rather than "Your profile" first and a name after it.

import styles from "./account-heading.module.css";

export interface HeadingFact {
  readonly label: string;
  readonly value: string;
}

/** Names longer than these are set a size down, so a four-word Vietnamese
 *  name still sits in two lines beside the card. */
const MEDIUM_TITLE = 15;
const LONG_TITLE = 24;

export function AccountHeading({
  greeting,
  title,
  hiddenTitle,
  facts = [],
}: {
  /** A line over the heading that is not part of it — "Welcome back,". */
  readonly greeting?: string;
  /** The `h1`, drawn. */
  readonly title?: string;
  /** The `h1` while there is nothing to draw: heard, not seen. */
  readonly hiddenTitle?: string;
  readonly facts?: readonly HeadingFact[];
}) {
  if (!title) {
    return <h1 className={styles.hidden}>{hiddenTitle}</h1>;
  }

  return (
    <div className={styles.heading}>
      <div className={styles.names}>
        {greeting ? (
          <p className={`${styles.greeting} font-display`}>{greeting}</p>
        ) : null}
        <h1
          className={`${styles.title} font-display`}
          data-length={titleLength(title)}
        >
          {title}
        </h1>
      </div>

      {facts.length > 0 ? (
        <dl className={styles.facts}>
          {facts.map((fact) => (
            <div className={styles.fact} key={fact.label}>
              <dt className={`${styles.factLabel} caps-label`}>{fact.label}</dt>
              <dd className={`${styles.factValue} font-display`}>
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

/** The heading's size, by its length in characters rather than code units. */
function titleLength(title: string): "short" | "medium" | "long" {
  const length = [...title].length;

  if (length > LONG_TITLE) {
    return "long";
  }

  return length > MEDIUM_TITLE ? "medium" : "short";
}
