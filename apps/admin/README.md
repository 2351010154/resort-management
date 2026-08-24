# @mariva/admin

Next.js. The front-desk and management console — keyboard-first, no WebGL, on
its own origin away from the guest-facing site.

The console has a signed-in shell, role-filtered navigation, a global command
palette, and the complete staff route set described in `docs/screens.md`.
Operational state continues to come through the feature query hooks; the
presentation layer is local to this app.

## The theme

`app/console-tokens.css` owns the admin-only visual vocabulary, and it is the
brand's colours wearing console names. The nine anchors at the top of that file
are `packages/tokens/tokens.css` — same names, same values — restated rather
than imported, because that package also carries a type ramp (`--text-base`,
`--text-lg`) which the console overrides in `globals.css`, and an unlayered
`:root` import would beat Tailwind's layered `@theme` and resize every screen.
Restating the palette costs one file to keep level; importing it would cost the
type scale. **Change a colour in the tokens package first.**

What the console adds on top is vocabulary a hotel front page does not need: a
card above the ground, two border weights, and four status colours. Every pair
a screen can draw is checked against WCAG AA and the ratio is written beside
the value that earns it. Two of those checks decided a token — `--dusk-amber`
is 2.7:1 on ivory, so the accent cannot be a focus ring or a solid button. It
is a marker, a fill and a tint; `--console-accent-line` is the ring and
`--console-accent-strong` is amber as text. Solid controls are umber.

`app/globals.css` maps those values into Tailwind 4 and loads Figtree as the
console's one type family. Tailwind's stock colour and font namespaces are
cleared so screens use semantic names such as `background`, `card`, `nav`,
`accent-soft`, `accent-mark`, `line`, `success`, `warning`, and `danger`. Note
that `primary` is its own token rather than the rail's: the rail is light, and a
button mapped to it would be ivory carrying umber text. Focus is a single
three-pixel outline in `accent-line`. Operational motion is limited to state
transitions and loading skeletons; there is no route or surface entrance
animation.

## Primitives

`components/ui/` holds the local shadcn/Radix primitives. `components/console/`
is the product layer: page headers, key hints, status chips, stat cards, filter
bars, table frames, detail sheets, form sections, fields, empty states, step
trails, and toolbars.

Import primitives from their deep paths on screens that need one or two. The UI
barrel remains the inventory. Use console components for repeated product
patterns rather than restyling a primitive in each feature.

## The keyboard layer

`lib/keyboard/` and `lib/date-parser.ts` provide the shared interaction layer:
focus order, an escape route out of every surface, and one
place that owns the arrow keys are properties of all the screens at once, and
retrofitting them onto twenty screens written mouse-first is a rewrite rather
than a refactor.

| Module | Owns |
|---|---|
| `chord.ts` | A written hotkey and a `KeyboardEvent`, reconciled to one id |
| `hotkey-registry.ts` | One document listener, and which binding a press reaches |
| `use-hotkeys.ts` | Binding a hotkey for as long as a component is mounted |
| `keyboard-layer.tsx` | Which surface a binding belongs to, when several are open |
| `form-field.ts` | Whether a press landed somewhere a person is typing |
| `focus-trap.tsx` | Keeping Tab inside a surface that is not a Radix dialog |
| `focus-restore.ts` | Putting focus back where it was when a surface closes |
| `roving-focus.tsx` | Arrow keys through a list that is one Tab stop |
| `roving-geometry.ts` | Which member a press resolves to, as arithmetic |
| `date-parser.ts` | Reading a typed date — `15/3`, `+2d`, `tomorrow` |

Seven of its decisions are load-bearing rather than incidental:

- **`mod` means Cmd or Ctrl, resolved once per session.** Bindings are written
  `mod+k` and never branch on the platform at the call site. The one spelling
  to avoid is `ctrl+alt+…`: AltGr sets both flags, so on the layouts that reach
  punctuation through it, typing that character fires the binding.
