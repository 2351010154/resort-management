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
// The session guard is here now too, and it is what makes this group the
// authenticated realm rather than a folder named after one: nothing under it
// renders until the browser has spent the refresh cookie and got a session
// back, and an operator without one is sent to login carrying the destination
// they were interrupted on.
//
// The navigation is still absent, and deliberately: it has an owner further
// along in the console's build-out, and a placeholder navigation invented here
// would be a second opinion about the screen inventory that the real one has to
// undo. Until then the palette's `Go to` group stays empty and `Actions` holds
// the shell's one command, which is signing out.
//
// What must not happen is screens arriving first. The keyboard layer is a
// property of every screen at once — focus order, an escape route from any
// modal, one palette that reaches every command — and retrofitting that onto
// twenty screens already written mouse-first is a rewrite, not a refactor.

import {
  CommandPalette,
  CommandRegistryProvider,
} from "@/features/command-palette";
import {
  SessionCommands,
  SessionGuard,
  StaffSessionProvider,
} from "@/lib/auth";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    // The provider is outside the registry rather than inside it because the
    // guard it feeds decides whether the children exist at all, and a registry
    // that mounted below that decision would be torn down and rebuilt on every
    // sign-out.
    <StaffSessionProvider>
      <CommandRegistryProvider>
        <SessionGuard>
          {children}
          {/* After the children for the same reason the palette is: React
           * flushes a child's effects first, so a screen's commands register
           * before the shell's and a screen may override `session.sign-out` by
           * claiming its id. Inside the guard, so there is no sign-out command
           * offered on a console nobody is signed in to. */}
          <SessionCommands />
        </SessionGuard>
        {/* After the children, not before: the palette portals its surface to the
         * document body when it opens, so its position here decides nothing
         * visual — but a screen's commands are registered by the children, and
         * having them mounted first keeps the registration order the one
         * `groupCommands` reads as innermost-first. */}
        <CommandPalette />
      </CommandRegistryProvider>
    </StaffSessionProvider>
  );
}
