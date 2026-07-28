// The measure line's three slots, as arithmetic and as a sentence.
//
// The card carries twelve words, so the three facts that actually differ
// between the five types — whom the room sleeps, how big it is, what it faces —
// are carried by glyphs instead of prose. Glyphs have to say the same thing to a
// screen reader that they say to an eye, and the only way to keep those two from
// drifting is to derive both from one place. That is this file: the numbers the
// strip draws and the sentence it is labelled with come out of the same
// functions, and `room-measure.spec.ts` holds them together.
//
// Nothing here reads a hotel fact of its own. Every value comes from
// `room-types.ts`, which cites `property-and-tariff.md` §1.

import type { RoomTypeCode } from "@mariva/shared";
import type { RoomType } from "./room-types";

/**
 * The occupancy dots: one filled per head the type takes, one open if it takes
 * an extra bed.
 *
 * `property-and-tariff.md` §1's distinction between what the bedding sleeps and
 * what the room may hold *is* the filled/open pair. Circles, and only circles —
 * a square or a star in this position reads as a rating, and the property is not
 * rating its own rooms.
 */
export function occupancyDots(type: RoomType): {
  readonly filled: number;
  readonly open: number;
} {
  return { filled: type.maxOccupancy, open: type.takesExtraBed ? 1 : 0 };
}

/**
 * Each type's size bar, as a percentage of the track.
 *
 * **Normalised over the set actually passed in, never over a hardcoded largest
 * room.** The list renders whichever types are available for the range, so the
 * denominator moves; a literal 68 would silently mis-scale every bar the day a
 * sixth type is added, and would draw a full track for a room that is the
 * largest one free rather than the largest one there is.
 */
export function sizeBarFills(
  types: readonly RoomType[],
): ReadonlyMap<RoomTypeCode, number> {
  const largest = types.reduce(
    (max, type) => Math.max(max, type.squareMetres),
    0,
  );

  return new Map(
    types.map((type) => [
      type.code,
      largest > 0 ? Math.round((type.squareMetres / largest) * 100) : 0,
    ]),
  );
}

/**
 * The whole strip's accessible name — one complete sentence for one node.
 *
 * Booking.com's shape, which is the one verified thing about its cards: the
 * glyph run is a single element with a full name, and every glyph inside it is
 * `aria-hidden`. Not a label per dot. Four labelled dots in a row is four
 * announcements that each mean nothing on their own.
 */
export function measureLineLabel(type: RoomType): string {
  const { open } = occupancyDots(type);
  const sleeps =
    open > 0
      ? `Sleeps ${type.maxOccupancy}, extra bed available.`
      : `Sleeps ${type.maxOccupancy}.`;

  return `${sleeps} ${type.squareMetres} square metres. ${aspectSentence(type.aspect)}`;
}

/**
 * The aspect as a sentence rather than as a card caption.
 *
 * "corner · two aspects" is typography: the middle dot is the arrival's own
 * separator and a screen reader reads it aloud as "middle dot" or skips it,
 * neither of which is the pause it draws. A comma is.
 */
function aspectSentence(aspect: string): string {
  const text = aspect.replaceAll(" · ", ", ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}
