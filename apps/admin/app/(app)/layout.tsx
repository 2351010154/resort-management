// The authenticated realm. Every screen family the console grows lives under
// this group, so this layout is where the things that must be true on all of
// them are mounted: the session guard, the persistent navigation, the global
// hotkey listener, and the command palette.
//
// The palette is here now. It is mounted once and holds no commands of its own
// — a screen declares what it offers with `useCommands`, and the provider
// around it collects those declarations — so ⌘K means the same thing on every
// screen while what it can do is decided by the screen the operator is on.
// Until the shell registers its navigation and the first screens register their
// actions, the palette opens onto an empty list, which is the honest state
// rather than a placeholder.
//
// The session guard and the navigation are still absent, and deliberately: they
// have an owner further along in the console's build-out, and a placeholder
// navigation invented here would be a second opinion about the screen inventory
// that the real one has to undo.
//
// What must not happen is screens arriving first. The keyboard layer is a
// property of every screen at once — focus order, an escape route from any
// modal, one palette that reaches every command — and retrofitting that onto
// twenty screens already written mouse-first is a rewrite, not a refactor.

import {
  CommandPalette,
  CommandRegistryProvider,
} from "@/features/command-palette";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <CommandRegistryProvider>
      {children}
      {/* After the children, not before: the palette portals its surface to the
       * document body when it opens, so its position here decides nothing
       * visual — but a screen's commands are registered by the children, and
       * having them mounted first keeps the registration order the one
       * `groupCommands` reads as innermost-first. */}
      <CommandPalette />
    </CommandRegistryProvider>
  );
}
