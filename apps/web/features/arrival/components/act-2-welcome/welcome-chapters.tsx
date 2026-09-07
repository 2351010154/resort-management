"use client";

// Act 2, second half: six ruled chapters on the same wall and under the same
// foliage shadow. Each chapter moves through one continuous vertical passage;
// only the window and the closing lens hold for a beat.

import {
  CHECK_IN_TIME,
  CHECK_OUT_TIME,
  PROPERTY_ADDRESS_LINES,
} from "@mariva/shared";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useRef } from "react";
import { ApertureFrame } from "@/features/arrival/components/aperture/aperture-frame";
import { ChooseDatesLink } from "@/features/arrival/components/booking/choose-dates-link";
import {
  Drift,
  DriftFrame,
  DriftImage,
} from "@/features/arrival/components/vocabulary/drift";
import {
  GUEST_FLOORS,
  ROOM_COUNT_IN_WORDS,
} from "@/features/arrival/content/house-facts";
import { arrivalImages } from "@/features/arrival/lib/image-manifest";
import { tierSrc, tierSrcSet } from "@/features/arrival/lib/image-srcset";
import { registerArrivalEases } from "@/features/arrival/lib/motion-eases";
import { prefersReducedMotion } from "@/features/arrival/lib/webgl-support";
import { ROOM_TYPES } from "@/features/booking/lib/room-types";
import {
  DUR_ENTER,
  DUR_EXIT,
  DUR_SCENE_SLOW,
  EASE_ENTER,
  STAGGER_CASCADE,
} from "@/lib/motion-tokens";
import styles from "./act-2-welcome.module.css";

const CONVERGE = arrivalImages["act-1-converge"];
const ROOMS = arrivalImages["act-4-rooms"];
/** Landscapes cut wide enough to carry a whole page width on their own — the
 *  only set in the manifest that can, which is why the bled chapter draws from
 *  it rather than from the room and detail crops the other two are built out of. */
const PLATES = arrivalImages["act-2-chapters"];

type ManifestImage = (typeof arrivalImages)[keyof typeof arrivalImages][number];

const bySlug = <T extends { src: string }>(set: readonly T[], slug: string) =>
  set.find((img) => img.src.includes(`/${slug}-`))!;

/** Indent of a display line, in em of its own size. */
type Line = readonly [text: string, indent: number];

/** A tile's place in its archetype, and its class key in the stylesheet. */
type Slot = "frame" | "portal" | "bleed";

/**
 * Which way a seam travels. Physical, not logical: `clip-path: inset()` is
 * measured against the box's physical edges and is not mirrored by the
 * `direction: rtl` that flips a left-side panel, so "rightward" means rightward
 * on every panel.
 */
type Seam = "down" | "up" | "rightward" | "leftward";

/**
 * Where along a chapter's passage something happens, in heights of the
 * viewport the chapter's top mark has travelled up from the bottom edge of the
 * screen. 0 is the chapter's top edge appearing at the foot of the screen, 1 is
 * that edge reaching the top of the screen, 1.5 is it half a screen above.
 *
 * Every scroll range in the act is written in this unit and nothing else, so a
 * seam on the bled plate and a wipe on the table are placed on one scale and
 * a chapter's beats can be read off its data as a sequence. It is a distance
 * of wheel, not a time: the reader sets the pace.
 */
type Travel = number;

/**
 * The second photograph a tile turns over to across the chapter's passage. The
 * seam is the reader's to pull: scrolling down advances it, scrolling back up
 * uncrosses it, and it is placed on the chapter's own scale — `at` is where it
 * starts and `dur` how much travel it takes to cross. A seam that reads as too
 * quick is long here, and nowhere else.
 */
interface Flip {
  image: ManifestImage;
  seam: Seam;
  at: Travel;
  dur: Travel;
}

interface Tile {
  slot: Slot;
  image: ManifestImage;
  /** Set when this tile turns over. A tile without one is a plain photograph. */
  flip?: Flip;
}

interface ChapterBase {
  index: string;
  /** Which side the photographs take. Alternates down the act. */
  side: "right" | "left";
  rail: string;
  /**
   * How much of the passage the chapter takes, in viewport heights. Written
   * onto the chapter as its minimum height (`--travel`); a chapter is exactly
   * this tall on a desktop and takes its own height on a phone.
   */
  travel: number;
  /**
   * Where the chapter's time-based entrance plays — the reading rising, the
   * photographs settling. Placed where the reading actually sits: a chapter
   * whose reading is under a wide opening lands later than one that opens on
   * its headline.
   */
  landAt: Travel;
}

/** A chapter built out of tiles: a ragged display line beside a composition of
 *  photographs, each of which may turn over during the passage. */
interface TiledChapter extends ChapterBase {
  arch: "portal" | "bleed";
  lines: readonly Line[];
  body: string;
  caption: string;
  tiles: readonly Tile[];
}

/**
 * The chapters whose composition is one grid drawn in the type layer rather
 * than a stack of tiles — the table, the window, the diptych and the pause.
 * None carries tiles; each is rendered by a composition of its own below.
 */
interface OpeningChapter extends ChapterBase {
  arch: "table" | "window" | "diptych" | "pause";
}

type Chapter = TiledChapter | OpeningChapter;

const tiled = (chapter: Chapter): chapter is TiledChapter =>
  chapter.arch === "portal" || chapter.arch === "bleed";

/**
 * Every fact in these sentences is `docs/architecture/property-and-tariff.md`
 * §1: the ground floor holds the lobby, the F&B and the back of house; the
 * forty rooms are on guest floors 2–5. Neither the count nor the street is
 * typed here — the count is `house-facts.ts` and the street is the address
 * `@mariva/shared` prints, so this panel's note cannot come apart from the
 * footer's or the mail's.
 */
const DINING_ROOM_NOTE =
  `The dining room stands on the ground floor at ${PROPERTY_ADDRESS_LINES[0]}, ` +
  "beside the lobby, with the kitchen and the back of house behind it. It " +
  `serves the ${ROOM_COUNT_IN_WORDS.toLowerCase()} rooms above it. The guest ` +
  "floors begin one storey up.";

/**
 * What the service row says, and why it says nothing more. §1 places the food
 * and beverage on the ground floor and stops there: it names no venue, no
 * covers and no service window, and §2's clock is the arrival and departure
 * clock, not a kitchen's. So the panel prints where the hours do reach a guest
 * and hands them the address they reach them at, rather than a breakfast hour
 * nobody has decided.
 */
const DINING_SERVICE_UNPUBLISHED = "Hours published at booking";

const TABLE_WIDE = bySlug(CONVERGE, "terrace-lunch-sea");
const TABLE_TALL = bySlug(CONVERGE, "patisserie-bread");

/**
 * The window's coordinate system, and the two paths cut in it.
 *
 * The wall is drawn as one SVG the size of the composition, and the opening is
 * a second subpath inside the same `d` under `fill-rule: evenodd` — so the
 * plaster is a single filled shape with a hole in it rather than a picture with
 * something laid over it. That is what makes the depth possible: a CSS
 * `drop-shadow` on this element follows the silhouette it actually has, hole
 * included, and drops a shadow from the inside edge of the cut onto whatever is
 * behind it. An `inset` box-shadow follows the border box and would draw a
 * rectangle across the middle of the picture.
 *
 * `preserveAspectRatio="none"` because the element is given this viewBox's own
 * aspect in the stylesheet; the mark is never stretched, and the rect is
 * guaranteed to reach all four edges at any size.
 */
