"use client";

// Movement II — "The Rooms": two wheels far bigger than the frame, standing
// clear of it on either side, with only the inner sliver of each on screen —
// two shallow arcs of photographs, the left one climbing out of the ground and
// the right one coming down from above, with the chapter's words standing
// still between them.
//
// The wheels are the scrollbar, read directly. A card's place on its arc is a
// pure function of the section's progress: scroll and the streams turn, stop
// and they stand, go back up and every card retraces its own path exactly.
// There is no clock and no momentum anywhere in the movement — the reader's
// hand is the only thing that has ever moved a room.
//
// Twelve rooms, twelve cards, laid out along the scroll rather than recycled.
// The day rooms ride the first stretch of the section and the night rooms the
// last, with a breath of arc between the sets, so the change of hour arrives
// as new rooms passing on a darkening ground — no card ever changes its
// picture, and a deep link into the dark half lands on night rooms because
// that is simply where they are.
//
// Cards only ever translate. Riding a wheel is what puts them on the arc; they
// are never rotated by it, because a room photographed level and then hung at
// an angle is a photograph of a crooked room. They come up out of the ground
// and sink back into it at either end rather than arriving at an edge: opacity
// is a function of how much of the card the frame is holding.
//
// The words in the middle change once, at dusk. The day sentence and the night
// sentence are different text, so the exchange is drawn as an exchange — the
// day lines drift up and out as the ground commits to dark and the night lines
// rise in under them — rather than as one block of type recoloured in place.
// The crossing rides `--type`, the same narrow window inside the ground's own
// ramp that the rest of the stage's ink turns on.
//
// The movement opens on somebody else's frame. The corridor's statement is
// still standing when this stage pins over it, and the two sentences are meant
// to be one held screen rather than two stacked ones — so this stage draws
// nothing at all while it travels up into place and then takes the centre over
// where it stands: an ivory sheet, identical to the one under it, comes up over
// the statement and the rooms' own words come up after it, on this movement's
// first tenth of scroll. The corridor holds its pin for that tenth so the
// sentence being given up is still rather than sliding away underneath.

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useRef } from "react";
import { useArrivalActStore } from "@/features/arrival/lib/act-store";
import { arrivalImages } from "@/features/arrival/lib/image-manifest";
import { tierSrc, tierSrcSet } from "@/features/arrival/lib/image-srcset";
import styles from "./act-4-stay.module.css";

const ROOM_IMG = arrivalImages["act-4-rooms"];
const pick = (slug: string) =>
  ROOM_IMG.find((i) => i.src.startsWith(`/images/act-4-rooms/${slug}-`))!;

interface Room {
  slug: string;
  name: string;
  note: string;
}

/** 0–5 are the day set, 6–11 the night one; the dusk ramp crosses between. */
const ROOMS: Room[] = [
  { slug: "room-cedar", name: "Cedar Suite", note: "68 m² · garden" },
  { slug: "room-mori", name: "Mori Pavilion", note: "94 m² · forest" },
  { slug: "room-park", name: "Park Suite", note: "72 m² · canopy" },
  {
    slug: "room-sky-lounge",
    name: "Sky Lounge Suite",
    note: "110 m² · skyline",
  },
  {
    slug: "room-washigamine",
    name: "Washigamine Suite",
    note: "88 m² · standing forest",
  },
  { slug: "room-bath", name: "The Bath House", note: "lap pool · 06:00–22:00" },
  { slug: "room-onsen", name: "Onsen Villa", note: "private spring · 41°C" },
  { slug: "room-table", name: "The Table", note: "eight seats · one sitting" },
  { slug: "room-library", name: "Library Suite", note: "76 m² · reading room" },
  { slug: "room-premier", name: "Premier Room", note: "58 m² · city" },
  {
    slug: "room-lantern",
    name: "Lantern Suite",
    note: "82 m² · lantern court",
  },
  { slug: "room-autumn", name: "Autumn Suite", note: "96 m² · dusk terrace" },
];

