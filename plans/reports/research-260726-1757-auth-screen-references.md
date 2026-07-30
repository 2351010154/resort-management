# Sign-up / login screen references

Reference gathering for `app/(booking)` auth screens. Brief: interesting and
suitable *feeling*, interactive, 3D optional, colour irrelevant (retintable).

All links below were checked live on 2026-07-26. Evidence for each claim is the
runtime probe noted under it, not a summary of someone else's write-up.

---

## What I discarded, and why

The Awwwards `elements → login and sign up` gallery is the obvious place to
look and it is mostly a dead end for this project:

| Entry | Result |
|---|---|
| `abroadsocial.com/auth` | 404 |
| `jingtea.com/account/login` | redirects to stock Shopify auth |
| `c-tourist.com/prijava` | plain Laravel form, Oxygen, no motion |
| `harrygeorge.design/confidential` | HTTP 401, not inspectable |
| `varanigin.com/areapersonale` | blocked |
| `eixarcolant.cat`, `coreatelierpilates.com` | connection failed |

Of the ones that do load, nearly all are the same archetype — a centred dark
card, Inter or Geist, Google SSO, and an ambient `<canvas>` behind it. That
archetype is reference **6** below; it is worth knowing but it is not a
*feeling*, and it is not what this house looks like.

So the references worth having split into two groups: **hospitality sites whose
whole motion language the auth screen should inherit** (1, 2), and **form
interaction patterns that are directly implementable** (3, 4, 5, 7).

---

## 1. Son Daven — the closest thing to a target

