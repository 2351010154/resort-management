# Design foundations

The landing page is the design standard. There is no `packages/ui` and none is
planned — see [`repository-structure.md`](repository-structure.md) for why. The
*values* do live in a package, `packages/tokens`; what does not is components.
So what the three surfaces share is written down here instead: a palette, a type
scale, a spacing rhythm, two easing curves, and a way of writing sentences.

This file is written for whoever builds `app/(booking)` — human or agent —
with no prior exposure to the arrival. Read it before the first component.
Everything in it was read off the code, and every claim is traceable to a file
named in the text.

**What is shared:** tokens and copy voice.
**What is not shared:** motion, components, layout idiom. The marketing
arrival, the booking funnel and the admin console have deliberately different
visual languages. Consistency here means a booking screen looks like it belongs
to the same house, not that it looks like the same page.

---

## 1. Where the standard lives

| Fact | File |
|---|---|
| Palette, type scale, spacing rhythm | [`packages/tokens/tokens.css`](../../packages/tokens/tokens.css) |
| Base element styles, the two global classes, the reduced-motion kill switch | [`apps/web/app/globals.css`](../../apps/web/app/globals.css) |
| Every ease, duration, stagger; the `--ease-*` custom properties | [`apps/web/lib/motion-tokens.ts`](../../apps/web/lib/motion-tokens.ts) |
| Type families (`--font-display`, `--font-ui`), the `:root` block for the eases | [`apps/web/app/layout.tsx`](../../apps/web/app/layout.tsx) |
| Colour and easing enforcement | [`apps/web/stylelint.config.mjs`](../../apps/web/stylelint.config.mjs), invoked by the web and root package scripts |
| Image alt text | [`apps/web/features/arrival/lib/image-manifest.ts`](../../apps/web/features/arrival/lib/image-manifest.ts) (generated) |
| Per-act composition | `apps/web/features/arrival/components/act-{1..6}-*/` |
| The first booking surface, as a worked example | `apps/web/features/auth/components/login-screen.*` |

The palette used to live in `globals.css`, and the acts that wanted a colour at
partial opacity re-typed it as a decimal `rgba()` triplet — nine stylesheets
each holding their own copy of the numbers. `packages/tokens/tokens.css` fixes
that by pairing each hex with a bare-channel `--*-rgb` on the adjacent line, for
`rgb(var(--x-rgb) / α)`. The **root layout** imports it, immediately ahead of
`globals.css`; neither file re-declares a value from the other.

Styling is CSS Modules throughout. No Tailwind, no CSS-in-JS, no utility
classes beyond the two in `globals.css`.

---

## 2. Palette

Ten tokens. The first nine were sampled from the curated reference library as
1×1 ffmpeg averages; `--night` was extracted later from four stylesheets that
had all typed the same number.

| Token | Value | Role | Uses in CSS |
|---|---|---|---|
| `--ivory` | `#f4efe6` | Page ground on the light acts; type on the dark ones | 26 |
| `--ivory-warm` | `#eee7de` | The wall. Acts 2 and 3 settle onto it so they read as one surface; `/booking`'s stay panel is a plate of it beside the ivory calendar | 5 |
| `--sand` | `#cfc0ab` | Secondary type on dark grounds — captions, kickers, footer links | 10 |
| `--stone` | `#8a7b6e` | Quietest type. Rail labels, column titles, placeholders, small print | 6 |
| `--stone-deep` | `#645c51` | Body copy on light grounds; the corridor's lit tone panel | 4 |
| `--umber` | `#3a332b` | Photographic ground — what a panel or card shows before its image decodes | 3 |
| `--ink` | `#1c1915` | Primary type on light grounds; the corridor and threshold grounds | 8 |
| `--dusk-amber` | `#b48b60` | The single accent. Two list titles, and the light behind act 5's pill | 3 |
| `--ocean` | `#7fa2b7` | The funnel's selected-date wash; a 14% cool cast in act 4. See below | 9 |
| `--night` | `#100e0c` | The dark the acts hand over on | 6 |

### Reading the roles

**Type colour is decided by the ground, not by the component.** On ivory:
`--ink` for headings and display lines, `--stone-deep` for body, `--stone` for
the quietest labels. On dark: `--ivory` for anything that must be read first,
`--sand` for everything supporting it, `--stone` for what is nearly furniture.
A booking screen on ivory that reaches for `--sand` as body copy will be
illegible; that token exists for dark grounds.

**`--umber` is not a surface, it is an under-layer.** It sits behind
photographs (`.panel`, `.card` in act 4) so a frame whose image has not decoded
is a warm dark rectangle rather than a hole. Act 4's quiet tone panel is the one
place it is a surface in its own right.

**`--dusk-amber` is the accent and it is nearly unspent.** Three uses on the
whole page. That restraint is the point: the arrival has no buttons that need to
shout, so the one warm colour marks the two list heads and — at the end, on the
one control the ride has — the light around act 5's pill. The booking funnel has
real primary actions, and this is the token for them — but the discipline
transfers with the colour. One accent, used where the eye must go, and nowhere
else.

The pill is worth separating out, because it spends the accent as **light rather
than as ink**: the type stays `--ink` and the fill stays `--ivory`, and what is
amber is the bloom behind them (plus a 6% wash in the fill on hover). A dark act
lit by lamps can afford that reading where a form on ivory cannot — but it is
still one amber thing on the screen, which is the rule holding.

`/login` is the first surface to spend it that way, and it spends it once: the
submit control is filled `--dusk-amber` and nothing else on the screen is. The
reveal toggle rests at `--stone`, the forgot link at `--stone-deep`, the
provider discs at an `--ink` hairline — each resolving to `--ink` on focus. If a
booking screen ever wants a second amber thing, that is a question about which
of the two is actually the primary action.

**`--ocean` was reserved, and `/booking` is what it was reserved for.** It is the
only cool token in the family, and this table said it had zero uses for as long as
the arrival was the only surface — act 1's sea is sampled film stock, not this. Two
things have since spent it, and they are spending it for different reasons.

Act 4 uses it once, as a **cast rather than a signal**:
`color-mix(in srgb, var(--ocean) 14%, transparent)` in the night half's wash. At 14%
over `--night` it is not read as a colour at all, only as the cool edge of a dark
frame, which is the one job the arrival ever found for it.

