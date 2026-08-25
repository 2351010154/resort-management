// The five room galleries, and the tier helpers for them.
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
// The files themselves are cut by `scripts/prepare-room-images.mjs` from the
// picks in `scripts/room-curation-map.json`. **The script is gitignored and the
// map is not**: it reads a library outside the repo, so what it produced is
// versioned and it is not, while the map stays as the record of which frame
// became which slug — the part a later reader needs. What that script does not write is
// the `alt` below: a photograph of a room is content, its description is
// writing, and writing belongs beside the rest of the funnel's words.
//
// **One difference from the plates: these are content.** A photograph of a room
// is what the guest is choosing between, so its `alt` is meaningful and is never
// `""`. It also does not repeat the room's name: the name is rendered beside the
// frame in the list, and again on the stage, so an `alt` beginning "Junior
// Suite," makes a screen reader say it twice.
//
// ---
//
// **A gallery per room now, not a lead.** The room was one photograph for as
// long as the sheet behind `View details` was the only place a second frame
// could have gone, and a one-slide carousel reading "1 / 1" is a control that
// reads as broken. The stage shows a room at the size of the window; one frame
// of a bed cannot answer what a 68 m² suite *is*, and five rooms that each show
// one bed are five rooms that look the same. So each type carries four to six
// frames and the room is read by walking them.
//
// **The set is one property, one shoot, one palette** — a warm taupe interior
// with washi screens, bronze and dark stone. That is the acceptance test these
// frames were picked against: print them as a contact sheet, cover every word of
// text, and hand it to somebody. A 28 m² room and a 68 m² suite must be tellable
// apart at a glance, and they are, because the galleries themselves ascend — a
// bed close, a bed with a bath, a bed with a city and a desk, a bedroom with a
// sitting room, and then a living room, a dining room, a bedroom, a bath and a
// study.
//
// **What the set still fails.** The aspect words are not honoured. This property
// has a city outside its windows and nothing else: `courtyard`, `garden` and
// `sea` are not in the library at all, and the frames chosen for those three
// types were chosen to show no outlook rather than the wrong one — nothing on
// screen contradicts the word, and nothing confirms it either. `city` is the one
// aspect the frames actually carry. That is a photography brief, not a code
// change, and `room-types.ts` already flags the aspect words as ⚑ pending.
//
// **The swap.** Name new picks in `room-curation-map.json`, run the script, and
// correct the `alt` lines here. No consumer changes: the list and the stage read
// this module and nothing else.

import type { RoomTypeCode } from "@mariva/shared";

/**
 * The three widths every frame is cut at.
 *
 * One constant rather than a field per frame, because every frame *is* the same
 * shape now — the script crops each master to 3:2 before it scales, so 640
 * covers a phone, 1280 a laptop and 1920 the stage at two device pixels, for all
 * twenty-seven of them. A tier's number is the file's **real** pixel width: the
 * suffix and the `srcSet` descriptor are the same number, so the browser is
 * never told a file is larger than it is.
 */
export const ROOM_TIERS: readonly number[] = [1920, 1280, 640];

/** Intrinsic size of every largest tier — a 3:2 cut scaled to 1920 wide. */
const FRAME_WIDTH = 1920;
const FRAME_HEIGHT = 1280;

export interface RoomFrame {
  /** Path of the largest tier, under `public/`. */
  readonly src: string;
  /** Intrinsic size of `src`. */
  readonly width: number;
  readonly height: number;
  /** Meaningful — never `""`, and never the room's name. See the header. */
  readonly alt: string;
}

/** One slug and its description; the paths and sizes are filled in below. */
function frame(slug: string, alt: string): RoomFrame {
  return {
    src: `/images/booking/rooms/${slug}-${FRAME_WIDTH}.webp`,
    width: FRAME_WIDTH,
    height: FRAME_HEIGHT,
    alt,
  };
}

/**
 * The galleries, in the order the stage walks them.
 *
 * **The first frame is the lead** — it is what the list row shows as a thumbnail
 * and what the stage opens on, so it is the frame that has to tell this room
 * from the other four on its own. Everything after it answers "and what else is
 * in here".
 */
export const ROOM_GALLERIES: Readonly<
  Record<RoomTypeCode, readonly RoomFrame[]>
