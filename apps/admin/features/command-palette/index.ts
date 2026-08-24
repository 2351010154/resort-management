/* The command palette, in one import site.
 *
 * A screen needs exactly one thing from this folder — `useCommands`, and the
 * types to write its commands against. `CommandPalette` and
 * `CommandRegistryProvider` are the `(app)` layout's, mounted once; a screen
 * rendering either has given itself a second palette that the first one's ⌘K
 * does not open.
 *
 * `formatShortcut` is exported for the shell, which shows the same key hints
 * beside its navigation as the palette shows beside its rows, and must derive
 * them from the same written chords rather than typing out the glyphs.
 */

export {
  COMMAND_GROUP_LABELS,
  COMMAND_GROUP_ORDER,
  type CommandGroup,
  type CommandGroupId,
  type ConsoleCommand,
  commandValue,
  groupCommands,
} from "./command";
export { CommandPalette } from "./command-palette";
export { CommandRegistryProvider } from "./command-registry";
export { openCommandPalette } from "./palette-event";
export { formatShortcut } from "./shortcut";
export { useCommands } from "./use-commands";
