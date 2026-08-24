// The authenticated realm. Every screen family the console grows lives under
// this group, so this layout is where the things that must be true on all of
// them are mounted: the session guard, the persistent navigation, the global
// hotkey listener, and the command palette.
//
// The palette is mounted once and holds no commands of its own — a screen
// declares what it offers with `useCommands`, and the provider around it
// collects those declarations — so ⌘K means the same thing on every screen
// while what it can do is decided by the screen the operator is on. Its
// `Go to` group is the shell's navigation and its `Actions` group holds the
// shell's one command, which is signing out; everything else in it arrives with
// a screen.
//
// The session guard is here too, and it is what makes this group the
// authenticated realm rather than a folder named after one: nothing under it
// renders until the browser has spent the refresh cookie and got a session
// back, and an operator without one is sent to login carrying the destination
// they were interrupted on.
//
// The drawer is here too, in the two places `docs/screens.md` puts it: the shift
// an operator is on lives in the top bar, and opening, counting, closing and
// handing one over are palette actions available from any screen. Both are the
// shell's rather than a screen's because shifts "never own a screen visit" —
// what the Shifts family screen holds is the history. `features/shifts` carries
// the argument in full; what the layout owes it is a position for the bar and a
// registration after the children, like every other shell command.
//
// The navigation is here as a rail down the left, filtered by the session's
// role, and as the palette rows that reach the same places. It names fifteen
// families and **none of their routes exist yet** —
// `features/shell/nav-inventory.ts` says why at length, and it is the same
// reason `lib/auth/landing-route.ts` gives for the landings: the map is settled
// and tested before the screens, and a placeholder behind each entry would be
// a second opinion about an inventory that has an owner.
//
// What must not happen is screens arriving first. The keyboard layer is a
// property of every screen at once — focus order, an escape route from any
// modal, one palette that reaches every command — and retrofitting that onto
// twenty screens already written mouse-first is a rewrite, not a refactor.

import {
  CommandPalette,
  CommandRegistryProvider,
} from "@/features/command-palette";
import { AppNav, NavCommands } from "@/features/shell";
import {
  ShiftBar,
  ShiftCommands,
  ShiftSurfaceProvider,
} from "@/features/shifts";
import {
  SessionCommands,
  SessionGuard,
  StaffSessionProvider,
} from "@/lib/auth";

import { Providers } from "./providers";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    // The provider is outside the registry rather than inside it because the
    // guard it feeds decides whether the children exist at all, and a registry
    // that mounted below that decision would be torn down and rebuilt on every
    // sign-out.
    <StaffSessionProvider>
      <CommandRegistryProvider>
        <SessionGuard>
          {/* Inside the guard, not above it, and that is where the cache's
           * lifetime comes from: nothing under this renders until a session
           * exists, and signing out unmounts it — so the answers one operator's
           * screens accumulated are discarded rather than being served to
           * whoever signs in next on the same machine. */}
          <Providers>
            {/* The provider holds one piece of state — which act of the drawer
             * is open — and nothing else, because the two surfaces that reach it
             * are mounted in two different places: the bar is drawn in the top
             * bar below and the commands are registered after the children, the
             * way every other shell command is. It renders the panel itself, so
             * neither surface owns one the other opens. */}
            <ShiftSurfaceProvider>
              <div className="flex min-h-svh bg-background">
                {/* Before the children in the markup, which is where a landmark
                 * belongs for anything reading the page in order. Its commands are
                 * not registered here — see `NavCommands` below — so the shell's
                 * registration order is unaffected by where the rail is drawn. */}
                <AppNav />
                {/* `min-w-0`, so a wide table inside a screen scrolls within the
                 * main region instead of stretching the flex row and pushing the
                 * rail off the left of the window. */}
                <div className="flex min-w-0 flex-1 flex-col bg-background">
                  {/* The top bar `screens.md` puts the current shift in. It
                   * holds one state and no navigation: the rail is the map, and
                   * whether the operator is on a drawer is a fact they need
                   * while working somewhere else. Slim, and drawn above every
                   * screen's own header rather than inside one, so a
                   * receptionist glancing up finds it in the same place on all
                   * of them.
                   *
                   * The strip is the bar's own rather than a shell wrapper it is
                   * poured into: a housekeeper works no till and is told about
                   * none, and a wrapper here would rule a border across the top
                   * of every one of their screens to hold nothing.
                   *
                   * A `div` and not a second `header` landmark: it holds a fact
                   * rather than a heading, and every screen below draws a header
                   * of its own — two of those in one document is a landmark list
                   * nobody can navigate by. */}
                  <ShiftBar />
                  <main className="min-w-0 flex-1 overflow-x-clip">
                    {children}
                  </main>
                </div>
              </div>
              {/* After the children for the same reason the palette is: React
               * flushes a child's effects first, so a screen's commands register
               * before the shell's and a screen may override `session.sign-out` or
               * a `nav.*` row by claiming its id. Inside the guard, so there is no
               * sign-out command and no navigation offered on a console nobody is
               * signed in to. */}
              <NavCommands />
              <ShiftCommands />
              <SessionCommands />
            </ShiftSurfaceProvider>
          </Providers>
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
