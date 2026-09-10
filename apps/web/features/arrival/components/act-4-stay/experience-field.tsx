"use client";

// Act 4 — "Stay", as one held screen on a bright ground.
//
// The act is a single pinned viewport and everything on it is a pure function
// of one number: how far the reader has scrolled through the section. Scroll
// and the screen assembles, stop and it stands, go back up and it disassembles
// along exactly the path it came. There is no clock anywhere in the movement.
//
// It runs in four beats on that one number:
//
//   1. Four words arrive, letter by letter, at the largest type in the ride.
//      One size for all four — the big/small relationship is the *length* of
//      the words, not their scale, which is what makes DINE and BATHE read as
//      a block rather than as a list.
//   2. The block shatters. Every letter becomes its own body and leaves on its
//      own vector with a tumble, and two or three of them instead grow toward
//      the centre of the frame at eight times their size and pass through it.
//      That is the act's one moment of real scale, and it is the reason the
//      opening is set in one size: the reader has to have read the words flat
//      before a single letter of them can be enormous.
//   3. Under the letters leaving, the sentence resolves: the chapter's words
//      set themselves at the centre where the block stood.
//   4. Two wheels far wider than the frame turn in on either side, and the
//      experiences ride them — the left column climbing out of the ground, the
//      right coming down from above, each card tilted with the rim it rides and
//      level at the height it is read at.
//
// The act hands directly to the Invitation frame. The next photograph rises
// over this pinned ivory stage, so there is no intermediate night-only screen.
//
// The movement opens on somebody else's frame. The corridor's statement is
// still standing when this stage pins over it, and the two sentences are meant
// to be one held screen rather than two stacked ones — so this stage draws
// nothing at all while it travels up into place: an ivory sheet, drawn at the
// value the statement is already in, comes up over it on this movement's own
// first tenth of scroll, and the four words arrive after the sheet has closed
// rather than under it. The corridor holds its own pin for exactly that tenth,
// so the sentence being given up is still rather than sliding away underneath —
// `FIELD_HANDOFF` is that shared fraction, and the corridor imports it rather
// than holding its own opinion of how long the hand-off takes.

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useRef } from "react";
import { tierSrc, tierSrcSet } from "@/features/arrival/lib/image-srcset";
import styles from "./act-4-stay.module.css";
import { EXPERIENCES, experiencePlate } from "./experiences";

/**
 * The four words, and the whole reason the stack is set in one size: STAY and
 * DINE are four letters, BATHE five, REST four — the block is nearly square,
 * and every apparent difference of scale in it is a difference of width.
 */
const WORDS = ["STAY", "REST", "BATHE", "DINE"];
/** Letters in the longest word — the ruler each line's own letters are beaten
 *  against, so the four lines arrive together rather than in proportion to how
 *  long they are. */
const GLYPH_SPAN = Math.max(...WORDS.map((w) => w.length));

/** The sentence that stands where the block stood. */
const HEADLINE = "Beyond\nthe room.";
const LEAD =
  "A collection of hours arranged around you — to wake in, to bathe in, to sit down to, and to remember.";
/**
 * The foot of the frame, which changes once. Two different sentences, so the
 * exchange is drawn as an exchange — the first leaving letter by letter under
 * the second arriving the same way — rather than as one line recoloured.
 */
const FOOT_FIRST = "One house. Many ways to spend a day.";
const FOOT_SECOND = "Forty rooms, one kitchen, a bath house open at six.";

/**
 * Both the block and the foot are drawn letter by letter, and every letter
 * carries its own beat in the run it belongs to. Cut here rather than in the
 * render, so a beat is a property of the text and not of the frame it is drawn
 * on.
 */
const cut = (text: string, beat: (i: number) => number) =>
  [...text].map((ch, i) => ({
    key: `${i}-${ch}`,
    ch,
    beat: beat(i).toFixed(3),
  }));

/**
 * The share of `--reveal` one letter spends resolving, and the number the
 * stylesheet divides the letter's own beat by. Written onto the block as a
 * custom property rather than typed out a second time in the CSS: the run of
 * beats below is cut to land the last letter's window exactly on `--reveal`
 * = 1, and a stylesheet holding its own opinion of how wide a window is would
 * break that agreement by an amount nobody could see until the bottom line of
 * the block never came into focus.
 */
const GLYPH_WINDOW = 0.45;

/** A letter's place in the run, before it is quoted against anything: its
 *  line, plus how far along that line it stands — measured against the longest
 *  word rather than against its own, so the four lines arrive together instead
 *  of in proportion to how long they are. */
const glyphPlace = (w: number, g: number) => w + g / GLYPH_SPAN;

