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
// The act ends the way trionn.com's does: five bands of Act 5's own dark climb
// the frame from the foot, the lowest first, and the Invitation is behind them
// when the last one closes. Nothing fades; the screen is taken.
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
import { useArrivalActStore } from "@/features/arrival/lib/act-store";
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
const HEADLINE = "Experience\nbeyond stay.";
const LEAD =
  "A collection of hours arranged around you — to wake in, to bathe in, to sit down to, and to remember.";
/**
 * The foot of the frame, which changes once. Two different sentences, so the
 * exchange is drawn as an exchange — the first leaving letter by letter under
 * the second arriving the same way — rather than as one line recoloured.
 */
const FOOT_FIRST = "One house. Many ways to spend a day.";
const FOOT_SECOND = "Hospitality. Reimagined for you.";

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

const WORD_LINES = WORDS.map((word, w) => ({
  word,
  // Quoted against the longest word rather than against the run, so the four
  // lines arrive together instead of in proportion to how long they are.
  glyphs: cut(word, (g) => (w + g / GLYPH_SPAN) / (WORDS.length + 1)),
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
 * A tenth of the section is about a third of a screen of scroll: long enough
 * to read as a dissolve rather than a cut, short enough that the reader is not
 * scrolling through a blank frame waiting for the words to arrive.
 */
export const FIELD_HANDOFF = 0.09;

/** Maps a beat window quoted against the whole section (0–1, the shape the
 *  four beats below were designed at) onto the span that is actually free to
 *  draw anything — after the hand-off sheet has closed. A linear map rather
 *  than an offset: it holds every beat's *proportion* of the remaining scroll
 *  exactly what it was of the whole, so the section still reads as the same
 *  four beats, only starting later. */
const rebase = (v: number): number => FIELD_HANDOFF + v * (1 - FIELD_HANDOFF);

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

/** A pair's start on the card timeline, and the span one card spends crossing
 *  the frame. Four pairs at this stagger fill the timeline exactly: the last
 *  pair is still arriving as the section's final screen is reached, so the
 *  field is never finished and standing still. */
const PAIR_STAGGER = 0.16;
const CARD_SPAN = 0.52;

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

const DEG = Math.PI / 180;

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
  /** How an ordinary letter leaves: a unit vector, a distance, and a tumble. */
  dirX: number;
  dirY: number;
  speed: number;
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
  const u = pair * PAIR_STAGGER + CARD_SPAN / 2;
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
  const setNavDark = useArrivalActStore((s) => s.setNavDark);

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
        const heroCount = HERO_MIN + Math.floor(rand() * (HERO_MAX - HERO_MIN));
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
          el.style.font = getComputedStyle(glyph).font;
          shardLayer.appendChild(el);

          const heading = (rand() * 2 - 1) * Math.PI;
          return {
            el,
            ox: box.left - stageBox.left + box.width / 2,
            oy: box.top - stageBox.top + box.height / 2,
            w: box.width,
            h: box.height,
            hero,
            tx: vw / 2 + (rand() * 2 - 1) * 0.15 * vw,
            ty: vh / 2 + (rand() * 2 - 1) * 0.15 * vh,
            grow: 6 + rand() * 4,
            dirX: Math.cos(heading),
            // Biased upward: letters thrown off a page mostly go up, and a
            // field that leaves evenly in all directions reads as an explosion
            // diagram rather than as paper caught by a draught.
            dirY: Math.sin(heading) * (rand() * 1.18 - 1),
            speed: (0.4 + rand() * 0.5) * reachOut,
            rotX: (rand() * 2 - 1) * 360,
            rotY: (rand() * 2 - 1) * 360,
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
            x = shard.ox + (shard.tx - shard.ox) * t;
            y = shard.oy + (shard.ty - shard.oy) * t;
            // Full size by half way, so the letter is enormous for the second
            // half of its crossing rather than only at the end of it.
            scale = 1 + (shard.grow - 1) * Math.min(1, t / 0.5);
            alpha =
              HERO_ALPHA *
              (t < 0.15 ? t / 0.15 : t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1);
          } else {
            x = shard.ox + shard.dirX * shard.speed * t;
            y = shard.oy + shard.dirY * shard.speed * t;
            scale = 1;
            alpha =
              t < shard.hold + 0.3 ? 1 : 1 - (t - shard.hold - 0.3) / 0.35;
          }
          alpha = clamp01(alpha);

          // The tumble, as two axis scales rather than as a rotation in space.
          // A letter is a flat thing; turning one about its own horizontal and
          // vertical is exactly the foreshortening a cosine gives, and it costs
          // the compositor nothing.
          const sx = Math.cos(shard.rotY * t * DEG);
          const sy = shard.hero ? 1 : Math.cos(shard.rotX * t * DEG);

          if (alpha <= 0 && shard.alpha <= 0) {
            shard.alpha = 0;
            continue;
          }
          if (Math.abs(alpha - shard.alpha) > 0.004) {
            shard.alpha = alpha;
            shard.el.style.opacity = alpha.toFixed(3);
          }
          shard.el.style.transform =
            `translate3d(${(x - shard.w / 2).toFixed(1)}px, ${(y - shard.h / 2).toFixed(1)}px, 0)` +
            ` rotate(${(shard.rotZ * t).toFixed(2)}deg)` +
            ` scale(${(scale * sx).toFixed(4)}, ${(scale * sy).toFixed(4)})`;
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

        const u = clamp01((p - CARDS_FROM) / (1 - CARDS_FROM));
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

      // The hand-over into Act 5. Five bands of the Invitation's own dark, each
      // growing up out of its own foot, the lowest first — so what crosses the
      // frame is a rising edge rather than a curtain, and the act ends on a
      // taken screen rather than a faded one.
      const next = document.querySelector<HTMLElement>('[data-act="5"]');
      const stripes = gsap.utils.toArray<HTMLElement>("[data-stripe]", stage);
      if (next && stripes.length) {
        const wipe = gsap.timeline({ paused: true });
        stripes.forEach((stripe, i) => {
          const at = (0.3 * (stripes.length - 1 - i)) / (stripes.length - 1);
          wipe.to(stripe, { scaleY: 1, duration: 0.3, ease: "none" }, at);
        });
        // A held tail, so the last band has closed before the pin releases and
        // the Invitation is never met through a gap.
        wipe.to({}, { duration: 0.1 });

        ScrollTrigger.create({
          trigger: next,
          start: "top bottom",
          end: "top top",
          onUpdate: (self) => {
            wipe.progress(self.progress);
            // The bar is over this act's ivory until the bands have most of the
            // frame, and over Act 5's dark after.
            setNavDark(4, self.progress >= 0.55);
          },
          onLeaveBack: () => setNavDark(4, false),
        });
      }
    }, section);

    return () => {
      ctx.revert();
      fieldLive = false;
      setNavDark(4, false);
    };
  }, [mobile, setNavDark]);

  return (
    <section
      ref={sectionRef}
      data-movement="experiences"
      className={styles.field}
      // What this height buys is the four beats. The shatter alone is a fifth
      // of it, and a card crosses the whole frame in half of it; shorter, and
      // the letters leave in the same screen the sentence arrives in.
      style={{ height: mobile ? "400vh" : "520vh" }}
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
                    sizes={mobile ? "44vw" : "18vw"}
                    alt={plate.alt}
                    loading={i < 2 ? undefined : "lazy"}
                  />
                </div>
                <div className={styles.cardFoot}>
                  <span className={styles.cardName}>{experience.name}</span>
                  <span className={styles.cardNote}>{experience.note}</span>
                </div>
                <span className={styles.cardMark} aria-hidden>
                  →
                </span>
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
          aria-hidden
        >
          {WORD_LINES.map(({ word, glyphs }) => (
            <span key={word} className={styles.word}>
              {glyphs.map(({ key, ch, beat }) => (
                <span
                  key={key}
                  data-glyph
                  className={styles.glyph}
                  style={{ "--c": beat } as React.CSSProperties}
                >
                  {ch}
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
            <a className={`caps-label ${styles.centreLink}`} href="/rooms">
              <span className={styles.centreLinkMark} aria-hidden>
                →
              </span>
              View all experiences
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

        <div className={styles.wipe} aria-hidden>
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} data-stripe className={styles.stripe} />
          ))}
        </div>
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
                  alt={plate.alt}
                  loading="lazy"
                />
              </div>
              <div className={styles.cardFoot}>
                <span className={styles.cardName}>{experience.name}</span>
                <span className={styles.cardNote}>{experience.note}</span>
              </div>
            </li>
          );
        })}
      </ul>
      <p className={styles.foot}>{FOOT_SECOND}</p>
    </section>
  );
}
