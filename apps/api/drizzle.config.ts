import { defineConfig } from "drizzle-kit";

// drizzle-kit compiles this file itself, outside the app's tsconfig and outside
// Nest, so it reads the environment directly rather than importing the zod
// schema — one bundler-resolution edge case is not worth sharing four lines.
try {
  process.loadEnvFile();
} catch {
  // No .env file; the connection string comes from the shell.
}

const url = process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    "DATABASE_URL is required. Copy apps/api/.env.example to apps/api/.env, or export it.",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/database/schema/index.ts",

  // Migrations live inside src/ rather than a top-level drizzle/ folder because
  // docs/architecture/repository-structure.md puts the constraints that carry
  // the correctness invariants next to the schema that declares them.
  out: "./src/database/migrations",
  dbCredentials: { url },

  // Prompts before running anything destructive. The generated SQL is
  // hand-edited here — `EXCLUDE USING gist` has no Drizzle expression — so a
  // silent drop would take a constraint with it.
  strict: true,
  verbose: true,
});
