// What the stays page cuts into the stone: its name, and an arch cut through
// the wall with a room seen through it.
//
// **The arch is the page's one picture, and it is the room of the stay the
// guest is reading.** A history of stays is a list of rooms, and the funnel
// already holds a photograph of every one; so as the pointer or the keyboard
// moves down the register beside it, the opening in the wall shows that stay's
// room — the arrival's sticky chooser, in stone. It holds the last room shown
// when the pointer leaves, so the wall never empties under a guest who has
// just looked away. A stay that did not happen is seen in a drained light.
//
// **It is cut, not hung.** The stone holds nothing laid on it, so the room is
// seen *through* it: an opening with the wall's own thickness shaded around it
// (`arch-frame.tsx`). It is decorative to assistive technology, because the
// row being read already names the room — which is also why nothing is cut
// under it: the stone is the heavy half of the page and says the least.

import {
  type ArchPicture,
  ArchFrame,
} from "@/features/account/components/account-frame/arch-frame";
import { Carved } from "@/features/account/components/account-frame/carving";
import styles from "./stays-list.module.css";

/** The arch on the stone; it is not drawn on a phone. */
const ARCH_SIZES = "(width >= 64rem) 18rem, 1px";

export function StaysInscription({
  pictures,
  active,
  muted = false,
}: {
  readonly pictures: readonly ArchPicture[];
  readonly active: string | undefined;
  readonly muted?: boolean;
}) {
  return (
    <div className={styles.inscription}>
      <Carved as="h1" className={styles.title} text="Your stays" />

      <ArchFrame
        active={active}
        className={styles.window}
        decorative
        muted={muted}
        pictures={pictures}
        setting="stone"
        sizes={ARCH_SIZES}
      />
    </div>
  );
}
