# Handover — apps/web to React 19 + Next 16

Branch `chore/web-react19-next16`, cut from `chore/add-ci-workflow`. Nothing
pushed, no PR. Working dir `C:\Users\tamla\Downloads\khach-san`, pnpm 11.1.2,
Windows, local Node 25.2.1.

**Done: steps 1–5a. Left to do: Next 16, baseline regeneration, final report.**

## Commits (oldest first)

| Commit | What |
|---|---|
| `8bbee78` | refactor(web): group the arrival experience into a feature module |
| `7ee6746` | chore: reserve the api, admin, and api-client boundaries |
| `f4fc9c1` | test(web): deterministic capture harness + 66 committed baseline images |
| `bbf313a` | chore(web): drop the unused @react-three/drei dependency |
| `f30b021` | feat(web): move the app onto React 19 — **does not build** |
| `f4f25ac` | feat(web): move the WebGL acts onto React Three Fiber 9 — **does not build** |
| `b138dfc` | test(web): let the capture decode video before it pins it |
| `796d694` | feat(web): move the app onto Next 15 — build/lint/typecheck all green |

The first two are the user's own uncommitted work, committed at their
instruction before the migration began (they had asked for one commit; it was
two genuinely unrelated changes, so it went in as two).

## Not mine — leave alone

`docs/README.md` (modified), `docs/architecture/booking-state-machine.md`,
`docs/architecture/rbac-matrix.md`, `docs/bao-cao/` all appeared in the tree
mid-session from outside this work. They were deliberately kept out of every
commit; one `git add -A` swept them in and the commit was rebuilt without them.
Do not use `git add -A` on this tree.

## Current state

`react` 19.2.8 (single version, `pnpm why react` confirms), `react-dom` 19.2.8,
`@types/react` 19.2.17, `@types/react-dom` 19.2.3, `@react-three/fiber` 9.6.1,
`next` ^15.5.22, `eslint-config-next` ^15.5.22, **`three` untouched at
0.169.0**, `zustand` untouched at 4.5.5 (peers `react >=16.8`, so React 19
needed no bump — zustand 5 was not required and was not taken).

`pnpm build`, `pnpm lint`, `pnpm typecheck` all green from the repo root.

## Why two commits do not build

Next 14 vendors React 18's server renderer, and prerendering `/` under React 19
dies with `TypeError: Cannot read properties of undefined (reading 'S')`; Next
14 peers `react ^18.2.0` and means it. Fiber 9 in turn requires React 19, so
there is no ordering of the three in which every commit builds. The brief said
never to combine steps, so they were kept apart and both commit messages state
plainly that they are unbuildable and why. Green returns at `796d694`.

## Remaining work

### 1. Next 16

`next@16.2.12`, `eslint-config-next@16.2.12` (verify with `npm view` first).

- `next@16.2.12` engines: `node >=20.9.0`. `.nvmrc` is `20`, which
  `actions/setup-node` resolves to the latest 20.x — that satisfies it, so
  **`.nvmrc` does not need changing**. Root `package.json` `engines` says
  `>=20`, which is looser than Next's real floor; tighten it to `>=20.9.0` so
  `.nvmrc`, `engines` and CI agree (acceptance criterion 7).
- Flag to the user, do not act on unilaterally: **Node 20 reached end of life
  in April 2026**. The repo is pinned to an EOL runtime. Changing the major is
  outside this task's scope.

### 2. Regenerate the baseline — required before any comparison means anything

The committed baseline in `apps/web/tests/visual-baseline/` was captured with
an earlier version of the harness that stubbed out `HTMLMediaElement.play()`.
Every video-backed frame in it is black. Commit `b138dfc` fixed the harness but
**the images were deliberately left stale** rather than regenerated against a
half-migrated tree.

Regenerate against the pre-migration code, with the current harness:

```
git worktree add ../khach-san-base bbf313a      # React 18 / Next 14 / no drei
cd ../khach-san-base && pnpm install
# copy the three current harness files in — the worktree predates b138dfc
cp <migration tree>/apps/web/scripts/capture-visual-baseline.mjs apps/web/scripts/
cp <migration tree>/apps/web/scripts/compare-visual-baseline.mjs apps/web/scripts/
cp <migration tree>/apps/web/scripts/visual-baseline-clock.mjs   apps/web/scripts/
pnpm --filter @mariva/web build
cd apps/web && pnpm exec next start -p 3200
node scripts/capture-visual-baseline.mjs http://localhost:3200 <tmp>/base-new
```

Then, in the migration tree, replace `apps/web/tests/visual-baseline/` with
`<tmp>/base-new`, amend `f4fc9c1`, and run the head capture and comparison.
Run the pre-migration capture **twice** and compare the two to re-measure the
noise floor before trusting it.

Expect real differences to remain in act 2. Under the stale baseline, act 2
was consistently off by ~27 channel steps over 5–20% of the frame at every
scroll fraction and both viewports, which is too systematic to be noise and
too small to be a broken act — most likely the foliage gobo shader under
fiber 9. It needs a verdict once a valid baseline exists.