/** The last letter's place, which is what the run is normalised against. */
const LAST_PLACE = Math.max(
  ...WORDS.map((word, w) => glyphPlace(w, word.length - 1)),
);

const WORD_LINES = WORDS.map((word, w) => ({
  word,
  // Normalised to end at `1 - GLYPH_WINDOW`, so the last letter of DINE opens
  // its window in time to close it on the same frame the beat does. Cut any
  // longer and the beat saturates while the bottom of the block is still
  // resolving, which leaves it soft and grey for the whole of the rest of the
  // screen — until the shatter swaps it for sharp debris.
  glyphs: cut(
    word,
    (g) => (glyphPlace(w, g) / LAST_PLACE) * (1 - GLYPH_WINDOW),
  ),
}));

const FOOT_LINES = [FOOT_FIRST, FOOT_SECOND].map((line) => ({
  line,
  glyphs: cut(line, (i) => i / line.length),
}));

/**
 * The share of this movement's own scroll the hand-off from the corridor
 * takes, and the one number the two movements agree on rather than each
 * holding its own opinion of. The corridor's statement is still on the frame
 * when this stage pins over it — that is the whole design of the seam, one
 * held screen rather than two — so the corridor has to keep its own stage
 * pinned for exactly this long to hold the sentence still while the sheet
 * comes up over it, and this movement's beats all have to wait for the sheet
 * to have closed before any of them starts.
 *
 * About a third of a screen of scroll: long enough to read as a dissolve
 * rather than a cut, short enough that the reader is not scrolling through a
 * blank frame waiting for the words to arrive.
 *
 * Quoted here against the *designed* sheet — the timeline the four beats were
 * cut on, before the cards' ride was stretched — and re-quoted against the
 * real section below, so the sheet keeps its length in scroll whatever the
 * ride is set to.
 */
const HANDOFF_DESIGN = 0.09;

/** Screens of scroll the designed sheet runs for (the section's height less
 *  the one viewport that stays pinned). The beats before the cards hold
 *  exactly this length; only the ride after them is stretched. */
const DESIGN_SCROLL = { wide: 4.2, narrow: 3 } as const;

/** Maps a beat window quoted against the designed sheet (0–1, the shape the
 *  four beats below were cut at) onto the span that is actually free to draw
 *  anything — after the hand-off sheet has closed. A linear map rather than an
 *  offset: it holds every beat's *proportion* of the remaining scroll exactly
 *  what it was of the whole, so the sheet still reads as the same four beats,
 *  only starting later. */
const design = (v: number): number => HANDOFF_DESIGN + v * (1 - HANDOFF_DESIGN);

/** Where the cards start on the designed sheet. */
const RIDE_FROM_DESIGN = design(0.52);

/**
 * How much longer the cards' ride is than it was designed at. The photographs
 * now dissolve into the ground rather than standing on plates, and a softer
 * card wants more air around it: the pairs are dealt further apart on the
 * wheel — see `PAIR_STAGGER`, which this figure tracks — and the section grows
 * by exactly the extra scroll that takes, so the
 * words, the shatter and the sentence are scrolled through at the pace they
 * were cut at.
 */
const RIDE_STRETCH = 2.36;

/** The whole section, in units of the designed sheet: the sheet up to the
 *  cards, then the ride stretched. */
const SHEET = RIDE_FROM_DESIGN + (1 - RIDE_FROM_DESIGN) * RIDE_STRETCH;

/** The section's height, in viewports: the pinned one plus the scroll. */
const sectionHeight = (mobile: boolean) =>
  `${((1 + DESIGN_SCROLL[mobile ? "narrow" : "wide"] * SHEET) * 100).toFixed(0)}vh`;

/** The share of this movement's own scroll the hand-off takes. The corridor
 *  imports it rather than holding its own opinion of how long that is. */
export const FIELD_HANDOFF = HANDOFF_DESIGN / SHEET;

/** A designed-sheet window, quoted against the real section. */
const rebase = (v: number): number => design(v) / SHEET;

// ---------------------------------------------------------------------------
// The section's progress, cut into beats. Every window below is a span of that
// one number, and they overlap on purpose: a beat that waits for the one before
// it to finish leaves the frame empty in between, and an empty frame is a third
// of a screen of scroll the reader spends waiting. None of them starts before
// `FIELD_HANDOFF` — the frame has nothing of its own to show until the sheet
// over the corridor's statement has closed.
// ---------------------------------------------------------------------------

/** The words arrive. Short — they are the first thing on the screen and the
 *  reader has not scrolled to be made to wait for them. */
const REVEAL: [number, number] = [rebase(0), rebase(0.13)];
/** The foot's exchange, held clear of the shatter so the two changes at the
 *  bottom and the middle of the frame are not read as one event. */
