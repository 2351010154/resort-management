"use client";

import { useEffect, useRef } from "react";

import {
  type HotkeyHandler,
  type HotkeyOptions,
  registerHotkey,
} from "./hotkey-registry";
import { useKeyboardLayer } from "./keyboard-layer";

export interface UseHotkeysOptions extends HotkeyOptions {
  /**
   * Register only while true. A screen turns its bindings off rather than
   * branching inside every handler — an arrivals row that is mid-check-in
   * should not also answer the queue's shortcuts.
   */
  enabled?: boolean;
}

// Chords arrive as an array and have to survive a dependency array, which means
// collapsing to a string and back. Newline is the separator because it is the
// one character no chord spec can contain: a space is legal — "space" is an
// alias for it — and every other punctuation mark is a key somebody may bind.
const SPEC_SEPARATOR = "\n";

/**
 * Binds a hotkey for as long as the component is mounted.
 *
 * The handler is held in a ref and the effect does not depend on it, so a
 * caller may pass an inline arrow function without re-registering on every
 * render. That is the whole reason this hook exists rather than screens
 * touching the registry directly: the naive version either re-registers
 * constantly or obliges every screen to remember `useCallback`, and the second
 * is the kind of rule that is followed for about a month.
 *
 * The chords are joined for the same reason — a caller writing
 * `["mod+k", "/"]` inline builds a new array on every render, and an effect
 * depending on the array itself would unbind and rebind forever.
 */
export function useHotkeys(
  spec: string | readonly string[],
  handler: HotkeyHandler,
  options: UseHotkeysOptions = {},
): void {
  const {
    enabled = true,
    enableInFormField = false,
    preventDefault = true,
    stopPropagation = false,
  } = options;
  // Read from context rather than taken as an option: a surface declares its
  // depth once, by wrapping its subtree, and every hotkey inside inherits it.
  // An option would mean every call site restating a fact about where it sits.
  const layer = useKeyboardLayer();
  const handlerRef = useRef(handler);
  // Blank entries are dropped rather than parsed: a list assembled from data
  // can hold one before the data does, and `parseChord("")` is a throw.
  const specs = (typeof spec === "string" ? [spec] : spec)
    .filter((one) => one.trim() !== "")
    .join(SPEC_SEPARATOR);

  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    // An empty list is a screen whose shortcuts have not arrived yet — data
    // still loading, a row with none of its own. Nothing to bind, and binding
    // the empty string would throw out of an effect into the nearest error
    // boundary over a state that is merely early.
    if (!enabled || specs === "") {
      return;
    }

    return registerHotkey(
      specs.split(SPEC_SEPARATOR),
      (event) => {
        handlerRef.current(event);
      },
      { enableInFormField, preventDefault, stopPropagation, layer },
    );
  }, [
    specs,
    enabled,
    enableInFormField,
    preventDefault,
    stopPropagation,
    layer,
  ]);
}
