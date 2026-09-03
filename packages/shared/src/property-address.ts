// Where the property stands — `property-and-tariff.md` §1's address.
//
// Two lines rather than one string, because the two places that print it set
// it differently: the pre-arrival mail runs it into a sentence and the
// arrival's footer stacks it. Joined here, so neither caller re-derives the
// other's shape.
//
// Beside the clock rather than in the API, for the reason the clock moved: a
// hotel fact printed on the guest site has to be the same fact the mail prints,
// and a second copy typed into `apps/web` would be the one that did not move
// on the day the property is real. Like everything in §1 it is ⚑ — there is no
// building — and a constant rather than configuration because nothing decides
// anything by it: the day it changes, this is one line and not a migration.

/** The street and ward, then the city and province. */
export const PROPERTY_ADDRESS_LINES = [
  "12 Trần Phú, Lộc Thọ",
  "Nha Trang, Khánh Hòa",
] as const;

/** The address as one line, for running text. */
export const PROPERTY_ADDRESS = PROPERTY_ADDRESS_LINES.join(", ");
