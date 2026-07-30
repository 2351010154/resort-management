# Design standard hardening — implementation report

Date: 2026-07-26
Branch: `chore/web-react19-next16`
Scope: docs/architecture/design-foundations.md, easing single-source, stylelint,
reduced-motion fixes, alt audit.

> **Read §7 first.** A second Claude session was editing the same working tree
> throughout this task, and is extracting a `packages/tokens` package — which
> this task's constraints forbid. My code changes are parked in `stash@{0}`,
> unapplied, pending a decision.

---

## 1. What landed

### Item 1 — `docs/architecture/design-foundations.md` (in working tree)

640 lines, under the 800 cap. Sections: token file map; palette roles with
per-token usage counts; the `rgba()` blind spot; type scale + caps convention;
spacing rhythm and off-scale treatment; motion (marketing vs booking, the zero
-bytes budget); copy voice with funnel guidance; alt-text rule + per-image
table; do/don't + disable convention; load-bearing details; enforcement.

Linked from `docs/architecture/repository-structure.md` (§`packages/`) and from
the authority map in `docs/README.md`. Both edits are in the working tree.

Every claim was read off source and spot-verified: 19 `--ease-ui` transition
declarations, 63 `--space-*` uses, 66 baseline frames, `1.24^8 ≈ 5.59`,
`--dwell: 45vh`, act 5 `300vh`.

Findings the doc records honestly rather than papering over:

- **`--ocean` is defined and never consumed** (0 uses). Documented as reserved
  for the booking funnel's second signal colour, not deleted.
- **`--text-base`, `--text-display`, `--text-display-lg` are unused.** Every
  large line on the page is a bespoke `clamp()` measured against a comp. The doc
  states the arrival's rule (scale governs UI text, display type set per
  composition) and that it does **not** transfer to the funnel.
- **`rgba()` is the hole in the enforcement.** `color-no-hex` cannot see it, and
  the page has already drifted inside it: of 12 base colours in use only 5 are
  palette tokens, and two are unintentional near-misses — `rgba(16, 14, 11)` is
  `--night` with the blue channel one step down, `rgba(240, 235, 226)` is
  `--ivory` four steps down.

### Item 2 — easing single-sourced (stashed)

`lib/motion-tokens.ts` gains `EASE_CUSTOM_PROPERTIES` and `motionTokensCss()`,
which builds the `:root` block; `app/layout.tsx` inlines it in `<head>`; the
`--ease-*` declarations are removed from `globals.css` and replaced with a note
saying where they went.

`grep -rn cubic-bezier apps/` → **one hand-maintained site**, `motion-tokens.ts`
lines 14 and 18. ✅ AC 2.

Chosen over generating a `.css` file because a generated file in the tree can be
edited, can go stale, and needs its own CI drift check; a string built at render
time cannot drift from the constants it is built from.

### Item 3 — stylelint (stashed + `apps/web/stylelint.config.mjs` in tree)

`stylelint@17` added to `apps/web`; `"lint": "eslint . && stylelint \"**/*.css\""`.
CI already runs `pnpm run lint`, so no workflow change was needed.

Rules — no `stylelint-config-standard`, which is mostly formatting opinions that
would reflow hand-set compositions:

- `color-no-hex` — bans raw hex in modules (`app/globals.css` is ignored; it
  defines the tokens).
- `color-named: never` — `white` is not `var(--ivory)`.
- `declaration-property-value-disallowed-list` — a literal `cubic-bezier()`,
  `ease-in`, `ease-out` or `steps()` inside `transition`/`animation` is an
  error. This is what keeps item 2 from being undone one declaration at a time.
- `reportDescriptionlessDisables`, `reportNeedlessDisables`,
  `reportInvalidScopeDisables` — the disable convention.

18 pre-existing violations resolved:

- `#100e0c` × 6 across four stylesheets → new `--night` token. This was a real
  latent bug: the act 3→4→5→6 handover reads as one continuous dark *only*
  because all four were the same number, with nothing holding them together.
