// Reading a CCCD back without reading it out — the default half of `FR-GST-03`.
//
// `schema/guest.ts` stores the number as it was read off the card and argues
// there why no second column holds the asterisks: a mask is a pure function of
// the number, and a stored copy of a pure function is a copy that goes stale on
// the update that touches one and not the other, leaving four digits that are
// confidently wrong. So the mask is computed, here, on the way out.
//
// It is a separate file from the service because it is the one rule in this
// module with no database under it. That makes it exhaustively testable — every
// length, including the ones a real card never has — and it gives the check-in
// screen and the guest contract one function to agree with rather than one
// habit each.
//
// Three decisions the shape below encodes:
//
// - **Four characters, and only from the end.** Enough for a receptionist to
//   confirm the card in front of them matches the record; not enough to write
//   the number down. `screens.md` describes revealing as per field and per
//   visit, which is only meaningful if the default reveals something less than
//   the whole.
// - **A number of four characters or fewer shows nothing at all.** A twelve
//   digit CCCD has no such case, but the column has no length check and a
//   mistyped entry is storable — and "show the last four" applied to a value
//   four long is a function that prints its own input. The tail rule is
//   therefore a floor, not a subtraction: below the threshold the answer is all
//   asterisks. The failure avoided is a masking function that leaks precisely
//   on the records somebody typed wrong.
// - **Absent stays absent.** `null` masks to `null` and never to a row of
//   asterisks. A guest with no CCCD on file and a guest whose CCCD is being
//   withheld are different facts — the first says the property never took the
//   number, the second says it has it and is not showing it — and a residence
//   report that cannot tell them apart is a report that cannot say who is
//   undocumented. `guest_cccd_present_when_set` makes the same distinction
//   storable by refusing the blank string that would blur it.
//
// The length of the number survives masking, deliberately. It is what lets the
// desk see that a full card number is on file rather than a fragment, and it
// discloses nothing the count of asterisks would not.

/** How many characters of the number a masked reading keeps. */
const VISIBLE_TAIL = 4;

const MASK_CHARACTER = "*";

/**
 * The number as every read path but the audited one is allowed to see it.
 *
 * Total over its input by construction: there is no length, and no absence,
 * for which this returns the number it was given.
 */
export function maskCccd(cccdNumber: string | null): string | null {
  if (cccdNumber === null) {
    return null;
  }

  if (cccdNumber.length <= VISIBLE_TAIL) {
    return MASK_CHARACTER.repeat(cccdNumber.length);
  }

  return (
    MASK_CHARACTER.repeat(cccdNumber.length - VISIBLE_TAIL) +
    cccdNumber.slice(-VISIBLE_TAIL)
  );
}
