// What the profile cuts into the stone: the guest's name, and nothing else.
//
// **The name is carved, not printed.** A profile is the one screen where the
// house shows what it remembers, and a name set in ink on a card reads as a
// form echoing its own field back. Cut into the wall it reads as what it is —
// the house's record of a person — and it is cut again when the guest corrects
// it, because the carving is keyed on the text (`carving.tsx`).
//
// **One line, because the stone is the heavy half of the page.** The tier, the
// points and the month the account began were all cut here once, under a
// groove; each of them is also the book's to state, where it has room to be
// explained, so the wall keeps only the name and lets the light do the rest.

import { Carved } from "@/features/account/components/account-frame/carving";
import styles from "./profile-inscription.module.css";

/** Names longer than these are set a size down, so a four-word Vietnamese
 *  name still cuts in three lines inside the honed field. */
const MEDIUM_NAME = 15;
const LONG_NAME = 24;

export function ProfileInscription({
  name,
}: {
  /** The `h1`. Undefined while nothing has been read: the heading is then the
   *  screen's name for assistive technology and the wall stays uncut, so the
   *  stone never reads one name and then another. */
  readonly name: string | undefined;
}) {
  return name ? (
    <Carved as="h1" className={nameClass(name)} text={name} />
  ) : (
    <h1 className={styles.uncut}>Your profile</h1>
  );
}

/** The name's size, by its length in characters rather than code units. */
function nameClass(name: string): string {
  const length = [...name].length;

  if (length > LONG_NAME) {
    return `${styles.name} ${styles.long}`;
  }

  if (length > MEDIUM_NAME) {
    return `${styles.name} ${styles.medium}`;
  }

  return styles.name;
}