### 3. Final report to `plans/reports/`

## Config changes outside the brief's file list, and why

`pnpm-workspace.yaml` — the repo already keeps pnpm settings here rather than
in `package.json`, so both went here:

- `allowBuilds: sharp: true`. pnpm 11 **fails** an install that leaves a build
  script unapproved, and Next 15 pulls sharp in. Without this, CI dies at
  `pnpm install --frozen-lockfile`.
- `packageExtensions` giving `@react-three/fiber` an `@types/react` peer.
  Fiber's own `.d.ts` files reference React's types — the JSX element names on
  one side, `CanvasProps extends React.HTMLAttributes` on the other — but it
  never declared `@types/react`, so pnpm's isolated layout never links one and
  TypeScript's upward `node_modules/@types` search walks past fiber's private
  folder to a workspace root that has nothing. `skipLibCheck` then swallows the
  breakage inside fiber and reports it at the call sites: "Property 'mesh' does
  not exist on type 'JSX.IntrinsicElements'", "Property 'style' does not exist
  on type CanvasProps". **One fix clears both.** A hand-written global JSX
  augmentation was tried, worked, and was then deleted as unnecessary — do not
  reintroduce it.

**Editing `pnpm-workspace.yaml` needs a purge to take effect.** `pnpm install
--force` is not enough:

```
Remove-Item -Recurse -Force node_modules,apps\web\node_modules,packages\shared\node_modules
pnpm install
```

Also purge `apps/web/.next` when changing Next major — a Next 15 build over a
Next 14 `.next` produced a page that served no stylesheets at all.

## React 19 source churn, already done in `f30b021`

`useRef<T>(null)` returns `RefObject<T | null>` in React 19. Four signatures
widened to accept it; every one already null-checked at runtime, so only the
types changed: `lib/use-in-view.ts`,
`features/arrival/components/act-2-welcome/orbiting-image-field.tsx`,
`features/arrival/components/act-4-stay/room-deck.tsx`,
`features/arrival/components/act-6-turndown/embossed-monogram.tsx`.

Next 15's async request APIs required nothing: the app has one marketing route
group and one page and reads no `cookies()`, `headers()`, `params` or
`searchParams` anywhere.

## The visual harness

`apps/web/scripts/capture-visual-baseline.mjs`, `compare-visual-baseline.mjs`,
`visual-baseline-clock.mjs`. 66 frames: 6 acts × 5 fractions of each act's own
scroll range × 2 viewports (1440×900, 390×844), plus nav light, nav dark and
nav menu-open. Must run against a **production** server.

Driver (scratchpad, not committed):
`C:\Users\tamla\AppData\Local\Temp\claude\C--Users-tamla-Downloads-khach-san\de2ff615-f97b-4aaa-afe4-bc35c6ad7a7a\scratchpad\verify.sh <label> [port]`

How it gets determinism: rAF, `performance.now` and `Date.now` are virtual and
advance only on `step()`, one frame at a time (Lenis and the room deck's spring
integrate per frame, so a single large jump lands somewhere else); videos are
loaded, paused and seeked to frame 0; CSS animations are pinned at a fixed
offset; intersection observers are waited for in **real** time, which moves
nothing because the animation clock is stopped; act 1's canvas is waited for
explicitly because it does not mount until its distance field and backdrop are
ready. Capture goes through CDP, not `page.screenshot` — the latter waits for a
stable frame the WebGL acts never hand over, and deadlocks against a virtual
frame loop.

Measured noise floor (two runs, unchanged tree): 52/66 bit-identical, the rest
within 4 channel steps. Comparator tolerates 4 by default over a per-frame
budget of `max(32, 0.02%)` pixels. For scale, real breakage measured 100–255.

### Three traps already paid for — do not repeat them

1. **A stale `next start` held port 3187 for three hours** and answered every
   capture, so step 2's "clean" comparison was the old build measured against
   itself and proved nothing. `verify.sh` now refuses a port in use and aborts
   if the server serves no stylesheet. Check the listener's *start time*:
   `Get-NetTCPConnection -LocalPort 3187 -State Listen`.
2. **The clock used to stub `play()`.** An element never played is never
   decoded, and an undecoded video texture paints black over its act. That
   invented 20 "regressions" in acts 1–2. Fixed in `b138dfc`.
3. **Waiting for every `<img>` to load hangs forever** — two thirds of the
   arrival's images are lazy and never load until scrolled to. Only images near
   the viewport can be waited on, and only with a timeout.

## Acceptance criteria

- [x] `@react-three/drei` absent from `apps/web/package.json`
- [x] `three` still 0.169.0
- [x] one React major — `pnpm why react` shows only 19.2.8
- [x] ≥5 commits, one variable each, conventional format, no AI references
- [x] `pnpm build` / `lint` / `typecheck` green at Next 15 — recheck at 16
- [ ] all 6 acts visually identical to baseline — **blocked on regeneration**
- [ ] `.nvmrc`, root `engines` and CI agree on one Node version
