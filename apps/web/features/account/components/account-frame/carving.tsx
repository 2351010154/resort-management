// Letters cut into the stone, rather than printed over it.
//
// **This is how the stone holds words without anything laid on top of it.**
// The account's limestone is a material, and a material only takes type one way
// that does not turn it into a backdrop: cut in. So the guest's name on the
// member card is set as a groove in the stone, and the stone's own light falls
// into it.
//
// **Three copies of the text make one cut.** Stacked the way
// `embossed-monogram.tsx` stacks the footer's mark: the cut's upper wall in its
// own shadow, its lower lip catching the light, and the floor of the cut filled
// with the stone's grain under an umber wash — the same stone, further in. The
// two decorative copies are hidden from assistive technology, so the words are
// read once.
//
// Display type only: small type cannot take three copies and stay sharp, so
// the card's small caps are engraved shallow instead (`member-card.module.css`).

import styles from "./carving.module.css";

export function Carved({
  as: Tag = "p",
  text,
  className,
  id,
}: {
  readonly as?: "h1" | "h2" | "p";
  readonly text: string;
  readonly className?: string;
  readonly id?: string;
}) {
  return (
    // Keyed on the text, so a change is cut again rather than swapped under
    // the eye — a guest who corrects their name watches it carved anew.
    <Tag
      className={className ? `${styles.carved} ${className}` : styles.carved}
      id={id}
      key={text}
    >
      <span aria-hidden="true" className={styles.cutShadow}>
        {text}
      </span>
      <span aria-hidden="true" className={styles.cutLight}>
        {text}
      </span>
      <span className={styles.cutFace}>{text}</span>
    </Tag>
  );
}
