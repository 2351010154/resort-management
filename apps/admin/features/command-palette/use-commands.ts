"use client";

import { useEffect, useRef, useState } from "react";

import type { ConsoleCommand } from "./command";
import { useCommandRegistrar } from "./command-registry";

/* Registering a screen's commands, for as long as the screen is on.
 *
 * The shape of this hook is set by one requirement: a screen must be able to
 * write its commands inline.
 *
 *   useCommands([
 *     { id: "arrivals.check-in", label: "Check in", group: "actions",
 *       action: () => openCheckIn(row.reference) },
 *   ]);
 *
 * That array is new on every render and so is the closure inside it, which is
 * exactly the pattern a naive effect turns into an infinite loop. The two
 * alternatives are both worse: obliging every screen to wrap its commands in
 * `useMemo` and every action in `useCallback` is a rule that will be followed
 * for about a month, and registering on every render re-renders the whole tree
 * under the provider on every render of any screen.
 *
 * So the array is split into the two things it actually contains. What the
 * palette *draws* — id, label, group, shortcut, keywords, disabled — is stable
 * text, and re-registration happens only when it changes. What a command
 * *does* is a closure, held in a ref and reached through a trampoline, so the
 * registered command always runs the newest one without the registration ever
 * having to be replaced. A row whose action closes over a value that changed
 * this render runs against the new value; a row whose label is unchanged does
 * not disturb anything.
 */

// The fields that decide whether the palette would render differently.
//
// The separators are named rather than typed, because the characters
// themselves would be invisible in this file. Control characters, because
// every field joined by them is operator-visible text that may contain any
// printable one — a label reading "Check in / out" must not produce the same
// signature as two commands whose fields happen to meet at a slash.
const FIELD_SEPARATOR = String.fromCharCode(31); // unit separator
const COMMAND_SEPARATOR = String.fromCharCode(30); // record separator

function signatureOf(commands: readonly ConsoleCommand[]): string {
  return commands
    .map((command) =>
      [
        command.id,
        command.label,
        command.group,
        command.shortcut ?? "",
        (command.keywords ?? []).join(","),
        command.disabled === true ? "1" : "",
        // The icon is a component reference rather than text. Identity is the
        // only thing available and a screen defining one inline would change it
        // every render, so it is deliberately not in the signature: an icon
        // that changes without any other field changing is not a case the
        // console has, and paying a re-registration per render to cover it is.
      ].join(FIELD_SEPARATOR),
    )
    .join(COMMAND_SEPARATOR);
}

/**
 * Offers a set of commands to the palette while the caller is mounted.
 *
 * Call it once per screen with everything that screen offers. Calling it twice
 * in one component works — each call is its own source — but a single list is
 * easier to read and gives the group a deliberate order.
 *
 * Must be inside `CommandRegistryProvider`, which the `(app)` layout mounts.
 */
export function useCommands(commands: readonly ConsoleCommand[]): void {
  const registrar = useCommandRegistrar();
  // One identity per calling component, created once. `useState` rather than
  // `useRef` because the initializer runs exactly once either way and this
  // spelling cannot be read before it is written.
  const [source] = useState(() => Symbol("commands"));
  const latest = useRef(commands);
  const signature = signatureOf(commands);

  // Not in an effect: an action fired between this render and the effects
  // being flushed — a press landing in that window — would otherwise run the
  // previous render's closure. Assigning during render is safe here because it
  // is a ref rather than state, and because the value written is the one this
  // render was given.
  latest.current = commands;

  // `signature` stands in for `commands` here, and the suppression is the whole
  // design of this hook rather than a shortcut around the rule. Depending on
  // the array itself would re-register on every render, which is what the
  // signature exists to avoid; the array is still read, through the ref, and
  // every field the palette draws is in the signature, so an unregistered
  // change is one that changes nothing on screen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the signature is the identity of `commands` that matters here
  useEffect(() => {
    const registered = latest.current.map((command) => ({
      ...command,
      action: () => {
        // Looked up by id at call time rather than by position: between
        // registration and the press, the list may have been rebuilt with the
        // same signature but a different order — a re-sorted queue whose rows
        // offer the same command.
        const current = latest.current.find((one) => one.id === command.id);
        current?.action();
      },
    }));

    return registrar.register(source, registered);
  }, [registrar, source, signature]);
}