/** Rooms in a set. */
const HALF = 6;
/** Rooms in a set on one wheel — the left wheel carries the first half of each
 *  set and the right the second, so no room is ever on screen twice and each
 *  column runs three day rooms and then three night ones. */
const PER_SIDE = HALF / 2;
/**
 * The words at the centre, one pair for each half of the hour. Different text,
 * so the crossing at dusk is drawn as an exchange — the day lines out, the
 * night lines in — rather than as one sentence recoloured in place.
 */
const DAY_COPY = {
  headline: "Twenty-four rooms.\nNo two of them alike.",
  note: "Pick the light you want to wake in.",
};
const NIGHT_COPY = {
  headline: "And when the day turns,\nthe rooms turn with it.",
  note: "Choose the dark you want to sleep in.",
};
/**
 * Arc distance between consecutive cards on one wheel, in arc-parameters — the
 * whole visible sweep is 1, so a third of it holds about three cards to a
 * column at any moment, the same density the movement has always drawn. It is
 * the spacing the composition is built on: closer and the column reads as a
 * contact sheet, wider and the frame spends half its scroll holding one room.
 */
const STEP = 1 / 3;
/**
 * The right wheel runs half a step behind the left, so the two columns are
 * never level with each other — level, six cards read as three rows rather
 * than as two streams passing.
 */
const COUNTER_PHASE = STEP / 2;
/**
 * Extra clearance between the last day room and the first night one, in arc.
 * The sets are different hours and the gap is what keeps them from reading as
 * one continuous deck: the day stream visibly ends, the ground commits to
 * dark, and the night stream arrives on it.
 */
const SET_GAP = STEP / 2;
/**
 * Where the first card stands when the hand-off finishes: exactly at the foot
 * of its arc, a whole overshoot clear of the frame. The movement opens on the
 * sentence alone, and the first room is *brought in* by the first scroll —
 * nothing is already waiting on the frame for a reader who has not moved.
 */
const ENTRY = 0;
/** Arc phase of card `i` in its column: even spacing, the night set held a gap
 *  back, and the right column half a step behind throughout. */
const cardPhase = (dir: 1 | -1, i: number) =>
  i * STEP + (i >= PER_SIDE ? SET_GAP : 0) + (dir === -1 ? COUNTER_PHASE : 0);
/**
 * Total arc the columns travel over the movement's scroll, solved rather than
 * chosen: the hindmost card in the field — the right column's last, half a
 * step behind the left's — has crossed its whole arc by the section's final
 * screen. The movement ends the way it began, on the sentence alone: every
 * room has left the frame before Act 5 rises over it.
 */
const TRAVEL = cardPhase(-1, HALF - 1) + 1 - ENTRY;
/**
 * The share of a card the frame must be holding before the card is fully
 * opaque. Under it the card is fading, so both ends of every stream are cards
 * coming up out of the ground rather than cards being cut off by an edge.
 *
 * A third, not a half. The fade is meant to be an edge effect — the moment a
 * card is crossing the boundary — and at a half it is a state a card spends the
 * first sixth of its travel in, which puts pale cards well inside the frame and
 * reads as a wash over the whole stream rather than as an entrance.
 */
const EMERGE = 0.34;
/**
 * Half the arc a stream is drawn on, in radians, and the only number that sets
 * how much the arc bows. The wheel's radius is solved from it rather than
 * chosen: a card has to leave the frame entirely at either end, so
 * `R · sin(SWEEP)` is fixed at half a viewport plus a card, and the sideways
 * travel that leaves is `R · (1 - cos SWEEP)` — which reduces to
 * `(that fixed height) · tan(SWEEP / 2)`, a function of the sweep alone.
 *
 * A phone gets a much shallower one. The bow is quoted in pixels, not in
 * viewport widths, so the desktop figure that reads as a gentle curve across
 * 1440px is most of a phone's screen and carries the cards clean off it.
 */
