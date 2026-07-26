# Mariva

Booking and property-management system for the Mariva resort, plus the marketing
site that fronts it.

## Layout

```
apps/api             NestJS + Postgres — every business rule, the only writer to the database
apps/admin           Next.js — front desk and management, keyboard-first
apps/web             Next.js — the public origin: the marketing arrival and the booking funnel
packages/shared      zod schemas and the types inferred from them; the contract every app reads
packages/api-client  typed fetch wrapper over the API, validating with the shared schemas
packages/tokens      tokens.css — the one definition of the brand, imported by every app
docs/                architecture, generated diagrams, traceability
```

`apps/web`, `apps/api`, `packages/shared` and `packages/tokens` have code.
`apps/admin` and `packages/api-client` are reserved boundaries: the directory
tree exists, the work that fills it has not started.
[`docs/architecture/repository-structure.md`](docs/architecture/repository-structure.md)
is the authority on what goes where and why.

## Documentation

New here, or back after a break? [`docs/orientation.md`](docs/orientation.md) —
what the system is, the one invariant that must never break, the road, and how to
work out what to do next.

[`docs/README.md`](docs/README.md) is the authority map: it points every fact
domain — structure, roles, booking states, stack, infrastructure, backlog — to
the one document that owns it.

### Route groups in `apps/web`

The root layout carries only the document shell, the type family, and the design
tokens. Anything that reaches `three` / `gsap` / `lenis` lives in
`app/(marketing)/`, so `app/(booking)/` renders on the same origin without the
WebGL bundle in its tree. Route groups do not appear in URLs:
`app/(marketing)/page.tsx` is still `/`.

## Getting started

Requires Node 24 (see `.nvmrc`) and pnpm — the version is pinned in the root
`package.json` `packageManager` field, so `corepack enable` will fetch it.

```bash
pnpm install
pnpm dev            # every app that defines a dev task
pnpm lint
pnpm typecheck
pnpm build
```

Turborepo fans each task out across the workspaces. To drive a single one:

```bash
pnpm --filter @mariva/web dev
```

## Asset and capture scripts

`apps/web/scripts/` holds the pipelines that produce the arrival's images and
video, and the Playwright scripts that photograph acts against a running dev
server. Run them from the repo root:

```bash
node apps/web/scripts/capture-finale.mjs
```

Captures are written to `plans/reports/screenshots/`, which is untracked.
