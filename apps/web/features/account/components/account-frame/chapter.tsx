// One part of the book: `01  YOUR DETAILS`, a sentence set large, the small
// print under it, and the work below all three.
//
// A component because every part of both account screens opens this way — the
// landing's own chapter grammar — and the shape carries a rule a chapter
// written out by hand would forget: the heading is the *name* ("Your details")
// and not the sentence, so a guest moving by headings hears what the part is
// for, while the number beside it stays out of the accessibility tree. No
// rule is drawn between the two: the page carries no dashes, and the space
// between a number and a word is enough to tell them apart.

import { type ReactNode, useId } from "react";
import styles from "./chapter.module.css";

export function Chapter({
  number,
  name,
  line,
  lede,
  action,
  children,
}: {
  /** Two digits — the landing's chapter marks are numbered the same way. */
  readonly number: string;
  readonly name: string;
  /** The chapter's sentence, in the display face. */
  readonly line?: string;
  readonly lede?: ReactNode;
  /** One control that acts on the whole chapter, set at the mark's far end. */
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className={styles.chapter}>
      <div className={styles.head}>
        <div className={styles.markRow}>
          <ChapterMark id={headingId} name={name} number={number} />
          {action ? <div className={styles.action}>{action}</div> : null}
        </div>
        {line ? <p className={`${styles.line} font-display`}>{line}</p> : null}
        {lede ? <p className={styles.lede}>{lede}</p> : null}
      </div>

      <div className={styles.body}>{children}</div>
    </section>
  );
}

/** The heading itself: the number for the eye, the name for everyone. */
export function ChapterMark({
  id,
  number,
  name,
}: {
  readonly id: string;
  readonly number: string;
  readonly name: string;
}) {
  return (
    <h2 className={`${styles.mark} caps-label`} id={id}>
      <span aria-hidden="true" className={styles.number}>
        {number}
      </span>
      {name}
    </h2>
  );
}