const SWEEP = 0.66;
const SWEEP_NARROW = 0.28;
/**
 * Where the innermost point of a wheel stands, as a fraction of the viewport
 * width. The arc reaches that far in at mid-height and falls away from it
 * toward both ends, so this is also the closest the streams ever come to the
 * words — and the number that decides whether the middle of the frame is a
 * clearing or a corridor. At a quarter of the frame a card at mid-height came
 * within a finger's width of the copy at every desktop size; the streams have
 * to bow wide of the centre for the centre to read as the subject.
 */
const REACH = 0.165;
const REACH_NARROW = 0.1;
/**
 * The window, in `--dusk`, over which the centre's words make their exchange
 * and everything else that inherits `color` crosses from ink to ivory. Much
 * narrower than the ground's own crossing and centred inside it: ivory half
 * way to ink and night half way to ivory are the same grey, so type that
 * tracked the ground exactly went invisible for the whole of the crossing.
 * Held to one pole until the ground has committed, the words read on both
 * ends of the hour and spend a fraction of a screen of scroll in between.
 */
const TYPE_TURN: [number, number] = [0.42, 0.58];
/**
 * How far past the frame a card's arc carries it, in px — the room the edge
 * fade has to finish in, so a card is gone before its path runs out.
 */
const OVERSHOOT = 64;
/**
 * Section progress the ground crosses on, bright to dark. Smoothstepped over
 * the middle so both ends dwell: the reader arrives on a fully bright frame and
 * hands a fully dark one to the Invitation.
 */
const DUSK: [number, number] = [0.32, 0.72];
/**
 * The share of this movement's scroll the hand-off from the corridor takes.
 *
 * The corridor's statement is still on the frame when this stage pins over it —
 * that is the whole design of the seam, one held screen rather than two — so the
 * exchange between the two sentences has to happen after the pin, on this
 * movement's own scrub, and the corridor has to keep its stage pinned for
 * exactly this long to hold the sentence still while it goes. It is exported
 * because it is a contract between the two movements and not a taste either of
 * them holds alone.
 *
 * A tenth of the section is about a third of a screen of scroll: long enough to
 * read as a dissolve rather than a cut, short enough that the reader is not
 * scrolling through a blank frame waiting for the rooms to arrive.
 */
export const ORBIT_HANDOFF = 0.09;
/**
 * The three things the hand-off moves, as fractions of it.
 *
 * The sheet and the words overlap and the wheels wait, and both halves of that
 * are the point. Run in sequence — sheet all the way over, then words — the
 * frame empties in the middle and the reader scrolls through a third of a screen
 * of blank ivory; run together, the corridor's line and the rooms' line cross at
 * the same centre in the same face, one large and one small, and what that reads
 * as is the sentence changing rather than one leaving and another arriving. The
 * wheels are held out of it entirely and turn in afterwards, so the movement
 * assembles itself in front of the reader instead of being revealed already
 * composed.
 */
const HANDOFF_SHEET: [number, number] = [0, 0.62];
const HANDOFF_WORDS: [number, number] = [0.14, 0.66];
const HANDOFF_WHEELS: [number, number] = [0.46, 1];
/** Where `roomScrollTarget` lands a day room and a night room — inside the two
 *  dwells, so a link from the island menu arrives on a settled hour. The day one
 *  stands clear of the hand-off as well: landing inside it puts the reader on a
 *  frame that is still half the corridor's sentence. */
const DAY_DWELL = 0.16;
const NIGHT_DWELL = 0.82;

const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

const clamp01 = (v: number) => clamp(v, 0, 1);

const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * A card's drawn box. Cards share an area rather than a width: quoted by width
 * alone, an upright room covers nearly twice the frame a landscape one does at
 * the same nominal size, and the stream stops reading as one run of cards.
 * `base` is the side of the square of that shared area.
 */