- 12 remaining → three described disables: act 1's `--sea-standin` (five colours
  sampled off the backdrop encode), act 5's `#fff` CTA hover lift, act 6's
  emboss faces (four stone values plus black, retuned as a set).

**AC 1 verified**: appended `.stylelintProbe { color: #ff0000 }` to
`act-3-approach.module.css` → `pnpm run lint` failed with
`Disallowed hex color "#ff0000" color-no-hex`, exit 2. Probe reverted; file diff
confirmed back to the single `--night` line.

### Item 4 — reduced-motion fixes (stashed)

**Act 4.** The stated symptom did not reproduce on first load — with the
preference on at load, `RoomDeckStatic` mounts and nothing drifts. It reproduces
on a *live toggle*, which is the real-world case (an OS accessibility setting
changed with the page open). `act-4-stay.tsx` read the preference once at mount
while watching the `NARROW` query for changes right beside it. With reduced
motion turned on and the page held completely still, cards kept advancing:

```
a[0]: translate3d(933.71px, 402.69px, 0px) rotateY(0deg) scale(0.6789)
b[0]: translate3d(1041.54px, 466.48px, 0px) rotateY(0deg) scale(0.7289)   (+3s)
```

That is `DRIFT = 0.11` steps/second on a shared `gsap.ticker`, which holding
still cannot stop. Fix: watch `(prefers-reduced-motion: reduce)` alongside
`NARROW`. Verified after: cards 3 → 0, static grid appears, `drift: NONE`.

**Act 1.** Under reduced motion the copy block rendered *nothing at all* — the
`.statement` paragraph is empty in source (has been since the first commit) and
the "Scroll" cue was gated on `animate` being `true`. The scrubbed path fades
the cue out a hundredth into the push because by then the reader has done what
it asked; reduced motion has no such moment. Now rendered on both paths.
Verified: `{"text":"Scroll","opacity":"1","visibility":"visible","onScreen":true}`.

Default-motion output is byte-identical on both fixes.

✅ AC 3.

### Item 5 — alt audit (stashed)

Rule: **decorative → `alt=""`; content → manifest alt.** All 10 image call sites
audited, zero undecided. Two changed:

- `room-deck.tsx` deck cards: manifest alt → `alt=""`. They sit inside an
  `aria-hidden` deck, so the alt was text nothing could reach, and the room is
  already named in the list beside it.
- `threshold-arches.tsx`: `alt="Arcade colonnade"` → *"Brick and stone arcade
  receding into shadow under painted ceiling panels"*. The original was accurate
  but thin — I opened the poster to check. It cannot come from the manifest
  (it lives under `public/video/`, and `prepare-arrival-images.mjs` only covers
  `public/images/`), and it is the whole of the movement on that path.

Note: the `alt="Arcade colonnade"` named in the brief as act 3's is in fact act
4's `ThresholdStatic`. Act 3 has no `<img>` at all — only a `<video>`.

Video: decided, not left open. Decorative by default, no text alternative; the
reduced-motion paths are the accessible representation. Documented in §7 of the
foundations doc rather than changed in code — adding `aria-hidden` to act 3's
loop would remove the act's only representation for AT.

✅ AC 4.

### Item 6 — no refactoring

No act 2/4 proportion, z-index or pixel-gated layout code was touched. Both
named invariants are documented in §9 of the foundations doc, along with five
more found while reading: act 1's `.stage { z-index: 0 }`, act 4's two explicit
pin z-indices, act 4's pins outliving their sections, act 5 sticky-not-pinned,
act 6's clip-path window.

---

## 2. Verification

| AC | Result |
|---|---|
| 1 — raw hex fails lint | ✅ verified, probe reverted |
| 2 — one `cubic-bezier` site | ✅ `motion-tokens.ts` only |
| 3 — reduced motion | ✅ both verified in browser |
| 4 — deliberate alt everywhere | ✅ 10/10, zero undecided |
| 5 — no visual drift | ✅ see §3 |
| 6 — doc ≤800, linked, accurate | ✅ 640 lines, both links, spot-verified |
| 7 — tests/typecheck/build pass | ✅ `pnpm lint` 0 errors (22 pre-existing warnings), `pnpm typecheck` pass, `next build` pass. No test script exists for `apps/web` — by design, per the CI comment |

