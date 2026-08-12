# @mariva/admin

Next.js. The front-desk and management console — keyboard-first, no WebGL, on
its own origin away from the guest-facing site.

Scaffolded, not built. What exists is the shape a screen can land in: the root
layout (document element, type stack and `app/globals.css`), the `(auth)` and
`(app)` route groups with their empty layouts, and one index route so
`next build` checks something real. There are no screens, no navigation, no
command palette and no query provider yet — each has an owner further along, and
the layout comments say what lands where.

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

**Open:** there is no `--color-destructive`. The palette has no red, and
inventing one here would put the console's error colour outside
`packages/tokens`. shadcn's destructive variants and every error, warning and
status colour the operational screens need are blocked on that decision.

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
