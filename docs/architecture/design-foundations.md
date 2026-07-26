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
| Colour and easing enforcement | Review. See §10 — the stylelint config exists but is not wired |
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
| `--ivory-warm` | `#eee7de` | The wall. Acts 2 and 3 settle onto it so they read as one surface | 4 |
| `--sand` | `#cfc0ab` | Secondary type on dark grounds — captions, kickers, footer links | 10 |
| `--stone` | `#8a7b6e` | Quietest type. Rail labels, column titles, placeholders, small print | 6 |
| `--stone-deep` | `#645c51` | Body copy on light grounds; the corridor's lit tone panel | 4 |
| `--umber` | `#3a332b` | Photographic ground — what a panel or card shows before its image decodes | 3 |
| `--ink` | `#1c1915` | Primary type on light grounds; the corridor and threshold grounds | 8 |
| `--dusk-amber` | `#b48b60` | The single accent. Two list titles, and the light behind act 5's pill | 3 |
| `--ocean` | `#7fa2b7` | **Defined, never consumed.** See below | 0 |
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

**`--ocean` is reserved, not dead.** It is the only cool token in the family and
the arrival never found a job for it — act 1's sea is sampled film stock, not
this. Do not delete it and do not scatter it around to justify it. If the
booking funnel needs a second signal colour (an informational state, a
selected date), `--ocean` is the one already agreed on.

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
  `--dwell: 45vh` is not a spacing decision, it is how long a panel holds.
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

**Calm, CSS-only, and the same curve.** A booking screen gets:

- `transition` on `opacity`, `transform`, `color`, `border-color`,
  `background-color`;
- `0.4s`–`0.5s`;
- `var(--ease-ui)`;
- nothing else.

No scroll-driven anything. No pinning. No canvas. A funnel that animates like
the arrival is a funnel that gets in the way of booking a room.

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

**The login plates are the funnel's first images, and they are not in the
manifest.** They live under `public/images/auth/` and are referenced by hand,
because `scripts/prepare-arrival-images.mjs` curates the *arrival's* library and
writes the *arrival's* manifest — sweeping a booking image into it would put a
`features/arrival/` import in the funnel's path, which §5's budget forbids. So
their `alt` is written inline, and the rule that decides it is the one above:
they are atmosphere a sign-in form does not depend on, inside `aria-hidden`
asides, so both are `alt=""`.

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
- Don't add a provider to the root layout.
- Don't put a decorative image in the accessibility tree, and don't hide a
  content image from it.
- Don't add exclamation marks, urgency, or scarcity to any copy.

The first two are the rules this document leans on hardest, and they are the two
nothing currently checks: the stylelint config that would is written but not
wired (§10). Until it is, they are enforced in review — writing one costs a
reviewer's attention rather than a red build.

### The disable convention

A one-off is allowed. It has to say why:

```css
/* stylelint-disable-next-line color-no-hex -- The hover lift is off-palette on
   purpose: --ivory is the pill's rest state, so lifting it toward white is the
   whole gesture. */
background: #fff;
```

The config sets `reportDescriptionlessDisables`, so a disable without a `--`
reason is itself an error, and `reportNeedlessDisables`, so one that has stopped
suppressing anything is an error too. There are exactly three disables on the
page today, and each names a category the palette should not absorb:

1. **Act 1's `--sea-standin`** — five colours read off the backdrop encode.
   Their job is to match footage, so they change when the footage is re-cut and
   never for a palette reason.
2. **Act 5's CTA hover** — `#fff` as a lift away from `--ivory`.
3. **Act 6's emboss faces** — four stone values plus black, read as a set
   against each other and retuned as one whenever the panel's ground moves.

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
const HALF       = 6;     // rooms in a half
const POOL       = 12;    // card nodes in a half
const SPAN       = 6;     // depth, in steps, from spawn to fully off-frame
const GROWTH     = 1.33;  // size growth per step of depth
const LANES      = 3;     // lanes the cascade weaves between
const LANE_SHIFT = 0.22;  // lane offset, in card widths, normal to the ray
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
- **`POOL` must stay a multiple of both `HALF` and `LANES`.** A node's slot is
  `ordinal mod POOL`, its room `ordinal mod HALF`, its lane `ordinal mod LANES`;
  a multiple of both and a node keeps one room *and* one lane for the life of
  the page — no `src` changes under a visible card, nothing slides sideways at
  the recycle. `HALF` is a multiple of `LANES` too, which keeps a room always in
  one lane. The six nodes past `SPAN` are parked at `opacity: 0` — the price of
  the guarantee, and worth paying.

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
2. **The registers belong to neither half.** Siblings of both cascades, above
   both. Inside its own half a list is clipped by the wipe — an edge through a
   column of type holds sliced glyphs for the whole sweep — *and* sits under the
   other half's entire subtree. The ticker fades them instead, timed to the edge
   reaching each column, not to the wipe's endpoints.
3. **The seam is the thing you watch cross**, so it is held at full opacity
   across the sweep and folded away only at the ends. A bell curve leaves it
   faint for the entire crossing, which is the failure being fixed.

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

| Gate | Command | Catches |
|---|---|---|
| Biome | `pnpm lint` | Correctness, React hooks, accessibility (as warnings) |
| Biome | commit hook | Formatting — applied to staged files, not reported |
| TypeScript | commit hook, and `pnpm build` (Next runs it) | — |
| Visual regression | `apps/web/scripts/compare-visual-baseline.mjs` | Everything above the pixel tolerance |

`apps/web/stylelint.config.mjs` is **not** one of these yet. It is written and
it is the only thing that can enforce the two rules this document leans on
hardest — no raw hex, no hand-written easing curve — because Biome's CSS linter
cannot express either. But its dependency is not installed and no script calls
it, so today those two rules are enforced by review alone. Installing it or
deleting it is an open decision, not a documented state.

### Visual baselines

`apps/web/tests/visual-baseline/` holds 66 committed frames — six acts × five
scroll fractions × two viewports, plus three nav states.
`capture-visual-baseline.mjs` records them against a **production** server with
a virtual clock, video parked at a fixed frame, and CSS animations paused at a
fixed offset. `compare-visual-baseline.mjs` diffs two capture directories with a
per-channel tolerance and a per-frame pixel budget.

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
in `packages/tokens/tokens.css` without a row in §2 is a token nobody agreed to.
