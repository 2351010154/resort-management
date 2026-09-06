"use client";

// Act 2, second half — four ruled chapters hanging off the welcome line, on
// the same wall and under the same foliage shadow (izanami "Philosophy"
// composition: vertical rail label, ragged display line, and photographs
// stacked on the far side).
//
// They live inside Act 2's section rather than in one of their own so the gobo
// keeps casting over them: its canvas sticks for the length of the act, and the
// act is now several viewports instead of one and a bit.
//
// The panels stack rather than scroll past one another: each pins to the top of
// the viewport, holds for a dwell, and is then covered by the next one rising
// over it. Each panel is two overlaid sticky layers so the shadow can still
// fall between the photographs and the reading — see the chapters block in the
// stylesheet for the z-scale that depends on.
//
// The four panels are not one template filled four times. Each carries an
// archetype — how many photographs, what shapes, and how they stand against the
// panel — and no two share one:
//
//   01 portal   a tall frame with a brass-ringed circle breaking its top
//               corner, standing on two sheets of glass offset behind and
//               across it
//   02 table    no tiles at all — the arrival's arch-topped aperture at two
//               crops: a wide opening across the top of the panel stopping
//               short of the right margin, the house's one table read under
//               its left half, and a tall opening at the right riding up into
//               the room the wide one left
//   03 window   one opening cut in the shape of the house's own monogram —
//               the mark's V driven down into the picture from above and its
//               outer strokes leaning in from the sides — carved into a wall
//               thick enough to cast a reveal, with the reading and three
//               marked facts on the far side
//   04 bleed    one photograph filling the panel, dissolved into the wall down
//               its left edge and along its foot, the reading over the dissolve
//
// The scale runs medium, big, shaped, everything. The table is wide and heavy
// and anchored left, and the bled panel is the whole screen; a wide picture
// covered by a whole-screen picture is one big thing giving way to another,
// and the eye reads that as one panel that happened to change. What separates
// them is the third one, and what separates it is not size — two drafts tried
// to make it land by being small, and a small rectangle between two large ones
// reads as a panel that is missing something. It lands by being a different
// kind of hole: every other opening in the arrival is the arch, and this one is
// the monogram, cut through plaster with a thickness the light can find. The
// picture stays well inside its wall on every side, so what carries the panel
// is the shape of the cut and not the area of the photograph.
//
// They used to be three stacks of rectangles at slightly different percentages,
// and on a screen that is pinned and otherwise still that read as machinery: a
// panel holds for a whole viewport, which is long enough to notice that the
// frame, the satellite, and the corner are where they were last time. The
// compositions also sat too small inside their own panel — a stack capped at
// 28rem on a 1440 wall left a column of nothing between the reading and the
// page edge. Each archetype now sizes off the height it is given rather than a
// figure in rem, and the last one gives up the measure entirely.
//
// The tiled panels turn their photographs over, and the run is scrubbed
// against the dwell: the seam is drawn by the reader's travel and uncrosses on
// the way back up. The dwell is what buys it — a panel's hold is sized on the
// run it has to fit — so the far edge of the hold is where the replacement is
// fully in. What separates the runs is their shape: 01 descends from the frame
// to the circle, and 04 spends its whole dwell on one seam climbing the panel —
// the last chapter, and the one that hands over to Act 3.
//
// A pinned panel is not a still. Every archetype pushes in across its own
// dwell — inside the frame, never on it, so the composition holds its drawn
// position while the photograph inside it closes — and the seam is scrubbed
// through a lag rather than pinned to the wheel, so it glides and comes to
// rest instead of stepping with each notch. The three are one camera: a
// locked-off frame, slowly dollying, with an edge crossing it.
//
// 02 and 03 have no seam to run. The table holds two openings still and spends
// its dwell being read; it still holds for exactly as long as it used to, so
// the act's rhythm is the one that was tuned — see `hold` on the chapter. The
// window spends its dwell being carved: the photograph goes on settling back
// behind the opening long after the panel has stopped, the reveal down the
// inside of the cut deepens a beat later, and the three marked facts wipe in
// one after another last. Nothing turns over. What moves is the wall's
// thickness arriving, which is the one thing a panel about a hole can show.

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
  GUEST_FLOORS,
  ROOM_COUNT_IN_WORDS,
} from "@/features/arrival/content/house-facts";
import { arrivalImages } from "@/features/arrival/lib/image-manifest";
import { tierSrc, tierSrcSet } from "@/features/arrival/lib/image-srcset";
import { useScrollWeight } from "@/features/arrival/lib/lenis-scroll-provider";
import { registerArrivalEases } from "@/features/arrival/lib/motion-eases";
import { prefersReducedMotion } from "@/features/arrival/lib/webgl-support";
import { ROOM_TYPES } from "@/features/booking/lib/room-types";
import {
  DUR_ENTER,
  DUR_EXIT,
  DUR_SCENE_SLOW,
  EASE_ENTER,
  SCRUB_DRIFT,
  STAGGER_CASCADE,
} from "@/lib/motion-tokens";
import styles from "./act-2-welcome.module.css";

