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
    // `test/**/*.spec.ts` alongside the e2e pattern, for the checks that belong
    // beside the suite but talk to no database — a structural assertion over
    // the source tree is one. Without it such a file sits in `test/` and is
    // never collected, which is the failure mode a structural guard can least
    // afford: it looks installed and runs nowhere.
    include: ["src/**/*.spec.ts", "test/**/*.spec.ts", "test/**/*.e2e-spec.ts"],

    // Argon2 is deliberately slow and the e2e suite signs in several times.
    testTimeout: 30_000,
    hookTimeout: 60_000,

    // One database, one schema, one set of rows. Files running in parallel
    // would truncate each other's fixtures mid-assertion — the isolation a
    // single shared Postgres cannot provide is bought here instead.
    fileParallelism: false,

    // The same isolation, against the runs this process cannot see. The line
    // above orders the files inside one `vitest run`; a second `vitest run`
    // started while this one is going shares the database with it and neither
    // knows. `global-setup.ts` makes the second wait, and says why it does.
    globalSetup: ["./test/global-setup.ts"],

    // `NFR-10`: ≥85% on the modules that move money. UI coverage is
    // deliberately untargeted, and so is everything else here — a number over
    // the whole tree would be met by testing the easy half of it.
    //
    // On by default rather than behind its own script, because a threshold
    // only holds a branch if the run that gates the branch measures it. The
    // cost is a few seconds of instrumentation on a suite that already waits
    // on Postgres.
    coverage: {
      // On for a plain `vitest run`, not only for `--coverage`. A threshold
      // measured by a command CI does not run is a threshold nothing holds.
      enabled: true,
      provider: "v8",
      reporter: ["text-summary", "json-summary"],

      // Named rather than inferred from what the tests happened to load. A
      // file nothing imports is 0% covered, and leaving it out of the
      // denominator would let an untested service raise the average by being
      // invisible.
      include: [
        "src/modules/booking/**/*.ts",
        "src/modules/guest/**/*.ts",
        "src/modules/housekeeping/**/*.ts",
        "src/jobs/**/*.ts",
        "src/modules/inventory/**/*.ts",
        "src/modules/pricing/**/*.ts",
        "src/modules/folio/**/*.ts",
        "src/modules/payment/**/*.ts",
        "src/modules/operations/**/*.ts",
        "src/database/schema/inventory.ts",
        "src/database/schema/pricing.ts",
      ],

      // Per directory rather than one number across all four globs. The point
      // of `NFR-10` is that each of these holds its own line — a pooled figure
      // lets a well-tested inventory module carry an untested pricing one.
      //
      // `folio` was held out of this list until it held code, on the grounds
      // that a threshold over an empty directory passes vacuously while looking
      // like a guarantee. It holds the ledger now — the posting service, the
      // decomposition and the sweep that charges a night — so it joins, and
      // `NFR-10` names it directly.
      //
      // `payment` joins beside it. `NFR-10` does not name it, for the same
      // reason it does not name `guest`: the requirement lists where the money
      // *sits*, and this is where it arrives. The argument for the floor is the
      // one `schema/payment.ts` makes about its own index — the failure this
      // code exists to prevent is taking a guest's money twice, and that defect
      // is silent. A second charge looks exactly like a first one to everything
      // except the guest reading a statement.
      thresholds: {
        "src/modules/booking/**": {
          lines: 85,
          functions: 85,
          branches: 85,
          statements: 85,
        },
        // `guest` and `housekeeping` join the gate at the same floor. Neither
        // moves money, so neither is named by `NFR-10` — they are here because
        // the CCCD read path and the `OUT_OF_ORDER` rule are both places where a
        // defect is silent: a mask that stops masking still returns a string,
        // and a status change that reduced sellable inventory would surface as
        // a property that is quietly less bookable.
        "src/modules/guest/**": {
          lines: 85,
          functions: 85,
          branches: 85,
          statements: 85,
        },
        "src/modules/housekeeping/**": {
          lines: 85,
          functions: 85,
          branches: 85,
          statements: 85,
        },
        // The scheduler holds no domain rule, and is here for the one it does
        // hold: a sweep that is not idempotent must be refused rather than
        // discovered later in a counter that drifted. That check has no
        // second line of defence, so it is held to the same floor as the
        // modules whose invariants it protects.
        "src/jobs/**": {
          lines: 85,
          functions: 85,
          branches: 85,
          statements: 85,
        },
        "src/modules/inventory/**": {
          lines: 85,
          functions: 85,
          branches: 85,
          statements: 85,
        },
        "src/modules/pricing/**": {
          lines: 85,
          functions: 85,
          branches: 85,
          statements: 85,
        },
        "src/modules/folio/**": {
          lines: 85,
          functions: 85,
          branches: 85,
          statements: 85,
        },
        "src/modules/payment/**": {
          lines: 85,
          functions: 85,
          branches: 85,
          statements: 85,
        },
        // The service catalog joins on the argument the two above it make.
        // `NFR-10` does not name it and the module holds no money — what it
        // holds is the figure a folio line is computed from, and `FR-FOL-03`
        // gives it one branch that decides between the property's published
        // price and a number the desk typed. Getting that branch wrong is
        // silent in exactly the way this list exists for: a guest is charged an
        // amount that looks like a price and is not one.
        "src/modules/operations/**": {
          lines: 85,
          functions: 85,
          branches: 85,
          statements: 85,
        },
        // `schema/folio.ts` and `schema/payment.ts` are left out of `include`
        // entirely rather than included here without a floor, so they are
        // outside the measurement and not merely outside the gate. What fails
        // on them is the *function* count, and the functions a Drizzle schema
        // file declares are the lazy `() => other.column` reference thunks and
        // the `(table) => [...]` constraint callbacks — v8 records those as
        // covered when Drizzle happened to introspect the table, not when a
        // test proved the constraint holds. Both files are covered where it
        // counts, by `payment.spec.ts` and the folio storage suite, which
        // assert that the indexes and checks actually refuse what they are
        // there to refuse. A number over the thunks would move on whether an
        // unrelated query planner walked the relation.
        "src/database/schema/{inventory,pricing}.ts": {
          lines: 85,
          functions: 85,
          branches: 85,
          statements: 85,
        },
      },
    },
  },
});
