# Auth screen — prototype B: "The Pass"

Second, deliberately different direction. Prototype A
([research-260726-1757](research-260726-1757-auth-screen-references.md)) stays
on the table untouched — this does not replace it.

Brief carried over: interactive, 3D optional, colour irrelevant. Dropped this
round: the hotel-category constraint, and anything older than ~12 months.

References below were probed live on 2026-07-26. Evidence is the runtime read,
not a write-up.

---

## Why A needed a counter-proposal

A's weak point was not its styling — it was its **premise**. A assumed email +
password with a login/signup toggle, and then spent its craft budget animating
that. In 2026 that premise is the dated part:

- ~5 billion passkeys in active use ([FIDO Alliance, State of Passkeys 2026](https://www.authgear.com/post/login-signup-ux-guide/)).
- Current guidance is passkeys primary, magic link or OTP as fallback, social as
  an accelerator ([passwordless practitioner guide, 2026](https://guptadeepak.com/ciam-compass/guides/passwordless-authentication/)).
- Conditional UI (WebAuthn autofill) means the passkey should surface *inside
  the normal email field*, not behind a separate button.

If passkeys land in the email field and there is no password, then **the
login/signup toggle has nothing left to toggle** — and A's showpiece
interaction (the Flip morph between two panes) is animating a control that
should not exist. B starts from the auth model instead of the layout.

---

## The reference set — current, world-class, verified

### 1. Lacoste — Polo Atelier ⭐ the proof

<https://members-play.lacoste.com/polo-factory-experience> · Merci Michel ·
Awwwards SOTD

**Probed:** ground `rgb(247,236,232)` · custom *Lacoste* typeface · WebGL
`<canvas>` + branded `LOADING…` · then a **complete** registration form —
first/last name, email, phone, birthdate, civility, country, two consent
checkboxes.

**Why it is the single most useful reference here.** It settles the argument
this project will otherwise have: *can a real, long, GDPR-complete signup form
live inside an immersive experience without either half ruining the other?*
Merci Michel shipped it, on a light near-ivory ground, and won with it. The form
is not hidden behind the experience — the experience is the room the form is in.
Note also the framing: *Atelier*, gated on a `members-play.` subdomain, entry as
ceremony rather than access control.

### 2. Spotify Wrapped Party ⭐ the mechanic

<https://wrapped-party.activetheory.dev> · Active Theory · Awwwards SOTD

**Probed:** ground `rgb(239,239,234)` · WebGL2 via Active Theory's own **Hydra**
engine · GSAP + SplitText · **Klang** audio engine (`klang.umd.js`) with an
explicit *Toggle Audio* control · one text input (`party-name`) · on desktop it
says: *"To start your party, visit … on your mobile device or scan the QR code
below."*

**Two takes.** First, the **cross-device handoff as the entry mechanic** — the
desktop screen's job is to hand you to your phone, and the QR *is* the
interaction. (Caveat: here it hands off an experience, not a credential — for
literal QR *auth* the reference is Discord, which pairs QR scan with passkeys on
its login page, per the [2026 login UX survey](https://www.authgear.com/post/login-signup-ux-guide/).)
Second, **audio as a designed layer** behind one honest toggle — rare, and very
cheap to do badly.

### 3. Partizan — the media-dense ground

<https://partizan.com> · Beaucoup. · SOTD 26 Jul 2026, 7.18

**Probed:** *GT America Standard* · **36 `<video>` elements** · 1 canvas ·
`lenis` and essentially nothing else · a director roster as a rigorous index.

**Take.** The ground is a wall of moving image; the type layer over it is a
plain grotesque doing nothing clever. Richness in the media, discipline in the
type. That inversion is the whole lesson, and it is one Lenis away from
buildable — no WebGL required.

### 4. Dragonfly Redux — the anti-decorative register

<https://dragonfly.xyz> · Studio Freight

**Probed:** black · body face **Times New Roman** · 2 canvases · numbered
sections (`01 ABOUT`) · one bundled script, no motion library on `window`.

**Take.** From the studio that wrote Lenis, and it uses a *system serif* as the
body face over live WebGL. Permission to stop decorating. If the ground is
doing work, the type can be almost aggressively plain and read as more
expensive, not less.

### 5. Dash Creative — the physics vocabulary

<https://dashcreative.co> · [Codrops, 21 Jul 2026](https://tympanus.net/codrops/2026/07/21/magnetic-commerce-building-the-dash-creative-website/)

**Probed:** GSAP with **`InertiaPlugin`, `Draggable`, `Observer`**,
ScrollSmoother, CustomEase, SplitText, Lenis · *Messina Sans Light* · black · 8
videos.

**Take.** `Draggable` + `InertiaPlugin` is a different motion vocabulary from
A's entire toolkit: throw, momentum, magnetic snap, recoil. This is what makes
B's code-entry feel like a physical latch rather than a CSS transition. Both
plugins are now free in GSAP 3.13+.

### 6. Cerebrium — component-level interaction naming

<https://cerebrium.ai> · [Codrops, 23 Jul 2026](https://tympanus.net/codrops/2026/07/23/building-cerebrium-making-serverless-infrastructure-tangible/)

**Probed:** Astro · *Suisse Int'l* · islands named `BackgroundCanvas`,
`InteractiveDots`, `SplitTitle`, `Rail`, `AnimatedChart`.

**Take.** Structural, not visual. Every interaction is an addressable named
component rather than a page-level script — which is how this repo's
`features/arrival/components/act-*/` is already organised, and how B's scenes
should be.

---

### One pattern worth flagging

Three independent world-class winners — Lacoste `#f7ece8`, Wrapped Party
`#efefea`, and prototype A's Son Daven `rgb(168,148,116)` — all ground on warm
off-white, not dark. Against that, every stock SaaS auth screen probed in round
one was near-black. This project's `--ivory` `#f4efe6` is already in the
award-winning band. **Ivory is the confident choice here, not the safe one.**

---

## Prototype B — "The Pass"

**One line:** you are not filling in a form, you are being handed a pass — and
the pass is handed to your phone.

### Scene 1 — one field, no toggle

A single email field. No password. No login/signup switch anywhere on the
screen; the system resolves known vs. new from the address and only the copy
changes. WebAuthn **conditional UI** (`mediation: "conditional"`) is attached to
that same field, so a returning guest with a passkey gets a biometric prompt as
if it were autofill and is through before reading anything.

*This is the load-bearing difference from A.* Everything below only follows if
this is accepted.

### Scene 2 — the handoff

No passkey, or a new guest → the credential moment, which is **device-aware**:

- **Desktop** — a QR code. Scan with the phone, approve there, the desktop pane
  releases on its own. The desktop's job is to hand you off (Wrapped Party,
  and literally auth on Discord).
- **Mobile** — a 6-digit code inline; no QR, no handoff, no wasted step.

### Scene 3 — the code as the ceremony

Where A put its craft in a *sequence of questions*, B puts all of it in **one
moment**: six discrete cells.

- Paste or type → digits **land** in sequence at `STAGGER_CASCADE`.
- Wrong code → the row **recoils** on `InertiaPlugin`, physical, not a shake
  keyframe.
- Correct → the six cells **converge into the monogram**, and the ground opens.

One moment, heavily crafted, is cheaper to build and harder to get wrong than
six screens each lightly crafted.

### Scene 4 — the ground

A **media-dense** wall (Partizan) on `--ivory`, not a single held plate and not
a generative canvas. Plain grotesque type over it, doing nothing clever
(Dragonfly). Optionally one soft latch cue on success behind an honest toggle
(Wrapped Party) — cut this first if the budget tightens.

Built as named scene components per Cerebrium / the existing `act-*` layout.

### How B differs from A

| | A — "Sequence & restraint" | B — "The Pass" |
|---|---|---|
| Auth model | email + password | passwordless: passkey → QR/OTP |
| Login vs. signup | Flip morph between panes | no toggle; one field resolves |
| Focal moment | the run of questions | the credential handoff |
| Devices | one screen | desktop ↔ phone |
| Ground | one held arrival plate | media-dense wall |
| Motion | GSAP `Flip` | GSAP `Draggable` + `InertiaPlugin` |
| Sound | none | one latch cue, toggleable |
| Screens to build | ~6 | 2 |

Shared with A, and worth keeping either way: `--ivory` ground, existing
`EASE_SCENE` / `EASE_UI` / `DUR_*` tokens, no white flash at the boundary.

### Cost and risk

- **Cheaper than A to build** — 2 screens, not 6 — but **more backend**:
  WebAuthn registration + assertion, a QR channel needing short-lived tokens and
  a poll or SSE release, OTP issue/verify with rate limiting. A is nearly all
  frontend; B is not. This is the real trade.
- Passkey **enrolment is the known weak point** of every passwordless rollout —
  needs a clear recovery path, and must never be forced at signup.
- QR desktop→mobile handoff must degrade to "email me a code instead" — some
  guests have no camera to hand, and some are on one device.
- The 6-cell input has to survive SMS autofill, paste of the whole code, and
  screen readers. Treat it as one labelled field presented as six, never six
  independent inputs.

---

## Recommendation

Take **B's premise and A's patience.** The passwordless model is not a style
choice — it is where auth actually is in 2026, and it deletes A's centrepiece
interaction rather than decorating it. But A was right that this house does not
rush people, and B's two-scene shape gives that fewer places to land.

Best-of-the-best, if only three references survive: **Lacoste** (a real form can
live inside a real experience), **Partizan** (rich ground, plain type),
**Wrapped Party** (the handoff is the interaction).

---

## Open questions

1. Passwordless is a **backend commitment**, not a screen. `apps/api` is a fresh
   NestJS scaffold — is WebAuthn + a QR channel in scope now, or does auth ship
   on email/password with B retrofitted later? This decides A vs. B more than
   any visual judgement.
2. Do guests need an account at all before booking, or is this checkout-time
   account creation? B's cross-device handoff is good for the first and actively
   hostile mid-checkout.
3. Is booking allowed to depend on the guest holding a phone? If yes, QR leads;
   if no, OTP leads and QR is the accelerator.
4. Audio anywhere in this product? Nothing in `features/arrival/` carries sound
   today — scene 4's cue would be the first, and that is a product decision, not
   a detail.