const CONVERGE = arrivalImages["act-1-converge"];
const ROOMS = arrivalImages["act-4-rooms"];
/** Landscapes cut wide enough to carry a whole panel on their own — the only
 *  set in the manifest that can, which is why the bled chapter draws from it
 *  rather than from the room and detail crops the other two are built out of. */
const PLATES = arrivalImages["act-2-chapters"];

type ManifestImage = (typeof arrivalImages)[keyof typeof arrivalImages][number];

const bySlug = <T extends { src: string }>(set: readonly T[], slug: string) =>
  set.find((img) => img.src.includes(`/${slug}-`))!;

/** Indent of a display line, in em of its own size. */
type Line = readonly [text: string, indent: number];

/** Which composition a chapter's photographs take. The geometry itself lives in
 *  the archetype blocks of the stylesheet, selected on `data-arch`. */
type Arch = "portal" | "table" | "window" | "bleed";

/** A tile's place in its archetype, and its class key in the stylesheet. */
type Slot = "frame" | "portal" | "bleed";

/**
 * Which way a seam travels. Physical, not logical: `clip-path: inset()` is
 * measured against the box's physical edges and is not mirrored by the
 * `direction: rtl` that flips a left-side panel, so "rightward" means rightward
 * on every panel. The sideways pair is used on the wide tile of a composition,
 * and each runs out towards the page edge that tile already hangs over rather
 * than in towards the reading — which is why both exist: a right-side panel
 * hangs its wide tile off the right edge and a mirrored one off the left, and
 * neither seam can turn around on its own.
 */
type Seam = "down" | "up" | "rightward" | "leftward";

/**
 * The second photograph a tile turns over to during the panel's dwell — the
 * stretch where the panel has stopped travelling and only the camera inside it
 * is moving, so the seam is the one edge crossing anything. Carried by the tile
 * rather than the chapter, which is what lets a
 * panel run one flip or a sequence of them without a second shape of data.
 */
interface Flip {
  image: ManifestImage;
  seam: Seam;
  /** Where this seam starts along the panel's flip run, and how long it takes
   *  to cross. Written on a clock rather than in shares of the dwell: the act
   *  buys scroll per second of run at one rate (`--dwell-pace`), so a second
   *  here is the same distance of wheel on every panel, and a panel that flips
   *  more than once spaces its tiles along one scale.
   *
   *  Which makes `dur` the one figure that decides how fast a swap reads, and
   *  it decides it outright: the scroll a seam crosses in is `dur` times the
   *  pace, whatever else the panel is doing and however long the rest of the
   *  run is. A seam that reads as too quick is short here, and nowhere else. */
  at: number;
  dur: number;
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
  /** Painted in this order, and the lag table is read by position. */
  tiles: readonly Tile[];
}

/** A panel built out of tiles: a ragged display line beside a composition of
 *  photographs, each of which may turn over during the dwell. */
interface TiledChapter extends ChapterBase {
  arch: "portal" | "bleed";
  lines: readonly Line[];
  body: string;
  caption: string;
}

/**
 * The panels built out of a cut opening — the table and the window. Neither
 * carries tiles, because their composition is the opening rather than a stack
 * — so each also carries the one thing the tiled panels get for free: how long
 * it holds. A dwell is derived from the seams a panel has to fit, and a panel
 * with none would land and be covered in the same gesture.
 */
interface HeldChapter extends ChapterBase {
  arch: "table" | "window";
  tiles: readonly [];
  /** In the same units `runEnd` returns, so the act still buys its dwell at one
   *  pace. Both are what the two seams the tiled panels run used to ask for,
   *  which is what keeps the stack's rhythm the one that was tuned against
   *  them. */
  hold: number;
}

type Chapter = TiledChapter | HeldChapter;

