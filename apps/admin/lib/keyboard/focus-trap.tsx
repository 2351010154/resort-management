"use client";

import type * as React from "react";
import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";
import { captureFocus } from "./focus-restore";

// Keeping Tab inside a surface until it is done with.
//
// Radix already traps focus inside `Dialog` and `Popover`, and anything built
// on those primitives needs nothing from this file. What needs it is the
// console's own in-place surfaces — the check-in sequence that opens inside the
// arrivals queue, the command palette — which are not dialogs in the DOM sense
// and would otherwise let Tab walk out into the navigation behind them while
// the operator believes they are still in the sequence.
//
// The trap is deliberately not a `role="dialog"`. Whether a surface is a dialog
// to a screen reader is the surface's decision, not the trap's; this component
// only owns where Tab goes.
//
// It owns *only* that, and the restraint is deliberate. An earlier shape of
// this component also watched `focusin` and pulled focus back whenever it
// landed outside the container. That is the version most focus traps ship, and
// it breaks two things here. Every Radix overlay in `components/ui/` — select,
// popover, dropdown, tooltip — renders through a portal into `document.body`,
// which is outside the container by construction: a room-type select inside a
// check-in sequence would have its listbox yanked away the instant Radix
// focused it, making the control unusable by keyboard. And two live traps —
// the palette over a sequence, which the comments above describe as normal —
// would each pull focus back from the other, synchronously, until the stack
// overflowed. Wrapping Tab is the actual requirement; the sentinel was a
// guess at robustness that cost more than it bought.

// Only the innermost trap acts. Two nested traps both wrapping Tab would
// disagree about which element is last, and the outer one would drag focus out
// of the inner surface on the press that should have wrapped inside it.
const stack: symbol[] = [];

// The elements a browser will Tab to. `[tabindex]:not([tabindex="-1"])` covers
// anything the console opts in by hand, including the roving-focus member whose
// active row carries tabindex 0.
const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/**
 * Whether Tab would actually reach this element.
 *
 * `checkVisibility` is the browser's own answer and accounts for `display`,
 * `visibility`, `content-visibility` and the `hidden` attribute at once. The
 * obvious hand-rolled substitute — `offsetParent !== null` — is wrong in both
 * directions: it reports null for anything `position: fixed`, which is what an
 * app shell's action bar will be, and it is not consulted at all for a native
 * control, whose `tabIndex` reads 0 with or without an attribute. A trap that
 * wrapped onto a hidden control would call `.focus()` on it, watch nothing
 * happen, and leave the operator pressing Tab against a dead surface.
 */
function isReachable(element: HTMLElement): boolean {
  if (typeof element.checkVisibility === "function") {
    return element.checkVisibility({
      checkOpacity: false,
      checkVisibilityCSS: true,
    });
  }

  return element.getClientRects().length > 0;
}

function tabbablesIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    isReachable,
  );
}

export interface FocusTrapProps extends React.ComponentProps<"div"> {
  /**
   * Trap while true. False leaves the container in the page as a plain div,
   * which is what a surface that is conditionally inert wants.
   */
  active?: boolean;
  /**
   * What to focus on open. Defaults to the first tabbable element, and falls
   * back to the container itself when there is none.
   */
  initialFocus?: React.RefObject<HTMLElement | null>;
  /** Return focus to whatever held it when the trap opened. On by default. */
  restoreFocus?: boolean;
  /**
   * Where focus goes if the element that held it is gone by the time the trap
   * closes — a row that was re-rendered, a queue that re-sorted. Without one,
   * focus lands on `<body>` and the operator's place in the screen is lost,
   * which is the failure `focus-restore.ts` exists to describe.
   */
  fallbackFocus?: React.RefObject<HTMLElement | null>;
}

export function FocusTrap({
  active = true,
  initialFocus,
  restoreFocus = true,
  fallbackFocus,
  className,
  children,
  ...props
}: FocusTrapProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!active || container === null) {
      return;
    }

    const token = Symbol("focus-trap");
    stack.push(token);

    const restorer = captureFocus();
    const initial = initialFocus?.current ?? tabbablesIn(container)[0] ?? null;

    if (initial === null) {
      // Nothing to focus yet — an empty sequence, or a panel still loading.
      // The container takes it so the operator is at least inside the surface,
      // and `tabIndex={-1}` on the element below is what makes that legal.
      container.focus({ preventScroll: true });
    } else {
      initial.focus({ preventScroll: true });
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab" || container === null) {
        return;
      }

      if (stack[stack.length - 1] !== token) {
        return;
      }

      const tabbables = tabbablesIn(container);
      if (tabbables.length === 0) {
        // Nowhere to go. Swallow it rather than let Tab leave a surface the
        // operator has not dismissed.
        event.preventDefault();
        return;
      }

      const first = tabbables[0];
      const last = tabbables[tabbables.length - 1];
      const focused = document.activeElement;

      // Focus outside the surface entirely. It gets here when the element
      // holding it was removed — a sequence swapping a step, a row
      // re-rendering — because the browser drops focus to `<body>` and fires no
      // event a listener could catch. The next Tab is the first chance to
      // notice, and without this branch it is the press that walks into the
      // navigation behind the trap.
      if (focused === null || !container.contains(focused)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus({ preventScroll: true });
        return;
      }

      if (event.shiftKey && (focused === first || focused === container)) {
        event.preventDefault();
        last.focus({ preventScroll: true });
        return;
      }

      if (!event.shiftKey && focused === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    }

    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);

      const at = stack.lastIndexOf(token);
      if (at !== -1) {
        stack.splice(at, 1);
      }

      if (restoreFocus && !restorer.restore()) {
        // The element that held focus is gone. `restore` reports that rather
        // than pretending, so there is something to do about it here.
        fallbackFocus?.current?.focus({ preventScroll: true });
      }
    };
  }, [active, initialFocus, restoreFocus, fallbackFocus]);

  return (
    <div
      ref={containerRef}
      // Focusable but not tabbable: the effect above focuses the container when
      // the surface has no controls of its own, and without this that call is a
      // no-op that leaves focus on `<body>` outside the trap.
      tabIndex={-1}
      // A focus-landing container, so it keeps the outline suppression that
      // `components/ui/` reserves for exactly this case — the operator is being
      // put inside the surface, and ringing the whole panel every time one
      // opens marks the container rather than the control they will use.
      className={cn("outline-none", className)}
      {...props}
    >
      {children}
    </div>
  );
}
