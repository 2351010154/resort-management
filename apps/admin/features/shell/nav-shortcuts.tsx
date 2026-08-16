"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { useCommands } from "@/features/command-palette";
import { useStaffSession } from "@/lib/auth";
import { eventChordIds, useHotkeys } from "@/lib/keyboard";

import {
  NAV_PREFIX,
  NAV_SEQUENCE_TIMEOUT_MS,
  navCommandId,
  navItemsFor,
  navShortcut,
} from "./nav-inventory";

/* Reaching the rail without the mouse. Two ways in, one inventory behind both.
 *
 * **The palette's `Go to` group.** Every family the operator is offered is a
 * row under ⌘K, which is the entry point for the operator who knows where they
 * want to be and not which letter it is. The group was empty by design until
 * this existed; it is filled from the same list the rail draws, so a family
 * cannot be in one and missing from the other.
 *
 * **The `g` sequence.** `g` then a letter. The console has no unclaimed
 * modified chords worth spending — the browser and the window manager have
 * them — and two unmodified letters is the fastest thing a touch typist can do.
 *
 * The sequence is built out of the existing keyboard layer rather than beside
 * it: `g` arms, and while armed the fifteen destination letters are registered
 * as ordinary bindings. No second key listener, no parallel matching, and every
 * gate the registry already applies still applies — the letters do nothing
 * while focus is in a search field, nothing during IME composition, and nothing
 * against a modal that has bound the same letter one layer deeper.
 *
 * Headless, and mounted after the children for the reason the layout gives:
 * effects flush innermost-first, so a screen registering the same command id or
 * the same letter is registered before the shell and wins the palette row. The
 * bare `g` is the one binding a screen cannot take back, because the shell
 * registers it last at the shell's own depth; a surface that needs `g` for
 * itself declares a `KeyboardLayer` and outranks it by depth, which is how
 * every other global binding in the console is displaced.
 */

export function NavShortcuts() {
  const session = useStaffSession();
  const router = useRouter();
  // Whether `g` has been pressed and the console is waiting for the letter that
  // finishes the sequence. State rather than a ref because it decides whether
  // the destination letters are registered at all, and a ref would not
  // re-render the hook that registers them.
  const [armed, setArmed] = useState(false);

  const items =
    session.status === "authenticated"
      ? navItemsFor(session.user.role)
      : // Not reachable inside the guard, which renders nothing until there is
        // a session. Written out so the hooks below are called unconditionally
        // and register nothing rather than being skipped.
        [];

  const go = useCallback(
    (href: string) => {
      setArmed(false);
      router.push(href);
    },
    [router],
  );

  // Registered only while no sequence is in progress, so pressing `g` twice
  // reaches Guests — `g g` — instead of re-arming on itself.
  useHotkeys(
    NAV_PREFIX,
    () => {
      setArmed(true);
    },
    { enabled: !armed && items.length > 0 },
  );

  useHotkeys(
    items.map((item) => item.key),
    (event) => {
      // Which letter fired is asked of the same function the registry matched
      // on, not of `event.key` directly. A binding can be found by the physical
      // key when a layout or a modifier rewrote the typed one, and comparing
      // the typed character here would miss exactly the presses the registry
      // went to the trouble of catching.
      const pressed = new Set(eventChordIds(event));
      const item = items.find((one) => pressed.has(one.key));

      if (item === undefined) {
        setArmed(false);
        return;
      }

      go(item.href);
    },
    { enabled: armed },
  );

  useEffect(() => {
    if (!armed) {
      return;
    }

    // A `g` typed by accident must not still be armed when the operator's next
    // real key arrives, or that key navigates. The timer is the whole of the
    // disarming: a press that is not a destination letter leaves the sequence
    // standing for the rest of the window, which costs nothing, while a
    // keystroke-by-keystroke cancel would mean a second document listener
    // watching every key in the console to solve a case the clock already does.
    const timer = setTimeout(() => {
      setArmed(false);
    }, NAV_SEQUENCE_TIMEOUT_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [armed]);

  useCommands(
    items.map((item) => ({
      id: navCommandId(item),
      label: item.label,
      group: "navigation" as const,
      // The hint the palette prints comes from the chord the sequence above
      // binds, so a row cannot advertise a key that goes nowhere.
      shortcut: navShortcut(item),
      keywords: item.keywords,
      action: () => {
        go(item.href);
      },
    })),
  );

  return null;
}