const holds = (chapter: Chapter): chapter is HeldChapter =>
  chapter.arch === "table" || chapter.arch === "window";

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
 * Taken off `public/brand/mariva-monogram-intro.svg`, the heavy cut Act 1 flies
 * the lens into, rather than drawn to look like it. Two things in that mark are
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

const CHAPTERS: Chapter[] = [
  {
    index: "01",
    side: "right",
    rail: "Rest",
    // Portal: one tall frame, a circle set in a brass ring breaking its top
    // corner, and two sheets of glass — one standing behind the frame, one
    // crossing its foot. The act's establishing composition, and the only one
    // holding anything that is not a photograph. The sheets are what stand the
    // frame on something: a rectangle alone on the wall is what the panel used
    // to be, and it read as flat at every size it was tried at.
    arch: "portal",
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
    // The run descends: the frame goes first and largest, the circle closes.
    tiles: [
      {
        slot: "frame",
        image: bySlug(ROOMS, "room-cedar"),
        // First, and the largest change: the same room at dusk, so the seam has
        // something to show — two warm cedar interiors would turn over
        // invisibly.
        flip: {
          image: bySlug(ROOMS, "room-premier"),
          seam: "down",
          at: 0.35,
          dur: 0.9,
        },
      },
      {
        slot: "portal",
        // Dark, and full to its own edges. The round-window detail was here
        // first for the obvious reason — a circular subject in a circular tile
        // — and it was the wrong picture for exactly that reason: the window is
        // a dark disc on a pale wall, so a circle cut out of it came back as a
        // dark disc inside a ring of that wall, and the ring read as three
        // times its width. What the slot wants is a photograph with no margin
        // of its own.
        image: bySlug(ROOMS, "room-onsen"),
        // Last, and the shorter sweep — the panel's closing beat. Steam at dusk
        // for a room standing in daylight, which at this size is the whole of
        // what makes a seam inside a circle readable.
        flip: {
          image: bySlug(ROOMS, "room-washigamine"),
          seam: "down",
          at: 1.2,
          dur: 0.5,
        },
      },
    ],
  },
  {
    index: "02",
    side: "left",
    rail: "Relax",
    // The table. The one panel in the act that is not a stack of photographs
    // hung on the wall: it is built out of the arrival's own aperture, the
    // arch-topped opening Act 1 cuts with the monogram lens, at two crops of
    // one room — a wide one across the top and a tall one on the detail. The
    // aspect is the only thing that changes between them, which is the whole of
    // what the device has to prove it can do.
    //
    // Nothing hangs off a corner, nothing turns over, and there is no measure
    // running beside a picture: the reading sits *under* the wide opening
    // rather than opposite it. That absence is what keeps the middle chapter
    // from reading as 01 mirrored, which is the job the shingled pair used to
    // hold and never quite did.
    arch: "table",
    tiles: [],
    // What this panel's two seams used to ask for. The dwell is a reading dwell
    // now rather than a run, but it is the same length of hold, so the three
    // panels still stack at the rhythm the act was tuned to.
    hold: 1.4,
  },
  {
    index: "03",
    // The reading takes the right of the wall and the opening the left, which
    // is the reference mirrored — 02 reads at the left, and two panels reading
    // down the same column in a stack is the same panel twice. `side` places
    // the rail, and the rail's rule is that it stands on the outer edge beside
    // the type, so the reading moving right takes it with it.
    side: "left",
    // Not one of the kicker's three words, and deliberately. Rest, Relax and
    // Rejuvenate are the three chapters that say what the house offers — 01,
    // 02 and 04 — and this panel says what the house *is*. The rail names the
    // subject rather than a fourth amenity.
    rail: "The house",
    // The window. One opening cut in the shape of the monogram, carved into a
    // wall thick enough to have a reveal, with the reading and three marked
    // facts on the other side of it.
    //
    // The act's device up to here is the arch — the same arch-topped opening
    // at four crops. This panel is the one place that device is set aside, and
    // it is set aside for the only shape with a better claim to be a hole in
    // this building than the arch has: the house's own mark. That is the whole
    // idea of the panel, and it is why the panel does not need to be either
    // large or small to stand between the table and the bleed.
    arch: "window",
    tiles: [],
    // The table's hold, unchanged, so the stack keeps the rhythm it was tuned
    // to. The panel arrives in three beats — the picture settling back behind
    // the cut, the reveal deepening, then the marked facts wiping in — and the
    // last of them lands well after the panel does.
    hold: 1.4,
  },
  {
    index: "04",
    side: "right",
    rail: "Rejuvenate",
    // The panel gives up the measure. One photograph fills it edge to edge and
    // is dissolved back into the wall down its left side and along its foot,
    // and the reading stands on the dissolve rather than beside the picture.
    //
    // Two panels of photographs held at arm's length inside a grid, and then
    // the act stops holding them: the last chapter is the one the reader is
    // standing in rather than looking at, which is the handover Act 3 opens on.
    // `side` still places the rail and the reading — the photograph is behind
    // both and pays no attention to the columns.
    arch: "bleed",
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
    // One seam, and it takes the whole dwell. The other two panels spend their
    // hold on a sequence — a change, then another, then the panel is done —
    // and doing that a third time at full-panel scale would have been the act
    // repeating its one trick at its loudest. A single edge crossing a whole
    // screen slowly is the other thing a seam can be, and it is the one the
    // closing chapter wants.
    //
    // Climbing, because the copy does. The photograph is a peak at first light
    // over a village still in shadow; the one it gives way to is the garden the
    // copy walks to, three minutes downhill from the kitchen — full daylight,
    // full green, which at this size is the whole of what makes the seam
    // readable. Two dawn landscapes would have crossed invisibly.
    tiles: [
      {
        slot: "bleed",
        image: bySlug(PLATES, "snow-peak-roofs"),
        flip: {
          image: bySlug(PLATES, "garden-pavilion"),
          seam: "up",
          at: 0.5,
          dur: 1.75,
        },
      },
    ],
  },
];

