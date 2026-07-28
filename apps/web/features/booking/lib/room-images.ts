// The five room leads, and the tier helpers for them.
//
// Written by hand, and deliberately **not** generated. `design-foundations.md`
// §7 records the same reasoning for the `/login` plates: they live under
// `public/images/auth/` and are referenced by hand, because
// `scripts/prepare-arrival-images.mjs` curates the *arrival's* library and
// writes the *arrival's* manifest — sweeping a booking image into it would put
// a `features/arrival/` import in the funnel's path, which §5's bundle budget
// forbids outright. Nothing under `features/booking/` may import from
// `features/arrival/`, and that includes `lib/image-srcset.ts`, so the two tier
// helpers below are the funnel's own six lines rather than a shared third
// module nobody asked for.
//
// **One difference from the plates: these are content.** A photograph of a room
// is what the guest is choosing between, so its `alt` is meaningful and is never
// `""`. It also does not repeat the room's name: the name is rendered beside the
// frame inside the same button, and again as the room sheet's title, so an
// `alt` beginning "Junior Suite," makes a screen reader say it twice.
//
// ---
//
// **These five frames are interim.** The shoot the design needs does not exist.
// Each entry below is a file copied out of the arrival's `act-4-rooms` library
// and renamed to the type it stands for:
//
//   SUPERIOR        <- room-cedar        the one true bed-from-the-door frame
//   DELUXE          <- room-mori         opens onto planting — the garden aspect
//   PREMIER         <- room-premier      dusk above the city — the city aspect
//   JUNIOR_SUITE    <- room-park         corner over the park — the corner aspect
//   PANORAMA_SUITE  <- room-sky-lounge   the widest daylight frame available
//
// Two of the five are not bedrooms and none of them is a sea view. They prove
// the layout, not the hotel.
//
// **The acceptance test the real shoot has to pass, before these are swapped
// out:** print the five leads as a contact sheet, cover every word of text on
// it, and hand it to somebody. A 28 m² courtyard room and a 68 m² sea-view
// suite must be tellable apart at a glance. That only happens if the five are
// shot as a *set* — same focal length, same eye height, same time of day, same
// bed dressing, same position relative to the door — so that the room is the
// only thing that changes between frames. Five good photographs that are not a
// set fail this test.
//
// **The swap.** Export each room at the tiers below, drop the files into
// `public/images/booking/rooms/` under the same names, and correct `width`,
// `height`, `tiers` and `alt` here. No consumer changes: the card, the sheet
// and the gallery all read this module and nothing else.
//
// A tier's number is the file's **real** pixel width, not the width it was
// asked for — the suffix and the `srcSet` descriptor are the same number, so
// the browser is never told a file is larger than it is. Two of the interim
// frames were cropped portrait or square in the arrival and so land at 1520 and
// 1160 rather than 1920; a 3:2 export of the real shoot will not.

import type { RoomTypeCode } from "@mariva/shared";

export interface RoomImage {
  /** Path of the largest tier, under `public/`. */
  readonly src: string;
  /** Intrinsic size of `src`. */
  readonly width: number;
  readonly height: number;
  /** Available widths; swap the trailing `-<w>.webp` to pick one. */
  readonly tiers: readonly number[];
  /** Meaningful — never `""`, and never the room's name. See the header. */
  readonly alt: string;
}

export const ROOM_IMAGES: Readonly<Record<RoomTypeCode, RoomImage>> = {
  SUPERIOR: {
    src: "/images/booking/rooms/superior-1520.webp",
    width: 1520,
    height: 2000,
    tiers: [1520, 1280, 640],
    alt: "A vaulted cedar ceiling, and morning light across the bed.",
  },
  DELUXE: {
    src: "/images/booking/rooms/deluxe-1920.webp",
    width: 1920,
    height: 1186,
    tiers: [1920, 1280, 640],
    alt: "A pale room opening full-width onto planting.",
  },
  PREMIER: {
    src: "/images/booking/rooms/premier-1160.webp",
    width: 1160,
    height: 1160,
    tiers: [1160, 640],
    alt: "Dusk above the city, the lamps lit low.",
  },
  JUNIOR_SUITE: {
    src: "/images/booking/rooms/junior-suite-1920.webp",
    width: 1920,
    height: 1186,
    tiers: [1920, 1280, 640],
    alt: "The corner window, looking over the park canopy to the city.",
  },
  PANORAMA_SUITE: {
    src: "/images/booking/rooms/panorama-suite-1920.webp",
    width: 1920,
    height: 1186,
    tiers: [1920, 1280, 640],
    alt: "Low seating against a wall of daylight.",
  },
};

export function roomImage(code: RoomTypeCode): RoomImage {
  return ROOM_IMAGES[code];
}

/** One tier's path. The suffix is the tier, so picking one is a filename swap. */
export function tierSrc(src: string, width: number): string {
  return src.replace(/-\d+\.webp$/, `-${width}.webp`);
}

/** Full `srcSet`, so the browser picks by layout width and pixel density. */
export function tierSrcSet(image: Pick<RoomImage, "src" | "tiers">): string {
  return [...image.tiers]
    .sort((left, right) => left - right)
    .map((width) => `${tierSrc(image.src, width)} ${width}w`)
    .join(", ");
}