const WINDOW_VIEW_BOX = "0 0 1000 660";
const WINDOW_WALL = "M0 0H1000V660H0Z";

/**
 * The opening, and the whole idea of the panel: the monogram is the window.
 *
 * Taken off `public/brand/mariva-monogram-intro.svg`, the house's heavy cut of
 * the mark, rather than drawn to look like it. Two things in that mark are
 * measured and reproduced here. Its central V descends about two fifths of the
 * mark's height from the top edge — 220 of the 560 units this opening is tall.
 * And the V is not symmetric: the arm falling from the left runs at about 0.85
 * and the one climbing to the right at about 1.24, which is the mark's own pair
 * and puts the apex at 59% of the notch's span rather than the middle of it.
 * That lean is the difference between the house's mark and a chevron.
 *
 * The sides are the mark's outer strokes leaning back in — a concave sweep on
 * each edge, but a shallow one. The first cut of this shape took the sweep to
 * fifty units and the opening stopped being a window: two shoulders, a deep
 * notch and a waist read as a moth, and the eye finds the insect before it finds
 * the letter. Eighteen units is enough for the plaster to lean and not enough
 * for the silhouette to close. The corners carry a 44-unit radius, the same soft
 * rectangle the arrival's other openings are struck with, so the panel is still
 * the same building.
 */
const WINDOW_OPENING =
  "M174 50 L290 50 L548 270 Q556 278 564 270 L742 50 L826 50 " +
  "Q870 50 870 94 C870 230 852 262 852 330 C852 398 870 430 870 566 " +
  "Q870 610 826 610 L174 610 Q130 610 130 566 " +
  "C130 430 148 398 148 330 C148 262 130 230 130 94 Q130 50 174 50 Z";

/**
 * The house's headline, three lines of it, with one word in italic.
 *
 * It asserts nothing. That is not a stylistic preference: `design-foundations.md`
 * §6 forbids a component inventing a hotel fact, and this is the one line on the
 * panel with no row behind it — so it is written to carry no claim a guest could
 * arrive and find untrue. Everything that is a fact is under it, and every one of
 * those is read from somewhere.
 */
const WINDOW_LINES: readonly (readonly [italic: string, roman: string])[] = [
  ["", "One mark."],
  ["", "One house."],
  ["You", ", inside it."],
];

/**
 * The two sentences under the headline. Both are `property-and-tariff.md` §1 and
 * nothing else: "Rooms: 40" as the word the running type sets it in, "Rooms per
 * floor: 10", "Guest floors: 4, numbered 2–5. Ground floor is lobby, F&B and
 * back-of-house". The count and the floors are read from `house-facts.ts` rather
 * than typed, so this panel cannot come apart from the footer's or the mail's.
 */
const HOUSE_NOTE: readonly string[] = [
  `${ROOM_COUNT_IN_WORDS} rooms stand on guest floors ${GUEST_FLOORS}, ten to a floor.`,
  "Under them the ground floor is lobby, kitchen and back of house.",
];

/**
 * §1, "Room types: 5", as the word the running type sets it in.
 *
 * The word is typed and the count is not: it is read off the list the funnel
 * renders, and the word is only used while the two agree. A sixth type added to
 * `room-types.ts` prints "6 room types" here rather than going on saying five,
 * which is the failure this panel cannot have — every other line on it is read
 * from its own record for the same reason.
 */
const ROOM_TYPE_COUNT_IN_WORDS =
  ROOM_TYPES.length === 5 ? "Five" : `${ROOM_TYPES.length}`;

/** Which glyph a marked fact is drawn with. The stylesheet and the switch below
 *  are the only two places that read it. */
type HouseGlyph = "monogram" | "water" | "hours";

interface HouseMark {
  glyph: HouseGlyph;
  /** Two lines, as the reference sets them: the caption breaks where it means
   *  to rather than where the column runs out. */
  caption: readonly [string, string];
}

/**
 * The three facts on the row, and where each one comes from.
 *
 * Every line is the property's own record, bar one. The first is §1's "Room
 * types: 5", counted off `room-types.ts`. The second is the address
 * `@mariva/shared` prints, in the two lines it already holds — the site and the
 * pre-arrival mail cannot disagree about where the house is. The third is §2's
 * operating clock, both ends of it, read from the same constants the booking
 * review reads back. The exception is "in one house", which is not a fact and
 * is not claiming to be one: it is the second line of a caption whose first line
 * carries the whole of what §1 says.
 *
 * The glyphs are the reference's three, and each is the fact rather than a
 * decoration beside it: the house's own mark for what the house holds, water
 * for the street it stands on, a dial for the hours it keeps.
 */
const HOUSE_MARKS: readonly HouseMark[] = [
  {
    glyph: "monogram",
    caption: [
      // §1, "Room types: 5" — counted off the list the funnel renders rather
      // than typed, so a sixth type is a sixth here too.
      `${ROOM_TYPE_COUNT_IN_WORDS} room types`,
      "in one house",
    ],
  },
  {
    glyph: "water",
    caption: [PROPERTY_ADDRESS_LINES[0], PROPERTY_ADDRESS_LINES[1]],
  },
  {
    glyph: "hours",
    caption: [
      `Rooms open at ${CHECK_IN_TIME}`,
      `asked back at ${CHECK_OUT_TIME}`,
    ],
  },
];

/**
 * What stands behind the cut: the headland at dusk, a horizon across the middle
 * of the frame and open sky above it.
 *
 * Chosen for the shape rather than for the subject. The monogram's V drives
 * nearly halfway down the opening from the top, so whatever is in the upper half
 * of the picture is the half the wall eats — a room interior loses its ceiling
 * and reads as a mistake, and a busy plate read through a notched hole reads as
 * damage. A single horizon under empty sky is the one composition that survives
 * having its top bitten out: the wall takes sky, and the picture keeps its
 * subject. No panel in the act uses this plate.
 */
const WINDOW_PLATE = bySlug(PLATES, "ocean-pool-dusk");

/**
 * The diptych's two hours: the same subject — water in a pool — in the
 * morning and after dark. The pairing is the composition. Two different
 * subjects split by a seam read as a broken layout; one subject at two hours
 * reads as time passing under the reader's hand.
 *
 * The morning plate is bright to its edges and the evening one dark to its,
 * which is what lets the line written over them turn colour at the seam: ink
 * on the day, ivory on the night, and the seam is the only place they meet.
 */
const DIPTYCH_MORNING = bySlug(PLATES, "pool-hills-day");
const DIPTYCH_EVENING = bySlug(CONVERGE, "dark-pool-dusk");

/**
 * The line over the diptych. Written twice in the markup, once in each ink,
 * and the seam's clip decides which copy shows where — see the effect.
 */
const DIPTYCH_LINES: readonly string[] = [
  "The same water,",
  "morning and evening.",
];

/**
 * Two sentences under the diptych, on the ivory beside the slab. The clock is
 * §2's — the same constants the booking review reads back — and the rest
 * claims nothing a guest could arrive and find untrue.
 */
