// `docs/architecture/property-and-tariff.md` §1, §3 and §6, as the rows the
// seed writes. This is the file that file means by "revisable at no cost until
// the code reads it" — the code reads it here, so §1 and this table are changed
// together or they disagree.
//
// Every value is ⚑, and the four base rates are ⚑ twice over: §3 sets the plan
// *structure* and leaves the room rates unset, so the figures below arrived
// with `/booking`, which could not render a card without them. They are the
// same numbers `apps/web/features/booking/lib/rate-calendar-fixture.ts` stubs,
// deliberately: that fixture exists to be deleted once these endpoints answer,
// and a screen that changed its prices the day it was wired to the real API
// would look like a pricing bug rather than a wiring change.

import type { RatePlanCode, RoomTypeCode, VndAmount } from "@mariva/shared";
import type { TAX_CLASSES } from "../schema/service.js";

/** The property's rooms — §1. */
export const ROOM_COUNT = 40;
export const GUEST_FLOORS = [2, 3, 4, 5] as const;
export const ROOMS_PER_FLOOR = 10;

/**
 * One row of §1's type mix, plus the two sentences §1's second table gives it.
 *
 * `rooms` is what the mix has to sum to, and the seed refuses to run when it
 * does not — §1 says a mix that does not sum to forty is a seed bug, and this
 * is the sentence that makes it one.
 */
export interface RoomTypeSeed {
  readonly code: RoomTypeCode;
  readonly name: string;
  readonly rooms: number;
  readonly maxOccupancy: number;
  readonly beddingSleeps: number;
  readonly takesExtraBed: boolean;
  readonly squareMetres: number;
  readonly bedding: string;
  readonly aspect: string;
  readonly description: string;
  readonly displayOrder: number;
  /** ⚑ Proposed gross, on a low-season weeknight — §5's gross, whole đồng. */
  readonly baseGrossPerNight: VndAmount;
}

export const ROOM_TYPES: readonly RoomTypeSeed[] = [
  {
    code: "SUPERIOR",
    name: "Superior",
    rooms: 12,
    maxOccupancy: 2,
    beddingSleeps: 2,
    takesExtraBed: false,
    squareMetres: 28,
    bedding: "one queen bed (1.60 m)",
    aspect: "courtyard",
    description:
      "The courtyard side of the building, and the quiet one. A queen bed, a desk at the window, and room enough for two.",
    displayOrder: 1,
    baseGrossPerNight: 1_850_000n,
  },
  {
    code: "DELUXE",
    name: "Deluxe",
    rooms: 10,
    maxOccupancy: 2,
    beddingSleeps: 2,
    takesExtraBed: true,
    squareMetres: 34,
    bedding: "one king bed (1.80 m)",
    aspect: "garden",
    description:
      "Six square metres more than the Superior, facing the garden. A king bed, and a chair you will actually sit in.",
    displayOrder: 2,
    baseGrossPerNight: 2_450_000n,
  },
  {
    code: "PREMIER",
    name: "Premier",
    rooms: 8,
    maxOccupancy: 3,
    beddingSleeps: 3,
    takesExtraBed: false,
    squareMetres: 42,
    bedding: "one king bed (1.80 m) · one single bed (1.00 m)",
    aspect: "city",
    description:
      "A king bed and a single, on the city side. The room a family of three stops having to negotiate.",
    displayOrder: 3,
    baseGrossPerNight: 3_200_000n,
  },
  {
    code: "JUNIOR_SUITE",
    name: "Junior Suite",
    rooms: 6,
    maxOccupancy: 3,
    // Two, and the extra bed is what closes the gap to three — §1's "beds sleep
    // is not max occupancy" row, and the reason `room_type` carries a check
    // that a type claiming more heads than bedding must take a bed.
    beddingSleeps: 2,
    takesExtraBed: true,
    squareMetres: 52,
    bedding: "one king bed (1.80 m)",
    aspect: "corner · two aspects",
    description:
      "A corner room, so the light moves across it through the day. The sitting area is its own room in all but name.",
    displayOrder: 4,
    baseGrossPerNight: 4_600_000n,
  },
  {
    code: "PANORAMA_SUITE",
    name: "Panorama Suite",
    rooms: 4,
    maxOccupancy: 4,
    beddingSleeps: 4,
    takesExtraBed: true,
    squareMetres: 68,
    bedding: "two queen beds (1.60 m)",
    aspect: "sea",
    description:
      "The largest room in the house, facing the sea, with two queen beds. It is the one people come back for.",
    displayOrder: 5,
    baseGrossPerNight: 6_800_000n,
  },
];

