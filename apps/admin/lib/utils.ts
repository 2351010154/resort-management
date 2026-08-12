import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Joins class names and lets the last conflicting utility win.
 *
 * Every primitive in `components/ui/` takes a `className` prop and merges it
 * over its own defaults with this. `clsx` alone would emit both — `px-3` from
 * the primitive and `px-6` from the caller — and which one applied would come
 * down to the order Tailwind happened to emit the two rules in, not to the
 * order they were written. `twMerge` understands the namespaces and drops the
 * loser, so a caller overriding a default gets the override.
 *
 * This is the one place `components/ui/` reaches outside itself, which is why
 * it lives in `lib/` rather than beside the primitives: it is infrastructure
 * the screens use too.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
