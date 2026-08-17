import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The console's pure logic, and only that.
//
// Same line `apps/web` draws and for the same reason: what matters about a
// focus trap is where focus actually lands, and jsdom is not evidence about
// that — it has no layout, so `offsetParent` is null for every element in it,
// and the visibility checks the trap and the roving group are built on would be
// asserted against a model rather than a browser. `FocusTrap`, `RovingFocusGroup`
// and `useHotkeys` are verified end to end instead, by the keyboard-only
// check-in Playwright run `NFR-11` requires.
//
// What is covered here is everything underneath them that a browser adds
// nothing to: chord normalization, the registry's stacking and gates, and the
// date parser. The registry is exercised through `dispatchHotkey` rather than a
// real key press, which is why these run with no environment at all.
//
// The `@/` alias matches the one `tsconfig.json` declares for Next, so a spec
// imports a module the same way the app does.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    // Every directory, not just `lib/`. A spec written under `features/` by a
    // screen author would otherwise sit there passing silently by never being
    // run at all, which is worse than having no spec.
    include: ["**/*.spec.ts"],
    // `e2e/` is the Playwright run named above. Its specs are `*.spec.ts` too —
    // they are the console's tests and are named like them — but they import
    // `@playwright/test`, which throws when it is not the runner. `pnpm test:e2e`
    // is what executes them.
    exclude: ["node_modules/**", ".next/**", "e2e/**"],
  },
});
