// The counts the arrival prints, read rather than typed.
//
// `docs/architecture/property-and-tariff.md` §1 is the authority: 40 rooms, and
// a type mix of 12 / 10 / 8 / 6 / 4 that sums to it. `features/booking/lib/
// room-types.ts` is already the one place the code reads §1's size, occupancy,
// bedding and aspect from, and it stays that — it simply carries no per-type
// room count, because the funnel never had a use for one. The arrival does: a
// deck that says how many of a type the house holds is telling a guest something
// the five near-identical cards otherwise cannot.
//
// So this file adds exactly the rows §1 has and `room-types.ts` does not, and
// nothing that is already there. Everything here is ⚑ like the rest of §1 —
// there is no building — and correcting it is a correction in the property file
// first and here second.

import type { RoomTypeCode } from "@mariva/shared";

/** §1, "Rooms". */
export const ROOM_COUNT = 40;

/**
 * The same count as a word, for the two places that set it in running type —
 * chapter 1's facts and promise, and the dining room's note. Typed once here
 * rather than in each of them, so "forty" and 40 cannot come apart.
 */
export const ROOM_COUNT_IN_WORDS = "Forty";

/** §1, "Guest floors": 4 of them, numbered 2–5. Ground floor is not one. */
export const GUEST_FLOORS = "2–5";

/** §1's type mix, per type. The sizes, beds and aspects are `room-types.ts`. */
export const ROOMS_OF_TYPE: Readonly<Record<RoomTypeCode, number>> = {
  SUPERIOR: 12,
  DELUXE: 10,
  PREMIER: 8,
  JUNIOR_SUITE: 6,
  PANORAMA_SUITE: 4,
};

// §1: "40 rooms, and the mix sums to it — a seed that does not sum is a seed
// bug." The same is true of a page: a deck whose counts do not add up to the
// number in its own headline is printing two different houses. Checked at module
// scope, which is the only moment it is worth finding out.
const MIX_TOTAL = Object.values(ROOMS_OF_TYPE).reduce(
  (sum, count) => sum + count,
  0,
);
if (MIX_TOTAL !== ROOM_COUNT) {
  throw new Error(
    `Type mix sums to ${MIX_TOTAL}, not ${ROOM_COUNT} — see property-and-tariff.md §1`,
  );
}

/** How many rooms of a type the house holds. */
export function roomsOfType(code: RoomTypeCode): number {
  return ROOMS_OF_TYPE[code];
}
