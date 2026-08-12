import styles from "./handoff-note.module.css";

export interface HandoffNoteProps {
  content: string;
  author: string;
  /** Already formatted for display. The console formats dates and times in the
   *  property's timezone, which is a decision for the caller holding the
   *  business date, not for a presentational note. */
  timestamp: string;
}

/** What the last shift left for this one.
 *
 *  A `blockquote` with a `figcaption`-style byline: the attribution has to sit
 *  outside the quoted text, or a reader hears the author's name as part of the
 *  note. The quote marks are drawn in CSS for the same reason. */
export default function HandoffNote({
  content,
  author,
  timestamp,
}: HandoffNoteProps) {
  return (
    <figure className={styles.note}>
      <blockquote className={styles.quote}>{content}</blockquote>
      <figcaption className={`${styles.byline} caps-label`}>
        <cite className={styles.author}>{author}</cite>
        <span className={styles.time}>{timestamp}</span>
      </figcaption>
    </figure>
  );
}