> = {
  SUPERIOR: [
    frame(
      "superior-1",
      "A bed between folding lattice screens, with a low bench at its foot.",
    ),
    frame(
      "superior-2",
      "A bed under two paper-shaded lamps, a long bench across its foot.",
    ),
    frame(
      "superior-3",
      "A bed between two shaded windows, with a side table and a lamp.",
    ),
    frame(
      "superior-4",
      "A writing desk against a washi wall, with a chair and one vase.",
    ),
    frame(
      "superior-5",
      "A round copper bath in a wood alcove, with a floor-standing tap.",
    ),
  ],
  DELUXE: [
    frame(
      "deluxe-1",
      "A bed under two shaded lamps, with a bench and windows to one side.",
    ),
    frame(
      "deluxe-2",
      "A low bed with an upholstered headboard, in a pale, quiet room.",
    ),
    frame(
      "deluxe-3",
      "A bed beside folding screens standing open to the bath behind it.",
    ),
    frame(
      "deluxe-4",
      "A freestanding bath between lattice screens, on a long stone counter.",
    ),
    frame(
      "deluxe-5",
      "A round table and two armchairs in the window, beside a banquette.",
    ),
  ],
  PREMIER: [
    frame(
      "premier-1",
      "A bed facing a corner window, with towers standing beyond the glass.",
    ),
    frame(
      "premier-2",
      "A bed beside a glass-sided fire, with the city through the window.",
    ),
    frame(
      "premier-3",
      "A writing desk set into the window, with towers beyond it.",
    ),
    frame(
      "premier-4",
      "An oval bath on dark stone, with planting at either end of it.",
    ),
    frame(
      "premier-5",
      "A table and two chairs at the window, beside an open fire.",
    ),
  ],
  JUNIOR_SUITE: [
    frame(
      "junior-suite-1",
      "A bed between two windows, with a long fire set into the wall.",
    ),
    frame(
      "junior-suite-2",
      "A bed against wide glazing, with a daybed along the window.",
    ),
    frame(
      "junior-suite-3",
      "A chaise longue drawn up to the window, under a single painting.",
    ),
    frame(
      "junior-suite-4",
      "A sofa with two side tables, beside a glass-sided fire.",
    ),
    frame(
      "junior-suite-5",
      "Folding screens standing open onto a bath and a stone counter.",
    ),
    frame(
      "junior-suite-6",
      "A sitting room under a carved relief, with chairs and a long desk.",
    ),
  ],
  PANORAMA_SUITE: [
    frame(
      "panorama-suite-1",
      "Two sofas facing across a low table, under a scroll and tall windows.",
    ),
    frame(
      "panorama-suite-2",
      "A curved sofa around a low table, with an olive tree in the corner.",
    ),
    frame(
      "panorama-suite-3",
      "A dining table under two drum pendants, with a console behind it.",
    ),
    frame(
      "panorama-suite-4",
      "A bed and a writing desk, in a room of wide shaded windows.",
    ),
    frame(
      "panorama-suite-5",
      "A stone bath in a marble alcove, with a tray on a low table.",
    ),
    frame(
      "panorama-suite-6",
      "A study lined with shelves, opening through a lit screen.",
    ),
  ],
};

/** Every frame of one room, in the order the stage walks them. */
export function roomGallery(code: RoomTypeCode): readonly RoomFrame[] {
  return ROOM_GALLERIES[code];
}

/** The frame that has to tell this room from the other four on its own. */
export function roomLead(code: RoomTypeCode): RoomFrame {
  return ROOM_GALLERIES[code][0];
}

/**
 * A second look at the room, for a screen already showing the lead.
 *
 * The review screen prints two frames — a wide strip under the facts and the
 * summary's own 16:9 — and until this existed both were {@link roomLead}. On a
 * phone, where the two columns stack, that put the identical photograph twice on
 * one page about seven hundred pixels apart, which reads as a rendering fault
 * rather than as a gallery.
 *
 * Falls back to the lead, because "every type carries four to six frames" is
 * true of the five galleries above and is not a guarantee the type system makes.
 * A room curated down to one frame gets the repetition back rather than an
 * exception.
 */
export function roomSecond(code: RoomTypeCode): RoomFrame {
  const gallery = ROOM_GALLERIES[code];

  return gallery[1] ?? gallery[0];
}

/** One tier's path. The suffix is the tier, so picking one is a filename swap. */
export function tierSrc(src: string, width: number): string {
  return src.replace(/-\d+\.webp$/, `-${width}.webp`);
}

/** Full `srcSet`, so the browser picks by layout width and pixel density. */
export function tierSrcSet(frame: Pick<RoomFrame, "src">): string {
  return [...ROOM_TIERS]
    .sort((left, right) => left - right)
    .map((width) => `${tierSrc(frame.src, width)} ${width}w`)
    .join(", ");
}
