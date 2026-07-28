"use client";

// Movement III — "The Rooms": two mirrored perspective cascades, day then
// night, played over the door that Movement II leaves standing open.
//
// A cascade is a run of cards on one ray from a vanishing point in an upper
// corner. A card's offset from that point and its size share a single factor,
// `r = GROWTH^(depth - SPAN)`, which is what makes the stack read as one
// perspective instead of a fan of separately scaled photos. Depth advances with
// scroll and, on its own, with time — the deck never stops.
//
// Cards do not sit exactly on that ray: each is carried off it, normal to it,
// by an amount that grows with its depth. The trail leaves the vanishing point
// tight and spreads toward the front like a dealt hand. Single file the spacing
// a step of depth buys is shorter than a card is wide, so cards hid behind each
// other and none read as a whole photograph.
//
// Each half keeps a register down its own side. It is the standing answer to
// "what am I looking at"; hovering a card is the specific one. On hover the
// card slides clear of its neighbours, loses its scrim and takes a caption —
// and the register gets out of the way, because a card pulls back against the
// way its half recedes, straight into the column that half's names stand in.
//
// Because r is exponential in depth, the composition is self-similar under a
// shift of exactly one step: advance every card one depth, move the card that
// fell off the near end back to the far end, and the frame is the same one with
// the next room in it. That is the loop. There is no seam to hide and no scroll
// position at which the stage is empty — the cascade is full at every k, which
// is what lets the movement hand off to the Invitation without a gap.
//
// The night cascade runs the whole time and is revealed by a left-to-right wipe
// over the still-running day cascade, so neither half ever cuts to black. The
// two halves carry their own light — a grade on the photographs and a wash on
// the ground under them — which is what makes the crossing legible. The edge
// itself stays a hard cut; a soft band drawn on it read as a blurred smear.
//
// All per-frame work happens in one gsap.ticker callback reading a progress
// ref. ScrollTrigger only writes that ref (and the discrete tail fade), so
// nothing races for the same style property.

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useRef } from "react";
import { useArrivalActStore } from "@/features/arrival/lib/act-store";
import { arrivalImages } from "@/features/arrival/lib/image-manifest";
import { tierSrc, tierSrcSet } from "@/features/arrival/lib/image-srcset";
import { SecondOrderSpring2 } from "@/features/arrival/lib/second-order-spring";
import styles from "./act-4-stay.module.css";

const ROOM_IMG = arrivalImages["act-4-rooms"];
const pick = (slug: string) =>
  ROOM_IMG.find((i) => i.src.startsWith(`/images/act-4-rooms/${slug}-`))!;

interface Room {
  slug: string;
  name: string;
  note: string;
}

/** 0–5 are the day half, 6–11 the night half; the wipe crosses between them. */
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

/** Rooms in a half. */
const HALF = 6;
/**
 * Card nodes in a half. A multiple of HALF on purpose: a node's slot in the
 * recycle is `ordinal mod POOL` and its room is `ordinal mod HALF`, so when
 * POOL is a multiple of HALF a node keeps one room for the life of the page.
 * No `src` ever changes under a visible card. The six nodes past SPAN are
 * parked at opacity 0 — the cost of that guarantee.
 */
const POOL = 12;
/** Depth, in steps, from spawn to fully off-frame. */
const SPAN = 6;
/** Size growth per step of depth. SPAN of them is the spawn/exit size ratio. */
const GROWTH = 1.33;
/**
 * The hero slot, and the depth `roomScrollTarget()` aims a room at. Solved so
 * the card there is the largest one still whole in frame: at
 * `r = GROWTH^(FOCUS_D - SPAN)` its far edge clears the viewport edge the
 * cascade recedes toward. Deeper and the hero is cropped by the frame, which is
 * what it used to be.
 */
const FOCUS_D = 3;
const CARD_ASPECT = 3 / 2;
/**
 * The fan: how far each step of depth carries a card off the ray, normal to it,
 * in card widths. One direction for every card, so the trail leaves the
 * vanishing point tight and spreads toward the front like a dealt hand — where
 * a three-lane weave read as a zigzag rather than as one diagonal.
 *
 * It rides `r` and `depth`, both of which are functions of where a card is and
 * not of which node is drawing it, so the offset is continuous through the
 * recycle by construction. Nothing here has to divide POOL.
 */