const DIPTYCH_NOTE =
  `The house opens its rooms at ${CHECK_IN_TIME} and asks for them back at ` +
  `${CHECK_OUT_TIME}. Everything between the two is kept at your pace.`;

/**
 * Where the diptych's seam starts and stops, as the share of the frame the
 * morning plate takes. The reader drags it from most of the frame to none of
 * it: the chapter opens on the day and is left on the evening, whole. It used
 * to stop short of the edge so the frame never stopped reading as two
 * photographs, and what that actually read as was a swap that had not
 * finished — a strip of morning still standing at the frame's left when the
 * chapter left the screen. The seam is what the device is; a seam that has
 * run off the edge has been drawn all the way, which is the point of dragging
 * it.
 *
 * It also has to be finished while the frame is still on the screen. The
 * chapter is 1.45 screens tall and the frame stands a fifth of one down it,
 * so anything running past about 1.1 lands with the picture already leaving
 * over the top edge — which is the other half of a swap that reads as
 * unfinished.
 */
const DIPTYCH_SEAM = { from: 74, to: 0, at: 0.25, dur: 0.85 } as const;

/**
 * How far the plates behind the diptych's seam travel, in % of their own
 * width. The morning drifts back as it is covered, the evening arrives a
 * little behind the seam: the flip grammar, sideways.
 */
const DIPTYCH_DRIFT = 5;

/** The pause: no photograph, one line at the centre of the dark screen, and
 *  the opening grows through it. */
const PAUSE_LINES: readonly string[] = ["Let the hour", "find you."];

/**
 * The pause's travel, on the chapter's own scale. The stage pins from 1 (its
 * top at the top of the screen) to `travel`: about a screen of dark with the
 * line on it, then the lens opens over the last stretch — timed so the
 * opening is complete exactly as the pin releases, which is when the bleed's
 * held plate is the whole screen anyway.
 */
const PAUSE = {
  travel: 2.2,
  lensAt: 1.9,
  lensEnd: 2.2,
} as const;

/**
 * The lens at its widest, as a length rather than a share: `clip-path` and
 * masks take no "cover this box" keyword, and the circle has to clear the
 * far corner of a 16:9 screen from its centre — half the diagonal is 0.58 of
 * the long side, so 0.8 of it is clear on any aspect a desktop has.
 */
const LENS_OPEN = "80vmax";

/**
 * How far the bleed is pulled up under the pause, in viewport heights.
 *
 * The pause's stage pins for the pause's travel; the bleed's plate holds
 * still for the bleed's. Overlapping them puts the bleed's plate under the
 * stage — already stuck, already the full screen — before the lens starts, so
 * what the opening reveals is a photograph that is not moving, and when the
 * stage releases there is no seam because nothing under it changes. The
 * figure is what makes that true: the bleed's plate sticks at
 * `1 + PAUSE.travel - BLEED_LEAD` on the pause's scale, which has to be past
 * where it pins and short of `PAUSE.lensAt`. The bleed's reading is pushed
 * down by the same figure (`--hold-lead` in the stylesheet) so it lands after
 * the lens rather than during it.
 */
const BLEED_LEAD = 1.4;

const CHAPTERS: Chapter[] = [
  {
    index: "01",
    side: "left",
    rail: "Rest",
    arch: "portal",
    travel: 1.5,
    landAt: 0.35,
    lines: [
      ["Rooms that keep", 0],
      ["the quiet you", 0],
      ["came for.", 2.4],
    ],
    body:
      "Forty rooms in five kinds, from a Superior on the courtyard to the " +
      "Panorama Suites facing the sea. " +
      "Cedar, linen, and lamplight kept low enough to hear the room. Nothing " +
      "here asks anything of you.",
    caption: "Suites & Villas",
    tiles: [
      {
        slot: "frame",
        image: bySlug(ROOMS, "room-cedar"),
        flip: {
          image: bySlug(ROOMS, "room-premier"),
          seam: "down",
          at: 0.9,
          dur: 0.7,
        },
      },
      {
        slot: "portal",
        image: bySlug(ROOMS, "room-onsen"),
        flip: {
          image: bySlug(ROOMS, "room-washigamine"),
          seam: "down",
          at: 0.55,
          dur: 0.35,
        },
      },
    ],
  },
  {
    index: "02",
    side: "left",
    rail: "Relax",
    arch: "table",
    travel: 1.2,
    landAt: 0.7,
  },
  {
    index: "03",
    side: "left",
    rail: "The house",
    arch: "window",
    travel: 1.4,
    landAt: 0.45,
  },
  {
    index: "04",
    side: "right",
    rail: "Hours",
    arch: "diptych",
    travel: 1.45,
    landAt: 0.4,
  },
  {
    index: "05",
    side: "right",
    rail: "Rejuvenate",
    arch: "pause",
    travel: PAUSE.travel,
    landAt: 0.85,
  },
  {
    index: "06",
    side: "right",
    rail: "Morning",
    arch: "bleed",
    travel: 1.6 + BLEED_LEAD,
    landAt: 0.45 + BLEED_LEAD - 0.5,
    lines: [
      ["The day begins", 0],
      ["somewhere", 1.5],
      ["up the hill.", 3],
    ],
    body:
      "Dawn walks up the cedar steps, a garden three minutes from the kitchen, " +
      "and one table of eight for whatever was picked that morning. You leave " +
      "lighter than you arrived.",
    caption: "Land & Table",
    tiles: [
      {
        slot: "bleed",
        image: bySlug(PLATES, "villa-deck-forest"),
        flip: {
          image: bySlug(PLATES, "garden-pavilion"),
          seam: "up",
          at: 0.9 + BLEED_LEAD,
          dur: 1.1,
        },
      },
    ],
  },
];

const SLOT_CLASS: Record<Slot, string> = {
  frame: styles.slotFrame,
  portal: styles.slotPortal,
  bleed: styles.slotBleed,
};

/** Rendered width of each slot, from its share of the archetype's stack. */
const SLOT_SIZES: Record<Slot, string> = {
  frame: "(max-width: 900px) 88vw, 36rem",
  portal: "(max-width: 900px) 34vw, 13rem",
  // The one slot whose width is the window's.
  bleed: "100vw",
};

/**
 * How far the small details lead the page and the slabs trail it, in per cent
 * of their own height across their passage — the vocabulary's `Drift`. The
 * circle is the quickest thing in the act, and a slab the slowest: what
 * separates the composition into depth is that its three layers pass at three
 * rates, and the reference's contrast device is exactly two neighbours given
 * opposite drifts. A slab is the one thing on the wall taller than the
 * screen, so its figure is small: a per cent of its own height is a long way.
 */
const PORTAL_LEAD = 55;
const SLAB_TRAIL = 3;
const TALL_OPENING_LEAD = 22;

/**
 * Travel of the two photographs behind a seam, in % of the tile's own size,
 * measured off the reference capture: the incoming one arrives a little slower
 * than the seam that uncovers it, and the outgoing one drifts back behind. The
 * two rates are the whole depth of the move — the tile itself never scales.
 */
const FLIP_ENTER = 90;
const FLIP_EXIT = 10;