/**
 * The three plans — §3, as the two columns `rate_plan` stores them in.
 *
 * `BB` carries §6's breakfast price rather than a percentage, because §3 makes
 * it an addition and not a discount: breakfast is a folio line of its own, and
 * a plan that expressed it as an uplift would make the room and the meal
 * inseparable at reporting time.
 */
export interface RatePlanSeed {
  readonly code: RatePlanCode;
  readonly name: string;
  readonly percentAdjustment: number;
  readonly breakfastPerPersonGross: VndAmount | null;
  readonly displayOrder: number;
}

/**
 * §6 states breakfast's price once, and two tables spend it: `rate_plan` holds
 * what a `BB` quote adds, `service_catalog` holds what an à-la-carte folio line
 * costs. They are separate products — a `BB` guest's price is snapshotted onto
 * the booking at quote time and cannot move afterwards, while the catalog row
 * prices a walk-in today. Naming the figure once is what makes them start from
 * the same paragraph, so the day the owner moves §6 neither table is missed.
 *
 * ⚑ Proposed — §6, per person per night.
 */
export const BREAKFAST_PER_PERSON_GROSS: VndAmount = 250_000n;

export const RATE_PLANS: readonly RatePlanSeed[] = [
  {
    code: "STANDARD",
    name: "Standard",
    percentAdjustment: 0,
    breakfastPerPersonGross: null,
    displayOrder: 1,
  },
  {
    code: "BB",
    name: "Bed and breakfast",
    percentAdjustment: 0,
    breakfastPerPersonGross: BREAKFAST_PER_PERSON_GROSS,
    displayOrder: 2,
  },
  {
    code: "NONREF",
    name: "Non-refundable",
    // §3: `STANDARD` − 10%, and nothing back on a cancellation.
    percentAdjustment: -10,
    breakfastPerPersonGross: null,
    displayOrder: 3,
  },
];

/**
 * The one tariff figure that belongs to the property rather than to a plan — §3.
 *
 * ⚑ Proposed, per night, gross, per head beyond the included two. It is the
 * number §3's age bands are percentages *of*: without it, "50% of the
 * extra-person rate" resolves to nothing.
 *
 * The extra *bed* price is not here and is not an oversight. §9 leaves with the
 * owner both when a bed is mandatory and whether its charge stacks with this
 * one, and a seeded figure would be this file answering a question it was told
 * not to.
 */
export const EXTRA_PERSON_PER_NIGHT_GROSS: VndAmount = 600_000n;

/**
 * What a Friday or Saturday night costs against a weeknight — §3.
 *
 * A multiplier the seed applies when it writes the rows, and never a rule the
 * query knows. `rate_calendar` holds one price per type per night precisely so
 * a public holiday falling on a Tuesday can be priced as a weekend by editing
 * data; a query that derived the uplift from the day of the week would make
 * that an impossible request.
 */
export const WEEKEND_UPLIFT_PERCENT = 25;

/**
 * One row of §6's service catalog.
 *
 * `unitPriceGross` is `null` for an item nobody has costed. That is §6's own
 * state — two of eight priced, six still ⚑ unset and blocking nothing — and it
 * is carried into the seed rather than filled in, because a figure invented
 * here would be invoiced. The gross is per one of whatever the item is counted
 * in; §6 quotes breakfast per person per night and an extra bed per night, and
 * qualifies neither of the six it has not priced.
 */
