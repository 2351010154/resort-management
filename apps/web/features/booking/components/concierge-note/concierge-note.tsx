"use client";

// The foot of the room list: a person, for the guest the list did not answer.
//
// Five rooms is a short list, and a short list is exactly where a guest gets
// stuck — the difference between the Junior Suite and the Panorama Suite is two
// facts and a number, and a guest weighing them has a question the screen cannot
// anticipate. Every other line on this step answers a question the property
// already knows about. This one is the exit for the question it does not.
//
// **It is a call, not a form and not a chat.** A form is a question asked back;
// a chat widget is a third-party script on a route whose whole budget rule
// (`design-foundations.md` §5) is that it ships almost nothing. A `tel:` link is
// one tap on the device this is most likely being read on.
//
// **It is named as an action rather than printed as a number.** The block used
// to set the number itself as the link — a guest read eleven digits where every
// other line on the plate is a sentence, and the one exit from the five rooms
// looked like a footer. What a guest wants here is the person, so the control
// says the thing it does. The number is still what is dialled; it is simply no
// longer what is read.
//
// ⚑ **`CONCIERGE_TEL` is a placeholder and has to be replaced before this ships
// to a guest.** It is on the same footing as the ⚑ values in
// `property-and-tariff.md` §1 — the developer's call until the property states
// the real one — with one difference that matters: those are facts a guest
// *reads*, and this is a number a guest *dials*. A wrong room size is a
// correction. A wrong phone number is a guest at the moment of buying, calling a
// stranger. `rate-promise.tsx` refuses to print a guarantee nobody has written
// down for the same reason; this block exists because it was asked for, and the
// flag is the whole of the honesty about it.
//
// **Naming the action rather than printing the number does not soften that
// flag, it sharpens it.** A guest who could read the digits had a chance of
// noticing they were wrong. A guest who presses "Call the concierge" has none,
// so the number behind it must be real before this reaches one.

// **The glyph is the one picture in this block and it earns its place.** The
// block used to be three lines of type under a hairline, which is what every
// other paragraph on the plate looks like — so the one exit from the five rooms
// read as a footnote about them. A headset marks it as a different kind of
// offer: not another thing to choose, a person to ask. It is drawn in
// `public/images/booking/icons/concierge.svg` in the same idiom as the room's
// facts — one weight, one colour, `currentColor` — and painted as a mask for the
// reasons `room-stage.tsx` gives.

import styles from "./concierge-note.module.css";

/**
 * ⚑ Placeholder. Not the property's number — see the note above.
 *
 * Written once, and the `tel:` href is derived from it rather than typed a
 * second time: a number that reads one way and dials another is the failure this
 * block is most likely to ship with, and two literals is how it happens.
 */
const CONCIERGE_TEL = "+84 28 7300 0000";

export function ConciergeNote() {
  return (
    <aside className={styles.note} data-concierge>
      {/* Decorative, and deliberately so: "Concierge" is written beside it in
          words, and a glyph that repeated that word would make a screen reader
          say it twice. */}
      <span aria-hidden="true" className={styles.icon} />

      <div className={styles.lines}>
        <p className={`${styles.term} caps-label`}>Concierge</p>

        {/* The sentence and the way to act on it are one row, not two blocks.
            The control used to sit under the sentence in a tap box of its own,
            which made the quietest paragraph on the plate the tallest thing
            after the five rooms — and put a ruled phrase at the plate's own
            reading size directly under a line that was smaller than it. Beside
            it, in the space the sentence's own wrap leaves, the pair reads as
            one offer with its answer at the end. */}
        <div className={styles.body}>
          <p className={styles.line}>
            Unsure which room? We will help you choose.
          </p>

          {/* The number is the `href` and never the text — see the note above
              for why that raises the stakes on the ⚑ rather than lowering
              them. */}
          <a
            className={styles.call}
            data-concierge-call
            href={`tel:${CONCIERGE_TEL.replaceAll(" ", "")}`}
          >
            Call the concierge
          </a>
        </div>
      </div>
    </aside>
  );
}