/**
 * The wide opening's entrance: how far its photograph slides in behind the
 * seam that uncovers it, in % of its own width. Less than a flip's, because
 * there is nothing leaving under it — a plate arriving on a bare wall wants
 * to arrive, not to chase an edge.
 */
const TABLE_WIDE_SLIDE = 12;

/**
 * The seam that uncovers the wide opening: where it runs on the chapter's
 * scale — starting as soon as the opening is showing under 01 and across
 * before the reading lands — and the clips it runs between. The insets are
 * negative on three sides so the keyline standing off the opening is drawn
 * by the seam along with it rather than cut at the frame's own box. The
 * stylesheet parks the frame at `from` so nothing flashes before this runs.
 */
const TABLE_WIPE = {
  at: 0.05,
  dur: 0.7,
  from: "inset(-1rem 100% -1rem -1rem)",
  to: "inset(-1rem 0% -1rem -1rem)",
} as const;

/**
 * The lag the scrubbed seams follow the scroll through, in seconds.
 *
 * A seam pinned to the wheel exactly steps once per notch and stops dead
 * between them. Following the scroll instead of tracking it, it glides and
 * comes to rest a beat after the reader does. Longer than `SCRUB_DRIFT` because
 * a seam is the one thing on the wall the reader is watching cross.
 */
const SEAM_SCRUB = 0.8;

/**
 * How far the window's plate closes across the act's one hold, as a share of
 * its own size. Small on purpose: this is the move the reader should feel
 * rather than watch, and it is what keeps the held screen from being a still.
 */
const HOLD_PUSH = 0.045;

/**
 * The seam's curve, and the reason it is this one rather than the obvious one.
 *
 * A seam should leave and arrive rather than switch on and off, so it wants an
 * `inOut`. But an `inOut` does not slow an edge down — it redistributes it, and
 * what it takes off the two ends it puts in the middle, which is the only part
 * of the sweep anyone is looking at. `power1.inOut` is quadratic, so its
 * velocity peaks at twice the average: it makes a seam read *faster* than the
 * linear one it replaced over the same distance. `sine.inOut` peaks at pi/2 —
 * about 1.57 — which is the mildest in-out there is. What actually buys a slow
 * seam is distance, and that is `dur` above.
 */
const SEAM_EASE = "sine.inOut";

/**
 * Per seam: the clip the incoming layer starts fully hidden behind, the axis the
 * photographs travel on, and the sign of that travel. The sign is negative when
 * the seam sweeps along the positive axis and positive when it sweeps back, so
 * the incoming photograph always follows the seam and the outgoing one always
 * drifts against it. The overscan that stops that drift uncovering the tile is
 * on the matching side in the stylesheet (`.tile[data-seam] .tileCurrent`).
 */
const SEAM: Record<
  Seam,
  { from: string; axis: "xPercent" | "yPercent"; sign: number }
> = {
  down: { from: "inset(0% 0% 100% 0%)", axis: "yPercent", sign: -1 },
  up: { from: "inset(100% 0% 0% 0%)", axis: "yPercent", sign: 1 },
  rightward: { from: "inset(0% 100% 0% 0%)", axis: "xPercent", sign: -1 },
  leftward: { from: "inset(0% 0% 0% 100%)", axis: "xPercent", sign: 1 },
};

/**
 * The document position of a point on a chapter's passage — see `Travel`.
 *
 * A function rather than a figure, so ScrollTrigger re-reads it on every
 * refresh: a resize changes both the viewport height the unit is measured in
 * and where the chapter sits. Measured off the chapter's zero-height mark, which
 * is in flow and never sticky, so the rect is where the chapter belongs and not
 * where one of its layers is currently stuck.
 */
const travelPoint = (mark: HTMLElement, p: Travel) => () =>
  mark.getBoundingClientRect().top +
  window.scrollY -
  window.innerHeight * (1 - p);

function TileImage({ image, slot }: { image: ManifestImage; slot: Slot }) {
  return (
    <img
      src={tierSrc(image.src, 640)}
      srcSet={tierSrcSet(image)}
      sizes={SLOT_SIZES[slot]}
      width={image.width}
      height={image.height}
      alt={image.alt}
      loading="lazy"
      decoding="async"
    />
  );
}

/**
 * A tile that may turn over: one photograph, or two layered with the seam cut
 * on the upper one. The clip is on the layer and the travel on the photograph
 * inside it, because an inset() is measured against the box it sits on, and
 * clipping and moving the same element would drag the seam along with the
 * picture.
 */
function Tile({ tile, className }: { tile: Tile; className?: string }) {
  const { slot, image, flip } = tile;
  return (
    <div
      className={[styles.tile, className].filter(Boolean).join(" ")}
      // Read by the stylesheet for the overscan the outgoing photograph needs
      // on the side it drifts away from.
      data-seam={flip?.seam}
    >
      {flip ? (
        <>
          <div className={`${styles.tileLayer} ${styles.tileCurrent}`}>
            <TileImage image={image} slot={slot} />
          </div>
          <div className={`${styles.tileLayer} ${styles.tileNext}`}>
            <TileImage image={flip.image} slot={slot} />
          </div>
        </>
      ) : (
        <TileImage image={image} slot={slot} />
      )}
    </div>
  );
}

/**
 * The portal's stack: the frame with its photograph lagging inside it and the
 * circle crossing ahead of the page. Rendered in paint order — every layer is
 * positioned, so DOM order is the z-scale inside the stack. The slab the two
 * stand on is not in the stack: it reaches the page's edge, which the stack,
 * held to the measure, cannot, so it is a child of the plate layer itself.
 *
 * The frame is the vocabulary's `DriftFrame`: a clipped window with the
 * photograph bleeding past it by exactly as far as it travels, so the picture
 * moves inside a frame that holds still on the page. That is the restrained
 * lag the large imagery in the act is allowed, and the whole of it.
 */
function PortalStack({ tiles }: { tiles: readonly Tile[] }) {
  const frame = tiles.find((t) => t.slot === "frame")!;
  const portal = tiles.find((t) => t.slot === "portal")!;
  return (
    <>
      <DriftFrame className={SLOT_CLASS.frame}>
        <DriftImage mode="through">
          <Tile tile={frame} className={styles.tileFill} />
        </DriftImage>
      </DriftFrame>

      <Drift mode="up" amount={PORTAL_LEAD} className={SLOT_CLASS.portal}>
        <Tile tile={portal} className={styles.tileRound} />
      </Drift>
    </>
  );
}

/**
 * The dark slab a composition stands on: a block of umber hanging off one
 * edge of the page, taller than the screen, trailing the page a little.
 * Absolute inside the layer it is given to, which is the one box in a chapter
 * that spans the page — the measure the compositions are held to stops at
 * the gutter, and a slab that stops at the gutter is a card.
 *
 * Carries the chapter's index on a vertical rule, in sand, the way the
 * reference's dark block carries its page number: the number is on the dark
 * and the reading is on the ivory, so the slab is part of the chapter rather
 * than a backdrop behind it.
 */