export interface ServiceItemSeed {
  readonly code: string;
  readonly name: string;
  readonly unitPriceGross: VndAmount | null;
  readonly taxClass: (typeof TAX_CLASSES)[number];
}

/**
 * §6's eight items, seeded thin on purpose: "`P3-SVC` needs the posting path
 * proven, not a real menu".
 *
 * Every item carries a tax class because §5 says each one does, and every item
 * carries the same one because §6 assigns none and `system_config` prices
 * exactly one rate. A row that named a class the configuration cannot resolve
 * would post a line no rate applies to.
 *
 * The names are §6's own, in §6's order. Breakfast reads
 * `BREAKFAST_PER_PERSON_GROSS`, the same constant `RATE_PLANS` gives `BB` —
 * see the argument there for why one paragraph feeds two tables.
 */
export const SERVICE_CATALOG: readonly ServiceItemSeed[] = [
  {
    code: "BREAKFAST",
    name: "Breakfast",
    unitPriceGross: BREAKFAST_PER_PERSON_GROSS,
    taxClass: "STANDARD",
  },
  {
    code: "LAUNDRY",
    name: "Laundry",
    unitPriceGross: null,
    taxClass: "STANDARD",
  },
  {
    code: "MINIBAR",
    name: "Minibar",
    unitPriceGross: null,
    taxClass: "STANDARD",
  },
  {
    code: "AIRPORT_TRANSFER",
    name: "Airport transfer",
    unitPriceGross: null,
    taxClass: "STANDARD",
  },
  {
    code: "LATE_CHECKOUT",
    name: "Late checkout",
    unitPriceGross: null,
    taxClass: "STANDARD",
  },
  // ⚑ Proposed — §6, per night. What it does *not* settle is §9's question:
  // when a bed is mandatory, and whether this line stacks with or replaces the
  // extra-person charge, is the owner's and no posting path may infer it.
  {
    code: "EXTRA_BED",
    name: "Extra bed",
    unitPriceGross: 350_000n,
    taxClass: "STANDARD",
  },
  {
    code: "SPA_TREATMENT",
    name: "Spa treatment",
    unitPriceGross: null,
    taxClass: "STANDARD",
  },
  {
    code: "LOCAL_TOUR",
    name: "Local tour",
    unitPriceGross: null,
    taxClass: "STANDARD",
  },
];

/** How far ahead the calendar is opened for sale — `FR-INV-05`'s 12 months. */
export const CALENDAR_MONTHS = 12;

/** Synthetic bookings the seed writes — `FR-INV-05`. */
export const SYNTHETIC_BOOKINGS = 500;

/**
 * The email domain every seeded guest gets.
 *
 * It is what makes the seed re-runnable without touching a real account: the
 * wipe deletes guests at this domain and nothing else, so a database that has
 * both seeded demo data and somebody's actual sign-in keeps the second.
 * `.local` is reserved and can never be registered, so a seeded address cannot
 * accidentally reach a person.
 */
export const SEED_EMAIL_DOMAIN = "seed.mariva.local";

/**
 * The room numbers §1 specifies — `<floor><nn>`, ten a floor, floors 2 to 5.
 *
 * Generated rather than listed, so the four floors and the ten rooms are stated
 * once each. §1's acceptance is that every number exists exactly once, and a
 * literal list of forty is forty chances to typo one of them.
 */
export function roomNumbers(): readonly { number: string; floor: number }[] {
  return GUEST_FLOORS.flatMap((floor) =>
    Array.from({ length: ROOMS_PER_FLOOR }, (_, index) => ({
      number: `${floor}${String(index + 1).padStart(2, "0")}`,
      floor,
    })),
  );
}
