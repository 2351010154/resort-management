# @mariva/admin

Next.js. The front-desk and management console — keyboard-first, no WebGL, on
its own origin away from the guest-facing site.

Scaffolded, not built. What exists is the shape a screen can land in: the root
layout (document element, type stack and `app/globals.css`), the `(auth)` and
`(app)` route groups, one index route so `next build` checks something real, the
primitives in `components/ui/`, the keyboard layer in `lib/keyboard/`, and the
command palette the `(app)` layout mounts. There are no screens, no navigation
and no query provider yet — each has an owner further along, and the layout
comments say what lands where.

## The theme

`app/globals.css` is the whole styling configuration. There is no
`tailwind.config.ts`: Tailwind 4's `@theme` reads CSS custom properties, so the
console's palette *references* `@mariva/tokens` rather than restating it, and
changing the brand stays a one-file change in `packages/tokens`.

Four things about it are decisions rather than defaults, and each is load-bearing:

- **Tailwind's stock palette and font families are deleted** (`--color-*: initial`,
  `--font-*: initial`). `bg-slate-100` and `font-sans` do not compile. The
  console has nine colours and two faces; anything else is a build error rather
  than a review comment.
- **A semantic layer** — `background`, `foreground`, `muted-foreground`,
  `border`, `input`, `ring`, `primary`, `secondary`, `accent` — sits over the
  Mariva names so shadcn/ui primitives can be copied in rather than rewritten.
  Primitives use the semantic names; screens may use either.
- **`--dusk-amber` is a fill, never text and never the focus ring.** It computes
  2.70:1 on `--ivory` — under the 4.5:1 text needs and under the 3:1 a focus
  indicator needs. `--color-ring` is `--umber` (10.86:1). Accented *text* is
  `--umber` or `--ink`; text *on* the amber is `--ink` (5.67:1).
- **`--color-muted-foreground` is `--stone-deep`, not `--stone`.** `--stone` is
  3.57:1 on ivory — large text, rules and non-text UI only.

Two collisions with Tailwind's own namespaces are worth knowing before editing
this file. Tailwind's font-size namespace is `--text-*` and its tracking
namespace is `--tracking-*`, which are the names `tokens.css` already uses. The
four shared steps (`text-xs` … `text-lg`) therefore resolve to the Mariva values
through the cascade — tokens is unlayered, Tailwind's defaults sit in
`@layer theme`, and unlayered wins — which is why `text-lg` here is 1.375rem and
not Tailwind's 1.125rem. The steps with no Tailwind counterpart
(`text-display`, `text-display-sm`, `text-display-lg`, `tracking-caps`) are
registered with `@utility` instead, because writing them as theme keys would
mean `--text-display: var(--text-display)` — a property referencing itself.

Spacing keeps Tailwind's 0.25rem multiplier for component work; Mariva's five
step rhythm sits beside it as `--spacing-rhythm-1` … `-5`, so `p-2` is a control
and `gap-rhythm-3` is a page composition.

**`--color-destructive` is `--umber`, and there is still no red.** The palette
has none, and inventing one here would put the console's error colour outside
`packages/tokens`. The guest site had already answered the question the same way
— `apps/web`'s auth screens draw their error state as `--umber` text behind an
`--umber` rule — so the console follows it rather than opening a second
convention. What that costs is described under *Primitives* below.

## Primitives

`components/ui/` holds thirteen shadcn/ui components, copied in and restyled.
`components.json` records the settings the generator would use, so
`pnpm dlx shadcn@latest add <name>` drops a new one in the right place with the
right import aliases — but it arrives in upstream's styling, and the four rules
below are what has to be applied to it before it is a Mariva primitive.

Import from the deep path (`@/components/ui/button`) on a screen that needs one
or two. `components/ui/index.ts` re-exports everything and is the inventory; it
is also a client-component barrel, so importing from it pulls all thirteen into
the bundle.

