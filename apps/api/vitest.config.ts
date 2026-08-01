// Vitest for the API.
//
// The one non-obvious line is the SWC plugin. Vitest transpiles with esbuild,
// and esbuild does not implement `emitDecoratorMetadata` — the metadata Nest's
// DI reads constructor parameter types out of. Without it every injection in a
// test resolves to `undefined` and the failure looks like a broken provider
// rather than a broken transform. SWC emits it, so the tests see the same
// classes `tsc` produces.

import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// The suite talks to a real Postgres and truncates every table it finds, so
// which database it opens is a safety property, not a convenience. `.env.test`
// is the only thing that decides — never `.env`, which points at the database
// somebody is developing against.
//
// Missing, this stops here rather than falling back. A fallback is how a test
// run empties a development database, and the message below is cheaper than
// the afternoon that would cost.
try {
  process.loadEnvFile(".env.test");
} catch {
  throw new Error(
    "apps/api/.env.test is missing. Copy .env.example to .env.test and point " +
      "DATABASE_URL at a database you are willing to lose — the suite truncates it.",
  );
}

export default defineConfig({
  plugins: [swc.vite({ module: { type: "es6" } })],

  // Vitest 4 transforms with Oxc, and `unplugin-swc` only knows how to switch
  // off the esbuild that used to do it. Left on, Oxc wins and the decorator
  // metadata goes missing again — the symptom being every injected dependency
  // arriving as `undefined`.
  oxc: false,

  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.spec.ts", "test/**/*.e2e-spec.ts"],

    // Argon2 is deliberately slow and the e2e suite signs in several times.
    testTimeout: 30_000,
    hookTimeout: 60_000,

    // One database, one schema, one set of rows. Files running in parallel
    // would truncate each other's fixtures mid-assertion — the isolation a
    // single shared Postgres cannot provide is bought here instead.
    fileParallelism: false,
  },
});
