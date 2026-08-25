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

import { aspectMark } from "./room-icons";
import type { RoomType } from "./room-types";

/**
 * The row's one line of facts: whom it sleeps, how big, what it faces.
 *
 * Middle dots between concrete values, which is the arrival's own shape for
 * this — `design-foundations.md` §6, "68 m², garden". The extra bed is **not**
 * here: it is true of one type of the five, `property-and-tariff.md` §1 makes it
 * free, and the stage states it in one sentence instead of the row hinting at it.
 */
export function roomFacts(type: RoomType): string {
  const guests = maximumOccupancy(type);
  return `${guests}, ${type.squareMetres} m², ${type.aspect}`;
}

/**
 * One fact as a marked pair: which glyph stands beside it, what it says, and
 * which question that answers.
 *
 * **The icon is a slug, not a path.** Whoever renders it builds
 * `/images/booking/icons/<slug>.svg`, so the set a fact can be marked with is a
 * directory rather than a string anyone may write.
 *
 * The glyph is painted as **a CSS mask over `currentColor`, not an `<img>`** —
 * `funnel-nav.module.css` paints the wordmark this way and the reason carries:
 * it is drawn in the type colour it inherits, so it is correct on the first
 * frame, correct if the ground ever changes, and needs no loading state.
 */
export interface MarkedFact {
  /** Basename under `public/images/booking/icons/`, without the extension. */
  readonly icon: string;
  /** What is being read — printed first, at the heavier weight. */
  readonly value: string;
  /** Which question the value answers — printed under it, quietly. */
  readonly term: string;
}

/**
 * The four facts, in the order a guest asks them: how many of us, how big, what
 * do we sleep in, what do we look at.
 *
 * **One list for both screens that print it.** The room step's plate and the
 * review screen's summary state the same four facts about the same room, and
 * two copies of this array are two places for the order or the wording to drift
 * — a guest walking from one screen to the next would be reading the same room
 * described two ways.
 *
 * **Value first, then the word for it.** The value is what is being read — "3
 * guests", "42 m²" — and the term under it says which question that answers.
 * Printed the other way round, the eye runs down a column of labels and has to
 * land on each one before reaching anything it wanted.
 *
 * **All four are always drawn.** An earlier strip dropped the outlook for the
 * two types the traced icon set has no picture of, which left the Superior —
 * the first room every guest lands on — showing two marks in a grid sized for
 * four. `aspectMark` returns a neutral window glyph in that case and the word
 * beside it carries the fact; `room-icons.ts` is where that trade is argued.
 *
 * The extra bed is not one of them, and it no longer costs anything either —
 * `property-and-tariff.md` §1 makes the bed that closes a type's occupancy gap
 * free, because the advertised maximum is a promise and the bed is how the
 * property keeps it. It stays off the grid for the reason it always was: it is
 * true of one type of the five, and a fact that appears and disappears across
 * them is a grid that changes shape under a guest walking the list.
 */
export function markedRoomFacts(type: RoomType): readonly MarkedFact[] {
  return [
    { icon: "guests", value: maximumOccupancy(type), term: "Maximum" },
    { icon: "size", value: `${type.squareMetres} m²`, term: "Room size" },
    { icon: "bed", value: type.bedding, term: "The bed" },
    { icon: aspectMark(type.aspect), value: type.aspect, term: "View" },
  ];
}

/** Heads the type may sleep, spelled — the ceiling `§1` sets, not the bedding. */
function maximumOccupancy(type: RoomType): string {
  return type.maxOccupancy === 1 ? "1 guest" : `${type.maxOccupancy} guests`;
}