const FOOT_TURN: [number, number] = [rebase(0.18), rebase(0.42)];
/** The shatter. A fifth of the section: long enough for a letter to cross the
 *  frame and be gone, short enough that the reader is never scrolling through
 *  a field of debris. */
const SHATTER: [number, number] = [rebase(0.32), rebase(0.52)];
/** The sentence sets itself. Starts before the last letters have left, so the
 *  centre is never bare. */
const RESOLVE: [number, number] = [rebase(0.44), rebase(0.62)];
/** The wheels turn in, then carry the whole of the rest of the section. */
const WHEELS: [number, number] = [rebase(0.48), rebase(0.6)];
const CARDS_FROM = rebase(0.52);

/** Separate pairs by well over half a crossing, so a pair has left the middle
 *  of the frame before the next one reaches it and the ground between the
 *  images is clear rather than merely narrow. `RIDE_STRETCH` above carries the
 *  extra scroll that takes, so widening the gap does not speed the cards up.
 *  Normalize the full ride so every pair appears. */
const PAIR_STAGGER = 0.3;
const CARD_SPAN = 0.49;
const CARD_TIMELINE =
  (Math.ceil(EXPERIENCES.length / 2) - 1) * PAIR_STAGGER + CARD_SPAN;

// --- The wheels ------------------------------------------------------------

/**
 * Half the arc a stream is drawn on, in radians, and the only number that sets
 * how much the arc bows. The radius is solved from it rather than chosen: a
 * card has to leave the frame entirely at either end, so `R · sin(SWEEP)` is
 * fixed at half a viewport plus a card, and the sideways travel that leaves is
 * `R · (1 − cos SWEEP)`.
 *
 * A phone gets a much shallower one. The bow is a length, not a share of the
 * frame, so the figure that reads as a gentle curve across 1440px carries a
 * card clean off a 390px screen.
 */
const SWEEP = 0.62;
const SWEEP_NARROW = 0.3;
/** Where the innermost point of a wheel stands, as a fraction of the viewport
 *  width — also the closest a card ever comes to the sentence, and so the
 *  number that decides whether the middle of the frame is a clearing. */
const REACH = 0.2;
const REACH_NARROW = 0.11;
/** How far past the frame a card's arc carries it, in px. */
const OVERSHOOT = 96;
/**
 * The share of the rim's own tangent a card takes as tilt. Not the whole of it:
 * the tangent at the ends of this sweep is 35°, and a photograph hung at 35° is
 * a photograph of a crooked room. At a quarter the card leans with the wheel at
 * the edges of the frame and stands level at mid-height, which is the one place
 * it is actually read.
 */
const TILT = 0.26;

// --- The shatter -----------------------------------------------------------

/** How many letters are pulled out of the crowd and sent through the centre of
 *  the frame instead of off it. Two or three: one reads as an accident, four
 *  reads as a second block of type. */
const HERO_MIN = 2;
const HERO_MAX = 3;
/** What a hero letter is drawn at when it is eight times its size. Full ink at
 *  that scale is most of the frame painted black; held here it passes over the
 *  arriving sentence as a shadow of the word that was just there. */
const HERO_ALPHA = 0.5;

/**
 * The viewing distance a tumbling letter is drawn at, as a multiple of its own
 * rendered height.
 *
 * This is the number that makes the shatter a room rather than a sheet. A
 * letter turned about its own axes is foreshortened by exactly this ratio: at
 * infinity it is an axis scale and the letter reads as a flat card being
 * squashed, and the nearer the eye is put the harder the near edge grows
 * against the far one. Three and a bit is close enough that a letter caught
 * mid-turn is visibly a solid in a space, and far enough that it does not
 * distort into a wedge.
 *
 * Quoted against the letter's own size rather than fixed in pixels: a hero at
 * eight times its size is eight times further away, and so tumbles in the same
 * proportion the small ones do instead of tearing itself apart.
 */
const SHARD_VIEW = 3.4;

/**
 * How much of its flight an ordinary letter keeps its full ink for.
 *
 * Nearly all of it. Letters used to start dissolving half way across, which
 * left the middle of the frame holding a field of grey smoke that had to be
 * scrolled through — the block did not shatter so much as evaporate. A letter
 * leaves the frame; what fades is only the tail of the few that are slow
 * enough to still be on it when the beat closes.
 */
const FLIGHT_INK = 0.82;

/**
 * The size an ordinary letter ends its flight at, as a span the field is dealt
 * across. Not one number: a letter thrown toward the eye grows and one thrown
 * away shrinks, and a field where every piece stays the size it was is a field
 * with no depth in it at all — which is what the tumble alone could never fix.
 * The heroes are still the act's one moment of *real* scale; this is the depth
 * they need to be read against.
 */