The funnel uses it as a **signal**, which is what this paragraph reserved it for:
if the booking screens needed a second signal colour for "an informational state, a
selected date", `--ocean` was the one already agreed on. The stay calendar needed
exactly that, and took it: the nights of the stay are washed
`rgb(var(--ocean-rgb) / 0.22)`, the
arrival and departure cells are solid `--ocean` with `--ink` type, and the chosen
room's card carries the same wash at 0.1.

That division is what keeps §2's discipline intact with two colours instead of one:
**`--ocean` is what the guest has chosen, `--dusk-amber` is what they can do next.**
The `Choose` button is the only amber thing on the screen. A focus ring is amber
too, following `/login`'s precedent — a ring is an affordance, not a second accent.

Its `--ocean-rgb` triplet was added to `packages/tokens/tokens.css` in the same
change, because a wash is the colour at an alpha and §2's rule is that an `rgba()`
is a palette colour with an alpha.

**`--night` is a seam, not a shade.** Act 3's tail fade closes on it, act 4
stands on it, act 5 opens on it, act 6 warms out of it. The handover between
those acts reads as one continuous dark only because all four are the same
number — which is exactly why it is a token now and was a bug waiting to happen
before. Its `rgba(16, 14, 12, α)` form is every scrim in those acts.

### Alpha and gradients — the hole in the enforcement

Scrims, tints and hairlines are written as `rgba()` literals, not as tokens with
an opacity. There are a lot of them and no two want the same alpha, so a token
per stop would be a token per declaration. That much is fine.

What is not fine is that **`color-no-hex` does not catch `rgba()`**, and the
page has already drifted inside that blind spot. The twelve base colours
currently in use, by frequency:

| Base | Token | Uses |
|---|---|---|
| `16, 14, 12` | `--night` | 20 |
| `28, 25, 21` | `--ink` | 7 |
| `244, 239, 230` | `--ivory` | 7 |
| `120, 106, 88` | — none | 5 |
| `0, 0, 0` | — black | 3 |
| `16, 14, 11` | — **off by one from `--night`** | 2 |
| `100, 92, 81` | `--stone-deep` | 2 |
| `58, 51, 43` | `--umber` | 1 |
| `240, 235, 226` | — **near-miss of `--ivory`** | 1 |
| `24, 21, 18` | — none | 1 |
| `180, 139, 96` | `--dusk-amber` | 1 |
| `10, 40, 52` | — none | 1 |

Five of twelve are palette colours. Two are a hair off one — `16, 14, 11` is
`--night` with the blue channel one step down, `240, 235, 226` is `--ivory` four
steps down — and neither difference is visible or intentional. This is exactly
the drift the hex ban exists to prevent, surviving in the one syntax the ban
does not read.

**The rule going forward: an `rgba()` is a palette colour with an alpha.** New
CSS should use one of the token values above. The existing off-palette bases are
left alone rather than "corrected" — they sit in pixel-gated compositions and
the gain is not worth the risk — but they are not precedent.

This is the one part of the palette standard that rests on review rather than on
the linter. A rule that resolves `rgba()` against the token values would close
it; it does not exist yet.

---

## 3. Type

Two families, both from `next/font/google` in the root layout, both injected as
custom properties:

- `--font-display` — **Literata**, always weight 300. The display voice.
- `--font-ui` — **DM Mono**, weights 300 and 400. Everything else, including
  every caps run. The monospace is the house's UI signature, not an accident.

`globals.css` sets `--font-ui` at weight 300 on `body`, so the mono is the
default and the serif is opt-in.

**The booking funnel inverts that, and only the funnel.** `(booking)`'s screen
root sets `--font-display` for prose, and `.caps-label` keeps the mono for what
it was chosen for — caps runs, labels, the one primary button.

The reason is that the two surfaces say different kinds of thing. On the arrival
the mono is a caption over a film plate, a few words at a time, and it is the
house's signature. A booking screen is dates, counts, values and sentences, and
in a monospace those read as output rather than as writing: even spacing between
every glyph is exactly what makes a line of prose look like a log line. At two
months of calendar plus a summary panel there is enough of it on screen at once
for the texture to decide how the page feels.

Two faces still, no new bytes, and the arrival untouched. It also fixes something
`layout.tsx` documents at length: DM Mono has no Vietnamese subset, so ₫ fell
through to whatever the system offered. Literata carries the mark.

### The two global classes

These are the only utility classes in the codebase, and they exist because both
are exactly one idea used on every act:

```css
.font-display { font-family: var(--font-display), serif; font-weight: 300; }

.caps-label {
  font-family: var(--font-ui), sans-serif;
  text-transform: uppercase;
  letter-spacing: var(--tracking-caps);   /* 0.22em */
  font-size: var(--text-xs);              /* 0.75rem */
}
```

**Every caps run on the page goes through `.caps-label`.** Kickers, rail
labels, captions, list titles, nav links, the CTA, the footer column heads.
The tracking is the tell — `0.22em` is very open, and a caps run set at normal
tracking will look wrong next to anything on this page. Use the class; do not
re-derive it.

### The scale

| Token | Value | Where it is used today |
|---|---|---|
| `--text-xs` | `0.75rem` | `.caps-label`, footer small print |
| `--text-sm` | `0.875rem` | Footer links, notes, form input |
| `--text-base` | `1rem` | **unused** |
| `--text-lg` | `1.375rem` | Act 4's room list — title and entry name |
| `--text-display-sm` | `clamp(1.75rem, 3.5vw, 2.75rem)` | Act 1's statement, act 4's tone lines |
| `--text-display` | `clamp(2.5rem, 6vw, 4.5rem)` | **unused** |
| `--text-display-lg` | `clamp(3.5rem, 9vw, 7.5rem)` | **unused** |
| `--tracking-caps` | `0.22em` | Via `.caps-label`; also act 4's list title |

**Be honest about what this scale is.** Three of its seven steps are unused,
and every large line on the page is a bespoke `clamp()` written next to the
composition it belongs to — act 2's welcome line is
`clamp(2rem, 4.1vw, 3.75rem)`, its chapter heads `clamp(1.75rem, 3.3vw, 3.05rem)`,
act 4's panel headline `clamp(3rem, 7.5vw, 6.5rem)`, act 5's address
`clamp(1.5rem, 2.6vw, 2.35rem)`. The stylesheets say why in each case, and the
reasons are real: those sizes were measured against reference compositions, and
the token steps do not hit them.