const cardBox = (room: Room, base: number) => {
  const img = pick(room.slug);
  const aspect = img.width / img.height;
  const w = base * Math.sqrt(aspect);
  return { aspect, w, h: w / aspect };
};

/** Whether a live orbit is mounted — the reduced-motion variant has none, and
 *  `roomScrollTarget`'s answer is meaningless without one. */
let orbitLive = false;

/**
 * Absolute page offset at which room `index` is on the wheels, so the island
 * menu can aim at a room's hour rather than at the top of the act. Day rooms
 * land in the bright dwell, night rooms in the dark one. Returns null when no
 * orbit is mounted (the reduced-motion variant has none); callers fall back to
 * the act anchor.
 */
export function roomScrollTarget(index: number): number | null {
  if (typeof document === "undefined") return null;
  const section = document.querySelector<HTMLElement>(
    '[data-movement="rooms"]',
  );
  if (!section || !orbitLive) return null;

  const p = index < HALF ? DAY_DWELL : NIGHT_DWELL;
  const top = section.getBoundingClientRect().top + window.scrollY;
  // The stage pins with `pinSpacing: false`, so the section contributes
  // `height - 100vh` to the document and that is exactly the scrub's span.
  const scroll = Math.max(1, section.offsetHeight - window.innerHeight);
  return top + p * scroll;
}

interface Card {
  el: HTMLElement;
  room: Room;
  box: ReturnType<typeof cardBox>;
  /** Last opacity written, so a frame that has not changed one costs nothing. */
  alpha: number;
  /** Arc phase: how far behind the column's head this card rides. */
  phase: number;
  /** 1 for the left wheel (cards rise), -1 for the right one (cards fall). It
   *  is also the mirror: the right wheel's centre stands off the other side. */
  dir: 1 | -1;
}

/** Which room a column slot carries: the left wheel takes the first half of
 *  each set, the right wheel the second — day rooms first, night rooms after
 *  the gap — so no room is ever on screen twice. */
const cardRoom = (dir: 1 | -1, i: number): Room => {
  const set = i < PER_SIDE ? 0 : 1;
  const offset = (dir === 1 ? 0 : PER_SIDE) + (i % PER_SIDE);
  return ROOMS[set * HALF + offset];
};

