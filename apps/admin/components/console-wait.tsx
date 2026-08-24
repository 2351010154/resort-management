// What the console draws where a screen has not arrived yet.
//
// **It is not the guest site's curtain, and that is a decision rather than an
// omission.** `apps/web` covers its viewport with the house mark on ivory while
// a route resolves; doing that here would put a full-frame interstitial in
// front of a receptionist with a guest at the desk, several times a minute.
// `NFR-04` holds this console to sub-150ms feedback with no entrance animation
// on operational screens, and `(app)/layout.tsx` states the register: keyboard
// first and deliberately plain.
//
// So what this draws is the shape of the header that is about to land. Every
// screen family opens the same way — `p-8`, a caps kicker, a display
// line, and a rule under it — and this occupies exactly that geometry with the
// kicker filled in and the rest still empty. The effect when the screen lands
// is that the rule and the kicker stay where they are and the title fills in
// above them, rather than a page being swapped for another page.
//
// It lives in `components/` and not in `features/shell/` because two callers
// need it and they sit on opposite sides of the shell: `(app)/loading.tsx` is
// above the session guard's children, and the guard itself is in `lib/auth`.
// A presentational component under `lib/` would have `lib` importing a feature,
// which is the dependency direction `repository-structure.md` spends a section
// keeping straight.

import { Skeleton } from "@/components/ui/skeleton";

/**
 * The console's waiting state: a kicker, a rule, and no claim about progress.
 *
 * The rule pulses rather than travelling. A bar that fills implies a proportion
 * of the work is done, and nothing here knows one — a route chunk and a session
 * refresh both finish when they finish. A pulse says only "still working",
 * which is the honest amount.
 *
 * @param label What is being waited on, in the caps slot every console screen
 *   puts its family name in. Present tense, because it is still happening.
 */
export function ConsoleWait({ label = "Loading" }: { label?: string }) {
  return (
    // A `div` and not a `section`: `(app)/layout.tsx` already draws the `main`
    // this renders inside, and the not-found beside it makes the same choice
    // for the same reason — a transient fallback that adds a landmark leaves
    // anything reading the page in order with two answers to where the content
    // starts, and then takes one of them away again.
    <div
      aria-live="polite"
      className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8"
      role="status"
    >
      <span className="sr-only">{label}</span>
      <Skeleton className="h-9 w-48" />
      <Skeleton className="mt-2 h-5 w-80 max-w-full" />
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    </div>
  );
}
