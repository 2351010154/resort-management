import type * as React from "react";

/* What a command is, and what order a set of them appears in.
 *
 * Kept apart from the components on purpose: the ordering is the one part of
 * the palette that is decidable without a DOM, and it is also the part most
 * likely to be got wrong quietly — a group that renders in registration order
 * moves under the operator between two screens, and nothing about it looks
 * broken. `command.spec.ts` holds it to the rules below. */

/**
 * Which block of the palette a command appears under.
 *
 * Three, and they are a hierarchy of commitment rather than a taxonomy of
 * subject: going somewhere, doing something, finding something. An operator
 * scanning the list should be able to stop reading at the first group that
 * matches their intent.
 */
export type CommandGroupId = "navigation" | "actions" | "search";

/**
 * The order groups appear in, and the reason each sits where it does.
 *
 * Navigation first because it is the palette's most-used and least-consequential
 * content — a wrong Enter costs a screen change. Actions second: they write.
 * Quick search last because its members are results rather than commands, and a
 * list that grows and shrinks as the operator types must not push the fixed
 * entries around above it.
 */
export const COMMAND_GROUP_ORDER: readonly CommandGroupId[] = [
  "navigation",
  "actions",
  "search",
];

/** The heading each group renders under. */
export const COMMAND_GROUP_LABELS: Record<CommandGroupId, string> = {
  navigation: "Go to",
  actions: "Actions",
  search: "Quick search",
};

export interface ConsoleCommand {
  /**
   * Unique across the whole console, and stable across renders — it is what
   * the registry deduplicates on and what cmdk keys a row by.
   *
   * Namespace it by the family that owns it: `arrivals.check-in`, not
   * `check-in`. Two screens are going to want the same verb.
   */
  id: string;
  /** What the operator reads, and the primary thing the filter matches on. */
  label: string;
  group: CommandGroupId;
  /** What running it does. Called with the palette already closing. */
  action: () => void;
  /**
   * A written hotkey — `mod+k`, `g d` — shown on the right of the row.
   *
   * Display only. The palette does not bind it: a command that has a shortcut
   * binds it where it lives, with `useHotkeys`, so that the shortcut works on
   * the screen that owns it rather than only while the palette is open.
   */
  shortcut?: string;
  /**
   * Extra terms the filter should match, beyond the label.
   *
   * The console is worked in two languages and by people who name things after
   * the task rather than the screen. "Arrivals" is found by "check in" and by
   * "khách đến" only if someone says so here.
   */
  keywords?: readonly string[];
  icon?: React.ComponentType<{ className?: string }>;
  /** Shown, but not runnable — a command the current role or state forbids. */
  disabled?: boolean;
}

/** One group, ready to render. Absent groups are simply not in the array. */
export interface CommandGroup {
  id: CommandGroupId;
  label: string;
  commands: readonly ConsoleCommand[];
}

/**
 * Flattens what has been registered into the blocks the palette draws.
 *
 * Two rules, and both are about what happens when registrations collide:
 *
 * **The first registration of an id wins.** React flushes a child's effects
 * before its parent's, so a screen registers before the shell that contains it
 * — "first" is the innermost, most specific claim on that id. A screen may
 * therefore replace a shell command by reusing its id, which is the direction
 * an override has to run in. Later duplicates are dropped rather than merged,
 * so a command never appears twice under two labels.
 *
 * **Groups are ordered by `COMMAND_GROUP_ORDER`, members by registration.**
 * Not alphabetically: an operator learns the palette by muscle memory, and a
 * list that re-sorts when a command's label is edited has spent that memory.
 * Within a group, order is the order screens declared their commands in, which
 * is the order a person wrote them down.
 */
export function groupCommands(
  commands: readonly ConsoleCommand[],
): readonly CommandGroup[] {
  const seen = new Set<string>();
  const byGroup = new Map<CommandGroupId, ConsoleCommand[]>();

  for (const command of commands) {
    if (seen.has(command.id)) {
      continue;
    }
    seen.add(command.id);

    const members = byGroup.get(command.group);
    if (members === undefined) {
      byGroup.set(command.group, [command]);
    } else {
      members.push(command);
    }
  }

  const groups: CommandGroup[] = [];

  for (const id of COMMAND_GROUP_ORDER) {
    const members = byGroup.get(id);
    // An empty group renders as a heading over nothing, which reads as a
    // failure to load. Quick search has no members at all until something
    // API-backed registers into it, so this is the normal case rather than an
    // edge one.
    if (members === undefined || members.length === 0) {
      continue;
    }

    groups.push({ id, label: COMMAND_GROUP_LABELS[id], commands: members });
  }

  return groups;
}

/**
 * The string cmdk filters a row against.
 *
 * cmdk matches on a row's `value`, and its default is the rendered text — which
 * would make a command findable by its own key hint and not by anything the
 * operator might call it instead. Composing the value here puts the label, the
 * keywords and the id in front of the filter, and the id is in it so that
 * `arrivals.check-in` is reachable by typing "arrivals" on a row labelled
 * "Check in".
 */
export function commandValue(command: ConsoleCommand): string {
  return [command.label, ...(command.keywords ?? []), command.id].join(" ");
}