So the working rule for the arrival is: **the scale governs UI text, and
display type is set per composition.** That is defensible for six hand-built
acts photographed against comps.

**It is not defensible for the booking funnel.** A funnel is a run of similar
screens, and its text sizes should come from the scale — `--text-sm` for
supporting text, `--text-base` for body, `--text-lg` for a field label group,
`--text-display-sm` for a step heading. `--text-base` and `--text-display` are
unused precisely because nothing on the arrival is an ordinary page. Use them.
If a booking screen needs a size that is not on the scale, that is a signal to
question the screen, not to write another `clamp()`.

---

## 4. Spacing

Five steps, geometric, each double the last:

| Token | Value |
|---|---|
| `--space-1` | `0.5rem` |
| `--space-2` | `1rem` |
| `--space-3` | `2rem` |
| `--space-4` | `4rem` |
| `--space-5` | `8rem` |

They are used 63 times across the act stylesheets, and always for the same two
jobs: **padding on a container, and `gap` between siblings.** `--space-2` and
`--space-3` carry most of it; `--space-1` is a tight pairing (a caption under
its rule), `--space-4` separates blocks inside a section, `--space-5` is a
section's own top padding.

### How off-scale values are treated

There are plenty. `6vw` gutters in act 4, `13vh` padding in act 5, `1.75rem`
between a kicker and its line, `1.15rem` between room entries,
`clamp(1.25rem, 4vw, 4.5rem)` for act 2's chapter gutter. These are not
violations, and the standard should not pretend they are.

The distinction that actually holds:

- **Rhythm is on the scale.** Anything answering "how far apart do these two
  things sit" uses a `--space-*` token. This is what makes the page feel like
  one document.
- **Composition is measured.** Anything answering "where exactly does this land
  in this frame" is written where it is measured — usually a `clamp()` or a
  viewport unit, next to a comment saying what it was measured against. Act 2's
  `--dwell` is not a spacing decision, it is how long a stacked panel holds
  still between the movement that brings it in and the one that covers it.
- **A bare `rem` with no comment is neither**, and is the thing to catch in
  review. If it is rhythm it should be a token; if it is composition it should
  say what it was measured against.

Viewport units carry structure: act heights (`260vh`, `480vh`, `700vh`), stage
heights (`100vh`), gutters (`6vw`). Those are load-bearing — see §9.

**For the booking funnel:** it has no compositions measured against film. Stay
on the scale. An off-scale value in `(booking)` should be rare enough to need a
sentence explaining itself.

---

## 5. Motion

### The single source

Every ease, duration and stagger is a constant in
[`lib/motion-tokens.ts`](../../apps/web/lib/motion-tokens.ts). The two CSS
custom properties are **generated from those constants** by
`motionTokensCss()`, which the root layout inlines into `<head>`. There is
exactly one hand-written `cubic-bezier` in the repository, and it is in that
file.

This used to be two definitions kept level by a comment in `globals.css`. That
is the failure this arrangement exists to prevent: a CSS transition and a GSAP
tween drifting apart does not error, it just quietly stops feeling like the
same page.

```ts
EASE_SCENE     = "expo.out"    // cubic-bezier(0.19, 1, 0.22, 1)  -> --ease-scene
EASE_UI        = "power2.out"  // cubic-bezier(0.23, 1, 0.32, 1)  -> --ease-ui
EASE_UI_EXIT   = "power2.in"   // GSAP only — no CSS counterpart

DUR_SCENE      = 1.4   // scene transitions
DUR_SCENE_SLOW = 2.4   // cinematic moves on large media
DUR_UI         = 0.5   // micro-interactions
STAGGER_CASCADE = 0.1  // menu / card cascades

LENIS_LERP              = 0.06
LENIS_WHEEL_MULTIPLIER  = 0.8
```

### What CSS actually uses

Across every stylesheet on the page, CSS transitions use **`--ease-ui` only**,
at **0.4s, 0.45s or 0.5s** — 19 declarations, no exceptions. `--ease-scene` is
never used from CSS; it belongs to GSAP, where scene-scale moves live.

That is the whole CSS motion vocabulary, and it is the part that transfers:

> **A CSS transition is `0.4s`–`0.5s` with `var(--ease-ui)`.** Anything else is
> a new decision and needs a reason.

Stylelint enforces the curve half of this: a literal `cubic-bezier()`,
`ease-in`, `ease-out` or `steps()` inside a `transition` or `animation`
declaration is an error.

### Marketing motion

Cinematic and scroll-driven. GSAP ScrollTrigger scrubs against a single Lenis
smoothing layer; every act pins its own stage and scrubs its own timeline;
acts 1 and 2 additionally run R3F shader canvases. All of it is mounted from
[`app/(marketing)/layout.tsx`](<../../apps/web/app/(marketing)/layout.tsx>) —
deliberately not the root layout, because a provider at the root is in every
route's tree.

Nothing in the arrival captures wheel or touch. Every horizontal move, every
reveal, every wipe is driven by vertical scroll position. That is a rule worth
keeping: the reader's scroll is the only input.

### Booking motion

**Calm, the same curve, and CSS wherever CSS can do it.** A booking screen gets:

- `transition` on `opacity`, `transform`, `color`, `border-color`,
  `background-color`;
- `0.4s`–`0.5s`;
- `var(--ease-ui)`;
- nothing else.

No scroll-driven anything. No pinning. No canvas. A funnel that animates like
the arrival is a funnel that gets in the way of booking a room.

**One property is on that list that is not a transform, and it is named rather
than assumed.** `/booking`'s stage is two grid columns — the calendar and the stay
panel — and the panel opening moves them from `100 / 0` to `70 / 30`. That is a
width, and no amount of `transform` will do it: a scaled column scales its own
type, and a translated one does not give the space back. So the funnel transitions
**a registered `<percentage>` custom property**, once, on one element, and the
grid resolves its tracks from it:

```css
@property --booking-panel-share { syntax: "<percentage>"; inherits: false; initial-value: 0%; }
.stage { grid-template-columns: minmax(0, 1fr) var(--booking-panel-share); }
```

Three things keep this inside the budget rather than widening it:

