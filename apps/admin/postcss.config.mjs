// Tailwind 4 is a PostCSS plugin and nothing else — no config file, no content
// globs. The theme lives in `app/globals.css` under `@theme`, which is the whole
// reason `tech-stack.md` picked v4 for this app: `@theme` reads CSS custom
// properties, so the admin-only console palette stays in CSS rather than a
// JavaScript `tailwind.config.ts`.

/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