/**
 * How far each tile lags its panel as it rises, in % of its own height, by
 * position in the archetype's tile list. Per archetype rather than shared: in
 * `portal` the frame lags least and the circle most, so the composition reads
 * as depth arriving rather than as one parallax applied to two rectangles. The
 * tiles land on the composition as drawn and hold there for the dwell.
 *
 * `bleed` is zero, and not for want of trying: a photograph pinned to the
 * panel's own edges has nowhere to lag to, and any offset uncovers the edge it
 * was bled off. The panel's rise carries it, which is the point of bleeding it
 * — the reader is inside that frame rather than watching it arrive.
 *
 * `table` and `window` are empty because they hold no tiles at all; their
 * openings are laid out by the panel's own grid and rise with it.
 */
const LAG: Record<Arch, readonly number[]> = {
  portal: [4, 13],
  table: [],
  window: [],
  bleed: [0],
};

/**
 * When a chapter's flip run is over, in seconds from the panel landing — the
 * last seam to finish, whichever tile it belongs to.
 *
 * This is what the dwell is sized on. It used to be a figure per flip count,
 * written in the stylesheet and kept level with these timings by a comment,
 * which is a pairing that can only ever drift: a seam moved half a second later
 * here left the panel it belongs to scrolling away mid-sweep with nothing to
 * say so. Read off the timings themselves, the dwell cannot be wrong about a
 * run it is derived from.
 *
 * A panel with no seams has nothing to derive from and says how long it holds
 * instead — see `hold`. Both are the same figure to the stylesheet, which is
 * the point: the act buys its dwell at one pace whatever the panel spends it
 * on.
 */
const runEnd = (chapter: Chapter) =>
  holds(chapter)
    ? chapter.hold
    : chapter.tiles.reduce(
        (end, tile) =>
          tile.flip ? Math.max(end, tile.flip.at + tile.flip.dur) : end,
        0,
      );

const SLOT_CLASS: Record<Slot, string> = {
  frame: styles.slotFrame,
  portal: styles.slotPortal,
  bleed: styles.slotBleed,
};

/** Rendered width of each slot, from its share of the archetype's stack. */
const SLOT_SIZES: Record<Slot, string> = {
  frame: "(max-width: 900px) 88vw, 34rem",
  portal: "(max-width: 900px) 34vw, 12rem",
  // The one slot whose width is the window's.
  bleed: "100vw",
};

/**
 * Travel of the two photographs behind the seam, in % of the tile's own size,
 * measured off the reference capture: the incoming one arrives a little slower
 * than the seam that uncovers it, and the outgoing one drifts back behind. The
 * two rates are the whole depth of the move — the tile itself never scales.
 */
const FLIP_ENTER = 90;
const FLIP_EXIT = 10;

