"use client";

import type * as React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import type { ConsoleCommand } from "./command";

/* Where the palette's contents come from.
 *
 * The palette is mounted once, in the `(app)` layout, and knows none of the
 * commands it shows. Screens declare their own with `useCommands` and the
 * provider collects them; a command therefore exists exactly while the screen
 * that owns it is on, which is the only definition that stays true as the
 * console grows. The alternative — one central list of every command in the
 * console, each with a guard saying when it applies — is a file that every
 * screen has to remember to edit and that nothing fails when they don't.
 *
 * Registrations are held by source rather than merged into one array. A source
 * is one `useCommands` call, and it replaces its own contribution wholesale
 * when it changes; without that identity, a screen unmounting could only
 * remove its commands by value, and two screens offering the same command
 * would take each other's away.
 *
 * There are two contexts, not one, and the split is a performance fact rather
 * than a style: every screen that registers reads the registrar, and the list
 * changes whenever any screen anywhere mounts. One combined context would
 * re-render every registrant on every navigation for a value none of them
 * read.
 */

type Source = symbol;

interface CommandRegistrar {
  /** Publishes a source's commands and returns the function that withdraws them. */
  register(source: Source, commands: readonly ConsoleCommand[]): () => void;
}

const CommandRegistrarContext = createContext<CommandRegistrar | null>(null);
const CommandListContext = createContext<readonly ConsoleCommand[]>([]);

export function CommandRegistryProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // A Map, for its insertion order: that order is registration order, which is
  // what `groupCommands` reads as "innermost first" when two sources claim one
  // id. A plain object would key by symbol description and lose both.
  const [sources, setSources] = useState<
    ReadonlyMap<Source, readonly ConsoleCommand[]>
  >(() => new Map());

  const register = useCallback(
    (source: Source, commands: readonly ConsoleCommand[]) => {
      setSources((current) => {
        const next = new Map(current);
        next.set(source, commands);
        return next;
      });

      let withdrawn = false;
      return () => {
        // Guarded for the same reason the hotkey registry guards its release:
        // React invokes an effect's cleanup twice in development, and the
        // second pass would delete a source that had already re-registered
        // under the same symbol.
        if (withdrawn) {
          return;
        }
        withdrawn = true;

        setSources((current) => {
          if (!current.has(source)) {
            return current;
          }

          const next = new Map(current);
          next.delete(source);
          return next;
        });
      };
    },
    [],
  );

  const registrar = useMemo<CommandRegistrar>(() => ({ register }), [register]);
  const commands = useMemo(
    () => Array.from(sources.values()).flat(),
    [sources],
  );

  return (
    <CommandRegistrarContext.Provider value={registrar}>
      <CommandListContext.Provider value={commands}>
        {children}
      </CommandListContext.Provider>
    </CommandRegistrarContext.Provider>
  );
}

/**
 * The registrar, for `useCommands`.
 *
 * Throws rather than degrading to a no-op. A screen whose commands silently go
 * nowhere looks exactly like a screen with no commands, and the palette is the
 * one surface where "nothing happened" is indistinguishable from "nothing was
 * offered".
 */
export function useCommandRegistrar(): CommandRegistrar {
  const registrar = useContext(CommandRegistrarContext);

  if (registrar === null) {
    throw new Error(
      "useCommands was called outside CommandRegistryProvider. The provider is mounted in app/(app)/layout.tsx; a screen that needs commands belongs inside that route group.",
    );
  }

  return registrar;
}

/** Everything currently registered, in registration order. For the palette. */
export function useRegisteredCommands(): readonly ConsoleCommand[] {
  return useContext(CommandListContext);
}