- **It is one number on one element**, which is the mechanism limit the login
  screen's filmstrip established — not a crossfade plus two position changes.
- **A registered property is animated as a number, not as a track list.**
  Transitioning `grid-template-columns` directly works only where both lists match
  track for track, and fails as a silent jump where they do not. This cannot.
- **Nothing inside either column animates.** The panel's contents are set at their
  final measure and revealed by a clip (`min-width` on the panel's child,
  `overflow: hidden` on the column), because §"What the login screen settled" is
  explicit that a funnel screen must not re-lay-out its own inputs. The calendar's
  own grid does re-flow to the narrower column, and the cell the guest pressed keeps
  focus and its 44 px floor throughout — which is why the calendar reads its
  breakpoints from a container query on itself rather than from the window.

The one number carries the second ground with it. The panel column is painted
`--ivory-warm` and runs the full height of the page, so the same tween that gives
the calendar's 30% back also wipes a warm plate in from the right edge — one
property, two things read off it, and no cross-fade anywhere.

The reduced-motion path is the same composition with no travel: the panel is
simply there. Both readings are complete, which is §9's rule and not a fallback.

**`motion` is permitted in `(booking)`, for exits only.** This section said
*CSS-only* until `/booking` was built, and that rule could not be kept: **CSS
has no exit.** A dismissed element either stays mounted or is gone on the frame
it unmounts, so a bottom sheet under a CSS transition can enter on
`var(--ease-ui)` and cannot leave on anything. `motion-tokens.ts` had already
named the curve for this — `EASE_UI_EXIT`, `power2.in`, "the same
micro-interaction leaving" — and then had to admit it was GSAP-only and that
"nothing exits under CSS yet". Nothing could.

[`tech-stack.md`](tech-stack.md) §Frontend already listed `motion` 12.42 as this
repo's motion budget, and the two documents disagreed for as long as the funnel
had nothing that left the screen. They agree now, on these terms:

- **The `three` / `gsap` / `lenis` budget is unchanged.** `motion` is not on
  that list and does not pull any of them. Verified against the built route:
  `/booking`'s chunks contain no `gsap`, `ScrollTrigger`, `lenis`,
  `WebGLRenderer` or `react-three`, while `/`'s contain all five.
- **`LazyMotion` with `domAnimation`, and the `m` component — never `motion.*`.**
  `motion.div` bundles layout projection, drag, scroll and SVG morphing because
  the component cannot know what a page will use. The funnel uses `opacity` and
  `transform`. `<LazyMotion strict>` makes that enforceable: a `motion.*`
  component inside it throws rather than quietly restoring the full bundle.
- **Durations and curves still come from `motion-tokens.ts`.**
  `features/booking/lib/booking-motion.ts` is the only place that converts them
  into Motion's four-number ease form, and it *parses* `EASE_UI_CSS` rather than
  re-typing the digits — so there is still exactly one hand-written
  `cubic-bezier` in the repository.
- **Entrances stay in CSS where CSS suffices.** Every cell hover, the range
  paint, the card and summary-row washes and the photo card's name underline are
  all stylesheet transitions. Motion is used for six things, and five of them
  are exits: the bottom sheet, its scrim, the wide room dialog, the summary bar,
  **the swap between `/booking`'s two views**, and the card cascade's stagger.

  The view swap is the one that could not have been anything else. `/booking`
  asks two questions in sequence and unmounts the one it is not asking, because
  that is how "one open decision at a time" is guaranteed by the tree rather
  than by CSS discipline — and an unmounted view has to be able to leave.

**Reduced motion is still a composition, not a frozen frame** — and Motion makes
that a rule you have to keep by hand, because the global kill-switch in
`globals.css` cuts *CSS* durations and does not reach a JS animation.
`useReducedMotion` is read at every call site and swapped for a still variant, so
the sheet is rendered in place rather than travelling a viewport height in
`0.01ms`.

### What the login screen settled

`/login` is the first surface built to the rules above, and it is worth reading
before the second one — `features/auth/components/login-screen.module.css`.

Its one move looks expensive and is not. The screen is a filmstrip three panels
wide against a frame one panel wide — `[plate 60][pane 40][plate 60]` — and
focus moving to the password field pans it by exactly one plate, which carries
the form across the frame and brings the second plate in behind it. Measured at
1440×900: `translateX(0)` to `translateX(-864px)`, form from x=968 to x=104.

Four things it establishes:

- **A scene-scale move is allowed if it is one transform on one element.** The
  budget's list above is not a size limit, it is a mechanism limit. Panning a
  full frame in `0.5s` on `var(--ease-ui)` is inside it; the same move assembled
  from a crossfade plus two position changes is not, and would need GSAP `Flip`
  to stay coherent — which the bundle budget below forbids outright.
- **A layout move holds under reduced motion; it does not collapse.** The global
  kill-switch in `globals.css` cuts every duration to `0.01ms`, which turns a
  pan into a full-frame jump on every focus change — worse than the motion it
  was protecting against. The screen locks the strip to its first reading
  instead, and both fields stay present and legible. This is §9's rule about
  reduced-motion paths being compositions in their own right, in the funnel.
- **The ground moves and the pane stays still.** The form does not animate: it
  keeps its size, its type and its focus behaviour throughout, and only what is
  behind and beside it changes. A funnel screen that re-lays-out its own inputs
  is a screen that loses a password manager mid-fill.

- **A plate is the ground carrying on, not a picture hung on it.** Both plates
  are pale plaster, sky and linen, within a shade or two of `--ivory` — so the
  alcove that arrives beside the password field reads as the same wall the form
  is standing on, with one niche in it. Its inner edge is masked to transparent
  over the first 22% — about 190px at 1440 — so the wall's light arrives
  gradually instead of starting at a line.

  **A fade only works if it lands on the colour it is fading into.** The plates
  fall back to `--ivory-warm` before their images decode, rather than the
  `--umber` §2 reserves for photographic under-layers — but plate B overrides
  that to `--ivory`, because that is what the form pane beside it is painted.
  Fading onto `--ivory-warm` produced a warm band with a hard edge on *both*
  sides: a seam where there had been one seam. Measured after the fix, the pane
  and the first pixel of the plate are both `244, 239, 230`, and the largest
  adjacent-pixel delta across the join is 3 of a possible 765.

  Pick funnel imagery that can do this. A plate that needs a dark scrim to
  carry its type is a picture, and it will look pasted on.