<https://sondaven.com/en> · The First The Last · Site of the Month + Developer
Award, June 2026 · [Awwwards](https://www.awwwards.com/sites/son-daven)

**Probed:** `gsap`, `ScrollTrigger`, `CustomEase`, `SplitText`, `Flip`,
`lenis`, `barba` · 16 `<canvas>` · 3 `<video>` · display face *KTF Metro
Blueline* · body ground `rgb(168,148,116)` · branded loader ("LOADING THE
WEBSITE / PLEASE WAIT") · opens on a "PROLOGUE" narrative section.

**The feeling.** A resort presented as a film with chapters, not a site with
pages. It commits to a held, unhurried pace and never breaks it — the loader is
part of the story rather than an apology for one. Its warm tan ground sits
almost exactly in this project's `--sand` / `--ivory-warm` family, so the
comparison is unusually direct.

**Why it matters here.** This is the only reference that answers the real
question: *what does an auth screen look like when it is act 7 of a six-act
arrival?* Answer — it does not look like a page the user navigated to. It looks
like the film cutting to an interior.

**Take:**
- `barba`-style transition so arrival → auth is a **cut, not a load**. The
  ivory ground persists across the boundary; only the content changes.
- **GSAP `Flip`** to morph login ↔ signup as one shared element. This is the
  single highest-value technique on the list — see reference 7.
- `SplitText` line-by-line reveal on the greeting, at `STAGGER_CASCADE`.

---

## 2. Here & Away — the light, editorial register

<https://here-away.com> · Duo Studio · Honorable Mention, 8 May 2026

**Probed:** Next.js (turbopack chunks) · *PP Neue Montreal* · white ground ·
109 `<img>`, 1 `<canvas>`, no motion library · hero copy "Where You Stay Becomes
The Story" → "Matching you with the perfect stay".

**The feeling.** Curated, calm, type-led. Restraint doing the work that motion
does on Son Daven. Same framework as this repo, so its patterns transfer
without a stack argument.

**Why it matters here.** It is the counter-proposal to Son Daven: proof the
screen can feel expensive on `--ivory` with almost no motion at all. Also worth
stealing is the *stance* of its copy — the site addresses the traveller as
someone being matched to a place, not someone filling in a record.

**Take:** the copy stance. "Matching you with the perfect stay" is the tone the
signup screen wants; `docs/architecture/design-foundations.md` already asks for
a shared voice across surfaces.

---

## 3. Codrops — Fullscreen Form Interface ⭐ *recommended*

Demo <https://tympanus.net/Development/FullscreenForm/> (live, 200) ·
[article](https://tympanus.net/codrops/2014/07/30/fullscreen-form-interface/)

**The pattern.** One question at a time, fullscreen, with a progress indicator
and an animated transition between fields. Codrops' own framing:
"distraction-free form filling."

**The feeling — and this is the argument for it.** A hotel does not hand you a
form at the door. It asks you one thing at a time. Rendering signup as a
*sequence of asked questions* rather than a stack of inputs is the one choice
that makes an auth screen feel like a concierge rather than a database, and it
costs no 3D and no WebGL.

Dated 2014, so treat the code as illustrative and the *pattern* as the
deliverable. The pattern is alive and well — it is what Typeform productised.

**Take:** field-per-screen for **signup** (the considered, ceremonial path).
Keep **login** as a single fast pane — returning guests want the door open, not
a performance. Advance on Enter, `EASE_SCENE` / `DUR_SCENE` per step.

**Accessibility caveat:** a field-per-screen flow must keep one real `<form>`,
move focus to each new field, announce step changes via a live region, and
survive password-manager autofill. This is the pattern's main risk.

---

## 4. Codrops — Minimal Form Interface

Demo <https://tympanus.net/Development/MinimalForm/> (live, 200)

**The pattern.** The quieter sibling of 3 — a single input shown at a time with
subtle transitions, in a small card rather than fullscreen.

**Why both.** This is the fallback if fullscreen reads as too theatrical inside
the booking funnel, and it is the better mobile form of the same idea. Same
sequencing logic, a fraction of the staging cost.

---

## 5. Codrops — Text Input Effects (+ *Some More*)

Demos <https://tympanus.net/Development/TextInputEffects/> (live, 200) ·
[part 1](https://tympanus.net/codrops/2015/01/08/inspiration-for-text-input-effects/)
· [part 2](https://tympanus.net/codrops/2015/03/18/some-more-inspiration-for-text-input-effects/)

**The pattern.** ~25 named field micro-interactions — labels that travel into
place, underlines that draw on focus, borders that unfold, fills that wipe
across. Pure CSS transitions and pseudo-elements.

**Why it matters here.** This is the vocabulary layer, not the layout layer,
and it is where an auth screen is actually won or lost. Whichever composition
gets chosen, the fields need one consistent focus behaviour and this is a
catalogue to pick exactly one from.

**Take:** pick a **single** effect and apply it everywhere. The underline-draw
variants suit an ivory ground and a `--stone` placeholder; on focus draw to
`--ink`, error to a red the palette does not yet own. `EASE_UI` / `DUR_UI`.

---

## 6. save.design & handhold.io — the ambient-canvas archetype

<https://save.design/login> · <https://handhold.io/login>

**Probed — near-identical.** save.design: `rgb(9,9,11)` ground, *Geist*, 1
`<canvas>`, email + password + Google SSO. handhold.io: *Inter*, 1 `<canvas>`,
same field set, same SSO.

**The feeling.** Competent, current, anonymous. A still card, credible type,
and a slow generative backdrop doing all the atmospheric work.

**Why it is on the list anyway.** It is the honest baseline — this is what
"good SaaS auth" looks like in 2026, and it is what the screen will default to
if nobody decides otherwise. Two independent award-submitted products arriving
at pixel-adjacent solutions is the warning.

**The one transferable idea:** *the card stays still and the ground moves.* For
this project the ambient layer should not be a generative canvas — it should be
the arrival's own material. A held, very slow foliage gobo or a defocused
corridor plate behind a motionless ivory pane. Act 2's `foliage-gobo.tsx` and
act 3's `video-swell.tsx` already exist and already carry the right texture.

---

## 7. GSAP Flip — login ↔ signup as one object

[Flip plugin](https://gsap.com/docs/v3/Plugin/Flip/) · in production on Son Daven (ref 1)

**The pattern.** Record layout state, change the DOM, let Flip tween the delta.
The two panes are not two screens — they are one object rearranging.

**Why it matters here.** The login/signup toggle is the most-used interaction
on the surface and the one place a cheap crossfade will read as cheap. Under
Flip the shared furniture — the monogram, the ground, the submit control —
*persists and moves* while only the field set changes. It is a small amount of
code for the single most "expensive" moment on the screen, and it is the
technique the strongest reference here already ships.

**Take:** `EASE_SCENE` at `DUR_UI`–`DUR_SCENE`. Honour `prefers-reduced-motion`
with an instant swap. GSAP is already a dependency.

---

## Recommendation

**3 + 5 + 7, staged on 6's inverted idea, in 1's voice.**

- **Signup** — field-per-screen (3), one question at a time, ceremonial.
- **Login** — a single still pane, immediate.
- Both — one input effect from (5), and Flip (7) for the toggle between them.
- Behind both — a held plate from the arrival, not a generative canvas (6).
- Across the boundary — no white flash; the ivory persists (1).

The bet: **sequence and restraint, not spectacle.** Nothing here needs WebGL,
everything maps onto tokens that already exist in `lib/motion-tokens.ts`, and
the whole thing is retintable since none of it depends on a specific hue.

---

## Open questions

1. Does auth sit inside the arrival's cinematic language, or does it belong to
   the booking funnel's own idiom? `design-foundations.md` says motion is
   explicitly *not* shared across surfaces — so this is a real fork, and it
   decides whether reference 1 or reference 2 leads.
2. Is signup gated behind booking (checkout account creation) or a standalone
   entry point? Field-per-screen is right for the first and questionable for
   the second.
3. Social SSO in scope? Every live reference in group 6 leads with Google, and
   an SSO button row constrains the layout more than any motion choice here.