function Slab({ index, edge }: { index: string; edge: "left" | "right" }) {
  return (
    // The wrapper places the slab and the drift inside it moves it: the
    // vocabulary's block takes no attributes of its own, and the placement
    // wants the edge to read from the stylesheet.
    <div className={styles.slab} data-edge={edge} aria-hidden>
      <Drift mode="down" amount={SLAB_TRAIL} className={styles.slabFace}>
        <span className={styles.slabRule}>
          <span className={`caps-label ${styles.slabIndex}`}>{index}</span>
        </span>
      </Drift>
    </div>
  );
}

/**
 * The table chapter's inside: three children of the chapter's own grid rather
 * than a box of its own, so the wide opening can span the measure while the
 * reading and the tall opening share the row under it.
 *
 * The index leads the eyebrow on one caps line instead of standing on a line of
 * its own. Both are the same tracked mono at the same size, and stacked they
 * read as a label that has been printed twice — where the panel's number and
 * what the panel is about are one thought: 02, the table.
 *
 * The wide opening is not faded in with the rest: it is drawn by the seam the
 * reader pulls (`data-table-wide`, in the effect) — the arch, its keyline and
 * the picture behind it uncovered together from the page's edge, so the
 * aperture is struck by the reader's own travel rather than arriving made.
 */
function TableComposition({ index }: { index: string }) {
  return (
    <>
      <ApertureFrame ratio="16 / 9" className={styles.tableWide}>
        <img
          src={tierSrc(TABLE_WIDE.src, 1280)}
          srcSet={tierSrcSet(TABLE_WIDE)}
          sizes="(max-width: 900px) 92vw, 66vw"
          width={TABLE_WIDE.width}
          height={TABLE_WIDE.height}
          alt={TABLE_WIDE.alt}
          loading="lazy"
          decoding="async"
          data-table-wide
        />
      </ApertureFrame>

      <div className={styles.tableCopy}>
        <p className={`caps-label ${styles.chapterIndex}`} data-chapter-fade>
          {index}
          <span className={styles.tableEyebrow}>The table</span>
        </p>
        <h2
          className={`font-display ${styles.tableHeadline}`}
          data-chapter-fade
        >
          The Dining Room
        </h2>
        <p className={styles.tableNote} data-chapter-fade>
          {DINING_ROOM_NOTE}
        </p>

        <dl className={styles.tableTimes} data-chapter-fade>
          <div className={styles.tableTimeRow}>
            <dt className="caps-label">Service</dt>
            {/* Honest, and something to do about it. The house has not set its
                service windows and a panel that printed one would be telling a
                guest something nobody decided — but a sentence a reader can do
                nothing with is its own kind of dead end. The hours reach them
                with the booking; the link below is how they get there. */}
            <dd className={styles.tableHours}>{DINING_SERVICE_UNPUBLISHED}</dd>
          </div>
        </dl>

        <ChooseDatesLink
          className={`caps-label ${styles.tableAction}`}
          context="The Dining Room"
        />
      </div>

      {/* The small detail crossing quicker: the tall opening leads the page
          while the wide one above it sits at the page's own pace. */}
      <Drift mode="up" amount={TALL_OPENING_LEAD} className={styles.tableTall}>
        <ApertureFrame ratio="4 / 5">
          <img
            src={tierSrc(TABLE_TALL.src, 1280)}
            srcSet={tierSrcSet(TABLE_TALL)}
            sizes="(max-width: 900px) 62vw, 22rem"
            width={TABLE_TALL.width}
            height={TABLE_TALL.height}
            alt={TABLE_TALL.alt}
            loading="lazy"
            decoding="async"
            data-chapter-fade
          />
        </ApertureFrame>
      </Drift>
    </>
  );
}

/**
 * The glyph beside a marked fact. Drawn here at one pixel, in the ink colour,
 * rather than pulled from an icon set: three marks is not a library, and a set
 * would arrive with a stroke weight, a corner radius and a grid that are
 * somebody else's.
 *
 * The monogram is the exception and is not drawn at all — it is the brand file
 * itself, carried as a mask so it takes `currentColor` like the other two. An
 * `<img>` would have pinned it to whatever the file's own fill resolves to.
 */
function HouseGlyphMark({ glyph }: { glyph: HouseGlyph }) {
  if (glyph === "monogram") {
    return <span className={styles.windowGlyphMark} />;
  }

  if (glyph === "water") {
    return (
      <svg
        className={styles.windowGlyphDraw}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M4 8.5 Q6 6.1 8 8.5 T12 8.5 T16 8.5 T20 8.5" />
        <path d="M4 12 Q6 9.6 8 12 T12 12 T16 12 T20 12" />
        <path d="M6 15.5 Q8 13.1 10 15.5 T14 15.5 T18 15.5" />
      </svg>
    );
  }

  // The dial: a face and the rays around it, at the eight points a sundial is
  // cut at. Written out rather than generated — eight pairs of numbers are
  // cheaper to read than the trigonometry that would produce them.
  return (
    <svg
      className={styles.windowGlyphDraw}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="4.2" />
      <path d="M18.4 12h2.2M5.6 12H3.4M12 5.6V3.4M12 18.4v2.2" />
      <path d="M16.53 7.47l1.55-1.55M7.47 7.47L5.92 5.92M7.47 16.53l-1.55 1.55M16.53 16.53l1.55 1.55" />
    </svg>
  );
}

/**
 * The window's inside: the opening and the reading, two children of the
 * chapter's own grid, drawn entirely in the type layer (see the archetype block
 * in the stylesheet).
 *
 * The opening is four layers deep, back to front, and the order is the whole of
 * how it reads as a hole in something thick rather than a shaped photograph:
 *
 *   1  the plate, filling the box — only the part of it under the cut is ever
 *      seen, so it needs no clip of its own
 *   2  a veil over the plate, dark towards the edges: a picture standing behind
 *      a wall is further away than the wall, and a photograph that is evenly lit
 *      to its own corners is a photograph lying on top of one
 *   3  the sill — the same wall shape again, in a warm cream, offset up and left
 *      inside the SVG's own units so a band of it stands proud of the cut along
 *      the bottom and right insides
 *   4  the reveal — the wall shape a third time, in a darker plaster, offset the
 *      other way so its band stands along the top and left. Between them the two
 *      bands are the thickness of the wall, seen edge-on
 *   5  the light falling off down the cut, painted over the jamb and the picture
 *      together so the shadow carries from one onto the other
 *   6  the wall, in the panel's own plaster so it disappears into it at the box
 *      edge, carrying the shadow the cut throws
 *
 * Three and four are two faces of one jamb and not a decoration each. The light
 * is above and to the left, which is where the act's gobo throws it from: a
 * surface inside the cut that faces up or left is turned into that light and is
 * the sill, and one that faces down or right is turned away from it and is the
 * reveal.
 *
 * Three things arrive after the chapter has landed, in this order, each looked
 * up by the timeline rather than queried into the shared tweens so a chapter
 * without one carries no empty tween: the plate settling back behind the cut
 * (`data-chapter-settle`), the reveal deepening (`data-chapter-detail`), and the
 * marked facts wiping in one after another (`data-chapter-leader`). The plate's
 * box then takes the hold's push-in (`data-chapter-push`), which is the only one
 * of the four that is still going once the chapter has pinned. Under reduced
 * motion none of it runs and the frame is complete as drawn.
 */
