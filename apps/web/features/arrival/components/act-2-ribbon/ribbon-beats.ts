import { CHECK_IN_TIME, CHECK_OUT_TIME } from "@mariva/shared";
import { ROOM_COUNT_IN_WORDS } from "@/features/arrival/content/house-facts";
import { arrivalImages } from "@/features/arrival/lib/image-manifest";
import type { ApertureGeometry, Knot } from "./ribbon-geometry";

// Scene distance and scroll distance are deliberately different. Long holds
// belong to the camera, not to empty ivory between the photographs.
export const SCENE_LENGTH = 650;
export const RIBBON_LENGTH = 1370;
export const MOBILE_LENGTH = 965;

export interface RibbonImage {
  src: string;
  width: number;
  height: number;
  tiers: readonly number[];
  alt: string;
}
const generated = (name: string, alt: string): RibbonImage => ({
  src: `/images/act-2-ribbon/${name}-1536.webp`,
  width: 1536,
  height: 1024,
  tiers: [768, 1536],
  alt,
});
export const HORIZON = generated(
  "horizon",
  "Sunlit limestone terrace overlooking a rocky island and the blue sea.",
);
const BEDROOM = generated(
  "bedroom",
  "A linen-covered bed beside open doors looking out over the sea.",
);
const TABLE = generated(
  "table",
  "Pasta, fresh bread and a glass of wine on a table in dappled afternoon light.",
);
const pool = arrivalImages["act-2-chapters"];

export interface Aperture extends ApertureGeometry {
  widthVw: number;
  image: RibbonImage;
  nextImage?: RibbonImage;
}
export interface Beat {
  id: string;
  index?: string;
  label: string;
  y: number;
  x: number;
  lines: readonly string[];
  note?: string;
  facts?: readonly string[];
  onPhoto?: boolean;
  action?: boolean;
  aperture?: Aperture;
}

export const BEATS: readonly Beat[] = [
  {
    id: "light",
    index: "01",
    label: "A different perspective",
    y: 15.7,
    x: 56,
    lines: ["A different", "perspective."],
    note: "Coastal living reimagined.",
    aperture: {
      y: 18,
      dx: 14.5,
      r: 26,
      widthVw: 21.6,
      shape: "circle",
      image: arrivalImages["act-2-orbit"].find((image) =>
        image.src.includes("/tea-terrace-sunset-"),
      )!,
    },
  },
  {
    id: "rooms",
    index: "02",
    label: "Rooms",
    y: 140,
    x: 6,
    lines: ["Space to", "stay awhile."],
    note: `${ROOM_COUNT_IN_WORDS} rooms. Find a space that feels like yours.`,
    aperture: {
      y: 140,
      dx: 14,
      r: 36,
      widthVw: 65,
      shape: "organic",
      seed: 0.8,
      image: BEDROOM,
    },
  },
  {
    id: "water",
    label: "A quieter rhythm",
    y: 235,
    x: 8,
    lines: ["The day", "slows down", "here."],
    onPhoto: true,
    note: "Stay with the view a little longer.",
  },
  {
    id: "table",
    index: "03",
    label: "At the table",
    y: 335,
    x: 65,
    lines: ["Good food.", "Unhurried", "company."],
    note: "Bread, salt, and time around the table.",
    aperture: {
      y: 335,
      dx: -16,
      r: 35,
      widthVw: 53,
      shape: "organic",
      seed: 2.1,
      image: TABLE,
    },
  },
  {
    id: "stay",
    index: "04",
    label: "More than a stay",
    y: 438,
    x: 8,
    lines: ["A place", "to return to."],
    facts: [`Check in ${CHECK_IN_TIME}`, `Check out ${CHECK_OUT_TIME}`],
    action: true,
    aperture: {
      y: 438,
      dx: 14,
      r: 34,
      widthVw: 54,
      shape: "organic",
      seed: -0.35,
      image: pool.find((image) => image.src.includes("/pool-hills-day-"))!,
      nextImage: pool.find((image) => image.src.includes("/ocean-pool-dusk-"))!,
    },
  },
  {
    id: "horizon",
    label: "Mariva",
    y: 588,
    x: 66,
    lines: ["Let the horizon", "hold you."],
    action: true,
  },
];

// Large lobes hold a photograph and its heading together. Narrow, diagonal
// necks expose the darker ground and point toward the following chapter.
export const KNOTS: readonly Knot[] = [
  // A full-width tidal crest separates the acts before the ribbon turns.
  { y: -100, cx: 70, w: 88 },
  { y: 18, cx: 70, w: 88 },
  { y: 52, cx: 81.5, w: 65 },
  { y: 82, cx: 60, w: 91 },
  { y: 107, cx: 49, w: 112 },
  { y: 140, cx: 49, w: 112 },
  { y: 178, cx: 56, w: 104 },
  { y: 200, cx: 78, w: 56 },
  { y: 232, cx: 91, w: 31 },
  { y: 267, cx: 88, w: 38 },
  { y: 294, cx: 66, w: 76 },
  { y: 316, cx: 49, w: 111 },
  { y: 346, cx: 49, w: 111 },
  { y: 372, cx: 41, w: 93 },
  { y: 398, cx: 44, w: 102 },
  { y: 436, cx: 49, w: 114 },
  { y: 467, cx: 59, w: 98 },
  { y: 494, cx: 80, w: 61 },
  { y: 520, cx: 103, w: 30 },
  { y: 542, cx: 116, w: 0 },
  { y: SCENE_LENGTH, cx: 116, w: 0 },
];
export const KNOTS_NARROW: readonly Knot[] = [
  { y: -100, cx: 50, w: 124 },
  { y: -40, cx: 50, w: 124 },
  { y: 20, cx: 50, w: 124 },
  { y: 48, cx: 50, w: 88 },
  { y: 510, cx: 50, w: 88 },
  { y: 550, cx: 74, w: 58 },
  { y: 575, cx: 112, w: 0 },
  { y: SCENE_LENGTH, cx: 112, w: 0 },
];
