// Tailwind 4 is a PostCSS plugin and nothing else — no config file, no content
// globs. The theme lives in `app/globals.css` under `@theme`, which is the whole
// reason `tech-stack.md` picked v4 for this app: `@theme` reads CSS custom
// properties, so the console's palette can *reference* @mariva/tokens instead of
// restating it in JavaScript the way a v3 `tailwind.config.ts` would have had to.

/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
