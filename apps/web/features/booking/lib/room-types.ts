// The five types, and the four facts a card leads with.
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
 * What is behind the "What's in the room" disclosure.
 *
 * Deliberately the same list for every type. The differences between these five
 * rooms are the four facts on the face of the card; a per-type amenity list
 * would imply the Superior has no hairdryer, and inventing which amenities each
 * type lacks is exactly the fact-invention §6 rules out. When the database holds
 * per-type amenities, this constant is what it replaces.
 */
export const ROOM_AMENITIES: readonly string[] = [
  "Air conditioning",
  "Rain shower",
  "Desk and reading light",
  "Safe",
  "Kettle, tea and coffee",
  "Hairdryer",
  "Wi-Fi",
];