- **A press yields several candidate ids, not one.** `event.key` carries the
  typed character, so macOS Alt+A arrives as "å" and Shift+/ as "?";
  `event.code` carries the physical key and is wrong on a non-QWERTY layout.
  Neither is authoritative alone, so the registry tries the typed spelling
  first and the physical one last.
- **A chord holds a stack of bindings, and depth outranks recency.** When a
  dialog over a screen binds Escape and then closes, the screen underneath gets
  its Escape back — one handler per chord loses it silently, and a
  keyboard-first screen with no escape route looks perfectly fine. Registration
  order alone is not enough to say which surface is innermost, though: React
  flushes a child's effects before its parent's, so a screen arriving with a
  surface already open — `/arrivals?checkin=BK-5107`, an SSR-hydrated route, a
  Suspense reveal — registers them in exactly the wrong order. A surface that
  stacks over another wraps its subtree in `<KeyboardLayer>` and says so.
- **Hotkeys stay out of text fields, and Escape never does.** A receptionist
  typing "Nguyen" into search must not fire the "n"ew-booking command on the
  first letter — but the person who has just typed into the wrong field is
  exactly who needs the way out. Presses still assembling in an IME are left
  alone for the same reason: they belong to Vietnamese input, not to the
  console. The roving group holds the same line for the arrows, so a caret in a
  rate field inside a room grid keeps them.
- **The trap owns Tab and nothing else.** The usual extra — a `focusin` watcher
  that drags focus back whenever it lands outside — cannot work here. Every
  Radix overlay in `components/ui/` portals into `document.body`, so a select
  inside a check-in sequence would have its listbox yanked away the moment
  Radix focused it; and two live traps, which the palette-over-a-sequence case
  makes normal, would pull focus from each other synchronously until the stack
  overflowed. Tab wrapping is the requirement, a trap stack keeps the innermost
  one in charge, and focus that has been lost to `<body>` is recovered on the
  next Tab rather than fought for continuously.
- **A roving list is tracked by value, and reconciled against the DOM.** An
  index does not survive a re-sort or a filter, but a booking reference is the
  row it always was. The value has one failure mode that has to be handled
  rather than assumed away: the active row can *leave* — the operator checks
  that guest in — at which point nothing matches, every member is
  `tabIndex={-1}`, and the list has quietly stopped being a Tab stop at all.
  The group hands the stop to the first surviving member.
- **The date parser is liberal in, exact out, and never guesses.** Any
  recognised spelling gives one `YYYY-MM-DD` or `null` — 31 February is
  rejected rather than rolled into 3 March, and the day always precedes the
  month. It takes the day to count from as an argument rather than reading the
  clock, because "today" is the property's business date, which rolls at 04:00
  and is not the browser's calendar date at 01:30. Not for a date of birth:
  every two-digit year here is this century, which turns a guest born in 1985
  into one born in 2085.

The parser sits outside `lib/keyboard/` and outside its barrel: it exists
because operators type dates rather than pick them, but it is a parser and not
focus or key infrastructure.

`components/ui/` needs none of this. Radix already traps focus inside `Dialog`
and `Popover`, and the command palette is built on that `Dialog` for exactly
that reason. The trap is for the console's own in-place surfaces — the check-in
sequence that opens inside the arrivals queue — which are not dialogs in the DOM
and would otherwise let Tab walk out into the navigation behind them.

**Settled:** whether a console binding that handles Escape should also stop the
press reaching Radix's own dismissable-layer listener. The palette is the first
surface to answer it, and the answer is yes for a surface that stacks over a
screen. It binds Escape itself, one `KeyboardLayer` deep and with
`stopPropagation`, so a single press closes the palette and *only* the palette —
without it, the screen's own Escape binding underneath sees the same press and a
check-in sequence closes along with the palette that was opened over it. The
default stays off: a screen's own binding has nothing underneath it to protect.

## The command palette