- **Focus is drawn once, in `app/globals.css`.** Upstream rings each control
  with `ring-ring/50` — `--umber` at half strength, roughly 2.7:1 on `--ivory`,
  under the 3:1 a focus indicator owes. The primitives drop `outline-none` and
  inherit the base rule's full-strength 2px outline instead. Two exceptions,
  both deliberate: panels that take focus only so a screen reader lands in them
  (dialog, popover and select content, tab panels) keep the suppression, and a
  highlighted select or menu row is marked by the `--accent` fill rather than an
  outline that would clip against the panel edge.
- **Nothing animates in or out.** `NFR-04` holds operational screens to no
  entrance animation, so every `animate-in` / `fade-in-0` / `zoom-in-95` /
  `slide-in-from-*` is stripped, along with the `origin-*` that only existed to
  anchor the zoom. It also means the app needs no animation plugin.
- **`font-medium` and `font-semibold` become `font-normal`.** `app/layout.tsx`
  loads both faces at 300 and 400 only; a 500 or 600 would be a weight the
  browser synthesises rather than one the type designer drew. 400 against the
  body's 300 is the console's emphasis step.
- **Destructive differs by form, not by hue.** `--color-destructive` and
  `--color-primary` are both `--umber`, so a destructive control that copies the
  primary's shape says nothing. `Button variant="destructive"` is the only
  variant drawn as a doubled rule on the page ground, filling on hover and
  focus; a destructive `DropdownMenuItem` carries an `--umber` rule on its
  leading edge, the same device `apps/web` uses for an error notice. Both rely
  on the label naming the verb — "Cancel booking", never "Confirm". Sonner's
  `richColors` is off for the same reason.

Still open, and inherited rather than introduced here: the operational screens
will want **status** colours — housekeeping state, discrepancy severity,
success and warning — and the palette has none. Shape carries two states well
and does not scale to five. That decision belongs to `packages/tokens` and the
design authority, and it is not blocking until the first screen needs it.

## The keyboard layer

`lib/keyboard/` and `lib/date-parser.ts`. It is here before any screen is,
which is the point: focus order, an escape route out of every surface, and one
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

`features/command-palette/`, mounted once by the `(app)` layout so ⌘K means the
same thing on every authenticated screen.

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

A command therefore exists exactly while the screen that owns it is on, which is
the only definition that stays true as the console grows — the alternative is
one central list with a guard on every entry saying when it applies, which every
screen has to remember to edit and which nothing fails when they don't. **Today
that means the palette opens onto "This screen offers no commands."**, because
nothing registers yet. The shell fills `Go to`; screens fill `Actions`; `Quick
search` is defined and stays empty until something API-backed registers into it.

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
pnpm --filter @mariva/admin build
pnpm --filter @mariva/admin test
```

`@mariva/shared` and `@mariva/api-client` are declared but not yet imported.
They ship `dist/`, not source, so once a screen imports one, run it through
Turbo — `turbo run dev --filter @mariva/admin...` — and the dependency builds
first instead of failing to resolve.

There is no `typecheck` script, matching `apps/web`: `next build` type-checks
the app, and a separate `tsc` here would read the `.next/types` that build
rewrites underneath it.

`vitest run` covers every `*.spec.ts` in the app and runs in no environment at
all — the chord normalization, the registry's stacking and gates, the roving
list's arithmetic and the date parser are pure, and the registry is driven
through `dispatchHotkey` rather than a real press.
The trap, the roving group and `useHotkeys` are deliberately not tested here,
on the same line `apps/web` draws: what matters about a focus trap is where
focus actually lands, and jsdom has no layout, so `offsetParent` is null for
every element in it and the visibility checks both are built on would be
asserted against a model rather than a browser. They are proved end to end
instead, by the keyboard-only check-in run `NFR-11` requires.

Layering rules and the screen inventory are in
[`docs/architecture/repository-structure.md`](../../docs/architecture/repository-structure.md);
the pinned frontend versions are in
[`docs/architecture/tech-stack.md`](../../docs/architecture/tech-stack.md).
