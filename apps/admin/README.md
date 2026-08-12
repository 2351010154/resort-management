# @mariva/admin

Next.js. The front-desk and management console — keyboard-first, no WebGL, on
its own origin away from the guest-facing site.

Scaffolded, not built. What exists is the shape a screen can land in: the root
layout (document element, type stack and `app/globals.css`), the `(auth)` and
`(app)` route groups with their empty layouts, one index route so `next build`
checks something real, and the primitives in `components/ui/`. There are no
screens, no navigation, no command palette and no query provider yet — each has
an owner further along, and the layout comments say what lands where.

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

```
pnpm --filter @mariva/admin dev     # port 3002
pnpm --filter @mariva/admin build
```

`@mariva/shared` and `@mariva/api-client` are declared but not yet imported.
They ship `dist/`, not source, so once a screen imports one, run it through
Turbo — `turbo run dev --filter @mariva/admin...` — and the dependency builds
first instead of failing to resolve.

There is no `typecheck` script, matching `apps/web`: `next build` type-checks
the app, and a separate `tsc` here would read the `.next/types` that build
rewrites underneath it.

Layering rules and the screen inventory are in
[`docs/architecture/repository-structure.md`](../../docs/architecture/repository-structure.md);
the pinned frontend versions are in
[`docs/architecture/tech-stack.md`](../../docs/architecture/tech-stack.md).
