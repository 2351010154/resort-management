// Registers the arrival's three named eases with GSAP.
//
// The curves live in `@/lib/motion-tokens` as cubic-bezier strings so the
// stylesheet and the tween read one definition; this is the runtime half, the
// call that turns the string into an ease GSAP can be handed by name. It is
// idempotent — CustomEase overwrites a name it already holds with the same
// curve — so every component that tweens with one of these calls it in its own
// effect, next to `gsap.registerPlugin(ScrollTrigger)`, and none has to know
// whether another already did.

import gsap from "gsap";
import { CustomEase } from "gsap/CustomEase";
import {
  EASE_ENTER,
  EASE_ENTER_BEZIER,
  EASE_EXIT,
  EASE_EXIT_BEZIER,
  EASE_WIPE,
  EASE_WIPE_BEZIER,
} from "@/lib/motion-tokens";

let registered = false;

export function registerArrivalEases(): void {
  if (registered) return;
  gsap.registerPlugin(CustomEase);
  CustomEase.create(EASE_ENTER, EASE_ENTER_BEZIER);
  CustomEase.create(EASE_EXIT, EASE_EXIT_BEZIER);
  CustomEase.create(EASE_WIPE, EASE_WIPE_BEZIER);
  registered = true;
}
