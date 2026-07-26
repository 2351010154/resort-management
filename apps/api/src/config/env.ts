import { z } from "zod";

// Every environment variable the API reads, in one place. Anything absent from
// this schema is not configuration — it is a hardcoded value someone reached
// for `process.env` to avoid naming.
//
// Defaults exist only where a wrong value is harmless. DATABASE_URL has none:
// a default there would point production at somebody's laptop.
export const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),

  // libpq connection string. Neon for deployed environments, local Postgres for
  // development — docs/architecture/infrastructure.md §Hosting.
  DATABASE_URL: z.string().min(1, "must be a Postgres connection string"),

  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});

export type Env = Readonly<z.infer<typeof envSchema>>;

/** DI token for the parsed environment. */
export const ENV = Symbol("ENV");

// Thrown, not logged and swallowed: the caller decides how the process dies,
// and the message carries every problem at once rather than the first one.
export class EnvValidationError extends Error {
  constructor(issues: readonly z.core.$ZodIssue[]) {
    const lines = issues.map(
      (issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    super(`Invalid environment:\n${lines.join("\n")}`);
    this.name = "EnvValidationError";
  }
}

/**
 * Parses and freezes the environment. Pure in its argument so tests can pass a
 * fixture instead of mutating `process.env`.
 */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    throw new EnvValidationError(result.error.issues);
  }

  return Object.freeze(result.data);
}
