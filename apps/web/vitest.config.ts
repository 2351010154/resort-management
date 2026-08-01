import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// `packages/shared` needs no config at all — plain `vitest run` finds its specs and
// its imports are all relative. This app needs two things Vitest cannot infer:
// the `@/` alias that `tsconfig.json` declares for Next, and the fact that
// `@mariva/shared` is consumed as TypeScript source rather than a built `dist`
// (which is also why `next.config.mjs` lists it under `transpilePackages`).
//
// Only the funnel's pure logic is tested here — pricing, availability rules, the
// URL codec. The components are verified in a real browser instead, because what
// matters about a calendar cell is its computed style and its accessible name, and
// jsdom is not evidence about either.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    include: ["features/**/*.spec.ts"],
  },
});