const FAN = 0.05;
/**
 * How far a hovered card slides sideways, in card widths, to come out from
 * under the ones in front of it. About a card wide because that is what it
 * takes to be genuinely clear rather than merely nudged.
 *
 * Sideways rather than normal to the ray, which is what it used to be. The ray
 * falls about 60° below horizontal, so its normal is mostly vertical: the card
 * in the focus slot has under half its own height of frame left beneath it, and
 * the pull spent more than that going down. Hovering the one photograph worth
 * looking at drove it off the bottom of the screen. Horizontal is also the
 * direction this movement already clears — the register is on the side the
 * card slides toward, and gets out of the way for it.
 */
const PULL = 0.88;
/** Alpha of the scrim every card carries. The hovered one loses it as it comes
 *  out, which is the whole of the "brighter" — no filter is animated. */
const DIM = 0.26;
/** Seconds the pull and the scrim take to reach most of the way. */
const PULL_TAU = 0.22;
/** Seconds the register takes to clear out of a pulled card's way. Shorter than
 *  the pull, so the ground is free by the time the picture arrives on it. */
const LIST_TAU = 0.16;

/**
 * A cascade's frame, in viewport widths (x, widths) and heights (y).
 * `vp` is where a card at infinite depth would sit; `e` is the centre of a card
 * at the exit end, which has to be far enough out that the card is entirely
 * off-frame there — that is what makes the recycle invisible.
 */
interface Frame {
  vpx: number;
  vpy: number;
  ex: number;
  ey: number;
  ew: number;
}

/**
 * Read off `third.mp4`: the OFF half's cards sit on a ray from outside the
 * upper-right corner and leave past the lower-left one.
 *
 * The vanishing point sits a fifth of a viewport clear of the corner rather
 * than on it, and the exit a comparable distance further out, which lengthens
 * the ray by about a quarter without changing where on it a given depth lands
 * relative to its neighbours. That is what puts the trail on the frame's whole
 * diagonal: with the point on the corner, the first card the eye can see was
 * already a third of the way across, and the quarter of the frame between the
 * register and it was wall. The far end now spawns level with the register's
 * own column, and the near end bleeds the opposite corner on both edges rather
 * than only the side one.
 *
 * `ew` grows with the ray. The two are not independent — a longer ray with the
 * old card size spreads the same photographs thinner, which is the opposite of
 * what the length was for. At this size the largest whole card in frame is
 * about a third of the width (it was a quarter), and the one behind it, cropped
 * by the exit corner, a little over four tenths.
 */
const NIGHT_FRAME: Frame = {
  vpx: 1.185,
  vpy: -0.133,
  ex: -0.65,
  ey: 1.276,
  ew: 0.73,
};
const NIGHT_FRAME_NARROW: Frame = {
  vpx: 1.04,
  vpy: -0.05,
  ex: -1.0,
  ey: 1.24,
  ew: 1.16,
};

/** The day half is the same cascade reflected — list left, cards leaving right. */
const mirrored = (f: Frame): Frame => ({ ...f, vpx: 1 - f.vpx, ex: 1 - f.ex });

/** Section progress over which each half's depth advances. They overlap, so the
 *  night cascade is already mid-run when the wipe uncovers it. */
const DAY_RUN: [number, number] = [0.0, 0.56];
const NIGHT_RUN: [number, number] = [0.4, 1.0];
/** Depth a half travels across its run — one step is one room through focus,
 *  so a scroll of the run is very nearly one pass of that half's six. The idle
 *  drift rides on top, which is why "very nearly" is the honest word. */
const STEPS = 6.2;
/** Depth at the start of a run: room 0 sits in the focus slot. */
const K0 = FOCUS_D;
/** Section progress over which the night half wipes in, left to right. */
const WIPE: [number, number] = [0.46, 0.64];
/** Idle travel, in steps per second. The deck keeps moving with the page still. */
const DRIFT = 0.11;
/** Fraction of DRIFT the deck keeps while the pointer rests on a card. Not
 *  zero: a stopped deck reads as a bug, a slowed one reads as an answer. */
const HOVER_DRIFT = 0.12;
/** Seconds the brake takes to reach most of the way to its target. */
const BRAKE_TAU = 0.4;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

const span01 = (v: number, a: number, b: number) => clamp01((v - a) / (b - a));