---

## 3. Visual baselines — what is actually true

**The committed baselines do not reproduce on this machine.** A fresh capture of
an unchanged tree differs from `tests/visual-baseline/` on **44 of 66 frames**.
They were recorded elsewhere; a different font rasteriser and video decoder move
most of the page.

**The captures are also not deterministic run to run.** Act 1's monogram lens
and act 2's foliage gobo mount on real-time media decode, so shader phase at
shutter varies. Measured noise floor on this machine, same tree:

| Pair | Frames changed |
|---|---|
| base0 vs base1 (same build) | 8 — act 1 ×7 + nav-light |
| base0 vs baseClean (rebuild) | 7 — same set |
| headClean vs headClean2 (same build) | 4 — act 1 ×4 |
| headClean vs headRebuild (rebuild) | 5 — act 1 ×4 + nav-light |

**My delta, isolated: 4 frames — the same act-1 set as the noise floor.**

Getting to that number took work, because a first comparison showed **30**
frames moved, reproducibly across two clean builds. That turned out to be the
other session's concurrent edits to act 1, act 2, act 3 and the nav (§7) — their
eight files map exactly onto the drifting frames. Isolating properly meant
stashing *only my twelve files* and comparing their-tree against
their-tree-plus-mine:

```
theirsOnly vs headRebuild → 50/66 identical, 12 within tolerance, 4 changed
                            (desktop act-1-p000, act-1-p025, nav-light;
                             mobile act-1-p000)
```

Same frames, same magnitude as two captures of one unchanged tree. ✅ AC 5.

**Stronger evidence than the pixel gate**, and not subject to either problem —
computed styles in a live browser:

```
--ease-scene : cubic-bezier(0.19, 1, 0.22, 1)  OK   (was in globals.css)
--ease-ui    : cubic-bezier(0.23, 1, 0.32, 1)  OK   (was in globals.css)
--night      : #100e0c                          OK   (was 6 literals)
elements with a real transition: 48
off-token easing: none
elements painted --night: 3
```

Every token change is a substitution to the identical value. For that class of
change this is the right check; a pixel diff on a WebGL page is not.

**Two environment gotchas worth recording:**

1. `next build` into an existing `.next` on Windows produced HTML referencing
   chunks it never wrote — the app 500'd on a static chunk and never hydrated,
   silently yielding a full directory of garbage frames. Any capture must follow
   `rm -rf .next && build` with the server stopped. The capture script cannot
   detect this; its only hint is a `act 1 canvas never mounted` warning.
2. The committed baselines should probably be regenerated per-machine or dropped
   in favour of a CI-recorded set. As they stand they cannot gate anything
   locally.

---

## 4. Files — mine, in `stash@{0}` (not applied)

```
apps/web/app/globals.css                                   --night, ease note
apps/web/app/layout.tsx                                    <head> ease injection
apps/web/package.json                                      stylelint in lint
apps/web/features/.../act-1-gathering.module.css           disable block
apps/web/features/.../act-1-gathering.tsx                  reduced-motion cue
apps/web/features/.../act-3-approach.module.css            --night
apps/web/features/.../act-4-stay.module.css                --night ×3
apps/web/features/.../act-4-stay.tsx                       watch reduced motion
apps/web/features/.../room-deck.tsx                        alt=""
apps/web/features/.../threshold-arches.tsx                 alt rewrite
apps/web/features/.../act-5-invitation.module.css          --night, disable
apps/web/features/.../act-6-turndown.module.css            --night, disables
```

`lib/motion-tokens.ts` additions (`EASE_CUSTOM_PROPERTIES`, `motionTokensCss`)
are **in the working tree, not the stash** — that file also carries the other
session's `EASE_UI_EXIT`, which their `dynamic-island-menu.tsx` imports, so it
could not be stashed without breaking their build.