`features/command-palette/` is mounted once by the `(app)` layout so ⌘K means
the same thing on every authenticated screen.

| Module | Owns |
|---|---|
| `command.ts` | What a command is, and what order a set of them renders in |
| `command-registry.tsx` | Collecting what screens have registered |
| `use-commands.ts` | Offering a screen's commands while it is mounted |
| `command-palette.tsx` | The surface: the chord, the list, running a command |
| `shortcut.ts` | A written chord as the hint drawn beside a row |
| `components/ui/command.tsx` | cmdk, restyled to the tokens. Domain-blind |

**It holds no commands of its own.** A screen declares what it offers and the
palette collects it:

```tsx
useCommands([
  {
    id: "arrivals.check-in",
    label: "Check in",
    group: "actions",
    shortcut: "mod+shift+i",
    keywords: ["khách đến", "walk-in"],
    action: () => openCheckIn(row.reference),
  },
]);
```

A command therefore exists exactly while the screen that owns it is on. The
shell registers role-filtered **Go to** destinations and shift actions; screens
register contextual **Actions** such as booking creation, report export, and
filter focus. `Quick search` remains available for API-backed registrations.

Four decisions worth knowing before adding to it:

- **The array can be written inline, and that is the whole shape of
  `useCommands`.** What the palette *draws* — id, label, group, shortcut,
  keywords — is stable text, and re-registration happens only when that changes;
  what a command *does* is a closure reached through a trampoline, so an action
  written inline always runs the current one without ever being re-registered.
  Neither `useMemo` at the call site nor a re-render per keystroke.
- **The first registration of an id wins.** React flushes a child's effects
  before its parent's, so first is the innermost claim: a screen may replace a
  shell command by reusing its id, and the override runs in the direction it has
  to.
- **`shortcut` is drawn, not bound.** A command that has one binds it where it
  lives, with `useHotkeys`, so the key works on the screen that owns it and not
  only while the palette is open. The hint is derived from the same written
  chord — `mod+k` renders ⌘K or Ctrl+K — so the two cannot drift apart.
- **cmdk's list is a combobox, not a roving list.** Focus stays in the search
  box for the palette's whole life and the arrows move an `aria-selected`
  highlight; `lib/keyboard`'s `RovingFocusGroup` is the opposite arrangement and
  the two must not be mixed on one surface.

The palette hands focus back itself rather than leaving it to Radix. Radix
restores by focusing the dialog's *trigger*, and preventDefaults its own focus
scope to do it — this palette is opened by a chord and has no trigger, so that
path focuses nothing and drops the operator on `<body>`. It captures focus on
open and restores on close, and a command's action runs immediately after that
restoration so an action that opens a surface of its own gets the last word.

```
pnpm --filter @mariva/admin dev     # port 3002
pnpm --filter @mariva/admin typecheck
pnpm --filter @mariva/admin build
pnpm --filter @mariva/admin test
pnpm lint                           # repository gate
pnpm --filter @mariva/admin test:e2e # existing console/API/Postgres only
```

The feature layer imports `@mariva/shared` and `@mariva/api-client`; both ship
`dist/`, not source. Run development through Turbo when their sources change so
the dependencies build before the console. The `typecheck` script runs
`tsc --noEmit`; production builds retain Next.js's own type gate.

`vitest run` covers every `*.spec.ts` in the app and runs in no environment at
all — the chord normalization, the registry's stacking and gates, the roving
list's arithmetic and the date parser are pure, and the registry is driven
through `dispatchHotkey` rather than a real press.
The trap, roving group, and `useHotkeys` need a browser because jsdom has no
layout. Playwright covers the keyboard-only check-in and timing requirements
against an already-running console, API, and Postgres instance; its config does
not start those services.

Layering rules and the screen inventory are in
[`docs/architecture/repository-structure.md`](../../docs/architecture/repository-structure.md);
the pinned frontend versions are in
[`docs/architecture/tech-stack.md`](../../docs/architecture/tech-stack.md).