/**
 * Idle travel accumulated so far, in steps. Accumulated by the ticker rather
 * than solved from a start time because the hover brake makes the rate vary —
 * `roomScrollTarget` reads this so its aim stays right whatever the pointer has
 * been doing. `deckLive` is the mounted flag those callers used to read off the
 * clock.
 */
let driftK = 0;
let deckLive = false;

/**
 * Absolute page offset at which room `index` sits in the focus slot, so the
 * island menu can aim at a room rather than at the top of the act. Returns null
 * when the deck is not mounted (the reduced-motion variant has none); callers
 * fall back to the act anchor.
 */
export function roomScrollTarget(index: number): number | null {
  if (typeof document === "undefined") return null;
  const section = document.querySelector<HTMLElement>(
    '[data-movement="rooms"]',
  );
  if (!section || !deckLive) return null;

  const [runStart, runEnd] = index < HALF ? DAY_RUN : NIGHT_RUN;
  const local = index % HALF;
  const drift = driftK;
  // Focus is `round(k - FOCUS_D) mod HALF` and k is `K0 + m * STEPS + drift`
  // with K0 = FOCUS_D, so the run fraction that focuses `local` is
  // `(local + HALF * n - drift) / STEPS`. STEPS > HALF, so some n always lands
  // inside the run.
  const n = Math.ceil((drift - local) / HALF);
  const m = clamp01((local + HALF * n - drift) / STEPS);

  const p = runStart + m * (runEnd - runStart);
  const top = section.getBoundingClientRect().top + window.scrollY;
  const scroll = Math.max(1, section.offsetHeight - window.innerHeight);
  return top + p * scroll;
}

interface Cascade {
  /** The clipped element: this half's cards and the ground under them. */
  root: HTMLElement;
  /** This half's register, which is not inside the clip and not inside the
   *  other half's paint order either. See `.roomsList`. */
  list: HTMLElement;
  cards: HTMLElement[];
  entries: HTMLElement[];
  /** Room index this half's list is currently marking, so the highlight is
   *  written on the frame it changes and not on all the others. */
  focused: number;
  /** Index into ROOMS of this half's first room, so a node's slot can be read
   *  back to the room in it when the caption needs naming. */
  roomOffset: number;
  /** Per-node pull, eased 0→1 while that node is the one under the pointer.
   *  Indexed by pool slot, which is what the recycle addresses. */
  pull: number[];
  /** Pool slot currently under the pointer, or -1. */
  hovered: number;
  /** Last scrim alpha written per node, so an unchanged card is not repainted
   *  every frame for nothing. */
  dimWritten: number[];
  frame: Frame;
  run: [number, number];
}

