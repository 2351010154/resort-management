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
  /** How many the standard bedding sleeps. Below `maxOccupancy` only where an
   *  extra bed is what closes the gap, which is what makes the extra bed a
   *  thing the guest needs rather than a thing they are offered. */
  readonly beddingSleeps: number;
  /** Whether the type takes an extra bed at all — §1. */
  readonly takesExtraBed: boolean;
  /** Square metres. Rendered with the aspect as the one distinguishing fact. */
  readonly squareMetres: number;
  /** Bed configuration with dimensions — the fact Limehome gets right. */
  readonly bedding: string;
  /** One concrete fact in the arrival's voice. No adjectives. */
  readonly aspect: string;
}

/**
 * Occupancy included in the rate, for every type.
 *
 * Double occupancy, stated once rather than per type: `property-and-tariff.md`
 * §3 charges an extra person per night above it and up to `maxOccupancy`, and a
 * per-type value would imply the property varies what "the rate" covers when it
 * does not.
 */
export const INCLUDED_OCCUPANCY = 2;

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
  },
];

const BY_CODE = new Map(ROOM_TYPES.map((type) => [type.code, type]));

export function roomType(code: RoomTypeCode): RoomType {
  const type = BY_CODE.get(code);
  if (!type) throw new Error(`no such room type: ${code}`);
  return type;
}

/**
 * What is in the room, by subject.
 *
 * **Deliberately the same for every type**, and that is why it is one tap deeper
 * than the card rather than on it. The differences between these five rooms are
 * the three things the card draws; a per-type amenity list would imply the
 * Superior has no hairdryer, and inventing which amenities each type lacks is
 * exactly the fact-invention `design-foundations.md` §6 rules out. When the
 * database holds per-type amenities, this constant is what it replaces.
 *
 * Grouped rather than listed flat. Apple's comparison page is twenty row
 * headers and every one of them is a *subject* — "Size and Weight" — never a
 * spec, because a reader scans for the subject they care about and reads only
 * that row. Seven items in one run is a list to be read; three subjects is a
 * thing to be scanned. The grouping is organisation of facts the property
 * already states, not a new fact.
 */
export interface AmenityGroup {
  readonly subject: string;
  readonly items: readonly string[];
}

export const ROOM_AMENITIES: readonly AmenityGroup[] = [
  {
    subject: "Comfort",
    items: ["Air conditioning", "Desk and reading light"],
  },
  {
    subject: "Bathroom",
    items: ["Rain shower", "Hairdryer"],
  },
  {
    subject: "In the room",
    items: ["Safe", "Kettle, tea and coffee", "Wi-Fi"],
  },
];