const DEPTH_NEAR = 2.1;
const DEPTH_FAR = 0.42;

/**
 * How far past the centre of the frame a hero letter's mark stands, as a share
 * of the longer side of it.
 *
 * The mark used to be the centre itself, give or take a seventh, and that is a
 * letter that grows to eight times its size *and stays where the sentence is
 * about to be set*. Three of them at once left the middle of the screen under a
 * stack of enormous type for the whole of the resolve. Aimed off the frame
 * instead, the letter crosses the middle early — while it is still growing,
 * which is the moment worth seeing — and by the end only an edge of it is on
 * the screen at all, which is also how the reference draws its near letters.
 */
const HERO_EXIT = 0.72;
/**
 * What a shard has to be told to be drawn in the same type as the letter it
 * replaces, longhand by longhand.
 *
 * Longhand rather than the `font` shorthand, which is what this used to copy.
 * A computed `font` serialises to the empty string as soon as any longhand
 * outside the shorthand's own grammar is non-initial — and the block is set in
 * a variable face, so `font-variation-settings` is always non-initial and the
 * shorthand is always empty. Every shard was therefore handed nothing and drawn
 * at the 16px it inherited instead of the 152px it stood at: the block shattered
 * into letters a ninth of their size, which is most of the reason the beat had
 * no weight to it.
 *
 * `letter-spacing` is in the list because the block is tracked tight and the
 * glyph box the shard is centred on was measured with that tracking in it.
 */
const SHARD_FONT = [
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "font-variation-settings",
  "font-optical-sizing",
  "letter-spacing",
] as const;

/** The seed. The field has to be identical on the way back up — a reader who
 *  scrolls up through the shatter and down again must see the same letters go
 *  the same ways — so nothing here is drawn from Math.random. */
const SHATTER_SEED = 0x5741f3;

const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

const clamp01 = (v: number) => clamp(v, 0, 1);

const ramp = (a: number, b: number, v: number) => clamp01((v - a) / (b - a));

const smoothstep = (a: number, b: number, v: number) => {
  const t = ramp(a, b, v);
  return t * t * (3 - 2 * t);
};

/** mulberry32 — small, fast, and repeatable, which is the only property that
 *  matters here. */
const seeded = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

interface Shard {
  el: HTMLElement;
  /** Where the letter stood in the block, as the centre of its own box. */
  ox: number;
  oy: number;
  w: number;
  h: number;
  hero: boolean;
  /** Where a hero letter is going, and how much larger it gets. */
  tx: number;
  ty: number;
  grow: number;
  /** How an ordinary letter leaves: a unit vector, a distance, a tumble, and
   *  the size it arrives at — which is how near the eye it was thrown. */
  dirX: number;
  dirY: number;
  speed: number;
  depth: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  /** How long this letter holds full strength before it starts to go. */
  hold: number;
  /** Last opacity written, so a frame that changes nothing costs nothing. */
  alpha: number;
}

interface Card {
  el: HTMLElement;
  index: number;
  /** 1 for the left wheel (cards rise), −1 for the right (cards fall). Also
   *  the mirror: the right wheel's centre stands off the other side. */
  dir: 1 | -1;
  /** Which pair this card is in, and so when it starts. */
  pair: number;
  h: number;
  alpha: number;
}

/** Whether a live field is mounted. The reduced-motion variant has none, and
 *  `experienceScrollTarget`'s answer is meaningless without one. */
let fieldLive = false;

/**
 * Where card `index` stands at the middle of its own crossing, as an absolute
 * page offset — so the island menu and the turndown footer can aim at one
 * experience rather than at the top of the act. Returns null when no field is
 * mounted; callers fall back to the act anchor.
 */
export function experienceScrollTarget(index: number): number | null {
  if (typeof document === "undefined" || !fieldLive) return null;
  const section = document.querySelector<HTMLElement>(
    '[data-movement="experiences"]',
  );
  if (!section) return null;

  const pair = Math.floor(index / 2);
  const u = (pair * PAIR_STAGGER + CARD_SPAN / 2) / CARD_TIMELINE;
  const p = CARDS_FROM + u * (1 - CARDS_FROM);
  const top = section.getBoundingClientRect().top + window.scrollY;
  const scroll = Math.max(1, section.offsetHeight - window.innerHeight);
  return top + p * scroll;
}

