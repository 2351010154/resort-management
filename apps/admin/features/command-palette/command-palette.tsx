"use client";

import { Fragment, useCallback, useMemo, useRef, useState } from "react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import {
  captureFocus,
  detectPlatform,
  type FocusRestorer,
  KeyboardLayer,
  useHotkeys,
} from "@/lib/keyboard";

import { commandValue, type ConsoleCommand, groupCommands } from "./command";
import { useRegisteredCommands } from "./command-registry";
import { formatShortcut } from "./shortcut";

/* The console's command centre.
 *
 * Mounted once, in the `(app)` layout, so that ⌘K means the same thing on every
 * authenticated screen. It holds no commands of its own — the screen the
 * operator is on decides what the palette can do, through `useCommands` — which
 * is why an empty palette is a state this component has to render rather than a
 * bug it can assume away. The shell's navigation and sign-out are registered
 * from the layout, so what is left of that state is a screen offering nothing
 * of its own.
 */

const OPEN_CHORD = "mod+k";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  // Where focus was when the palette opened.
  //
  // Radix restores focus on close by focusing the dialog's *trigger*, and it
  // preventDefaults its own focus scope's restoration to do so. This palette
  // has no trigger — it is opened by a chord from anywhere — so that path
  // focuses nothing and the operator is dropped on `<body>`: the queue's
  // position lost, Tab starting again from the top of the document. Capturing
  // it here is the console's own answer, and it is the case `focus-restore.ts`
  // was written for.
  const restorer = useRef<FocusRestorer | null>(null);

  /**
   * Opens or closes the palette, and runs `after` once it is fully closed.
   *
   * A command's action is that `after`, and the ordering is the reason this
   * takes one. Focus has to be handed back before the action runs, not after:
   * an action that opens a surface of its own or moves focus deliberately must
   * be the last thing to touch it, and a restoration landing a frame later
   * would pull the operator out of whatever the command had just opened.
   * Running the action inside the same frame as the restoration puts the two
   * in the only order that works for both — and an action that touches focus
   * not at all still leaves the operator where they were.
   */
  const change = useCallback((shown: boolean, after?: () => void) => {
    if (shown) {
      // Captured before the surface exists, so `activeElement` is still the
      // operator's field rather than the dialog Radix is about to focus.
      restorer.current = captureFocus();
    }

    setOpen(shown);

    if (shown) {
      return;
    }

    const restoring = restorer.current;
    restorer.current = null;
    // Deferred a frame because Radix's own close-time focus handling runs
    // after this, and restoring before it would simply be overwritten.
    requestAnimationFrame(() => {
      restoring?.restore();
      after?.();
    });
  }, []);

  // `enableInFormField` is on, and this is the exception that proves the rule
  // the registry defaults to. A bare letter must not fire while a receptionist
  // types a guest's name; a modified chord cannot be typed by accident, and the
  // palette is most wanted from inside the search field a person has just
  // realised is the wrong place to be typing.
  useHotkeys(
    OPEN_CHORD,
    () => {
      change(!open);
    },
    { enableInFormField: true },
  );

  return (
    <CommandDialog open={open} onOpenChange={change}>
      {/* The palette is a surface over whatever screen is underneath, and this
       * is where it says so. Everything inside binds one layer deeper, so a
       * screen that has its own Escape — the check-in sequence — keeps its
       * binding registered and simply does not win while the palette is up. */}
      <KeyboardLayer>
        <PaletteBody close={change} />
      </KeyboardLayer>
    </CommandDialog>
  );
}

/**
 * The contents, mounted only while the palette is open.
 *
 * Separate from the component above for two reasons that are really one. Radix
 * unmounts the dialog's content on close, so anything here — the Escape
 * binding, cmdk's search state — exists exactly while the palette is up: the
 * search box is empty every time it opens, without a reset, and the binding is
 * absent the rest of the time without an `enabled` flag. And `useHotkeys` has
 * to be called from inside `KeyboardLayer` to read the depth it declares.
 */
function PaletteBody({
  close,
}: {
  close: (shown: false, after?: () => void) => void;
}) {
  const commands = useRegisteredCommands();
  const groups = groupCommands(commands);
  // Read once per opening rather than per row. It never changes within a
  // session, and it is only ever read here — this component does not exist
  // until an operator has pressed a key, so there is no server render of a
  // shortcut hint to disagree with.
  const platform = useMemo(() => detectPlatform(), []);

  // Escape is handled here rather than left to Radix, and `stopPropagation` is
  // the point of doing so. Radix's dismissable layer listens for Escape on the
  // document itself, so a press would otherwise be acted on twice: the palette
  // dismisses, and the screen's own Escape binding underneath — a check-in
  // sequence, an open filter — sees the press as well and closes too. One
  // press, two surfaces gone, one of them mid-work. Taking the press here ends
  // it: the layer above outranks the screen's binding, and stopping propagation
  // keeps it from reaching Radix.
  useHotkeys(
    "escape",
    () => {
      close(false);
    },
    { enableInFormField: true, stopPropagation: true },
  );

  const run = useCallback(
    (command: ConsoleCommand) => {
      // The action is handed to the close rather than called after it. An
      // action that navigates or opens a surface of its own should find the
      // palette gone and focus already handed back, so that whatever it does
      // with focus is the last word — see `change` above.
      close(false, command.action);
    },
    [close],
  );

  return (
    <>
      <CommandInput placeholder="Type a command…" />
      <CommandList>
        {/* Two different nothings, and they must not read alike. A palette with
         * nothing registered has not failed to find anything — there was
         * nothing to search — and telling an operator "No commands found" for
         * it sends them looking for a spelling that would work. */}
        {commands.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            This screen offers no commands.
          </div>
        ) : (
          <CommandEmpty>No command matches that.</CommandEmpty>
        )}
        {groups.map((group, at) => (
          <Fragment key={group.id}>
            {at > 0 && <CommandSeparator />}
            <CommandGroup heading={group.label}>
              {group.commands.map((command) => {
                const Icon = command.icon;

                return (
                  <CommandItem
                    key={command.id}
                    value={commandValue(command)}
                    disabled={command.disabled}
                    onSelect={() => {
                      run(command);
                    }}
                  >
                    {Icon && <Icon />}
                    <span>{command.label}</span>
                    {command.shortcut && (
                      <CommandShortcut>
                        {formatShortcut(command.shortcut, platform)}
                      </CommandShortcut>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </Fragment>
        ))}
      </CommandList>
    </>
  );
}
