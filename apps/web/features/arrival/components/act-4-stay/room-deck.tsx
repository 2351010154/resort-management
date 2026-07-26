"use client";

// Movement III — "The Rooms": two mirrored perspective cascades, day then
// night, played over the door that Movement II leaves standing open.
//
// A cascade is a run of cards on one ray from a vanishing point in the upper
// corner beside its list. A card's offset from that point and its size share a
// single factor, `r = GROWTH^(depth - SPAN)`, which is what makes the stack
// read as one perspective instead of a fan of separately scaled photos. Depth
// advances with scroll and, on its own, with time — the deck never stops.
//
// Because r is exponential in depth, the composition is self-similar under a
// shift of exactly one step: advance every card one depth, move the card that
// fell off the near end back to the far end, and the frame is the same one with
// the next room in it. That is the loop. There is no seam to hide and no scroll
// position at which the stage is empty — the cascade is full at every k, which
// is what lets the movement hand off to the Invitation without a gap.
//
// The night cascade runs the whole time and is revealed by a left-to-right wipe
// over the still-running day cascade, so neither half ever cuts to black.
//
// All per-frame work happens in one gsap.ticker callback reading a progress
// ref. ScrollTrigger only writes that ref (and the discrete tail fade), so
// nothing races for the same style property.

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useRef } from "react";
import { arrivalImages } from "@/features/arrival/lib/image-manifest";
import { tierSrc, tierSrcSet } from "@/features/arrival/lib/image-srcset";
import { useArrivalActStore } from "@/features/arrival/lib/act-store";
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
  { slug: "room-sky-lounge", name: "Sky Lounge Suite", note: "110 m² · skyline" },
  { slug: "room-washigamine", name: "Washigamine Suite", note: "88 m² · standing forest" },
  { slug: "room-bath", name: "The Bath House", note: "lap pool · 06:00–22:00" },
  { slug: "room-onsen", name: "Onsen Villa", note: "private spring · 41°C" },
  { slug: "room-table", name: "The Table", note: "eight seats · one sitting" },
  { slug: "room-library", name: "Library Suite", note: "76 m² · reading room" },
  { slug: "room-premier", name: "Premier Room", note: "58 m² · city" },
  { slug: "room-lantern", name: "Lantern Suite", note: "82 m² · lantern court" },
  { slug: "room-autumn", name: "Autumn Suite", note: "96 m² · dusk terrace" },
];

/** Rooms in a half. */
const HALF = 6;
/**
 * Card nodes in a half. A multiple of HALF on purpose: a node's slot in the
 * recycle is `ordinal mod POOL` and its room is `ordinal mod HALF`, so when
 * POOL is a multiple of HALF a node keeps one room for the life of the page.
 * No `src` ever changes under a visible card. The four nodes past SPAN are
 * parked at opacity 0 — the cost of that guarantee.
 */
const POOL = 12;
/** Depth, in steps, from spawn to fully off-frame. */
const SPAN = 8;
/** Size growth per step of depth. SPAN of them is the spawn/exit size ratio. */
const GROWTH = 1.24;
/** The depth the side list treats as the hero slot. */
const FOCUS_D = 5;
const CARD_ASPECT = 3 / 2;

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

/** Read off `third.mp4`: the OFF half's cards sit on a ray from just outside
 *  the upper-right corner and leave past the lower-left one. */
const NIGHT_FRAME: Frame = { vpx: 0.97, vpy: -0.09, ex: -0.53, ey: 1.33, ew: 0.8 };
const NIGHT_FRAME_NARROW: Frame = { vpx: 1.04, vpy: -0.05, ex: -1.0, ey: 1.24, ew: 1.5 };

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

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

const span01 = (v: number, a: number, b: number) => clamp01((v - a) / (b - a));

/** Shared clock for the idle drift, so `roomScrollTarget` can solve the same
 *  transform the ticker is drawing. */
let started = 0;

/**
 * Absolute page offset at which room `index` sits in the focus slot, so the
 * island menu can aim at a room rather than at the top of the act. Returns null
 * when the deck is not mounted (the reduced-motion variant has none); callers
 * fall back to the act anchor.
 */
export function roomScrollTarget(index: number): number | null {
  if (typeof document === "undefined") return null;
  const section = document.querySelector<HTMLElement>('[data-movement="rooms"]');
  if (!section || !started) return null;

  const [runStart, runEnd] = index < HALF ? DAY_RUN : NIGHT_RUN;
  const local = index % HALF;
  const drift = ((performance.now() - started) / 1000) * DRIFT;
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
  root: HTMLElement;
  cards: HTMLElement[];
  entries: HTMLElement[];
  frame: Frame;
  run: [number, number];
  focused: number;
}

