// The counts the arrival prints, read rather than typed.
//
// `docs/architecture/property-and-tariff.md` §1 is the authority: 40 rooms, and
// a type mix of 12 / 10 / 8 / 6 / 4 that sums to it. `features/booking/lib/
// room-types.ts` is already the one place the code reads §1's size, occupancy,
// bedding and aspect from, and it stays that — it simply carries no per-type
// room count, because the funnel never had a use for one. The arrival does: a
// block that says how many of a type the house holds is telling a guest something
// the funnel's near-identical cards otherwise cannot.
//
// So this file adds exactly the rows §1 has, `room-types.ts` does not, and the
// arrival reads — the room count and the guest floors — and nothing else. Everything here is ⚑ like the rest of §1 —
// there is no building — and correcting it is a correction in the property file
// first and here second.

/**
 * §1, "Rooms": 40, as the word the running type sets it in. Typed once here
 * rather than in each block, so two blocks cannot print two different houses.
 */
export const ROOM_COUNT_IN_WORDS = "Forty";

/** §1, "Guest floors": 4 of them, numbered 2–5. Ground floor is not one. */
export const GUEST_FLOORS = "2–5";