## 5. Files — mine, in the working tree (safe)

```
docs/architecture/design-foundations.md        new, 640 lines
docs/architecture/repository-structure.md      link added
docs/README.md                                 authority-map row added
apps/web/stylelint.config.mjs                  new
```

## 6. Not done

Nothing in the brief was skipped. Nothing was committed or pushed — not
authorised, and see below.

---

## 7. Blocker — concurrent session, conflicting design decision

A second Claude session has been editing `apps/web` in this same working tree
for the duration of this task. Files it changed that I never touched:

```
act-1-gathering/depth-image-field.tsx      act-2-welcome/foliage-gobo.tsx
act-1-gathering/intro-camera-model.ts      act-3-approach/video-swell.tsx
act-1-gathering/monogram-lens.tsx          navigation/concierge-nav.tsx
navigation/navigation.module.css           navigation/dynamic-island-menu.tsx
lib/motion-tokens.ts (EASE_UI_EXIT)
```

Two collisions:

1. **They are extracting `packages/tokens`.** `packages/tokens/{package.json,
   tokens.css}` now exists, `app/globals.css` has been gutted of its `:root`
   block, and `layout.tsx` imports `@mariva/tokens/tokens.css`. This task's
   constraints say *"No shared UI package, no `packages/design-tokens`
   extraction"*, and `repository-structure.md` argues against it. One of the two
   instructions is stale, and that is not my call to make.
2. **They implemented the same `motionTokensCss()` injection.** Their
   `layout.tsx` carries an equivalent `<head><style>{motionTokensCss()}</style>`
   plus a comment explaining the two-author split. Item 2 is effectively done
   twice, compatibly.

`git stash pop` refuses — their edits to `globals.css`, `layout.tsx`,
`package.json` and three act stylesheets would be overwritten. I did **not**
force it.

The foundations doc as written describes `globals.css` as the token home. If the
tokens package stands, §1 and §2 of that doc need retargeting to
`packages/tokens/tokens.css` — a small edit, but it should follow the decision,
not precede it.

### What I need from you

1. Does `packages/tokens` stand, or does the no-extraction constraint? If it
   stands I will retarget the doc and rebase my stash onto their `globals.css`.
2. Should I merge `stash@{0}` onto their tree (I would take their `layout.tsx`
   and `globals.css`, and re-apply `--night`, the stylelint disables, the
   reduced-motion fixes and the alt changes on top), or hold until their session
   finishes?

---

## Unresolved questions

1. `packages/tokens` vs the no-extraction constraint — above.
2. Act 1's `.statement` renders an empty `<p>`, and has since the first commit.
   Deliberate spacer, or lost copy? I left it alone: it is a flex child of
   `.copy` under `justify-content: space-between`, so removing it moves the cue
   on the default-motion path — a pixel change I was not asked to make.
3. Should the committed visual baselines be regenerated, moved to CI, or
   dropped? They currently fail on an unchanged tree on this machine and cannot
   gate anything locally.
4. Is an `rgba()` token rule wanted? It is the one documented hole in the colour
   enforcement, and there is already measurable drift inside it (§1).
5. `apps/web` has no `test` script, so `pnpm test` is a no-op for it. Intended,
   or a gap?

```
Status: BLOCKED
Summary: All six work items are implemented and verified — doc written and linked, easing single-sourced, stylelint gating raw hex, both reduced-motion gaps fixed, alt audit complete, zero visual drift attributable to my changes. My code sits unapplied in stash@{0} because a concurrent session is extracting packages/tokens in the same tree, which contradicts this task's no-extraction constraint.
Concerns/Blockers: (1) packages/tokens vs the no-extraction constraint — needs your decision before I merge. (2) git stash pop refuses against their edits; I did not force it. (3) The committed visual baselines do not reproduce on this machine (44/66 frames differ before any change) and act 1 is nondeterministic run-to-run; I gated on computed-style identity plus an isolated 4-frame delta equal to the noise floor.
```
