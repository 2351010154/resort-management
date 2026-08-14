// Stylelint for the arrival's CSS Modules.
//
// Deliberately not extending stylelint-config-standard. That config is mostly
// formatting opinions, and the stylesheets here are hand-set compositions whose
// shape carries meaning — reflowing them to satisfy a shorthand rule would cost
// the comments their alignment with the code they explain. What is enforced is
// the part of the design standard a reviewer cannot reliably eyeball: that
// colour and easing come from tokens rather than from literals.
//
// See docs/architecture/design-foundations.md for the standard these encode.

const config = {
  // globals.css defines the tokens themselves, so the palette literals there
  // are the one place raw hex is the correct answer rather than an escape.
  //
  // The rest are generated: `.next/**` is the build, `coverage/**` is vitest's
  // HTML report, and both contain vendored stylesheets nobody in this repo
  // wrote or can fix. Linting them turns `pnpm lint` into dozens of failures in
  // files that reappear the next time anything is built or measured, which is
  // how a lint gate stops being read.
  ignoreFiles: [
    "app/globals.css",
    ".next/**",
    "coverage/**",
    "node_modules/**",
  ],

  rules: {
    // The palette is eight named tokens plus --night. A hex in a module is
    // either one of those spelled out — which will drift the day the token
    // moves — or a ninth colour nobody agreed to.
    "color-no-hex": true,

    // Same argument, other spelling: `white` is not `var(--ivory)`.
    "color-named": "never",

    // Easing has exactly one hand-maintained definition site
    // (lib/motion-tokens.ts, emitted into :root by the root layout). A literal
    // curve in a stylesheet is a second one, and the pair drift silently —
    // nothing about a CSS transition and a GSAP tween disagreeing shows up as
    // an error, only as a scene that no longer feels like the rest of the ride.
    "declaration-property-value-disallowed-list": {
      "/^(transition|animation)/": [
        "/cubic-bezier\\(/",
        "/\\bease-in\\b/",
        "/\\bease-out\\b/",
        "/\\bease-in-out\\b/",
        "/\\bsteps\\(/",
      ],
    },
  },

  // The disable convention: every `stylelint-disable` carries `-- <reason>`,
  // and one that has stopped suppressing anything is an error rather than
  // harmless clutter. A one-off is allowed here — sampled film stock, a bespoke
  // emboss, a hover lift — but it has to say on its face why it is not a token,
  // so the next reader can tell an exception from an oversight.
  reportDescriptionlessDisables: true,
  reportNeedlessDisables: true,
  reportInvalidScopeDisables: true,
};

export default config;