export function RoomDeck({ mobile }: { mobile: boolean }) {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dayRef = useRef<HTMLDivElement>(null);
  const nightRef = useRef<HTMLDivElement>(null);
  const tailRef = useRef<HTMLDivElement>(null);
  const progress = useRef(0);
  const setNavDark = useArrivalActStore((s) => s.setNavDark);

  useEffect(() => {
    const section = sectionRef.current;
    const stage = stageRef.current;
    const day = dayRef.current;
    const night = nightRef.current;
    if (!section || !stage || !day || !night) return;
    gsap.registerPlugin(ScrollTrigger);
    started = performance.now();

    const ctx = gsap.context(() => {
      const nightFrame = mobile ? NIGHT_FRAME_NARROW : NIGHT_FRAME;
      const build = (root: HTMLElement, frame: Frame, run: [number, number]): Cascade => ({
        root,
        cards: gsap.utils.toArray<HTMLElement>("[data-card]", root),
        entries: gsap.utils.toArray<HTMLElement>("[data-room-entry]", root),
        frame,
        run,
        focused: -1,
      });
      const cascades = [
        build(day, mirrored(nightFrame), DAY_RUN),
        build(night, nightFrame, NIGHT_RUN),
      ];

      // One field response for the whole stage, not per-card hover.
      const spring = new SecondOrderSpring2(1.1, 0.55, 1.4);
      const pointer = { x: 0, y: 0 };
      let vw = 1;
      let vh = 1;
      let wipeWritten = -1;
      let dayCovered = false;

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
      };
      window.addEventListener("pointermove", onPointerMove, { passive: true });

      const tick = (_time: number, deltaTime: number) => {
        // Clamp the delta so a stalled tab cannot hand the spring a huge step.
        spring.setTarget(pointer.x, pointer.y);
        spring.update(Math.min(deltaTime, 64) / 1000);

        const p = progress.current;
        const drift = ((performance.now() - started) / 1000) * DRIFT;

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

          for (let i = 0; i < POOL; i++) {
            const ordinal = base - i;
            const depth = k - ordinal; // i <= depth < i + 1
            const node = c.cards[((ordinal % POOL) + POOL) % POOL];
            if (depth >= SPAN) {
              node.style.opacity = "0";
              continue;
            }
            const r = GROWTH ** (depth - SPAN);
            // Front cards answer the cursor by ~26px, the far ones barely.
            const reach = 26 * r;
            const cx = vpX + dx * r + spring.value.x * reach;
            const cy = vpY + dy * r + spring.value.y * reach * 0.6;
            node.style.transform =
              `translate3d(${(cx - w0 / 2).toFixed(2)}px, ${(cy - h0 / 2).toFixed(2)}px, 0) ` +
              `rotateY(${(spring.value.x * 4 * r).toFixed(3)}deg) ` +
              `scale(${r.toFixed(4)})`;
            node.style.opacity = (
              smoothstep(0, 1.4, depth) * (1 - smoothstep(SPAN - 0.9, SPAN, depth))
            ).toFixed(3);
            node.style.zIndex = String(200 + Math.round(r * 100));
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

        // One edge sweeps left to right: night owns everything behind it, day
        // everything ahead of it. The two clips are complements, so there is
        // never a column showing both halves and never one showing neither —
        // and both halves keep running the whole time, so neither side cuts.
        const edge = smoothstep(WIPE[0], WIPE[1], p);
        if (Math.abs(edge - wipeWritten) > 0.0005) {
          wipeWritten = edge;
          const pct = (edge * 100).toFixed(2);
          night.style.clipPath = `inset(0 ${(100 - edge * 100).toFixed(2)}% 0 0)`;
          day.style.clipPath = `inset(0 0 0 ${pct}%)`;
          const covered = edge > 0.5;
          if (covered !== dayCovered) {
            dayCovered = covered;
            day.setAttribute("aria-hidden", String(covered));
            night.setAttribute("aria-hidden", String(!covered));
            // At phone width both lists share one strip across the foot, so a
            // vertical wipe leaves them overlapping mid-sweep. The stage says
            // which half owns the strip; the breakpoint acts on it.
            stage.dataset.half = covered ? "night" : "day";
          }
        }
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
      started = 0;
      setNavDark(4, false);
    };
  }, [mobile, setNavDark]);

  const cascade = (
    rooms: Room[],
    ref: React.RefObject<HTMLDivElement | null>,
    title: string,
    side: string,
  ) => (
    <div ref={ref} className={`${styles.cascade} ${side}`}>
      <div className={styles.deck} aria-hidden>
        {Array.from({ length: POOL }, (_, node) => {
          const room = rooms[node % HALF];
          return (
            <article key={node} data-card={node} className={styles.card} style={{ opacity: 0 }}>
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

      <div className={styles.roomsList}>
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
      <div ref={stageRef} className={styles.roomsStage} data-half="day">
        {/* No ground of its own: the scrim over the open door belongs to the
            threshold's pinned stage, which is what this movement plays on. */}
        {cascade(ROOMS.slice(0, HALF), dayRef, "Day", styles.cascadeDay)}
        {cascade(ROOMS.slice(HALF), nightRef, "Night", styles.cascadeNight)}

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
