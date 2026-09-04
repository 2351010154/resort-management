// The three rituals chapter 5 reads down the page, and the only content source
// for them. Cut from the eight the dropped experience field carried: eight cards
// spun past a reader who could not have said afterwards what any of them was,
// and six of the eight only existed to fill a wheel.
//
// The order is the order of the evening, and the order chapter 5 renders: the
// spa, one thing to go out and do, and the kitchen coming to the door. It is no
// longer load-bearing for navigation — the island menu and the turndown footer
// aim at chapters now, by `[data-act]`, and nothing addresses an experience by
// index any more.
//
// ⚑ **The house publishes none of this.** `docs/architecture/property-and-tariff.md`
// describes the building, the clock and the tariff. It names no spa, no
// excursion and no room-service window, so there is no authority in the repo for
// an hour or a length here, and `design-foundations.md` §6 forbids a component
// inventing one. Every optional field below is therefore absent rather than
// guessed, the notes state nothing that is not either the name restated or a row
// of §1, and chapter 5 prints one honest line and a link where an hour would go.
// Filling `time` and `duration` when the property publishes them is the whole of
// the work.
//
// `plate` names the photograph an entry stands on today. The house has no
// experience library cut yet; these are the nearest frames already prepared for
// the arrival. The image manifest is generated from a source library outside the
// repo, so replacing a photograph is a change to this one field.

import { GUEST_FLOORS } from "@/features/arrival/content/house-facts";
import { arrivalImages } from "@/features/arrival/lib/image-manifest";

type PlateGroup = "act-4-rooms" | "nav-island";

export interface Experience {
  slug: string;
  name: string;
  /** One line, and only where one can be written that claims nothing the
   *  property has not stated. Absent otherwise: a name with no line under it
   *  says less than an invented line, and everything it says is true. */
  note?: string;
  /** Where it happens — `property-and-tariff.md` §1, or absent. */
  place?: string;
  /** Its window, 24-hour. No authority exists for one today. */
  time?: string;
  /** How long it runs. No authority exists for one today. */
  duration?: string;
  plate: { group: PlateGroup; match: string };
}

export const EXPERIENCES: Experience[] = [
  {
    slug: "wellness-spa",
    name: "Wellness Spa",
    plate: { group: "nav-island", match: "island-restore" },
  },
  {
    slug: "cultural-excursions",
    name: "Cultural Excursions",
    plate: { group: "act-4-rooms", match: "room-table" },
  },
  {
    slug: "in-room-dining",
    name: "In-Room Dining",
    // The name, restated: it says what the service is and claims nothing about
    // when it runs.
    note: "The kitchen comes to your door.",
    // §1: the kitchen is on the ground floor and the guest floors are 2–5, so
    // where this one happens is a fact the property file already holds.
    place: `Your room, on floors ${GUEST_FLOORS}`,
    plate: { group: "act-4-rooms", match: "room-lantern" },
  },
];

/** The photograph a card stands on. Throws at module scope if a plate names a
 *  frame the manifest does not carry, which is the only useful moment to find
 *  out — a card silently drawing nothing is a hole in the composition. */
export const experiencePlate = (experience: Experience) => {
  const { group, match } = experience.plate;
  const image = arrivalImages[group].find((img) => img.src.includes(match));
  if (!image) {
    throw new Error(`No ${group} image matching "${match}"`);
  }
  return image;
};