Field focus is one drawn underline, chosen once and used by both fields, which
is also why the UA outline can be removed — it is replaced, not deleted.

### The budget

**`app/(booking)` must ship zero bytes of `three`, `gsap` or `lenis`.** This is
stated as a CI budget in
[`repository-structure.md`](repository-structure.md#appsweb--nextjs), and it is
the reason the root layout carries only the document shell, the fonts and the
tokens.

Two consequences for anyone building there:

1. **Do not import from `features/arrival/`.** Everything under it reaches the
   banned three eventually. `lib/motion-tokens.ts` and `lib/use-in-view.ts` are
   in `lib/` precisely because a booking screen may reach for them; that is the
   complete list.
2. **Do not add a provider to `app/layout.tsx`.** If both route groups need
   something, it goes in each group's own layout, or it is not a provider.

The `--ease-*` properties are the one motion thing the root layout does emit —
they are two strings of text, they cost nothing, and they are what keeps the
funnel feeling related to the arrival.

**The budget is about those three packages, not about weight in general.** It is
worth being honest that the funnel is not free: `/booking` adds **~136 KB gzip**
over `/signup`, almost all of it `@react-aria/calendar` + `@react-stately/calendar`
+ `@react-aria/i18n` and Motion's `domAnimation`. That bought a range calendar
whose keyboard and ARIA behaviour is somebody else's tested problem — measured
against four production pickers that each get part of it wrong — rather than four
hundred lines of roving-tabindex code in this repo. It is the most expensive screen
in the funnel and the only one that should be; if a later step reaches this size,
that is a finding, not a precedent.

---

## 6. Copy voice

The register is a good hotel speaking quietly. It is worth being precise about
what that means mechanically, because it is easy to approximate badly.

**Second person, and the reader is already a guest.** Not "book your stay" but
"You have been expected." (act 2). Not "submit" but "Begin your stay" (act 5).
The footer's newsletter confirmation is one word — "Expected." — deliberately
echoing act 2.

**Short declaratives. Full stops, not exclamations.** Act 4's corridor is eight
panels of it: "Nothing to do" / "And all day to do it." — "Still water" /
"36°C, always." — "Warm stone" / "The bath is already drawn." — "Your door" /
"Suite 704."

**A headline states, a caption qualifies.** The pattern is consistent enough to
copy: display line makes a claim of three or four words; the caps caption under
it adds one concrete fact. Never two facts.

**Concrete over evocative.** "68 m² · garden". "eight seats · one sitting".
"private spring · 41°C". "lap pool · 06:00–22:00". Numbers, units, a middle dot
between them. The luxury is in the specificity, not in adjectives. There is
almost no adjective anywhere in the page's copy.

**Chapter bodies are three sentences, and the third one turns.** Act 2's
chapters all do this: two sentences of description, then a short one that
addresses the reader — "Nothing here asks anything of you." / "You leave
lighter than you arrived."

**Never sell.** No urgency, no scarcity, no "limited", no "exclusive", no
"don't miss". Act 6's small print names the page as a concept study rather than
dressing it up.

### For the booking funnel

The funnel has to say things the arrival never says: prices, dates, errors,
confirmations. The voice carries, the register drops slightly toward plain.

- Keep the second person and the full stops. "Your dates are held for 15
  minutes." not "Hurry — your dates are only held for 15 minutes!"
- Keep concrete facts in the arrival's shape. "2 nights · 1 room · from
  14 March".
- **Errors are plain and blameless.** "That card was declined." not "Oops!
  Something went wrong 😕". No apology theatre, no exclamation marks.
- **Never invent hotel facts.** Room names, sizes and hours live in
  `room-deck.tsx` and the image manifest today and in the database later. Copy
  that quotes a number must quote a real one.

---

## 7. Images

### Alt text — one rule

> **Decorative images get `alt=""`. Content images get meaningful alt, from the
> image manifest wherever the image is in it.**

An image is decorative when it is atmosphere the copy does not depend on, or
when it sits inside an `aria-hidden` container. Every image on the landing page
has been audited against this; there are no undecided cases.

| Image | Decision | Why |
|---|---|---|
| Act 1 backdrop plate | `alt=""` | Far-plane atmosphere |
| Act 1 depth field cards | `alt=""` | Inside an `aria-hidden` field |
| Act 2 orbiting field | `alt=""` | Inside an `aria-hidden` field |
| Act 2 chapter tiles | manifest `alt` | The chapters' subject matter |
| Act 4 corridor panels (both paths) | manifest `alt` | Each panel is a claim about the hotel |
| Act 4 room deck cards | `alt=""` | Inside the `aria-hidden` deck; the room is named in the list beside it |
| Act 4 static room grid | manifest `alt` | Reduced-motion path — these are the content |
| Act 4 threshold poster | written inline | Lives under `public/video/`, so the manifest does not cover it |
| Act 5 invitation plate | manifest `alt` | The act's single frame |
| Act 6 wordmark band | `alt=""` | Inside an `aria-hidden` band behind the mark |
| Nav island cards | manifest `alt` | Links to rooms |
| `/login` plates | `alt=""` | Atmosphere beside a form. See below |
| `/booking` room leads | written inline, **never `""`** | The thing the guest is choosing between. See below |

**The login plates are the funnel's first images, and they are not in the
manifest.** They live under `public/images/auth/` and are referenced by hand,
because `scripts/prepare-arrival-images.mjs` curates the *arrival's* library and
writes the *arrival's* manifest — sweeping a booking image into it would put a
`features/arrival/` import in the funnel's path, which §5's budget forbids. So
their `alt` is written inline, and the rule that decides it is the one above:
they are atmosphere a sign-in form does not depend on, inside `aria-hidden`
asides, so both are `alt=""`.

**The booking room leads follow the same route and land on the opposite
answer.** They live under `public/images/booking/rooms/` and are declared by
hand in `features/booking/lib/room-images.ts`, for exactly the reason the plates
are — but they are **content**, not atmosphere. A room card is a photograph of
the room the guest is being asked to take; with the text covered it is the only
thing telling five rooms apart. So every one carries a written `alt`, and
`room-images.spec.ts` fails the build if one is empty.

Two rules that fall out of that, and are worth stating because both are easy to
get wrong:

- **The `alt` does not repeat the room's name.** The name is rendered beside the
  frame inside the same button, and again as the room sheet's title. An `alt`
  beginning "Junior Suite," makes a screen reader say it twice — which is the
  same defect as `alt=""`, in the other direction.
- **A tier's number is the file's real pixel width**, so the `srcSet` descriptor
  and the filename suffix are the same number and the browser is never told a
  file is bigger than it is. The arrival's manifest names the width each tier was
  *asked* for; this one names what came out.

Decide from the image's job on the surface it is on, not from the file. The
same photograph can be content on one surface and decoration on another — act
4's corridor panels each make a claim about the hotel and carry real alt text;
the same frame behind a password field would claim nothing, and reading it to
someone trying to type is noise.

The manifest is **generated** by `scripts/prepare-arrival-images.mjs`. To change
an alt for an image under `public/images/`, change it at the source and
regenerate — an edit to `image-manifest.ts` will be overwritten.

### Video

Video is decorative by default and carries no text alternative: it is
background footage, always `muted loop playsInline`, and the frame it shows is
never the only place its information exists. **The reduced-motion path is where
each act's content is made readable** — act 4's threshold collapses to a poster
image with real alt text, its corridor and rooms to captioned grids. That is
the accessible representation, and it is why those static variants are not
optional.

### Everything else

- Always `srcSet` + `sizes` via `tierSrcSet` / `tierSrc`. The manifest carries
  the tiers.
- `loading="lazy"` on anything not in the first viewport; `decoding="async"`.
- `width` and `height` from the manifest wherever the image is in layout flow.

---

## 8. Do and don't

**Do**

- Use `var(--*)` for every colour.
- Use `.caps-label` for every caps run.
- Use `--space-*` for padding and gaps.
- Use `var(--ease-ui)` at 0.4–0.5s for every CSS transition.
- Put a comment above any measured value saying what it was measured against.
- Give every image a deliberate `alt`, empty or meaningful.
- Write copy in the second person, in full stops, with concrete numbers.

**Don't**

- Don't write a raw hex or a named colour in a CSS Module. If you genuinely
  need a one-off, see the disable convention below.
- Don't write a literal easing curve anywhere.
- Don't invent an off-scale spacing value in `(booking)`.
- Don't set a caps run's tracking by hand.
- Don't import `three`, `gsap`, `lenis`, or anything from `features/arrival/`
  into `(booking)`.
- Don't use `motion.*` in `(booking)` — `m` inside `<LazyMotion strict>`, and
  only for what CSS cannot do. See §5.
- Don't animate in JS without reading `useReducedMotion` — the global CSS
  kill-switch does not reach Motion.
- Don't add a provider to the root layout.
- Don't put a decorative image in the accessibility tree, and don't hide a
  content image from it.
- Don't add exclamation marks, urgency, or scarcity to any copy.
- Don't put `role="application"` on a composite widget. It turns off the screen
  reader's browse mode, which is the mode that reads a price inside a cell —
  React Aria's calendar sets it and `stay-calendar.tsx` strips it back off.

The first two are enforced by
[`apps/web/stylelint.config.mjs`](../../apps/web/stylelint.config.mjs). The web
package exposes that check as `lint:css`, and the root `lint` script invokes it;
CI runs the root script.

### The disable convention

A one-off is allowed. It has to say why:

```css
/* stylelint-disable-next-line color-no-hex -- The hover lift is off-palette on
   purpose: --ivory is the pill's rest state, so lifting it toward white is the
   whole gesture. */
background: #fff;
```

The config owns the checks for missing reasons and obsolete suppressions.
Exceptions and their rationale stay beside the declaration they exempt.

The test for a legitimate disable: *would naming this as a token invite someone
to reuse it?* If yes, disable it instead. Shader- and canvas-adjacent CSS is the
usual case.

---

## 9. Load-bearing details

Things that look like ordinary CSS and are not. Every one of these has already
been broken once. Changing any of them requires a fresh visual baseline and a
look at the act in a browser — reading the diff is not enough.

### Act 2 — the chapter stacking sandwich

`act-2-welcome.module.css`, the `.chapters` block.

The foliage shadow multiplies onto the wall. A `mix-blend-mode: multiply` layer
needs a backdrop to darken, and **anything that creates a stacking context
between it and `.section` isolates the blend**, at which point it has no
backdrop and paints its own white. The act paints in this order:

```
1 + i   panel plates      (wall, ruled edge, photographs)
5       .goboWrap         (the leaf shadow, multiplied)
6 + i   panel type        (must stay crisp — the shadow stops short of it)
```

> **`.chapters` and `.chapter` must stay free of `z-index`, `transform`,
> `filter`, and `sticky`/`fixed` positioning.** Any one of them creates a
> stacking context and collapses the sandwich.

This is also why each panel is two overlaid sticky layers rather than one: a
single sticky panel would be one stacking context and would flatten both sides
of the shadow into the same layer. The cost is that a plate cannot occlude the
type of the panel it covers, which is why that type is clipped to the incoming
plate's top edge from JS instead.

`.chapter { display: contents }` is load-bearing for the same reason —
the sticky layers must take their containing block from `.chapters`, or each
panel unpins at the end of its own article instead of holding until the next
one has covered it. `.chapterMark { height: 0 }` is the measurement anchor every
ScrollTrigger in the act reads, because a sticky element's own rect reports
where it is stuck rather than where it belongs.

### Act 4 — the room cascade's coupled constants

`room-deck.tsx`, lines ~61–77.

```ts
const HALF   = 6;     // rooms in a half
const POOL   = 12;    // card nodes in a half
const SPAN   = 6;     // depth, in steps, from spawn to fully off-frame
const GROWTH = 1.33;  // size growth per step of depth
const FAN    = 0.05;  // offset per step of depth, in card widths, normal to the ray
```

A card's offset from the vanishing point and its size share one factor,
`r = GROWTH^(depth - SPAN)`. That single factor is what makes the stack read as
one perspective instead of a fan of separately scaled photographs, and it means
the numbers are not independent:

- **`GROWTH^SPAN` is the spawn-to-exit size ratio.** At `1.33^6` that is about
  5.5×. Change `GROWTH` and the far cards are either specks or already
  legible at spawn; change `SPAN` and the same thing happens from the other
  direction. Either edit requires re-solving the other against the frame
  geometry in `NIGHT_FRAME` — whose `ex`/`ey` must keep the exit-end card
  entirely off-frame, because that is what makes the recycle invisible.
- **Legibility is spacing over footprint, and neither number alone.** A step of
  depth moves a card `|d|·r·(1 - 1/GROWTH)` along the ray; its own shadow on
  that ray is about `1.2·ew·vw·r`. The `r` cancels, so overlap is identical at
  every depth and is set by `GROWTH` and `ew` jointly. At `1.24` with
  `ew = 0.8` it was two thirds — no card ever wholly visible, focus slot
  included. At `1.33` with `ew = 0.62` it is two fifths.
- **`POOL` must stay a multiple of `HALF`.** A node's slot is `ordinal mod POOL`
  and its room `ordinal mod HALF`; a multiple and a node keeps one room for the
  life of the page, so no `src` ever changes under a visible card. The six nodes
  past `SPAN` are parked at `opacity: 0` — the price of the guarantee, and worth
  paying.
- **Anything else offsetting a card must be a function of where it is, not of
  which node is drawing it.** `FAN` carries each card off the ray, one direction
  for every card, growing with `depth` and riding `r`: tight at the vanishing
  point, spread toward the front, and continuous through the recycle by
  construction. A three-lane weave keyed to `ordinal` did the same job for
  overlap but read as a zigzag rather than as one diagonal, and it bought that
  with a divisibility rule on `POOL` that this needs no part of.
- **The normal `FAN` rides has to be turned to a fixed sense, not just taken.**
  `mirrored()` reflects the frame, and `(-dy, dx)` — a quarter turn — is not
  preserved by a reflection: it comes back as the opposite normal. Untamed it
  carried day's cards below their ray and night's above theirs, putting the two
  halves at different heights, so neither read as the other one flipped. Turning
  it down-frame (`turn = dx < 0 ? -1 : 1`) makes the halves exact mirrors.

`FOCUS_D = 3` is solved, not chosen: the deepest slot whose card is still whole
in frame, since `vpx + (ex - vpx)·r` plus half a card width must clear the edge
the cascade recedes toward. At the old `FOCUS_D = 5` the hero hung half off the
screen.

`STEPS = 6.2` and `K0 = FOCUS_D` are solved against these in
`roomScrollTarget()`, which the island menu uses to aim at a room rather than at
the top of the act. Change the constants above and that solve is wrong too. It
reads the ticker's accumulated `driftK` rather than solving idle travel from a
start time, because the hover brake makes the rate vary — resting the pointer on
a card slows the deck to `HOVER_DRIFT` of idle, and a closed form would silently
go out of true.

### Act 4 — what makes the day/night wipe a crossing

The halves once differed only in which six photographs loaded — same grade, same
ground, a `clip-path` edge between two dark frames — so by the time you looked
they had swapped and you never saw it happen. Three invariants carry it now:

1. **Each half's light is a `filter` on `.card img` plus a wash on
   `.cascade::before`.** The wash belongs inside the cascade so the wipe's clip
   carries it with no second animation, and it is the layer that most tests the
   transparency rule below — it paints over the open door and may only tint it.
   Keep its deepening off the half's *vanishing* corner: there it lands on cards
   that are already small, fading in and graded down, and buries them.
2. **Nothing is drawn on the edge.** A soft band travelling with it was tried
   and read as a blurred vertical smear across the frame. Once the two halves
   carry their own light the hard clip boundary is legible by itself, and the
   cut is what the movement wants — sharp, not feathered.
3. **The registers are siblings of both cascades, above both.** Inside its own
   half a list is clipped by the wipe — an edge through a column of type holds
   sliced glyphs for the whole sweep — *and* sits under the other half's entire
   subtree, so day's names went dark under night's cards long before night's
   arrived. The ticker fades them instead, timed to the edge reaching each
   column, and moves `aria-hidden` between them as it passes half.

### Act 4 — hovering a card

- **Every card sits under a scrim and the hovered one loses it** — `--dim`,
  written by the ticker only when it moves. A scrim, not an animated `filter`: a
  filter on a transformed element re-rasterises its layer on every frame the
  scale changes, and the scale changes every frame here.
- **The hovered card slides `PULL` card widths sideways, and nothing else
  changes about where it stands in the deck.** Sideways, not along the ray's
  normal: the ray falls ~60° below horizontal, so a normal pull is mostly
  downward, and the focus slot has under half a card height of frame beneath
  it. It sent the card off the bottom of the screen. Held to the horizontal the
  card keeps its height, and a near card cropped by the frame edge is pulled
  back into it.
- **Depth alone owns `z-index`, hover included.** The normal pull left the card
  clipped by the neighbour one step nearer — `GROWTH`× wider, overlapping by
  more than that travel undid — so the hovered card was lifted above its whole
  half to compensate. The sideways pull clears that neighbour outright, and the
  lift then only did damage: it stood a far, small card in front of the near,
  large ones, and the perspective the cascade is built on came apart under the
  pointer. A card part-way out is still part-way covered, which is what coming
  out from under something looks like.
- **The hit test uses the card's resting box, not the pulled one.** A hover that
  displaces its own target oscillates: the card slides out from under the
  cursor, the hover drops, the card returns, and it cycles — visibly, because
  the register, the scrim and the idle brake all ride on that flag. The pulled
  box counts too, but only for the card already held, so following it with the
  cursor keeps it instead of dropping it at the edge of the rest box.
- **The register clears while a card is out.** Its opacity is the wipe's fade
  times the pointer's, because a card pulls back against the way its half
  recedes — straight into the column that half's names stand in. `LIST_TAU` is
  shorter than `PULL_TAU` so the ground is free by the time the picture arrives
  on it.
- **The caption is a stage-level element parked under the card**, never inside
  it: card copy is scaled by depth and legible only at the front, which is what
  puts the names off to one side. It flips above the card when below will not
  fit and clamps on x, or a card at an edge hangs it off the screen.

### Act 4 — pins that outlive their own sections

Both the threshold stage and the rooms stage pin to `[data-act="5"]`'s top, not
to their own bottoms. The open door is the ground movement III plays on, so
every layer of the rooms movement must stay transparent — an opaque background
on `.rooms` or `.roomsStage` paints straight over the footage, because that
section sits after the threshold in the DOM.

Both pinned stages also carry an explicit `z-index` (1 and 2). Pinning makes an
element `fixed` with no stacking order of its own, and act 5 is a positioned
section later in the document; without those two numbers it climbs over the door
and the deck as it rises.

### Act 1 — the stage's `z-index: 0`

The layers inside act 1's stage climb to 1500. Without a stacking context of
their own they climb in the root, over a concierge bar that sits at 100. The
scrubbed path is saved from this by accident, because pinning wraps the stage in
a transformed spacer; **the reduced-motion path is not pinned and loses the
whole nav behind the sheet.** `z-index: 0` on `.stage` is what holds it.

### Act 5 — sticky, not pinned

The invitation stage uses CSS `position: sticky` rather than a ScrollTrigger
pin. A pin with `pinSpacing: false` releases the moment the footer's top edge
arrives and the stage snaps out of the viewport in one frame; sticky lets the
same screen ride up under the footer with nothing to hide.

Its reveal lines are set to `yPercent: 115` **from JS on mount**, not from CSS.
A CSS `translateY(115%)` is parsed into a pixel `y` that GSAP's `yPercent: 0`
cannot undo, and the address would never arrive.

### Act 5 — the pill's glow is two boxes, not one

`border-glow-pill.tsx` writes two custom properties on pointer move — how far
the cursor lies from the pill's centre, and in which direction — and the
stylesheet draws everything from them: a resting amber bloom on the whole rim,
and a brighter arc the pointer drags around it. Three things are load-bearing:

- **The mask and the bloom cannot be the same box.** A `conic-gradient()` mask is
  sized to the element it is set on, so a mask on the pill tiles across the
  shadow that spills past it and lights the wrong side. The masked element is
  therefore inset *negatively* by the glow's reach, and its `::before` is inset
  back to the pill exactly — the mask covers the whole bloom, and the box casting
  the bloom is still pill-shaped. Widening the shadows without widening
  `--glow-reach` cuts the bloom off at a line.
- **The direction is measured in half-extents, not pixels.** On a pill five times
  wider than it is tall, a raw `atan2` aims the arc at the far cap while the
  pointer sits two pixels under the top edge.
- **The arc has an opacity floor.** Proximity alone reaches 0 at the pill's
  centre, which is where a cursor reading the label actually is; a control that
  goes dark under the pointer reads as broken, so hover starts at 0.6 and
  proximity carries the remaining 0.4. Keyboard focus lands on the floor.

Under reduced motion the arc is removed outright and the pill rests on its
bloom — there is no pointer to chase, and the global kill-switch would otherwise
snap the arc on and off in `0.01ms`.

### Act 6 — the reveal band is a window

`.reveal` uses `clip-path: inset(0)` around a `position: fixed` child.
`clip-path` clips its subtree but is **not** a containing block for it, so the
layer inside stays fixed to the viewport while the window grows over it. The
frame never moves; the page just stops covering it. Replacing the clip with
`overflow: hidden` breaks this — `overflow` would scroll the layer with the
band.

### The nav's tint has no bottom edge

`.bar::before` carries the scrolled nav's tint and blur. It overhangs the bar by
`--scrim-feather` and is masked away across the overhang, because ending square
drew one hard line the full width of the viewport — a rectangle laid over the
footage rather than light falling on it, worst over Act 4, where the ground
behind it moves. The mask fades the `backdrop-filter` along with the colour, so
the blur cannot outlive the tint; the bar's own height is left fully opaque in
the mask, so the links lose no contrast. The feather stays on in the island
phase because that tint is matched to `.panel` exactly — it fades into an
identical colour and there is nothing to see.

### The reduced-motion paths are not decoration

Every act branches on `prefers-reduced-motion`, and the static branch is a
composition in its own right, not a frozen frame of the animated one. Act 4's
three movements become captioned grids and a poster; act 2's panels stop
stacking; act 5 collapses from `300vh` to one screen.

Two rules learned the hard way:

- **Nothing may advance on time alone.** Act 4's cascade drifts at
  `DRIFT = 0.11` steps per second on a shared ticker, which no amount of holding
  still stops. `act-4-stay.tsx` therefore *watches* the media query rather than
  reading it once, so turning the preference on mid-page swaps the static grid
  in.
- **Copy settles, it does not disappear.** Act 1's scroll cue is faded out by
  the scrubbed timeline a hundredth of the way into the push, because by then
  the reader has plainly done what it asked. Reduced motion has no such moment,
  so the cue is rendered and left legible. Hiding an element is not a
  reduced-motion state.

---

## 10. Enforcement

The executable quality gates live in the root
[`package.json`](../../package.json), the web
[`package.json`](../../apps/web/package.json),
[`lefthook.yml`](../../lefthook.yml) and the
[CI workflow](../../.github/workflows/ci.yml). Stylelint is installed and
invoked by the root lint path; its
[configuration](../../apps/web/stylelint.config.mjs) owns the colour and easing
rules described above.

### Visual baselines

Baseline fixtures live under
[`apps/web/tests/visual-baseline/`](../../apps/web/tests/visual-baseline/).
[`capture-visual-baseline.mjs`](../../apps/web/scripts/capture-visual-baseline.mjs)
owns how they are produced, and
[`compare-visual-baseline.mjs`](../../apps/web/scripts/compare-visual-baseline.mjs)
owns comparison behavior and thresholds.

Two things to know before you trust a result:

1. **The baselines are machine-specific in practice.** They were recorded on the
   machine that recorded them; a different font rasteriser or video decoder
   moves most frames. Comparing a fresh capture of your branch against a fresh
   capture of its merge base, on the same machine, is the comparison that means
   something.
2. **The WebGL acts are not fully deterministic even then.** Act 1's monogram
   lens and act 2's foliage gobo mount on real-time media decode, so how far
   their shaders have advanced when the shutter fires varies between runs on the
   same tree. Layout and type are stable; shader phase is not. Check what
   actually changed in the image before treating a diff as a regression.

For a token-level change — swapping a literal for the `var()` that holds the
same value — comparing computed styles in a browser is a stronger check than a
pixel diff, and it is not subject to either problem above.

### Adding to the standard

The order is: change this document, then change the code. A token that appears
in `packages/tokens/tokens.css` without an agreed role in the palette is a token
nobody agreed to.