export function ExperienceField({ mobile }: { mobile: boolean }) {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const wordsRef = useRef<HTMLDivElement>(null);
  const shardLayerRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    const stage = stageRef.current;
    const words = wordsRef.current;
    const shardLayer = shardLayerRef.current;
    const field = fieldRef.current;
    if (!section || !stage || !words || !shardLayer || !field) return;
    gsap.registerPlugin(ScrollTrigger);
    fieldLive = true;

    const ctx = gsap.context(() => {
      const sweep = mobile ? SWEEP_NARROW : SWEEP;

      const cards: Card[] = gsap.utils
        .toArray<HTMLElement>("[data-card]", field)
        .map((el) => {
          const index = Number(el.dataset.card);
          return {
            el,
            index,
            dir: index % 2 === 0 ? 1 : -1,
            pair: Math.floor(index / 2),
            h: 0,
            alpha: -1,
          } satisfies Card;
        });

      const nodes = gsap.utils.toArray<HTMLElement>("[data-node]", field);

      let vw = 1;
      let vh = 1;
      let reach = 0;
      let radius = 1;
      let shards: Shard[] = [];

      /**
       * Cut the block into letters. Every glyph's box is read off the live
       * layout — the block is real type in the real face at the real size, and
       * the shards start exactly where the letters were, so the moment the
       * stack hands over is not a moment the reader can see.
       */
      const buildShards = () => {
        shardLayer.replaceChildren();
        const rand = seeded(SHATTER_SEED);
        const glyphs = gsap.utils.toArray<HTMLElement>("[data-glyph]", words);
        const stageBox = stage.getBoundingClientRect();
        const reachOut = Math.max(vw, vh);

        // Which letters go through the centre instead of off the frame. Drawn
        // from the same seeded stream as everything else, so the choice is part
        // of the composition rather than a property of this page load.
        const heroCount =
          HERO_MIN + Math.floor(rand() * (HERO_MAX - HERO_MIN + 1));
        const heroes = new Set<number>();
        while (heroes.size < Math.min(heroCount, glyphs.length)) {
          heroes.add(Math.floor(rand() * glyphs.length));
        }

        shards = glyphs.map((glyph, i) => {
          const box = glyph.getBoundingClientRect();
          const hero = heroes.has(i);
          const el = document.createElement("span");
          el.textContent = glyph.textContent;
          el.className = hero
            ? `${styles.shard} ${styles.shardHero}`
            : styles.shard;
          const set = getComputedStyle(glyph);
          for (const property of SHARD_FONT) {
            el.style.setProperty(property, set.getPropertyValue(property));
          }
          // Born invisible. A shard is only ever placed by `scatter`, and a
          // rebuild past the end of the shatter — a refresh after a resize, or
          // a jump straight to the cards — skips every letter whose ink is
          // already gone rather than writing that zero; left at full ink, the
          // whole block would stand un-placed in the corner of the frame.
          el.style.opacity = "0";
          shardLayer.appendChild(el);

          const heading = (rand() * 2 - 1) * Math.PI;
          return {
            el,
            ox: box.left - stageBox.left + box.width / 2,
            oy: box.top - stageBox.top + box.height / 2,
            w: box.width,
            h: box.height,
            hero,
            tx: vw / 2 + Math.cos(heading) * HERO_EXIT * reachOut,
            ty: vh / 2 + Math.sin(heading) * HERO_EXIT * reachOut,
            grow: 6 + rand() * 4,
            dirX: Math.cos(heading),
            // Biased upward: letters thrown off a page mostly go up, and a
            // field that leaves evenly in all directions reads as an explosion
            // diagram rather than as paper caught by a draught.
            dirY: Math.sin(heading) * (rand() * 1.18 - 1),
            // Far enough to clear the frame. They used to be thrown barely
            // half a viewport and then faded where they stopped, which is why
            // the middle of the shatter was a cloud rather than an exit.
            speed: (0.78 + rand() * 0.72) * reachOut,
            depth: DEPTH_FAR + rand() * (DEPTH_NEAR - DEPTH_FAR),
            // A hero is readable type crossing the frame, not debris: it turns
            // enough to have a near edge and a far one and no further.
            rotX: (rand() * 2 - 1) * (hero ? 34 : 360),
            rotY: (rand() * 2 - 1) * (hero ? 42 : 360),
            rotZ: hero ? (rand() * 2 - 1) * 15 : (rand() * 2 - 1) * 180,
            hold: rand() * 0.3,
            alpha: -1,
          } satisfies Shard;
        });
      };

      const measure = () => {
        vw = window.innerWidth;
        vh = window.innerHeight;
        reach = (mobile ? REACH_NARROW : REACH) * vw;

        let tallest = 0;
        for (const card of cards) {
          card.h = card.el.offsetHeight;
          tallest = Math.max(tallest, card.h);
        }

        // The arc has to carry the tallest card entirely off the frame at
        // either end, or a stream's tail would be cut off in view.
        radius = (vh / 2 + tallest / 2 + OVERSHOOT) / Math.sin(sweep);
        stage.style.setProperty("--arc-d", `${(radius * 2).toFixed(0)}px`);
        stage.style.setProperty(
          "--arc-left",
          `${(reach - radius).toFixed(0)}px`,
        );
        stage.style.setProperty(
          "--arc-right",
          `${(vw - reach + radius).toFixed(0)}px`,
        );

        // The nodes sit on the drawn rim, evenly across the visible sweep —
        // the marks that say the cards are on a wheel and not on a rail.
        nodes.forEach((node) => {
          const dir = node.dataset.dir === "1" ? 1 : -1;
          const at = Number(node.dataset.node);
          const angle = sweep * at;
          const x =
            (dir === 1 ? reach : vw - reach) -
            dir * radius * (1 - Math.cos(angle));
          const y = vh / 2 + radius * Math.sin(angle);
          node.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
        });

        buildShards();
      };

      // Every CSS variable the stylesheet draws a beat from, and the last value
      // written for each — a beat that has not moved is not restated.
      const beats: [string, number][] = [
        ["--reveal", -1],
        ["--foot", -1],
        ["--shatter", -1],
        ["--resolve", -1],
        ["--wheels", -1],
        ["--shards", -1],
        ["--ground", -1],
      ];
      const beat = (i: number, v: number) => {
        if (Math.abs(v - beats[i][1]) <= 0.003) return;
        beats[i][1] = v;
        stage.style.setProperty(beats[i][0], v.toFixed(3));
      };

      /** The shatter, as the letters' own transforms. */
      const scatter = (t: number) => {
        for (const shard of shards) {
          let x: number;
          let y: number;
          let scale: number;
          let alpha: number;

          if (shard.hero) {
            // It leaves the frame rather than swelling to a stop in the
            // middle of it: the mark is already outside the screen, so the
            // letter crosses the centre early — while it is still growing —
            // and ends the beat cropped by an edge.
            x = shard.ox + (shard.tx - shard.ox) * t;
            y = shard.oy + (shard.ty - shard.oy) * t;
            // Full size by half way, so the letter is enormous for the second
            // half of its crossing rather than only at the end of it.
            scale = 1 + (shard.grow - 1) * Math.min(1, t / 0.5);
            alpha =
              HERO_ALPHA *
              (t < 0.12
                ? t / 0.12
                : t > FLIGHT_INK
                  ? 1 - (t - FLIGHT_INK) / (1 - FLIGHT_INK)
                  : 1);
          } else {
            x = shard.ox + shard.dirX * shard.speed * t;
            y = shard.oy + shard.dirY * shard.speed * t;
            // Toward the eye or away from it. The letter carries its throw all
            // the way out rather than holding the size it was set at, which is
            // what puts the field in a volume instead of on a pane.
            scale = 1 + (shard.depth - 1) * t;
            alpha =
              t < FLIGHT_INK ? 1 : 1 - (t - FLIGHT_INK) / (1 - FLIGHT_INK);
          }
          alpha = clamp01(alpha);

          if (alpha <= 0 && shard.alpha <= 0) {
            shard.alpha = 0;
            continue;
          }
          if (Math.abs(alpha - shard.alpha) > 0.004) {
            shard.alpha = alpha;
            shard.el.style.opacity = alpha.toFixed(3);
          }

          // The tumble, as a turn in a space with an eye in it.
          //
          // It used to be two axis scales — a cosine on each of the letter's
          // own axes, which is the foreshortening a camera at infinity would
          // give and costs the compositor nothing. What it also gives is a
          // letter with no near edge and no far one: it squashes symmetrically
          // and reads as a card being flattened rather than as a solid turning.
          // `perspective()` before the rotations is the whole difference, and
          // it is still one composited matrix.
          //
          // The distance is quoted off the letter's own drawn height, so a
          // hero at eight times its size is looked at from eight times as far
          // and turns in the same proportion the small ones do.
          const view = shard.h * scale * SHARD_VIEW;
          shard.el.style.transform =
            `translate3d(${(x - shard.w / 2).toFixed(1)}px, ${(y - shard.h / 2).toFixed(1)}px, 0)` +
            ` perspective(${view.toFixed(1)}px)` +
            ` rotateX(${(shard.rotX * t).toFixed(2)}deg)` +
            ` rotateY(${(shard.rotY * t).toFixed(2)}deg)` +
            ` rotateZ(${(shard.rotZ * t).toFixed(2)}deg)` +
            ` scale(${scale.toFixed(4)})`;
        }
      };

      /** One card's place on its wheel, for a crossing that is `a` done. */
      const place = (card: Card, a: number) => {
        // Zero at mid-height. The left wheel runs from below the frame to
        // above; the right one is the same sweep with the sign of its rise
        // flipped, which is what makes the pair counter-run rather than scroll
        // together.
        const angle = sweep * (1 - 2 * a) * card.dir;
        const y = vh / 2 + radius * Math.sin(angle);
        const bow = radius * (1 - Math.cos(angle));
        const anchor = card.dir === 1 ? reach : vw - reach;
        const x = anchor - card.dir * bow;
        // A share of the rim's tangent, so a card leans with the wheel where it
        // is entering and leaving and stands level where it is read.
        const tilt = -card.dir * angle * TILT * (180 / Math.PI);

        const alpha =
          a <= 0 || a >= 1 ? 0 : Math.min(ramp(0, 0.15, a), ramp(1, 0.85, a));
        if (alpha <= 0 && card.alpha <= 0) {
          card.alpha = 0;
          return;
        }
        if (Math.abs(alpha - card.alpha) > 0.004) {
          card.alpha = alpha;
          card.el.style.opacity = alpha.toFixed(3);
        }
        card.el.style.transform =
          `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)` +
          ` translate(-50%, -50%) rotate(${tilt.toFixed(2)}deg)`;
      };

      // The whole act, as a function of where the scrollbar stands. A jump
      // lands on exactly the frame a patient scroll would have reached, and the
      // way back up retraces the way down to the pixel.
      const layout = (p: number) => {
        // The sheet, over the corridor's held statement. Ramps to fully opaque
        // over the section's own first `FIELD_HANDOFF`, and every other beat
        // below is already zero for the whole of that span by construction —
        // rebased to start no earlier than the sheet finishes — so nothing this
        // movement draws is ever seen moving over a statement still standing.
        beat(6, smoothstep(0, FIELD_HANDOFF, p));

        beat(0, smoothstep(REVEAL[0], REVEAL[1], p));
        beat(1, ramp(FOOT_TURN[0], FOOT_TURN[1], p));
        beat(3, smoothstep(RESOLVE[0], RESOLVE[1], p));
        beat(4, smoothstep(WHEELS[0], WHEELS[1], p));

        const shatter = ramp(SHATTER[0], SHATTER[1], p);
        beat(2, shatter);
        // The block and its shards are never both on the frame: the instant the
        // first letter moves, the type the reader was reading is the shards.
        beat(5, shatter > 0 ? 1 : 0);
        if (shatter > 0) scatter(shatter);

        const u = clamp01((p - CARDS_FROM) / (1 - CARDS_FROM)) * CARD_TIMELINE;
        for (const card of cards) {
          place(card, clamp01((u - card.pair * PAIR_STAGGER) / CARD_SPAN));
        }
      };

      measure();

      // Webfont metrics decide where every letter of the block stands, and so
      // where every shard starts. Measured against a fallback face the shards
      // begin a few pixels off the type they replace, which is a visible jump
      // at the one frame the hand-over happens on.
      document.fonts?.ready.then(() => {
        measure();
        ScrollTrigger.refresh();
      });

      ScrollTrigger.create({
        trigger: section,
        start: "top top",
        end: "bottom bottom",
        pin: stage,
        pinSpacing: false,
      });

      ScrollTrigger.create({
        trigger: section,
        start: "top top",
        end: "bottom bottom",
        invalidateOnRefresh: true,
        onRefresh: (self) => {
          measure();
          layout(self.progress);
        },
        onToggle: (self) => layout(self.progress),
        onUpdate: (self) => layout(self.progress),
      });
    }, section);

    return () => {
      ctx.revert();
      fieldLive = false;
    };
  }, [mobile]);

  return (
    <section
      ref={sectionRef}
      data-movement="experiences"
      className={styles.field}
      // What this height buys is the four beats. The shatter alone is a fifth
      // of the designed sheet, and a card crosses the whole frame in half of
      // the stretched ride; shorter, and the letters leave in the same screen
      // the sentence arrives in.
      style={{ height: sectionHeight(mobile) }}
      aria-label="Stay"
    >
      <div ref={stageRef} className={styles.stage}>
        <div ref={fieldRef} className={styles.wheels} aria-hidden>
          {/* The wheels, drawn as the hairlines they are: two circles several
              viewports across, clipped by the stage to the slivers the cards
              ride, with the rim marked where nothing is passing. */}
          {([1, -1] as const).map((dir) => (
            <div
              key={dir}
              className={`${styles.arc} ${dir === 1 ? styles.arcLeft : styles.arcRight}`}
            />
          ))}
          {([1, -1] as const).map((dir) =>
            [-0.74, -0.26, 0.26, 0.74].map((at) => (
              <span
                key={`${dir}:${at}`}
                data-node={at}
                data-dir={dir}
                className={styles.arcNode}
              />
            )),
          )}

          {EXPERIENCES.map((experience, i) => {
            const plate = experiencePlate(experience);
            return (
              <article
                key={experience.slug}
                data-card={i}
                className={styles.card}
                style={{ opacity: 0 }}
              >
                <div className={styles.cardPlate}>
                  <img
                    src={tierSrc(plate.src, 640)}
                    srcSet={tierSrcSet(plate)}
                    sizes={mobile ? "52vw" : "(min-width: 1876px) 544px, 29vw"}
                    alt={plate.alt}
                    loading={i < 2 ? undefined : "lazy"}
                  />
                </div>
              </article>
            );
          })}
        </div>

        {/* The block, and the shards it becomes. They share a centre and never
            share a frame: `--shards` is the switch, and it is 1 from the first
            letter's first pixel of travel. */}
        <div
          ref={wordsRef}
          className={`font-display ${styles.words}`}
          style={{ "--glyph-window": GLYPH_WINDOW } as React.CSSProperties}
          aria-hidden
        >
          {WORD_LINES.map(({ word, glyphs }) => (
            <span key={word} className={styles.word}>
              {/* Two boxes per letter, and the split is what lets the letter
                  move at all: the outer one is its place in the line and never
                  moves, because the shatter reads every one of them to decide
                  where its debris starts and reads them at whatever point in
                  the reveal the layout was last measured. The inner one is the
                  letter's own arrival. */}
              {glyphs.map(({ key, ch, beat }) => (
                <span
                  key={key}
                  data-glyph
                  className={styles.glyph}
                  style={{ "--c": beat } as React.CSSProperties}
                >
                  <span className={styles.glyphInk}>{ch}</span>
                </span>
              ))}
            </span>
          ))}
        </div>
        <div ref={shardLayerRef} className={styles.shards} aria-hidden />

        {/* The chapter's furniture: the label at the head, the sentence that
            takes the centre and the foot that changes once. All of it above
            the wheels — the cards pass behind the words, never over them. */}
        <div className={styles.frame}>
          <p className={`caps-label ${styles.label}`}>
            Our experiences
            <span className={styles.labelRule} aria-hidden />
          </p>

          <div className={styles.centre}>
            <h2 className={`font-display ${styles.headline}`}>{HEADLINE}</h2>
            <p className={styles.lead}>{LEAD}</p>
            {/* The one way into the funnel on this screen, and the only one
                between the welcome line and the invitation four screens on. */}
            <a className={`caps-label ${styles.centreLink}`} href="/booking">
              <span className={styles.centreLinkMark} aria-hidden>
                →
              </span>
              See rooms and rates
            </a>
          </div>

          <div className={styles.foot} aria-hidden>
            {FOOT_LINES.map(({ line, glyphs }) => (
              <p
                key={line}
                className={line === FOOT_FIRST ? styles.footOut : styles.footIn}
              >
                {glyphs.map(({ key, ch, beat }) => (
                  <span
                    key={key}
                    className={styles.footGlyph}
                    style={{ "--c": beat } as React.CSSProperties}
                  >
                    {ch}
                  </span>
                ))}
              </p>
            ))}
          </div>
          {/* The foot's sentences are drawn letter by letter and read by nobody
              in that form; this is the one a screen reader is given. */}
          <p className={styles.sr}>{FOOT_SECOND}</p>
        </div>

        {/* The cards are `aria-hidden` — they are a moving arrangement of eight
            photographs and there is no reading order in them — so this list is
            the whole of the field's accessible content. */}
        <ul className={styles.register}>
          {EXPERIENCES.map((experience) => (
            <li key={experience.slug}>
              {experience.name} — {experience.note}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Reduced motion: the same screen, standing still — the words at rest, the
 *  sentence under them, and every experience laid out flat and legible. */
export function ExperienceFieldStatic() {
  return (
    <section className={styles.static} aria-label="Stay">
      <p className={`caps-label ${styles.label}`}>Our experiences</p>
      <p className={`font-display ${styles.staticWords}`}>{WORDS.join(" ")}</p>
      <h2 className={`font-display ${styles.headline}`}>{HEADLINE}</h2>
      <p className={styles.lead}>{LEAD}</p>
      <ul className={styles.staticGrid}>
        {EXPERIENCES.map((experience) => {
          const plate = experiencePlate(experience);
          return (
            <li key={experience.slug} className={styles.card}>
              <div className={styles.cardPlate}>
                <img
                  src={tierSrc(plate.src, 640)}
                  srcSet={tierSrcSet(plate)}
                  sizes="(max-width: 767px) 92vw, 30vw"
                  alt={`${experience.name}: ${plate.alt}`}
                  loading="lazy"
                />
              </div>
            </li>
          );
        })}
      </ul>
      <p className={styles.foot}>{FOOT_SECOND}</p>
    </section>
  );
}