function WindowComposition({ index }: { index: string }) {
  return (
    <>
      <div className={styles.windowOpening}>
        {/* The push is on the plate's box, not on the plate: the `img` is
            already settling back behind the cut as the chapter lands, and the
            cut itself must not move — it is a hole in a wall. */}
        <div className={styles.windowPicture} data-chapter-push>
          <img
            src={tierSrc(WINDOW_PLATE.src, 1280)}
            srcSet={tierSrcSet(WINDOW_PLATE)}
            sizes="(max-width: 900px) 92vw, 56vw"
            width={WINDOW_PLATE.width}
            height={WINDOW_PLATE.height}
            alt={WINDOW_PLATE.alt}
            loading="lazy"
            decoding="async"
            data-chapter-settle
          />
        </div>
        <span className={styles.windowVeil} aria-hidden />

        <svg
          className={styles.windowSill}
          viewBox={WINDOW_VIEW_BOX}
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d={`${WINDOW_WALL}${WINDOW_OPENING}`}
            fillRule="evenodd"
            transform="translate(-15 -18)"
          />
        </svg>

        <svg
          className={styles.windowReveal}
          viewBox={WINDOW_VIEW_BOX}
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
          data-chapter-detail
        >
          {/* Offset in the viewBox's own units, not by a CSS transform: the
              landing animates this element's transform, and a base offset
              written there is the first thing GSAP would overwrite. */}
          <path
            d={`${WINDOW_WALL}${WINDOW_OPENING}`}
            fillRule="evenodd"
            transform="translate(21 25)"
          />
        </svg>

        <span className={styles.windowShade} aria-hidden />

        <svg
          className={styles.windowWall}
          viewBox={WINDOW_VIEW_BOX}
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          <path d={`${WINDOW_WALL}${WINDOW_OPENING}`} fillRule="evenodd" />
        </svg>
      </div>

      <div className={styles.windowReading}>
        <p className={`caps-label ${styles.chapterIndex}`} data-chapter-fade>
          {index}
          {/* §1, "Address" — the city the house stands in, off the same two
              lines the marked fact below prints in full. */}
          <span className={styles.windowEyebrow}>Nha Trang</span>
        </p>

        <h2 className={`font-display ${styles.windowHeadline}`}>
          {WINDOW_LINES.map(([italic, roman]) => (
            <span key={roman} className={styles.lineClip}>
              <span data-chapter-line style={{ display: "block" }}>
                {italic ? (
                  <em className={styles.windowLineItalic}>{italic}</em>
                ) : null}
                {roman}
              </span>
            </span>
          ))}
        </h2>

        <p className={styles.windowNote} data-chapter-fade>
          {HOUSE_NOTE.map((sentence) => (
            <span key={sentence} className={styles.windowNoteLine}>
              {sentence}
            </span>
          ))}
        </p>

        <ul className={styles.windowMarks}>
          {HOUSE_MARKS.map((mark, i) => (
            <li
              key={mark.glyph}
              className={styles.windowMark}
              data-chapter-leader
            >
              <span className={styles.windowGlyph} aria-hidden>
                <HouseGlyphMark glyph={mark.glyph} />
              </span>
              <span className={`caps-label ${styles.windowMarkIndex}`}>
                {`0${i + 1}`}
              </span>
              <span className={styles.windowMarkCaption}>
                {mark.caption[0]}
                <br />
                {mark.caption[1]}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

/**
 * The diptych's inside: the reading on the ivory and the frame on the slab,
 * two children of the chapter's own grid, drawn entirely in the type layer
 * like the table and the window. The slab is the type layer's too — it has
 * to sit under the frame and over the wall, and the plate layer is under the
 * gobo, which would have thrown the leaf shadow onto the dark, where it reads
 * as a stain rather than as light.
 *
 * The frame is two panes the size of the frame, one over the other: the
 * morning with the line set in ink over it, and the evening with the same
 * line set in ivory, clipped from the left by the seam. The line is inside
 * the pane rather than beside it because a clip is measured against the box
 * it sits on — clipping the ivory line by itself would cut it at a share of
 * its own width, not the frame's. One custom property, `--seam`, is what the
 * effect drags, and the pane's clip and the hairline both read it, so the
 * picture, the type and the rule cannot disagree about where the seam is.
 */
function DiptychComposition({ index }: { index: string }) {
  const headline = (className: string) => (
    <p className={`font-display ${styles.diptychLine} ${className}`}>
      {DIPTYCH_LINES.map((line) => (
        <span key={line} className={styles.diptychLineRow}>
          {line}
        </span>
      ))}
    </p>
  );
  return (
    <>
      <Slab index={index} edge="right" />

      <div className={styles.chapterText}>
        <div className={styles.chapterHold}>
          <p className={`caps-label ${styles.chapterIndex}`} data-chapter-fade>
            {index}
          </p>
          <p className={styles.chapterBody} data-chapter-fade>
            {DIPTYCH_NOTE}
          </p>
          <p
            className={`caps-label ${styles.chapterCaption}`}
            data-chapter-fade
          >
            Morning &amp; Evening
          </p>
        </div>
      </div>

      <div className={styles.diptych} data-diptych>
        <div className={styles.diptychPane}>
          <img
            src={tierSrc(DIPTYCH_MORNING.src, 1280)}
            srcSet={tierSrcSet(DIPTYCH_MORNING)}
            sizes="(max-width: 900px) 92vw, 62vw"
            width={DIPTYCH_MORNING.width}
            height={DIPTYCH_MORNING.height}
            alt={DIPTYCH_MORNING.alt}
            loading="lazy"
            decoding="async"
            data-diptych-morning
          />
          {headline(styles.diptychLineInk)}
        </div>
        <div className={`${styles.diptychPane} ${styles.diptychEvening}`}>
          <img
            src={tierSrc(DIPTYCH_EVENING.src, 1280)}
            srcSet={tierSrcSet(DIPTYCH_EVENING)}
            sizes="(max-width: 900px) 92vw, 62vw"
            width={DIPTYCH_EVENING.width}
            height={DIPTYCH_EVENING.height}
            alt={DIPTYCH_EVENING.alt}
            loading="lazy"
            decoding="async"
            data-diptych-evening
          />
          {headline(styles.diptychLineIvory)}
        </div>
        <span className={styles.diptychSeam} aria-hidden />
      </div>
    </>
  );
}

/**
 * The pause's inside: one display line at the centre of the pinned stage, and
 * nothing else on it. The line rises the way every other chapter's headline
 * does (`data-chapter-line`), and the stage's mask opens the lens through its
 * middle (`--lens`, on the stage — see the effect).
 */
function PauseComposition() {
  return (
    <div className={styles.pauseScreen} data-pause-lens>
      <p className={`font-display ${styles.pauseLine}`}>
        {PAUSE_LINES.map((line) => (
          <span key={line} className={styles.lineClip}>
            <span
              data-chapter-line
              className={styles.pauseRow}
              style={{ display: "block" }}
            >
              {line}
            </span>
          </span>
        ))}
      </p>
    </div>
  );
}

/** The reading of a tiled chapter: index, ragged display line, body, caption.
 *  Wrapped in a block that holds still for part of the passage (see
 *  `.chapterHold` in the stylesheet) and then leaves ahead of the picture. */
function ChapterReading({ chapter }: { chapter: TiledChapter }) {
  return (
    <div className={styles.chapterText}>
      <div className={styles.chapterHold}>
        <p className={`caps-label ${styles.chapterIndex}`} data-chapter-fade>
          {chapter.index}
        </p>
        <h2 className={`font-display ${styles.chapterHead}`}>
          {chapter.lines.map(([text, indent]) => (
            <span key={text} className={styles.lineClip}>
              <span
                data-chapter-line
                className={styles.chapterLine}
                style={
                  {
                    display: "block",
                    "--indent": `${indent}em`,
                  } as React.CSSProperties
                }
              >
                {text}
              </span>
            </span>
          ))}
        </h2>
        <p className={styles.chapterBody} data-chapter-fade>
          {chapter.body}
        </p>
        <p className={`caps-label ${styles.chapterCaption}`} data-chapter-fade>
          {chapter.caption}
        </p>
      </div>
    </div>
  );
}

export function WelcomeChapters() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || prefersReducedMotion()) return;
    gsap.registerPlugin(ScrollTrigger);
    registerArrivalEases();

    const ctx = gsap.context(() => {
      const chapters = gsap.utils.toArray<HTMLElement>(
        `.${styles.chapter}`,
        root,
      );

      chapters.forEach((chapter, i) => {
        // The chapters are rendered from CHAPTERS in order, so position is the
        // link back to the data the archetype and the seams are written in.
        const data = CHAPTERS[i];
        const mark = chapter.querySelector<HTMLElement>("[data-chapter-mark]")!;
        const at = (p: Travel) => travelPoint(mark, p);

        // The chapter's arrival: the reading rising, the photographs settling
        // out of an over-scale. Paused and played rather than scrubbed, so a
        // block that is being read arrives on a clock and not on the wheel —
        // and so leaving back over its landing point can run the whole thing
        // backwards. The reverse is three times the speed of the entrance: a
        // block that leaves is leaving because the reader has already moved
        // on.
        const landing = gsap
          .timeline({ paused: true, defaults: { ease: EASE_ENTER } })
          .fromTo(
            chapter.querySelectorAll("[data-chapter-line]"),
            { yPercent: 115 },
            {
              yPercent: 0,
              duration: DUR_ENTER,
              stagger: STAGGER_CASCADE,
            },
          )
          // The photographs settle out of an over-scale inside their own clip,
          // so nothing moves in the layout and nothing has to start hidden.
          .fromTo(
            chapter.querySelectorAll(`.${styles.tile} img`),
            { scale: 1.09 },
            {
              scale: 1,
              duration: DUR_ENTER,
              stagger: STAGGER_CASCADE,
            },
            0,
          )
          .fromTo(
            chapter.querySelectorAll("[data-chapter-fade]"),
            { autoAlpha: 0, y: 16 },
            {
              autoAlpha: 1,
              y: 0,
              duration: DUR_ENTER * 0.75,
              stagger: STAGGER_CASCADE,
            },
            0.3,
          );

        // The window's beats, in the order they land. Each is looked up rather
        // than queried into the tweens above so a chapter without one carries
        // no empty tween; the chapters either side of the window have none of
        // them.
        //
        // First, the same settle the tiles make, at the slow cinematic length
        // rather than the scene one, so it is still going after the chapter
        // has pinned — and barely going, which is the point.
        const settling = chapter.querySelector<HTMLElement>(
          "[data-chapter-settle]",
        );
        if (settling) {
          landing.fromTo(
            settling,
            { scale: 1.06 },
            { scale: 1, duration: DUR_SCENE_SLOW },
            0,
          );
        }

        // Then the reveal down the inside of the cut, once the reading is in.
        // It starts lifted, which is the wall at its thinnest, and settles to
        // where the band is fully open, so what the reader sees is the wall
        // gaining its thickness. Late enough to be caught on a screen that has
        // otherwise stopped, which is the whole of the hold.
        const detail = chapter.querySelector<HTMLElement>(
          "[data-chapter-detail]",
        );
        if (detail) {
          landing.fromTo(
            detail,
            { autoAlpha: 0, y: -16 },
            { autoAlpha: 1, y: 0, duration: DUR_ENTER },
            1.1,
          );
        }

        // Last, the marked facts: each is uncovered from its glyph outwards, so
        // the ring draws and the caption follows it, one after another along
        // the row.
        const leaders = chapter.querySelectorAll("[data-chapter-leader]");
        if (leaders.length > 0) {
          landing.fromTo(
            leaders,
            { clipPath: "inset(0% 100% 0% 0%)" },
            {
              clipPath: "inset(0% 0% 0% 0%)",
              duration: DUR_ENTER * 0.75,
              stagger: 0.14,
            },
            1.5,
          );
        }

        // Built once the whole landing exists, so a chapter entered on the
        // first frame plays all of its beats and not just the ones declared
        // above.
        ScrollTrigger.create({
          trigger: mark,
          start: at(data.landAt),
          onEnter: () => landing.timeScale(1).play(),
          onEnterBack: () => landing.timeScale(1).play(),
          onLeaveBack: () => landing.timeScale(DUR_ENTER / DUR_EXIT).reverse(),
        });

        // The seams, drawn by the reader across the chapter's passage. One
        // timeline for the whole chapter rather than one per tile, placed on
        // the chapter's own scale from its top edge appearing to its top edge
        // a whole passage above the screen, so a chapter with more than one
        // seam stays a sequence however the reader travels. One curve for all
        // three tweens of a seam — the clip that uncovers the incoming
        // photograph and the two that drift the photographs behind it —
        // because they are one edge, and any difference between their rates
        // shows up as the seam sliding off the pictures it is cutting between.
        const flips = tiled(data)
          ? data.tiles.flatMap((tile) => (tile.flip ? [tile.flip] : []))
          : [];
        const seamed = chapter.querySelectorAll<HTMLElement>(
          `.${styles.tile}[data-seam]`,
        );
        if (flips.length > 0) {
          const span = 1 + data.travel;
          const run = gsap.timeline({
            defaults: { ease: SEAM_EASE },
            scrollTrigger: {
              trigger: mark,
              start: at(0),
              end: at(span),
              scrub: SEAM_SCRUB,
              invalidateOnRefresh: true,
            },
          });
          flips.forEach((flip, f) => {
            const el = seamed[f];
            const incoming = el.querySelector<HTMLElement>(
              `.${styles.tileNext}`,
            )!;
            const outgoing = incoming.previousElementSibling!;
            const { at: start, dur: duration } = flip;
            const { from, axis, sign } = SEAM[flip.seam];
            run
              .fromTo(
                incoming,
                { clipPath: from },
                { clipPath: "inset(0% 0% 0% 0%)", duration },
                start,
              )
              .fromTo(
                incoming.querySelector("img"),
                { [axis]: sign * FLIP_ENTER },
                { [axis]: 0, duration },
                start,
              )
              .fromTo(
                outgoing.querySelector("img"),
                { [axis]: 0 },
                { [axis]: sign * FLIP_EXIT, duration },
                start,
              );
          });
          // Holds the timeline open to the end of the passage, so a seam's
          // position on the scale is its position on the scroll and not a
          // share of however long the last seam happened to run.
          run.to({}, { duration: Math.max(0, span - run.duration()) });
        }

        // The table's wide opening, uncovered from the page's edge as the
        // reader pulls it up. The seam sweeps out from the left, which is the
        // edge the opening hangs off, and the photograph follows it in a
        // little behind — the same grammar as a flip, on a plate arriving on a
        // bare wall rather than replacing one.
        const wide = chapter.querySelector<HTMLElement>("[data-table-wide]");
        if (wide) {
          const frame = wide.closest<HTMLElement>(`.${styles.tableWide}`)!;
          gsap
            .timeline({
              defaults: { ease: SEAM_EASE, duration: TABLE_WIPE.dur },
              scrollTrigger: {
                trigger: mark,
                start: at(TABLE_WIPE.at),
                end: at(TABLE_WIPE.at + TABLE_WIPE.dur),
                scrub: SEAM_SCRUB,
                invalidateOnRefresh: true,
              },
            })
            .fromTo(
              frame,
              { clipPath: TABLE_WIPE.from },
              { clipPath: TABLE_WIPE.to },
              0,
            )
            .fromTo(wide, { xPercent: -TABLE_WIDE_SLIDE }, { xPercent: 0 }, 0);
        }

        // The diptych's seam, dragged by the reader across the frame's
        // passage. One custom property on the frame, read by both clips and
        // the hairline, so the picture and the line turn over on the same
        // edge; the two plates drift behind it in the flip grammar — the one
        // being covered backing away, the one arriving following the seam in.
        const diptych = chapter.querySelector<HTMLElement>("[data-diptych]");
        if (diptych) {
          gsap
            .timeline({
              defaults: { ease: SEAM_EASE, duration: DIPTYCH_SEAM.dur },
              scrollTrigger: {
                trigger: mark,
                start: at(DIPTYCH_SEAM.at),
                end: at(DIPTYCH_SEAM.at + DIPTYCH_SEAM.dur),
                scrub: SEAM_SCRUB,
                invalidateOnRefresh: true,
              },
            })
            .fromTo(
              diptych,
              { "--seam": `${DIPTYCH_SEAM.from}%` },
              { "--seam": `${DIPTYCH_SEAM.to}%` },
              0,
            )
            .fromTo(
              diptych.querySelector("[data-diptych-morning]"),
              { xPercent: 0 },
              { xPercent: -DIPTYCH_DRIFT },
              0,
            )
            .fromTo(
              diptych.querySelector("[data-diptych-evening]"),
              { xPercent: DIPTYCH_DRIFT },
              { xPercent: 0 },
              0,
            );
        }

        // The lens. A hole in the pause's mask, grown from nothing to past
        // the screen's corners over the last stretch of the pin, easing in: a
        // circle that opens at a constant rate reads as fastest at the start,
        // when it is smallest, and what the moment wants is a coin that
        // hesitates and then takes the screen. Scrubbed hard rather than
        // followed — its edge is the seam between two chapters.
        const pause = chapter.querySelector<HTMLElement>("[data-pause-lens]");
        if (pause) {
          gsap.fromTo(
            pause.closest<HTMLElement>(`.${styles.panelType}`)!,
            { "--lens": "0vmax" },
            {
              "--lens": LENS_OPEN,
              ease: "power2.in",
              scrollTrigger: {
                trigger: mark,
                start: at(PAUSE.lensAt),
                end: at(PAUSE.lensEnd),
                scrub: true,
                invalidateOnRefresh: true,
              },
            },
          );
        }

        // The bleed's ground: the wall carried back over the photograph where
        // the words stand. It arrives with the reading rather than being
        // there from the start — under the lens the plate is whole, and the
        // dissolve is what the copy brings with it.
        const ground = chapter.querySelector<HTMLElement>(
          "[data-chapter-ground]",
        );
        if (ground) {
          landing.fromTo(
            ground,
            { autoAlpha: 0 },
            { autoAlpha: 1, duration: DUR_ENTER },
            0,
          );
        }

        // The hold's push-in, on the one chapter that holds. The window pins
        // for a beat once its top reaches the top of the screen, and across
        // that beat the plate behind the cut closes in — linear, because a
        // dolly is a constant rate — so the held screen is a camera move
        // rather than a still.
        const pushed = chapter.querySelectorAll("[data-chapter-push]");
        if (pushed.length > 0) {
          gsap.fromTo(
            pushed,
            { scale: 1 },
            {
              scale: 1 + HOLD_PUSH,
              ease: "none",
              scrollTrigger: {
                trigger: mark,
                start: at(1),
                end: at(data.travel),
                scrub: SEAM_SCRUB,
                invalidateOnRefresh: true,
              },
            },
          );
        }
      });
    }, root);
    return () => ctx.revert();
  }, []);

  return (
    <div ref={rootRef} className={styles.chapters}>
      {CHAPTERS.map((chapter, i) => (
        <article
          key={chapter.index}
          data-side={chapter.side}
          data-arch={chapter.arch}
          className={styles.chapter}
          style={
            {
              "--i": i,
              // Viewport heights the chapter takes. The stylesheet turns it
              // into the chapter's minimum height on a desktop, and lets the
              // chapter take its own height where nothing needs the scale.
              "--travel": chapter.travel,
            } as React.CSSProperties
          }
        >
          {/* Zero height, in flow, at the chapter's top: what every scroll
              range in the act is measured from, because the layers below may
              be stuck somewhere else. */}
          <div data-chapter-mark className={styles.chapterMark} aria-hidden />

          <div className={`${styles.panel} ${styles.panelType}`}>
            <div className={styles.panelInner}>
              <p className={`caps-label ${styles.chapterRail}`}>
                {chapter.rail}
              </p>

              {tiled(chapter) ? (
                <ChapterReading chapter={chapter} />
              ) : chapter.arch === "table" ? (
                <TableComposition index={chapter.index} />
              ) : chapter.arch === "window" ? (
                <WindowComposition index={chapter.index} />
              ) : chapter.arch === "diptych" ? (
                <DiptychComposition index={chapter.index} />
              ) : (
                <PauseComposition />
              )}
            </div>
          </div>

          {/* The photographs, under the gobo. The opening chapters draw
              everything in the type layer — their composition is one grid of
              openings and reading — and carry nothing here. */}
          {tiled(chapter) && (
            <div className={`${styles.panel} ${styles.panelPlate}`}>
              {/* The portal's slab is the plate layer's own child rather
                  than the stack's: it reaches the page's edge, and the leaf
                  shadow falls across it the way it falls across the wall. */}
              {chapter.arch === "portal" && (
                <Slab index={chapter.index} edge="left" />
              )}
              <div className={styles.panelInner}>
                <div className={styles.stack}>
                  {chapter.arch === "portal" ? (
                    <PortalStack tiles={chapter.tiles} />
                  ) : (
                    <>
                      <Tile
                        tile={chapter.tiles[0]}
                        className={SLOT_CLASS.bleed}
                      />
                      {/* The reading's ground: the dissolve gets the
                          photograph most of the way out of the words' way,
                          and this settles the rest of it. Faded in with the
                          reading — see the effect. */}
                      <div
                        className={styles.bleedHaze}
                        data-chapter-ground
                        aria-hidden
                      />
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
