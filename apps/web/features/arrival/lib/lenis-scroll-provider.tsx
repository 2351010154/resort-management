"use client";

// Single scroll smoother for the whole experience. Lenis drives GSAP
// ScrollTrigger.
//
// Two scrubs, and which one a tween takes is a rule, not a taste. Anything that
// shares an edge with something else — a pin, a panel covering another, a
// track being translated — is `scrub: true`: Lenis has already smoothed the
// page, and a cover edge that lags the panel it is cutting is a gap. Anything
// that moves *relative* to the page — a parallax, a drift, a plate's breath, a
// block scaling in — is `scrub: SCRUB_DRIFT` (motion-tokens): smoothed a second
// time, so it trails the hand and goes on settling after the page has stopped.
// That second smoothing, on those layers only, is what a single-layer page
// cannot imitate by any setting of the smoother.
//
// The smoother's weight is not one setting for the ride. Sections claim a
// `ScrollWeight` for the stretch they own (see `useScrollWeight`), and the
// claims are a stack: the last section to take the viewport's midline is the
// one being read, so it wins, and releasing it falls back to whatever is still
// under it rather than to a guess. That makes a light section nested inside a
// cinematic act — which is exactly what Act 2's chapters are — work without
// either end knowing about the other.
//
// The weight is written onto `lenis.options`, which Lenis reads when an input
// dispatches a scroll rather than every frame: a change lands on the next
// notch of the wheel and never retimes a glide already in flight.

import Lenis from "lenis";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { prefersReducedMotion } from "@/features/arrival/lib/webgl-support";
import {
  SCROLL_WEIGHT_CINEMATIC,
  SCROLL_WEIGHTS,
  type ScrollWeightName,
} from "@/lib/motion-tokens";

const LenisContext = createContext<Lenis | null>(null);

/**
 * Where a live change to `wheelMultiplier` has to be written.
 *
 * Lenis 1.1.17 hands the multiplier to its VirtualScroll at construction, and
 * that copy is the one `onWheel` multiplies by — writing `lenis.options` alone
 * moves the lerp and nothing else, so a weight change silently applied half of
 * itself. Both are written: the public field because it is the documented one,
 * because a Lenis that read its own options live would honour it, and because
 * `lenis.options` should not describe an instance it no longer matches; the
 * private copy because it is what this version actually reads.
 *
 * Behind a shape check rather than a bare cast, so a Lenis that stops keeping a
 * copy degrades to the public write instead of throwing on an absent object.
 */
function wheelOptions(lenis: Lenis): { wheelMultiplier: number } | null {
  const { virtualScroll } = lenis as unknown as {
    virtualScroll?: { options?: { wheelMultiplier?: unknown } };
  };
  const options = virtualScroll?.options;
  return options && typeof options.wheelMultiplier === "number"
    ? (options as { wheelMultiplier: number })
    : null;
}

/** Claim/release for one section's weight. Null under reduced motion. */
interface WeightControl {
  claim(token: object, name: ScrollWeightName): void;
  release(token: object): void;
}

const WeightContext = createContext<WeightControl | null>(null);

/** Null while mounting, under reduced-motion, or on the server. */
export function useLenis(): Lenis | null {
  return useContext(LenisContext);
}

/**
 * Hold `name` while `ref`'s element has the middle of the viewport.
 *
 * Measured against the midline rather than an edge so the handover happens
 * once, where the reader's attention actually is, instead of twice — a section
 * entering at the bottom edge and the one above leaving at the top are two
 * different moments, and switching on either means the weight changes while
 * half the screen still belongs to the other.
 */
export function useScrollWeight(
  ref: RefObject<HTMLElement | null>,
  name: ScrollWeightName,
) {
  const control = useContext(WeightContext);

  useEffect(() => {
    const el = ref.current;
    if (!el || !control) return;
    gsap.registerPlugin(ScrollTrigger);

    // The token identifies this claim on the stack. The element itself would
    // do, but a token keeps the stack from depending on the node surviving —
    // a claim is released by its own effect cleanup, not by a DOM lookup.
    const token = {};
    const trigger = ScrollTrigger.create({
      trigger: el,
      start: "top center",
      end: "bottom center",
      onToggle: (self) =>
        self.isActive ? control.claim(token, name) : control.release(token),
    });

    return () => {
      trigger.kill();
      control.release(token);
    };
  }, [ref, name, control]);
}

export function LenisScrollProvider({ children }: { children: ReactNode }) {
  const [lenis, setLenis] = useState<Lenis | null>(null);
  const [weight, setWeight] = useState<WeightControl | null>(null);

  useEffect(() => {
    // Reduced motion: keep native scroll, no scrub animations mount.
    if (prefersReducedMotion()) return;

    gsap.registerPlugin(ScrollTrigger);
    const instance = new Lenis({
      lerp: SCROLL_WEIGHT_CINEMATIC.lerp,
      wheelMultiplier: SCROLL_WEIGHT_CINEMATIC.wheelMultiplier,
    });
    instance.on("scroll", ScrollTrigger.update);

    const raf = (time: number) => instance.raf(time * 1000);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);

    // Innermost-last. Claims nest rather than replace, so a light section
    // inside a cinematic act restores the act's weight when it lets go.
    const stack: { token: object; name: ScrollWeightName }[] = [];
    const wheel = wheelOptions(instance);
    const apply = () => {
      const top = stack.at(-1);
      const next = top ? SCROLL_WEIGHTS[top.name] : SCROLL_WEIGHT_CINEMATIC;
      instance.options.lerp = next.lerp;
      instance.options.wheelMultiplier = next.wheelMultiplier;
      if (wheel) wheel.wheelMultiplier = next.wheelMultiplier;
    };
    const drop = (token: object) => {
      const i = stack.findIndex((entry) => entry.token === token);
      if (i >= 0) stack.splice(i, 1);
    };
    const control: WeightControl = {
      claim(token, name) {
        drop(token);
        stack.push({ token, name });
        apply();
      },
      release(token) {
        drop(token);
        apply();
      },
    };

    setLenis(instance);
    setWeight(control);

    // Strict-mode double-mount is safe: cleanup fully tears down the instance.
    return () => {
      gsap.ticker.remove(raf);
      instance.destroy();
      setLenis(null);
      setWeight(null);
    };
  }, []);

  return (
    <LenisContext.Provider value={lenis}>
      <WeightContext.Provider value={weight}>{children}</WeightContext.Provider>
    </LenisContext.Provider>
  );
}
