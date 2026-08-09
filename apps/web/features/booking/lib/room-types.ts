// The five types, and what tells them apart.
//
// ⚑ **The aspect words want a yes before they ship to a guest.**
// `courtyard / garden / city / corner / sea` are flagged in
// `property-and-tariff.md` §1 like the rest of §1–§6 — the developer's call
// until the database holds them. That was a low-stakes flag when the card
// carried four sentences and the aspect was one of them. It is now one of the
// **three** things the card says about a room, and the only one of the three
// that is a claim rather than a measurement: a guest who books the sea aspect
// and arrives to a car park has been told something untrue by this file.
//
// `docs/architecture/property-and-tariff.md` §1 is the authority for the type
// mix, the maximum occupancy and which types take an extra bed. It is also the
// authority for the size, the bedding and the aspect — those rows were added to
// it for this screen, because `design-foundations.md` §6 forbids inventing a
// hotel fact in a component, and a room card that says nothing concrete is the
// five-near-identical-blocks failure Limehome demonstrates. Every value there is
// ⚑ like the rest of §1–§6: the developer's call until the database holds it.
//
// The order is fixed and is the order the list renders in — ascending by maximum
// occupancy, then by price. Five items do not need a sort control, and a stable
// order is what lets the eye compare one fact down a column.

import type { RoomTypeCode } from "@mariva/shared";

export interface RoomType {
  readonly code: RoomTypeCode;
  readonly name: string;
  /** Hard ceiling — `property-and-tariff.md` §1. Occupancy above it is a
   *  rejection, not a price. */
  readonly maxOccupancy: number;
  /** How many the standard bedding sleeps — §1. Below `maxOccupancy` only where
   *  an extra bed is what closes the gap, and that gap is the whole rule: §1
   *  requires a bed exactly when the heads needing bedding exceed this number,
   *  and charges nothing for it. The stage states the bed off this comparison. */
  readonly beddingSleeps: number;
  /** Whether a bed fits and the desk may carry one in — §1. Not that the type
   *  reaches its maximum with one: two of the three that take a bed have no gap
   *  to close, and a bed there is one a guest asked for and pays §6 for. The bed
   *  §1 requires is free, and this column is not what decides one is required. */
  readonly takesExtraBed: boolean;
  /** Square metres. Rendered with the aspect as the one distinguishing fact. */
  readonly squareMetres: number;
  /** Bed configuration with dimensions — the fact Limehome gets right. */
  readonly bedding: string;
  /** One concrete fact in the arrival's voice. No adjectives. */
  readonly aspect: string;
  /**
   * Two sentences the property says about the type — `property-and-tariff.md`
   * §1, "What each type says for itself".
   *
   * Quotes no number that is not already a field above, so a size or a bed is
   * corrected in one place rather than two.
   */
  readonly description: string;
}

/**
 * Occupancy included in the rate, for every type.
 *
 * Double occupancy, stated once rather than per type: `property-and-tariff.md`
 * §3 charges an extra person per night above it and up to `maxOccupancy`, and a
 * per-type value would imply the property varies what "the rate" covers when it
 * does not.
 *
 * Re-exported rather than declared, so this file stays the one import the funnel
 * reaches for while the value itself sits in `@mariva/shared` beside the type
 * codes. The API prices against the same number; a second copy here is how a
 * quoted stay and a posted folio come to disagree by one extra person.
 */
export { INCLUDED_OCCUPANCY } from "@mariva/shared";

export const ROOM_TYPES: readonly RoomType[] = [
  {
    code: "SUPERIOR",
    name: "Superior",
    maxOccupancy: 2,
    beddingSleeps: 2,
    takesExtraBed: false,
    squareMetres: 28,
    bedding: "one queen bed (1.60 m)",
    aspect: "courtyard",
    description:
      "The courtyard side of the building, and the quiet one. A queen bed, a desk at the window, and room enough for two.",
  },
  {
    code: "DELUXE",
    name: "Deluxe",
    maxOccupancy: 2,
    beddingSleeps: 2,
    takesExtraBed: true,
    squareMetres: 34,
    bedding: "one king bed (1.80 m)",
    aspect: "garden",
    description:
      "Six square metres more than the Superior, facing the garden. A king bed, and a chair you will actually sit in.",
  },
  {
    code: "PREMIER",
    name: "Premier",
    maxOccupancy: 3,
    beddingSleeps: 3,
    takesExtraBed: false,
    squareMetres: 42,
    bedding: "one king bed (1.80 m) · one single bed (1.00 m)",
    aspect: "city",
    description:
      "A king bed and a single, on the city side. The room a family of three stops having to negotiate.",
  },
  {
    code: "JUNIOR_SUITE",
    name: "Junior Suite",
    maxOccupancy: 3,
    beddingSleeps: 2,
    takesExtraBed: true,
    squareMetres: 52,
    bedding: "one king bed (1.80 m)",
    aspect: "corner · two aspects",
    description:
      "A corner room, so the light moves across it through the day. The sitting area is its own room in all but name.",
  },
  {
    code: "PANORAMA_SUITE",
    name: "Panorama Suite",
    maxOccupancy: 4,
    beddingSleeps: 4,
    takesExtraBed: true,
    squareMetres: 68,
    bedding: "two queen beds (1.60 m)",
    aspect: "sea",
    description:
      "The largest room in the house, facing the sea, with two queen beds. It is the one people come back for.",
  },
];

const BY_CODE = new Map(ROOM_TYPES.map((type) => [type.code, type]));

export function roomType(code: RoomTypeCode): RoomType {
  const type = BY_CODE.get(code);
  if (!type) throw new Error(`no such room type: ${code}`);
  return type;
}

/**
 * ⚑ What is in every room — `property-and-tariff.md` §1, "In every room".
 *
 * **This list was once deleted, and the objection that deleted it was right.**
 * It read as seven features in three labelled groups, a tap deeper than the
 * card, and every item on it was something a guest paying this rate has already
 * assumed. A property that prints "Wi-Fi" as a *feature* is telling you it might
 * not have had it.
 *
 * What was wrong was the register, not the facts. So the list is back, sourced
 * from the property file rather than written in a component — which is the half
 * `design-foundations.md` §6 actually forbids — and `room-stage.module.css`
 * prints it as the plainest run of lines on the plate: no heading, no glyphs, no
 * ticks, under a rule, at the smallest weight. It answers "what is in the room"
 * for a guest who wondered, and it does not compete with the five things that
 * differ.
 *
 * One list, not five. A type that ever differs takes an override at that point;
 * five copies of the same twelve lines is five places to forget.
 *
 * The order is the property file's, read across then down, so the three columns
 * on the plate group the way the table does.
 */
export const ROOM_AMENITIES: readonly string[] = [
  "Air conditioning",
  "Rain shower",
  "Kettle, tea and coffee",
  "Desk and reading light",
  "Premium toiletries",
  "Still water",
  "In-room safe",
  "Hairdryer",
  "Wi-Fi",
  "Daily housekeeping",
  "Robes and slippers",
  "Smart TV",
];