/**
 * The lag the dwell's tweens follow the scroll through, in seconds.
 *
 * The act's chapters run under the light scroll weight — a wheel notch buys its
 * full travel and Lenis settles inside a couple of frames, because these are
 * screens to read rather than watch. That is right for the words and wrong for
 * the one thing on the panel that is a camera move: pinned to the wheel exactly,
 * a seam steps once per notch and stops dead between them.
 *
 * So the glide is put back here rather than in the page's weight, where it would
 * cost the reader every line of type as well. The seam follows the scroll
 * instead of tracking it, and eases to rest a beat after the reader does.
 */
const DWELL_SCRUB = 0.8;

/**
 * How far the frame closes per second of a panel's run, as a share of its own
 * size.
 *
 * A rate rather than a distance, and the same rate for all four panels, for the
 * reason `--dwell-pace` is one figure: a panel that holds longer has bought more
 * scroll, and a fixed push spread over more scroll is a slower camera. Written
 * per second, every panel dollies at one speed and the act reads as one lens.
 *
 * Small on purpose. This is the move the reader should feel rather than watch —
 * at 04's run it reaches about five per cent over a hold of half a screen.
 */
const PUSH_PER_SECOND = 0.022;

/**
 * The seam's curve, and the reason it is this one rather than the obvious one.
 *
 * A seam should leave and arrive rather than switch on and off, so it wants an
 * `inOut`. But an `inOut` does not slow an edge down — it redistributes it, and
 * what it takes off the two ends it puts in the middle, which is the only part
 * of the sweep anyone is looking at. `power1.inOut` is quadratic, so its
 * velocity peaks at twice the average: it makes a seam read *faster* than the
 * linear one it replaced over the same distance, and the ends it bought that
 * with are the frames where nothing is visibly happening anyway.
 *
 * `sine.inOut` peaks at pi/2 — about 1.57 — which is the mildest in-out there
 * is, and the difference is the whole of what separates a seam that crosses
 * from one that snaps. What actually buys a slow seam is distance, and that is
 * `dur` above.
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
 * A tile's photograph, in the layer the dwell's push-in drives.
 *
 * The scale is taken by this box rather than by the `img` inside it because the
 * landing already animates that `img` — it settles out of an over-scale as the
 * panel arrives — and two tweens writing one property is a fight decided by
 * whichever ran last. A box of its own is also what makes the push safe: `.tile`
 * clips it, so a photograph closing in cannot grow past the frame it is in,
 * uncover the panel behind it, or widen the page.
 */
function TileImage({ image, slot }: { image: ManifestImage; slot: Slot }) {
  return (
    <span className={styles.tilePush} data-chapter-push>
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
    </span>
  );
}

/**
 * The table panel's inside: three children of the panel's own grid rather than
 * a box of its own, so the wide opening can span the measure while the reading
 * and the tall opening share the row under it.
 *
 * The index leads the eyebrow on one caps line instead of standing on a line of
 * its own. Both are the same tracked mono at the same size, and stacked they
 * read as a label that has been printed twice — where the panel's number and
 * what the panel is about are one thought: 02, the table.
 *
 * The landing fade is carried by the photographs rather than by the frames
 * around them: the keyline and the tinted opening are the aperture, and an
 * opening that arrives already struck and then takes its picture is the device
 * doing what it says it is for. Fading the frame would have been the arch
 * fading in as a graphic.
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
          data-chapter-fade
          data-chapter-push
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

      <ApertureFrame ratio="4 / 5" className={styles.tableTall}>
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
          data-chapter-push
        />
      </ApertureFrame>
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
 * The window's inside: the opening and the reading, two children of the panel's
 * own grid, drawn entirely in the type layer for the reason the table is (see
 * the archetype block in the stylesheet).
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
 * reveal. Drawn with only the dark one the cut read as a grey line round a
 * shaped photograph however dark the line was made, because a bevel a reader
 * believes is a light edge and a dark edge, not one of them twice as strong.
 *
 * Three things arrive after the panel has, in this order, each looked up by the
 * timeline rather than queried into the shared tweens so a panel without one
 * carries no empty tween: the plate settling back behind the cut
 * (`data-chapter-settle`), the reveal deepening (`data-chapter-detail`), and the
 * marked facts wiping in one after another (`data-chapter-leader`). The plate's
 * box then takes the dwell's push-in (`data-chapter-push`), which is the only
 * one of the four that is still going once the panel has stopped. Under reduced
 * motion none of it runs and the frame is complete as drawn.
 */
