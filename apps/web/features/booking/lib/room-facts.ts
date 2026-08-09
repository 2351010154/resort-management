// What one row of the list states about a room.
//
// **The size track went with the disclosure it lived in.** Round 3's row opened
// a panel holding a rail labelled 28 → 68 with a mark on it, and the argument
// for it was real: "34 m²" answers "how big", and a mark at 15% of a labelled
// scale answers "how big compared to the other four", which is the question a
// guest choosing between five rooms is actually asking. What made it worth its
// pixels was that only one row could be open at a time, so the comparison had to
// be drawn because it could not be seen.
//
// It can be seen now. The five rows are five short lines at the same x, and the
// third column of every one of them is a number in square metres — 28, 34, 42,
// 52, 68, read straight down. A rail measuring the same five numbers beside them
// is the comparison drawn twice, and the drawn one is the one that needed a
// hundred lines of stylesheet, a `role="img"`, a hand-written accessible name
// and a browser test to prove its marks landed where it said they did.
//
// So `sizeMarks`, `sizeScale` and `sizeTrackLabel` are gone, and this is what is
// left of the module: the one line the row prints.
//
// Nothing here reads a hotel fact of its own. Every value comes from
// `room-types.ts`, which cites `property-and-tariff.md` §1.

import type { RoomType } from "./room-types";

/**
 * The row's one line of facts: whom it sleeps, how big, what it faces.
 *
 * Middle dots between concrete values, which is the arrival's own shape for
 * this — `design-foundations.md` §6, "68 m² · garden". The extra bed is **not**
 * here: it is true of one type of the five, `property-and-tariff.md` §1 makes it
 * free, and the stage states it in one sentence instead of the row hinting at it.
 */
export function roomFacts(type: RoomType): string {
  const guests =
    type.maxOccupancy === 1 ? "1 guest" : `${type.maxOccupancy} guests`;
  return `${guests} · ${type.squareMetres} m² · ${type.aspect}`;
}