export function RoomDeck({ mobile }: { mobile: boolean }) {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dayRef = useRef<HTMLDivElement>(null);
  const nightRef = useRef<HTMLDivElement>(null);
  const dayListRef = useRef<HTMLDivElement>(null);
  const nightListRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLParagraphElement>(null);
  const tailRef = useRef<HTMLDivElement>(null);
  const progress = useRef(0);
  const setNavDark = useArrivalActStore((s) => s.setNavDark);

  useEffect(() => {
    const section = sectionRef.current;
    const stage = stageRef.current;
    const day = dayRef.current;
    const night = nightRef.current;
    const dayList = dayListRef.current;
    const nightList = nightListRef.current;
    if (!section || !stage || !day || !night || !dayList || !nightList) return;
    const caption = captionRef.current;
    gsap.registerPlugin(ScrollTrigger);
    driftK = 0;
    deckLive = true;

    const ctx = gsap.context(() => {
      const nightFrame = mobile ? NIGHT_FRAME_NARROW : NIGHT_FRAME;
      const build = (
        root: HTMLElement,
        list: HTMLElement,
        roomOffset: number,
        frame: Frame,
        run: [number, number],
      ): Cascade => ({
        root,
        list,
        cards: gsap.utils.toArray<HTMLElement>("[data-card]", root),
        entries: gsap.utils.toArray<HTMLElement>("[data-room-entry]", list),
        focused: -1,
        roomOffset,
        pull: new Array(POOL).fill(0),
        hovered: -1,
        dimWritten: new Array(POOL).fill(-1),
        frame,
        run,
      });
      const cascades = [
        build(day, dayList, 0, mirrored(nightFrame), DAY_RUN),
        build(night, nightList, HALF, nightFrame, NIGHT_RUN),
      ];

      // One field response for the whole stage, not per-card hover.
      const spring = new SecondOrderSpring2(1.1, 0.55, 1.4);
      const pointer = { x: 0, y: 0 };
      const pointerPx = { x: -1e5, y: -1e5 };
      let vw = 1;
      let vh = 1;
      let wipeWritten = -1;
      let dayCovered = false;
      // The brake reads last frame's hit test: the card boxes it tests against
      // are the ones the loop below draws, so the answer arrives after the
      // drift that positioned them. One frame of lag on a 0.4s ease.
      let onCard = false;
      let brake = 1;
      let listAway = 0;
      let dayOpWritten = -1;
      let nightOpWritten = -1;
      let captionRoom: string | null = null;
      let captionW = 0;
      let captionH = 0;

      const measure = () => {
        vw = window.innerWidth;
        vh = window.innerHeight;
        for (const c of cascades) {
          // The element carries its exit-end size; depth is applied as scale.
          c.root.style.setProperty("--card-w", `${c.frame.ew * vw}px`);
        }
      };
      measure();

      const onPointerMove = (e: PointerEvent) => {
        pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
        pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
        pointerPx.x = e.clientX;
        pointerPx.y = e.clientY;
      };
      window.addEventListener("pointermove", onPointerMove, { passive: true });

      const tick = (_time: number, deltaTime: number) => {
        // Clamp the delta so a stalled tab cannot hand the spring a huge step.
        const dt = Math.min(deltaTime, 64) / 1000;
        spring.setTarget(pointer.x, pointer.y);
        spring.update(dt);

        // Rest the pointer on a card and the deck all but stops, so the photo
        // under it can be looked at rather than watched going past.
        brake +=
          ((onCard ? HOVER_DRIFT : 1) - brake) *
          (1 - Math.exp(-dt / BRAKE_TAU));
        driftK += DRIFT * brake * dt;

        const p = progress.current;
        const drift = driftK;

        // One edge sweeps left to right: night owns everything behind it, day
        // everything ahead of it. The two clips are complements, so there is
        // never a column showing both halves and never one showing neither —
        // and both halves keep running the whole time, so neither side cuts.
        const edge = smoothstep(WIPE[0], WIPE[1], p);
        const edgeX = edge * vw;
        if (Math.abs(edge - wipeWritten) > 0.0005) {
          wipeWritten = edge;
          const pct = (edge * 100).toFixed(2);
          night.style.clipPath = `inset(0 ${(100 - edge * 100).toFixed(2)}% 0 0)`;
          day.style.clipPath = `inset(0 0 0 ${pct}%)`;
          // The decks are `aria-hidden` in the markup, so the lists are the
          // whole of this movement's accessible content — the half that is
          // covered has to be out of the tree, not just faded.
          const covered = edge > 0.5;
          if (covered !== dayCovered) {
            dayCovered = covered;
            dayList.setAttribute("aria-hidden", String(covered));
            nightList.setAttribute("aria-hidden", String(!covered));
          }
        }

        // A register is worth two multiplications: the wipe takes it away as
        // the edge crosses its column, and the pointer takes it away while a
        // card is out — the day cards pull left, straight into the column day's
        // names stand in, so the type has to clear the ground the picture is
        // moving onto. Written outside the wipe's guard because the second
        // factor moves when the edge does not.
        listAway +=
          ((onCard ? 1 : 0) - listAway) * (1 - Math.exp(-dt / LIST_TAU));
        const clear = 1 - listAway;
        const dayOp = (1 - smoothstep(0.02, 0.14, edge)) * clear;
        const nightOp = smoothstep(0.86, 0.98, edge) * clear;
        if (Math.abs(dayOp - dayOpWritten) > 0.004) {
          dayOpWritten = dayOp;
          dayList.style.opacity = dayOp.toFixed(3);
        }
        if (Math.abs(nightOp - nightOpWritten) > 0.004) {
          nightOpWritten = nightOp;
          nightList.style.opacity = nightOp.toFixed(3);
        }

        // The card under the pointer this frame, if any: the nearest one, since
        // where cards overlap the pointer belongs to the one on top.
        let hit = false;
        let nearest = 0;
        let hitCascade: Cascade | null = null;
        let hitSlot = -1;
        let hitRoom: Room | null = null;
        let hitX = 0;
        let hitY = 0;
        let hitTop = 0;

        for (const c of cascades) {
          const k = K0 + span01(p, c.run[0], c.run[1]) * STEPS + drift;
          const base = Math.floor(k);
          const f = c.frame;
          const vpX = f.vpx * vw;
          const vpY = f.vpy * vh;
          const dx = f.ex * vw - vpX;
          const dy = f.ey * vh - vpY;
          const w0 = f.ew * vw;
          const h0 = w0 / CARD_ASPECT;
          // Unit normal to the ray — the axis the fan is spread along — turned
          // so it always points down-frame. `(-dy, dx)` is a quarter turn, and
          // a quarter turn is not preserved by the reflection `mirrored()`
          // applies: taken raw it carried day's cards below their ray and
          // night's above theirs, so the two halves stood at different heights
          // and neither read as the other one flipped. `turn` is also the side
          // the half recedes toward, which is the side a pull comes back from.
          const len = Math.hypot(dx, dy) || 1;
          const turn = dx < 0 ? -1 : 1;
          const nx = (-dy / len) * turn;
          const ny = (dx / len) * turn;
          // Only the half that owns the pointer's column can be under it; the
          // other one is clipped away there.
          const owns =
            !mobile &&
            (c === cascades[1] ? pointerPx.x < edgeX : pointerPx.x >= edgeX);

          for (let i = 0; i < POOL; i++) {
            const ordinal = base - i;
            const depth = k - ordinal; // i <= depth < i + 1
            const slot = ((ordinal % POOL) + POOL) % POOL;
            const node = c.cards[slot];
            if (depth >= SPAN) {
              node.style.opacity = "0";
              // Snapped, not eased: this slot is off-frame and will re-enter at
              // the far end, where a leftover pull would show as a card sliding
              // in off its own ray.
              c.pull[slot] = 0;
              continue;
            }
            const r = GROWTH ** (depth - SPAN);
            // Front cards answer the cursor by ~26px, the far ones barely.
            const reach = 26 * r;
            // One direction for every card, growing with depth: tight at the
            // vanishing point, spread at the front. Both terms are functions of
            // where the card is, so this is continuous through the recycle.
            const fan = FAN * depth * w0 * r;
            // Eased last frame, from whether this slot was the one under the
            // pointer. Slides the card out from under the ones in front and
            // takes its scrim off as it goes.
            const t = c.pull[slot];
            // Where the card sits with the fan alone — the box the pointer is
            // tested against, so the pull cannot move its own hit target.
            const restX = vpX + dx * r + nx * fan + spring.value.x * reach;
            const restY =
              vpY + dy * r + ny * fan + spring.value.y * reach * 0.6;
            // Out to the side, against the direction the cascade recedes: back
            // toward the register, and along the one axis that has frame left
            // to give. The card holds its height, so nothing it does under the
            // pointer can put it off the bottom.
            const cx = restX - turn * t * PULL * w0 * r;
            const cy = restY;
            const opacity =
              smoothstep(0, 1.4, depth) *
              (1 - smoothstep(SPAN - 0.9, SPAN, depth));
            node.style.transform =
              `translate3d(${(cx - w0 / 2).toFixed(2)}px, ${(cy - h0 / 2).toFixed(2)}px, 0) ` +
              `rotateY(${(spring.value.x * 4 * r).toFixed(3)}deg) ` +
              `scale(${r.toFixed(4)})`;
            node.style.opacity = opacity.toFixed(3);
            // Depth alone decides who is in front, hover included. The pulled
            // card used to be lifted to the top of its half as well, because a
            // pull along the ray's normal left it still clipped by the
            // neighbour one step nearer — 1.33× wider, and overlapping by more
            // than that travel undid. Sideways it clears that neighbour
            // outright, so the lift bought nothing and cost the perspective:
            // it put a far, small card in front of the near, large ones, and
            // the depth the whole cascade is built on came apart under the
            // pointer. What is left is the true order, and a card that is
            // still emerging is still partly covered, which is what emerging
            // looks like.
            node.style.zIndex = String(200 + Math.round(r * 100));

            // The scrim is a paint, so it is only written when it has actually
            // moved — otherwise every card repaints every frame to say nothing.
            const dim = DIM * (1 - t);
            if (Math.abs(dim - c.dimWritten[slot]) > 0.004) {
              c.dimWritten[slot] = dim;
              node.style.setProperty("--dim", dim.toFixed(3));
            }

            // Hit-tested here rather than with pointer events on the cards: the
            // nodes parked past SPAN keep their last transform and would take
            // the pointer from the cards actually on screen. A card still
            // fading in or out is not one you can be studying. Nearest first,
            // so the card on top of a stack wins the pointer over the one it
            // is covering.
            //
            // Tested against where the card rests, not where the pull has put
            // it. A hover that displaces its own target is unstable: the card
            // slides out from under the cursor, the hover drops, the card
            // returns, and the whole thing oscillates — visibly, because the
            // register and the scrim ride on it. The pulled box counts too, but
            // only for the card already held, so following it with the cursor
            // keeps it rather than dropping it at the edge of the rest box.
            if (owns && opacity > 0.5 && r > nearest) {
              const hw = (w0 * r) / 2;
              const hh = (h0 * r) / 2;
              const held = c.hovered === slot;
              const on =
                (Math.abs(pointerPx.x - restX) < hw &&
                  Math.abs(pointerPx.y - restY) < hh) ||
                (held &&
                  Math.abs(pointerPx.x - cx) < hw &&
                  Math.abs(pointerPx.y - cy) < hh);
              if (on) {
                nearest = r;
                hit = true;
                hitCascade = c;
                hitSlot = slot;
                hitRoom = ROOMS[c.roomOffset + (slot % HALF)];
                // The caption follows the card you can see, not the box the
                // pointer is being measured against.
                hitX = cx;
                hitY = cy + hh;
                hitTop = cy - hh;
              }
            }
          }

          // Ease every slot toward its target for the next frame. Parked nodes
          // are snapped, so a card cannot come back round still half pulled.
          for (let s = 0; s < POOL; s++) {
            const target = c.hovered === s ? 1 : 0;
            c.pull[s] += (target - c.pull[s]) * (1 - Math.exp(-dt / PULL_TAU));
          }

          // Focus is written straight to the list nodes — never through state.
          const focus = ((Math.round(k - FOCUS_D) % HALF) + HALF) % HALF;
          if (focus !== c.focused) {
            c.focused = focus;
            for (const el of c.entries) {
              el.dataset.focus = String(Number(el.dataset.roomEntry) === focus);
            }
          }
        }

        for (const c of cascades) {
          c.hovered = c === hitCascade ? hitSlot : -1;
        }

        // The caption is a fixed element parked under the card, not something
        // inside it: card copy would be scaled by the depth and unreadable
        // everywhere but the front. Its text is only rewritten when the room
        // changes, which is once per hover rather than once per frame.
        if (caption) {
          if (hitRoom) {
            if (captionRoom !== hitRoom.slug) {
              captionRoom = hitRoom.slug;
              caption.textContent = `${hitRoom.name} · ${hitRoom.note}`;
              // One forced layout per hover, not per frame: the size only
              // changes when the words do.
              captionW = caption.offsetWidth;
              captionH = caption.offsetHeight;
            }
            // A card at the edge of the frame would hang its caption off the
            // side, and one at the foot would hang it off the bottom — both of
            // which the first version did. Below the card by default, above it
            // when below will not fit.
            const below = hitY + 18;
            const y =
              below + captionH > vh - 34 ? hitTop - 18 - captionH : below;
            const x = Math.min(
              Math.max(hitX, captionW / 2 + 24),
              vw - captionW / 2 - 24,
            );
            caption.style.transform = `translate3d(${(x - captionW / 2).toFixed(1)}px, ${Math.max(16, y).toFixed(1)}px, 0)`;
            caption.style.opacity = "1";
          } else if (captionRoom !== null) {
            captionRoom = null;
            caption.style.opacity = "0";
          }
        }

        onCard = hit;
      };

      gsap.ticker.add(tick);

      // The Invitation act is the pin's real end, not this section's bottom.
      // Released at `bottom bottom` the stage would scroll away over the last
      // viewport before Act 5 starts, leaving the ride's one genuinely empty
      // frame. Held to Act 5's top, the deck is still full when the veil closes
      // over it.
      const begin = document.querySelector<HTMLElement>('[data-act="5"]');
      ScrollTrigger.create({
        trigger: section,
        start: "top top",
        endTrigger: begin ?? section,
        end: begin ? "top top" : "bottom bottom",
        pin: stage,
        pinSpacing: false,
        // The ground here is the open door, which is dark the whole way.
        onToggle: () => setNavDark(4, true),
      });

      ScrollTrigger.create({
        trigger: section,
        start: "top top",
        end: "bottom bottom",
        invalidateOnRefresh: true,
        onRefresh: measure,
        onUpdate: (self) => {
          progress.current = self.progress;
        },
      });

      // There is no entrance tween. The stage sits a viewport below the end of
      // the threshold's scrub and climbs into frame on the page's own scroll,
      // which is the entrance: the door is open and settled before the stage's
      // top edge reaches the foot of the frame, and what crosses that edge is
      // the near end of the cascade, already composed at k = K0. Dissolved in
      // over the door instead, the two read as one muddled frame — arches and
      // photographs at half strength on top of each other — which is the whole
      // reason the cross-fade is gone.

      // Exactly the window between the deck's last full frame and Act 5 taking
      // the viewport: the veil closes on Act 5's own dark, which is the value
      // its steam then rises out of. Nothing between the two is bare.
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

      return () => {
        gsap.ticker.remove(tick);
        window.removeEventListener("pointermove", onPointerMove);
      };
    }, section);

    return () => {
      ctx.revert();
      driftK = 0;
      deckLive = false;
      setNavDark(4, false);
    };
  }, [mobile, setNavDark]);

  const cascade = (
    rooms: Room[],
    ref: React.RefObject<HTMLDivElement | null>,
    side: string,
  ) => (
    <div ref={ref} className={`${styles.cascade} ${side}`}>
      <div className={styles.deck} aria-hidden>
        {Array.from({ length: POOL }, (_, node) => {
          const room = rooms[node % HALF];
          return (
            <article
              // biome-ignore lint/suspicious/noArrayIndexKey: the deck is a fixed pool of DOM slots the animation addresses by position — `node` is the slot, not the room in it, which is why it is also the data-card the tweens select on.
              key={node}
              data-card={node}
              className={styles.card}
              style={{ opacity: 0 }}
            >
              <img
                src={tierSrc(pick(room.slug).src, 1280)}
                srcSet={tierSrcSet(pick(room.slug))}
                sizes={mobile ? "72vw" : "44vw"}
                alt={pick(room.slug).alt}
                loading={node < HALF ? undefined : "lazy"}
              />
            </article>
          );
        })}
      </div>
    </div>
  );

  const register = (
    rooms: Room[],
    ref: React.RefObject<HTMLDivElement | null>,
    title: string,
    side: string,
  ) => (
    <div ref={ref} className={`${styles.roomsList} ${side}`}>
      <p className={`caps-label ${styles.listTitle}`}>{title}</p>
      {rooms.map((room, i) => (
        <div
          key={room.slug}
          data-room-entry={i}
          data-focus={i === 0 ? "true" : "false"}
          className={styles.listItem}
        >
          <p className={`font-display ${styles.listItemName}`}>{room.name}</p>
        </div>
      ))}
    </div>
  );

  return (
    <section
      ref={sectionRef}
      data-movement="rooms"
      className={styles.rooms}
      style={{ height: mobile ? "340vh" : "700vh" }}
      aria-label="The rooms"
    >
      <div ref={stageRef} className={styles.roomsStage}>
        {/* No ground of its own: the scrim over the open door belongs to the
            threshold's pinned stage, which is what this movement plays on. */}
        {cascade(ROOMS.slice(0, HALF), dayRef, styles.cascadeDay)}
        {cascade(ROOMS.slice(HALF), nightRef, styles.cascadeNight)}

        {/* The registers are no longer drawn — the photographs are the whole
            interface, and a room is named by hovering it. They stay in the
            document because the decks are `aria-hidden`: without them this
            movement has no accessible content at all, only twelve pictures a
            screen reader is told to ignore. The wipe still moves `aria-hidden`
            between the two, so the half being shown is the half being read. */}
        {register(ROOMS.slice(0, HALF), dayListRef, "Day", styles.listDay)}
        {register(ROOMS.slice(HALF), nightListRef, "Night", styles.listNight)}

        {/* Parked under the hovered card by the ticker. Outside the deck, so
            the depth scale never touches the type. */}
        <p
          ref={captionRef}
          className={`caps-label ${styles.hoverCaption}`}
          aria-hidden
        />

        {/* The wipe's own edge, above both halves so it crosses the whole
            frame — the curtain, not the join between two clips. */}

        <div ref={tailRef} className={styles.tailFade} aria-hidden />
      </div>
    </section>
  );
}

/** Reduced motion: the whole deck laid flat, every room legible at once. */
export function RoomDeckStatic() {
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
