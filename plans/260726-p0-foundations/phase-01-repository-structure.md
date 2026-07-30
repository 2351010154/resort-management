---
phase: 01
title: Repository structure and conventions
status: complete
completed: 2026-07-26
---

# Phase 01 — Repository structure and conventions

## Context

The workspace was already a pnpm + Turborepo monorepo with `apps/web` and
`packages/shared`, and the root layout had already been cleared of the arrival's
scroll machinery so a plain route group could live beside it. What was missing
was everything above one app: no home for the API, no home for the admin
console, no written rule for where a new screen's code goes. The first booking
screen would have forced those decisions ad hoc, and ad hoc decisions made
twenty times are what a `lib/` full of unrelated files is made of.

## Requirements

- Reserve every boundary the confirmed architecture needs, before code arrives.
- Write down the layering rules, once, somewhere discoverable.
- Change nothing about how the existing site builds.

## Work done

- Directory tree for `apps/api` (`common`, `config`, `database/{schema,migrations}`,
  `modules/` with all fourteen domain modules, `jobs`, `test`).
- Directory tree for `apps/admin` (`app/(auth)`, `app/(app)`, `features`,
  `components/ui`, `lib`).
- `apps/web` grown to hold more than the arrival: `app/(booking)`, `features`,
  `components/ui`.
- The arrival moved into `features/arrival/`: the six act directories and the
  concierge nav under `components/`, and nine of the eleven `lib/` files under
  `lib/`, with the redundant `arrival-` prefixes dropped. `motion-tokens` and
  `use-in-view` stayed in `apps/web/lib/` — a booking screen will want both.
- `eslint.dirs` added to `next.config.mjs`. Without it `next lint` skips
  `features/` entirely, and the move would have silenced twelve real warnings.
- Two generator scripts had runtime paths into `lib/` and now write to the
  feature: `encode-intro-video-tiles.mjs` and `prepare-arrival-images.mjs`.
- `packages/api-client` reserved.
- `docs/architecture/repository-structure.md` — the authority on what goes where
  and the rules that keep it there. `docs/README.md` as the index.
- Root `README.md` layout section reconciled with what now exists.
- `turbo.json`: a `test` task, and `dist/**` added to build outputs for the
  compiled API. Root `package.json` gained `pnpm test`.

Directories with no code are held by `.gitkeep` and are explicitly labelled in
the structure doc as reserved rather than started.

## Validation

`pnpm lint`, `pnpm typecheck` and `pnpm build` all green. Lint reports the same
twelve pre-existing `no-img-element` warnings as before the move, and the build
emits the same 236 kB / 380 kB first load — identical output is what makes it a
move rather than a change. `pnpm test` runs and reports no tasks, which is the
honest answer until phase 04 adds them.

## Rollback

Additive apart from three small edits to `turbo.json`, `package.json` and
`README.md`. Deleting the new directories and reverting those three restores the
previous state.
