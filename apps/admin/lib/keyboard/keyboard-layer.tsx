"use client";

import type * as React from "react";
import { createContext, useContext, useMemo } from "react";

// Which surface a hotkey belongs to, when several are open at once.
//
// The obvious model is registration order: the thing that bound Escape most
// recently gets it, and hands it back when it unmounts. That is right whenever
// surfaces open one after another — the operator opens a dialog over a screen —
// and it is *inverted* whenever they arrive together, because React flushes a
// child's effects before its parent's. A screen reached at
// `/arrivals?checkin=BK-5107` mounts the queue and the check-in sequence inside
// it in one commit; the sequence registers first, the queue second, and Escape
// would leave the screen entirely rather than close the sequence — discarding a
// half-finished check-in. The same inversion arrives with SSR hydration and
// with any Suspense boundary that reveals a surface already open.
//
// No ordering of effects can fix it, because layout effects run child-first
// too. What is missing is not a better order but the fact React never had:
// which surface is *inside* which. A layer is that fact, declared by the
// surface itself, and the registry prefers the deepest one.
//
// Screens do not think about this. A surface that stacks over another one wraps
// its subtree in `<KeyboardLayer>`; everything else inherits 0 and behaves the
// way registration order already implied.

const KeyboardLayerContext = createContext(0);

/** The depth of the surface the caller is inside. 0 is the screen itself. */
export function useKeyboardLayer(): number {
  return useContext(KeyboardLayerContext);
}

/**
 * Marks its children as one surface deeper than whatever contains them.
 *
 * ```tsx
 * <KeyboardLayer>
 *   <CheckInSequence />
 * </KeyboardLayer>
 * ```
 *
 * The sequence's Escape now wins over the queue's, whichever mounted first.
 *
 * Wrap the surface, not the screen: a layer that covers a whole screen makes
 * every binding on it outrank a dialog opened from it, which is the same defect
 * the other way round.
 */
export function KeyboardLayer({ children }: { children: React.ReactNode }) {
  const depth = useKeyboardLayer();
  const next = useMemo(() => depth + 1, [depth]);

  return (
    <KeyboardLayerContext.Provider value={next}>
      {children}
    </KeyboardLayerContext.Provider>
  );
}
