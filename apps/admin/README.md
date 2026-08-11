# @mariva/admin

Next.js. The front-desk and management console — keyboard-first, no WebGL, on
its own origin away from the guest-facing site.

Scaffolded, not built. What exists is the shape a screen can land in: the root
layout (document element and `@mariva/tokens`), the `(auth)` and `(app)` route
groups with their empty layouts, and one index route so `next build` checks
something real. There are no screens, no navigation, no command palette, no
query provider and no Tailwind theme yet — each has an owner further along, and
the layout comments say what lands where.

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