export function RoomOrbit({ mobile }: { mobile: boolean }) {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const tailRef = useRef<HTMLDivElement>(null);
  const setNavDark = useArrivalActStore((s) => s.setNavDark);

  useEffect(() => {
    const section = sectionRef.current;
    const stage = stageRef.current;
    const field = fieldRef.current;
    if (!section || !stage || !field) return;
    gsap.registerPlugin(ScrollTrigger);
    orbitLive = true;

    const ctx = gsap.context(() => {
      const sweep = mobile ? SWEEP_NARROW : SWEEP;
      const cards: Card[] = gsap.utils
        .toArray<HTMLElement>("[data-card]", field)
        .map((el) => {
          const dir = el.dataset.dir === "1" ? 1 : -1;
          const i = Number(el.dataset.card);
          const room = cardRoom(dir, i);
          return {
            el,
            room,
            box: cardBox(room, 1),
            alpha: -1,
            phase: cardPhase(dir, i),
            dir,
          } satisfies Card;
        });

      let vw = 1;
      let vh = 1;
      let reach = 0;
      let radius = 1;

      const measure = () => {
        vw = window.innerWidth;
        vh = window.innerHeight;
        // The card's shared area, quoted as the side of its square. A phone
        // gets a share of its own width; a wide screen is capped, because a
        // room card is a card and not a hero image. Held a step under what the
        // frame could carry: the subject of this movement is the sentence in
        // the middle, and a card big enough to compete with it turns the
        // composition into three things fighting for one frame.
        const base = mobile
          ? clamp(vw * 0.34, 126, 190)
          : clamp(vw * 0.145, 168, 240);
        reach = (mobile ? REACH_NARROW : REACH) * vw;

        let tallest = 0;
        for (const card of cards) {
          card.box = cardBox(card.room, base);
          card.el.style.width = `${card.box.w.toFixed(1)}px`;
          tallest = Math.max(tallest, card.box.h);
        }

        // The arc has to carry the tallest card in the pool entirely off the
        // frame at either end, or a stream's tail would be cut off in view.
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
      };

      // The hand-off, as the three numbers the stylesheet draws it from:
      // `--ground` the ivory sheet that covers the corridor's statement,
      // `--enter` this movement's own words, `--wheels` the streams.
      //
      // All three are zero for the whole of the rise, which is the point: this
      // section is a viewport tall before it pins and it travels up through the
      // frame to get there, so anything it is drawing during that travel is
      // drawn *moving* over a statement that is standing still — which is
      // exactly the two-stacked-sentences the seam is supposed not to be. At
      // zero the rise is a pane of glass: what the reader sees is the corridor's
      // held statement, unmoved, until this movement's own scrub starts and
      // takes the frame over where it stands.
      const written = [-1, -1, -1];
      const parts: [string, [number, number]][] = [
        ["--ground", HANDOFF_SHEET],
        ["--enter", HANDOFF_WORDS],
        ["--wheels", HANDOFF_WHEELS],
      ];
      const handoff = (p: number) => {
        const u = clamp01(p / ORBIT_HANDOFF);
        for (let i = 0; i < parts.length; i++) {
          const [name, ramp] = parts[i];
          const v = smoothstep(ramp[0], ramp[1], u);
          if (Math.abs(v - written[i]) <= 0.004) continue;
          written[i] = v;
          stage.style.setProperty(name, v.toFixed(3));
        }
      };

      measure();

      let duskWritten = -1;

      // The whole movement, as a function of where the scrollbar stands.
      // Everything on the stage — the ground, the words, every card — is
      // derived from `p` alone, so a jump-scroll lands on exactly the frame a
      // patient scroll would have reached, and the way back up retraces the
      // way down to the pixel.
      const layout = (p: number) => {
        handoff(p);

        const dusk = smoothstep(DUSK[0], DUSK[1], p);
        if (Math.abs(dusk - duskWritten) > 0.002) {
          duskWritten = dusk;
          stage.style.setProperty("--dusk", dusk.toFixed(3));
          stage.style.setProperty(
            "--type",
            smoothstep(TYPE_TURN[0], TYPE_TURN[1], dusk).toFixed(3),
          );
        }

        // The columns' shared travel: zero while the hand-off runs, the whole
        // of `TRAVEL` by the section's last frame.
        const u = clamp01((p - ORBIT_HANDOFF) / (1 - ORBIT_HANDOFF));
        const head = ENTRY + u * TRAVEL;

        for (const card of cards) {
          const s = head - card.phase;

          // Angle about the wheel's centre, zero at mid-height. The left wheel
          // runs it from below the frame to above; the right one is the same
          // sweep with the sign of its rise flipped, which is what makes the
          // pair counter-run rather than scroll together.
          const angle = sweep * (1 - 2 * s) * card.dir;
          const y = vh / 2 + radius * Math.sin(angle);

          const top = y - card.box.h / 2;
          // The share of the card the frame is actually holding. Opacity is
          // taken from that rather than from the arc parameter, so a card
          // comes up to full as it clears the edge at whatever pace the reader
          // is scrolling, and goes back down the same way in reverse.
          const held = clamp01(
            (Math.min(top + card.box.h, vh) - Math.max(top, 0)) / card.box.h,
          );
          const alpha = smoothstep(0, EMERGE, held);
          // A card standing entirely off the frame is not moved: its next
          // entrance starts exactly where its exit ended, so nothing is
          // composited for the ten cards that are elsewhere on the scroll.
          if (alpha <= 0 && card.alpha <= 0) {
            card.alpha = 0;
            continue;
          }
          if (Math.abs(alpha - card.alpha) > 0.004) {
            card.alpha = alpha;
            card.el.style.opacity = alpha.toFixed(3);
          }

          // How far the arc has fallen away from its innermost point. Even in
          // the angle, so both ends of the stream sit equally far out.
          const bow = radius * (1 - Math.cos(angle));
          const anchor = card.dir === 1 ? reach : vw - reach;
          const x = anchor - card.dir * bow;
          card.el.style.transform = `translate3d(${(x - card.box.w / 2).toFixed(2)}px, ${top.toFixed(2)}px, 0)`;
        }
      };

      // The Invitation act is the pin's real end, not this section's bottom.
      // Released at `bottom bottom` the stage would scroll away over the last
      // viewport before Act 5 starts, leaving the ride's one genuinely bare
      // frame. Held to Act 5's top, the night sentence keeps the emptied
      // ground until the veil closes over it.
      const begin = document.querySelector<HTMLElement>('[data-act="5"]');
      ScrollTrigger.create({
        trigger: section,
        start: "top top",
        endTrigger: begin ?? section,
        end: begin ? "top top" : "bottom bottom",
        pin: stage,
        pinSpacing: false,
      });

      // Written on every update, not only on a change — the claim is shared
      // with the corridor, and `setNavDark` already returns the same state when
      // the claim matches, so re-stating it is free and never wrong.
      const syncNav = (p: number) =>
        setNavDark(4, smoothstep(DUSK[0], DUSK[1], p) >= 0.5);

      ScrollTrigger.create({
        trigger: section,
        start: "top top",
        end: "bottom bottom",
        invalidateOnRefresh: true,
        onRefresh: (self) => {
          measure();
          layout(self.progress);
        },
        // Fires on both boundaries, so the sheet is put back exactly when the
        // reader scrolls up out of this movement and the statement it was drawn
        // over becomes the frame again.
        onToggle: (self) => {
          layout(self.progress);
          if (self.isActive) syncNav(self.progress);
        },
        onUpdate: (self) => {
          layout(self.progress);
          syncNav(self.progress);
        },
      });

      // Exactly the window between the streams' last full frame and Act 5
      // taking the viewport: the veil closes on Act 5's own dark, which by then
      // is the value this ground has already reached. Nothing between the two
      // is bare.
      if (begin) {
        gsap.fromTo(
          tailRef.current,
          { opacity: 0 },
          {
            opacity: 1,
            ease: "power2.in",
            scrollTrigger: {
              trigger: begin,
              start: "top bottom",
              end: "top top",
              scrub: true,
            },
          },
        );
      }
    }, section);

    return () => {
      ctx.revert();
      orbitLive = false;
      setNavDark(4, false);
    };
  }, [mobile, setNavDark]);

  const wheel = (dir: 1 | -1) =>
    Array.from({ length: HALF }, (_, i) => {
      const room = cardRoom(dir, i);
      return (
        <article
          key={room.slug}
          data-card={i}
          data-dir={dir}
          className={styles.orbitCard}
          // Held back until the layout has a position and a fade for it. Every
          // card's first frame is the one it emerges on, never a stack of
          // twelve sitting in the corner of the stage.
          style={
            {
              opacity: 0,
              // The shape is fixed for the life of the node; only the width
              // moves, and `measure()` owns that.
              aspectRatio: pick(room.slug).width / pick(room.slug).height,
            } as React.CSSProperties
          }
        >
          {/* The card is the photograph and nothing else. The room's name is
              in the register below, which is where a name can be read rather
              than glimpsed, and in this image's own `alt`. */}
          <img
            src={tierSrc(pick(room.slug).src, 1280)}
            srcSet={tierSrcSet(pick(room.slug))}
            sizes={mobile ? "48vw" : "20vw"}
            alt={pick(room.slug).alt}
            loading={i === 0 ? undefined : "lazy"}
          />
        </article>
      );
    });

  return (
    <section
      ref={sectionRef}
      data-movement="rooms"
      className={styles.rooms}
      // The hour is what this height buys: the ground crosses from day to night
      // over the middle of it, and both ends have to dwell long enough to be
      // read as a time of day rather than as a transition passing through one.
      style={{ height: mobile ? "300vh" : "420vh" }}
      aria-label="The rooms"
    >
      <div ref={stageRef} className={styles.roomsStage}>
        {/* The sheet, the words and the wheels are all drawn from hand-off
            variables that start at zero in the stylesheet — so the first paint,
            and the whole of the travel before this stage pins, is a clear pane
            over the corridor's statement whether the scrub has spoken yet or
            not. */}
        <div ref={fieldRef} className={styles.orbitField}>
          {/* The wheels themselves, drawn as the hairlines they are. Two
              circles several viewports across, clipped by the stage to the
              slivers the cards ride. */}
          <div
            className={`${styles.orbitArc} ${styles.orbitArcLeft}`}
            aria-hidden
          />
          <div
            className={`${styles.orbitArc} ${styles.orbitArcRight}`}
            aria-hidden
          />

          <div className={styles.orbitWheel} aria-hidden>
            {wheel(1)}
            {wheel(-1)}
          </div>

          <div className={styles.orbitCopy}>
            {/* Both hours' words are in the DOM for the life of the stage,
                stacked on one grid cell; `--type` runs the exchange. Every
                line is clipped by its own mask and *slides* — up and out for
                the day words, up and in for the night ones, each line a beat
                behind the one above it — so the crossing reads as typesetting
                changing hands, never as a dissolve. Each block carries its own
                pole of the ink rather than the stage's mix: the day words
                exist only on the light ground and the night words only on the
                dark one, so neither is ever drawn in the mid-grey the crossing
                passes through. `--l` is the line's beat, in `--type`. */}
            {(
              [
                [DAY_COPY, styles.copyDay],
                [NIGHT_COPY, styles.copyNight],
              ] as const
            ).map(([copy, tone]) => (
              <div key={copy.note} className={`${styles.copyBlock} ${tone}`}>
                <p className={`font-display ${styles.orbitHeadline}`}>
                  {copy.headline.split("\n").map((line, i) => (
                    <span key={line} className={styles.lineMask}>
                      <span
                        className={styles.line}
                        style={{ "--l": i * 0.08 } as React.CSSProperties}
                      >
                        {line}
                      </span>
                    </span>
                  ))}
                </p>
                <p className={styles.orbitNote}>
                  <span className={styles.lineMask}>
                    <span
                      className={styles.line}
                      style={{ "--l": 0.16 } as React.CSSProperties}
                    >
                      {copy.note}
                    </span>
                  </span>
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* The cards are `aria-hidden`, so this list is the whole of the
            movement's accessible content: twelve rooms in one place, in the
            order the columns carry them. */}
        <ul className={styles.orbitRegister}>
          {ROOMS.map((room) => (
            <li key={room.slug}>
              {room.name} — {room.note}
            </li>
          ))}
        </ul>

        <div ref={tailRef} className={styles.tailFade} aria-hidden />
      </div>
    </section>
  );
}

/** Reduced motion: every room laid flat and legible at once. */
export function RoomOrbitStatic() {
  return (
    <section className={styles.rooms} aria-label="The rooms">
      <div className={styles.staticRooms}>
        {ROOMS.map((room) => (
          <figure key={room.slug}>
            <img
              src={tierSrc(pick(room.slug).src, 640)}
              srcSet={tierSrcSet(pick(room.slug))}
              sizes="(max-width: 767px) 92vw, 30vw"
              alt={pick(room.slug).alt}
              loading="lazy"
            />
            <figcaption className={`caps-label ${styles.cardMeta}`}>
              <span>{room.name}</span>
              <span>{room.note}</span>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
