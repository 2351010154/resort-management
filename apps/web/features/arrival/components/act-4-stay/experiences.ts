// The eight experiences the field carries, and the order the two columns take
// them in: the left column runs the even indices, the right column the odd, so
// a pair is (2q, 2q+1) and no experience is ever on screen twice.
//
// The order is load-bearing beyond the composition. `experienceScrollTarget`
// aims the island menu and the turndown footer at an index, and those two call
// sites name 6 (Restore) and 7 (Dine) directly — an experience moved out of
// those slots takes a navigation destination with it.
//
// `plate` names the photograph a card stands on today. The house has no
// experience library cut yet; these are the nearest frames already prepared for
// the arrival, held here until the real ones are shot. The image manifest is
// generated from a source library outside the repo, so replacing a photograph
// is a change to this one field and to nothing else.

import { arrivalImages } from "@/features/arrival/lib/image-manifest";

type PlateGroup = "act-4-rooms" | "nav-island";

export interface Experience {
  slug: string;
  name: string;
  note: string;
  plate: { group: PlateGroup; match: string };
}

export const EXPERIENCES: Experience[] = [
  {
    slug: "signature-breakfast",
    name: "Signature Breakfast",
    note: "Served until eleven, wherever you are.",
    plate: { group: "act-4-rooms", match: "room-mori" },
  },
  {
    slug: "infinity-pool",
    name: "Infinity Pool",
    note: "Still water facing the bay, warm until late.",
    plate: { group: "act-4-rooms", match: "room-bath" },
  },
  {
    slug: "lobby-lounge",
    name: "The Lobby Lounge",
    note: "Tea at four. The last table stays lit.",
    plate: { group: "act-4-rooms", match: "room-autumn" },
  },
  {
    slug: "fitness-studio",
    name: "Fitness Studio",
    note: "Open through the night, for the early hour.",
    plate: { group: "act-4-rooms", match: "room-sky-lounge" },
  },
  {
    slug: "cultural-excursions",
    name: "Cultural Excursions",
    note: "A boat, a market, a temple. Back by dusk.",
    plate: { group: "act-4-rooms", match: "room-washigamine" },
  },
  {
    slug: "signature-massage",
    name: "Signature Massage",
    note: "Ninety minutes, oils pressed on the ridge.",
    plate: { group: "act-4-rooms", match: "room-onsen" },
  },
  {
    slug: "wellness-spa",
    name: "Wellness Spa",
    note: "Thermal stone, open at six, warm until ten.",
    plate: { group: "nav-island", match: "island-restore" },
  },
  {
    slug: "in-room-dining",
    name: "In-Room Dining",
    note: "The kitchen comes to your door until midnight.",
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