function WindowComposition({ index }: { index: string }) {
  return (
    <>
      <div className={styles.windowOpening}>
        {/* The push is on the plate's box, not on the plate: the `img` is
            already settling back behind the cut as the panel lands, and the
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

export function WelcomeChapters() {
  const rootRef = useRef<HTMLDivElement>(null);

  // The one stretch of Act 2 that is read rather than watched: four panels
  // that pin, hold still, and turn a photograph over. The act around it keeps
  // the cinematic weight — this claims the light one for its own length and
  // hands it back at the far edge.
  useScrollWeight(rootRef, "light");

  useEffect(() => {
    const root = rootRef.current;
    if (!root || prefersReducedMotion()) return;
    gsap.registerPlugin(ScrollTrigger);
    registerArrivalEases();

    const ctx = gsap.context(() => {
      const panels = gsap.utils.toArray<HTMLElement>(
        `.${styles.chapter}`,
        root,
      );
      const marks = panels.map(
        (panel) => panel.querySelector<HTMLElement>("[data-chapter-mark]")!,
      );

      panels.forEach((panel, i) => {
        // The panels are rendered from CHAPTERS in order, so position is the
        // link back to the data the archetype and the flip are written in.
        const data = CHAPTERS[i];
        const mark = marks[i];
        const next = marks[i + 1];
        const tiles = gsap.utils.toArray<HTMLElement>(`.${styles.tile}`, panel);

        // The panel's rise: from its top edge touching the bottom of the
        // screen to the moment it lands and pins.
        //
        // Two scrubs come off it, and which one a tween takes is the rule in
        // lenis-scroll-provider rather than a preference. The cover edge below
        // shares a line with the panel it is cutting, so it has to sit exactly
        // where the scroll says; a tile drifting inside the panel moves
        // relative to the page and takes the second smoothing, so it trails
        // the hand and is still settling after the panel has landed.
        const rise = (scrub: number | true = true) =>
          ({
            trigger: mark,
            start: "top bottom",
            end: "top top",
            scrub,
          }) as const;
        // Its dwell: from landing to the next panel's edge appearing, or, for
        // the last one, to the act letting go. Both stretches of a panel's
        // scroll are the reader's to drive, but they are driven differently:
        // the rise is scrubbed hard because the covering edge is a physical
        // relationship between two panels and cannot lag behind the panel it
        // is cutting, while everything the dwell drives is a camera and glides.
        const dwell = () =>
          ({
            trigger: mark,
            start: "top top",
            endTrigger: next ?? root,
            end: next ? "top bottom" : "bottom bottom",
            scrub: DWELL_SCRUB,
          }) as const;

        // The panel's arrival. Paused and played rather than fired by its own
        // trigger, so leaving back over the landing edge can run the whole
        // thing backwards: a chapter scrolled up past empties itself and fills
        // again on the way down, which is the same grammar the flip run below
        // has always used and the rest of the ride now keeps too. The reverse
        // is three times the speed of the entrance — a block that leaves is
        // leaving because the reader has already moved on.
        const landing = gsap
          .timeline({ paused: true, defaults: { ease: EASE_ENTER } })
          .fromTo(
            panel.querySelectorAll("[data-chapter-line]"),
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
            panel.querySelectorAll(`.${styles.tile} img`),
            { scale: 1.09 },
            {
              scale: 1,
              duration: DUR_ENTER,
              stagger: STAGGER_CASCADE,
            },
            0,
          )
          .fromTo(
            panel.querySelectorAll("[data-chapter-fade]"),
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
        // than queried into the tweens above so a panel without one carries no
        // empty tween; the panels either side of the window have none of them.
        //
        // First, the same settle the tiles make, at the slow cinematic length
        // rather than the scene one, so it is still going after the panel has
        // landed — and barely going, which is the point. On this panel it is
        // also the parallax: the plate is behind a wall, so it drifts back into
        // the cut rather than arriving flush with it.
        const settling = panel.querySelector<HTMLElement>(
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

        // Then the reveal down the inside of the cut, once the panel and the
        // reading are in. It starts lifted, which is the wall at its thinnest —
        // the reveal layer sits directly under the cut and shows no band at all
        // — and settles to where the band is fully open, so what the reader sees
        // is the wall gaining its thickness. Late enough to be caught on a panel
        // that has otherwise stopped, which is the whole of the beat.
        const detail = panel.querySelector<HTMLElement>(
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
        // the ring draws and the caption follows it, one after another along the
        // row. A clip rather than a set of faded parts — one property on one
        // element, and the caption cannot arrive ahead of its mark.
        const leaders = panel.querySelectorAll("[data-chapter-leader]");
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

        // Built once the whole landing exists, so a panel entered on the first
        // frame plays all of its beats and not just the ones declared above.
        ScrollTrigger.create({
          trigger: mark,
          start: "top 70%",
          onEnter: () => landing.timeScale(1).play(),
          onEnterBack: () => landing.timeScale(1).play(),
          onLeaveBack: () => landing.timeScale(DUR_ENTER / DUR_EXIT).reverse(),
        });

        // Differential drift across the panel's rise, in the archetype's own
        // order — which tile is the steady one is part of what tells the three
        // compositions apart.
        tiles.forEach((tile, t) => {
          const lag = LAG[data.arch][t] ?? 0;
          // A bled tile is pinned to the panel's edges and has none to give;
          // skipped rather than tweened to zero so it does not carry a
          // ScrollTrigger that recalculates on every resize to do nothing.
          if (lag === 0) return;
          gsap.fromTo(
            tile,
            { yPercent: lag },
            { yPercent: 0, ease: "none", scrollTrigger: rise(SCRUB_DRIFT) },
          );
        });

        // The push-in across the dwell, which is what keeps a pinned panel from
        // being a still. Every archetype marks the one layer that is its
        // picture rather than its frame — the photographs inside the tiles, the
        // plate behind the window's cut, the two crops inside the table's
        // apertures — so the composition holds the position it was drawn at and
        // only what is seen through it closes. Marked in the JSX rather than
        // selected by archetype here: which layer is the picture is a fact
        // about how a panel is built, and it belongs beside the building.
        //
        // Linear, because a dolly is a constant rate. The seam eases; the
        // camera carrying it does not, or the two curves beat against each
        // other and the seam reads as though it were hesitating.
        const pushed = panel.querySelectorAll("[data-chapter-push]");
        if (pushed.length > 0) {
          gsap.fromTo(
            pushed,
            { scale: 1 },
            {
              scale: 1 + PUSH_PER_SECOND * runEnd(data),
              ease: "none",
              scrollTrigger: dwell(),
            },
          );
        }

        // The flip run, drawn by the dwell. The seam is the reader's to pull
        // across: scrolling down advances it, scrolling back up uncrosses it,
        // and the end of the dwell is where the replacement stands fully
        // revealed. Nothing here runs on a clock of its own — the only time in
        // it is `DWELL_SCRUB`, which is the seam catching up to a reader who has
        // already stopped, not a run playing itself out regardless of one.
        //
        // One timeline for the whole panel rather than one per tile, so a panel
        // with more than one seam stays a sequence: 01's two share a single
        // scale, and the circle closes after the frame has turned however the
        // reader travels.
        const flips = data.tiles.flatMap((tile, t) =>
          tile.flip ? [{ flip: tile.flip, el: tiles[t] }] : [],
        );

        // One curve for all three tweens of a seam — the clip that uncovers the
        // incoming photograph and the two that drift the photographs behind it
        // — because they are one edge and any difference between their rates
        // shows up as the seam sliding off the pictures it is cutting between.
        if (flips.length > 0) {
          const run = gsap.timeline({
            defaults: { ease: SEAM_EASE },
            scrollTrigger: dwell(),
          });
          for (const { flip, el } of flips) {
            const incoming = el.querySelector<HTMLElement>(
              `.${styles.tileNext}`,
            )!;
            const outgoing = incoming.previousElementSibling!;
            const { at, dur: duration } = flip;
            const { from, axis, sign } = SEAM[flip.seam];
            run
              .fromTo(
                incoming,
                { clipPath: from },
                { clipPath: "inset(0% 0% 0% 0%)", duration },
                at,
              )
              .fromTo(
                incoming.querySelector("img"),
                { [axis]: sign * FLIP_ENTER },
                { [axis]: 0, duration },
                at,
              )
              .fromTo(
                outgoing.querySelector("img"),
                { [axis]: 0 },
                { [axis]: sign * FLIP_EXIT, duration },
                at,
              );
          }
        }

        // Covering the panel below. Its plate is occluded by this one outright,
        // but its type sits above every plate — that is what keeps the gobo
        // between the two — so it is clipped to this panel's top edge instead,
        // which is the same straight line doing the covering.
        const covered = panels[i - 1]?.querySelector<HTMLElement>(
          `.${styles.panelType}`,
        );
        if (covered) {
          gsap.fromTo(
            covered,
            { clipPath: "inset(0% 0% 0% 0%)" },
            {
              clipPath: "inset(0% 0% 100% 0%)",
              ease: "none",
              scrollTrigger: rise(),
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
          // How many seams this panel has to fit. Derived rather than written
          // down, so the two cannot drift — and present at zero, because it is
          // also what the stylesheet selects a pinning panel on.
          data-flips={chapter.tiles.filter((tile) => tile.flip).length}
          className={styles.chapter}
          style={
            {
              "--i": i,
              // Seconds the flip run takes. The stylesheet turns it into the
              // dwell at one pace for the whole act, and zeroes it where the
              // panels do not pin at all.
              "--run": runEnd(chapter),
            } as React.CSSProperties
          }
        >
          <div data-chapter-mark className={styles.chapterMark} aria-hidden />

          <div className={`${styles.panel} ${styles.panelType}`}>
            <div className={styles.panelInner}>
              <p className={`caps-label ${styles.chapterRail}`}>
                {chapter.rail}
              </p>

              {holds(chapter) ? (
                chapter.arch === "table" ? (
                  <TableComposition index={chapter.index} />
                ) : (
                  <WindowComposition index={chapter.index} />
                )
              ) : (
                <div className={styles.chapterText}>
                  <p
                    className={`caps-label ${styles.chapterIndex}`}
                    data-chapter-fade
                  >
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
                  <p
                    className={`caps-label ${styles.chapterCaption}`}
                    data-chapter-fade
                  >
                    {chapter.caption}
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className={`${styles.panel} ${styles.panelPlate}`}>
            <div className={styles.panelInner}>
              {/* The aperture panels keep the plate as the wall that covers
                  the panel below and nothing else: their composition is one
                  grid of openings and reading, and the two layers here are two
                  grids that only ever agree about a column width. It is drawn
                  in the type layer — see the archetype blocks in the
                  stylesheet. */}
              {!holds(chapter) && (
                <div className={styles.stack}>
                  {/* The sheet the composition stands on, offset up and out
                    behind the frame. Rendered ahead of the tiles because that
                    is the order it paints in — every one of these is
                    positioned, so DOM order is the z-scale inside the stack. */}
                  {chapter.arch === "portal" && (
                    <div
                      className={`${styles.glass} ${styles.glassSheet}`}
                      data-chapter-fade
                      aria-hidden
                    />
                  )}

                  {chapter.tiles.map(({ slot, image, flip }) => (
                    <div
                      key={slot}
                      className={`${styles.tile} ${SLOT_CLASS[slot]}`}
                      // Read by the stylesheet for the overscan the outgoing
                      // photograph needs on the side it drifts away from.
                      data-seam={flip?.seam}
                    >
                      {flip ? (
                        <>
                          <div
                            className={`${styles.tileLayer} ${styles.tileCurrent}`}
                          >
                            <TileImage image={image} slot={slot} />
                          </div>
                          <div
                            className={`${styles.tileLayer} ${styles.tileNext}`}
                          >
                            <TileImage image={flip.image} slot={slot} />
                          </div>
                        </>
                      ) : (
                        <TileImage image={image} slot={slot} />
                      )}
                    </div>
                  ))}

                  {/* And the sheet across its foot, which is the one that reads
                    as glass: it is the only layer in the act with a
                    photograph behind it to frost. */}
                  {chapter.arch === "portal" && (
                    <div
                      className={`${styles.glass} ${styles.glassBand}`}
                      data-chapter-fade
                      aria-hidden
                    />
                  )}

                  {/* The reading's ground on the bled panel. The dissolve gets
                    the photograph most of the way out of the words' way; this
                    settles the rest of it, and holds while the photograph
                    turns over to a darker one halfway through the dwell. */}
                  {chapter.arch === "bleed" && (
                    <div
                      className={styles.bleedHaze}
                      data-chapter-fade
                      aria-hidden
                    />
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Carries the dwell as flow height, and is how the capture script
              measures it now that it is not the same for every chapter. */}
          <div data-chapter-dwell className={styles.chapterDwell} aria-hidden />
        </article>
      ))}
    </div>
  );
}
