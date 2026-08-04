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

  // Where this API answers from, as the browser sees it. Better Auth builds
  // callback URLs and cookie domains from it, so a wrong value here produces a
  // sign-in that succeeds and a session that never arrives.
  API_URL: z.url().default("http://localhost:3001"),

  // The public site. It is the only origin allowed to send credentialed
  // requests, and the base of every link in a verification or reset email.
  WEB_ORIGIN: z.url().default("http://localhost:3000"),

  // Better Auth signs guest session cookies with this. Thirty-two characters is
  // the library's own floor; below it the signature is not worth computing.
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "must be at least 32 characters — `openssl rand -base64 32`"),

  // A **different** secret signs staff access tokens. Sharing one key across
  // the realms would mean a single leak forges both, which is the failure the
  // two-realm split in docs/architecture/rbac-matrix.md §1 exists to bound.
  STAFF_JWT_SECRET: z
    .string()
    .min(32, "must be at least 32 characters, and not BETTER_AUTH_SECRET"),

  // The OAuth client behind the guest realm's Google button. Optional so the
  // API boots for a developer who has not made one, and refused in production
  // by the check below: the login screen offers the button unconditionally, and
  // a button that reaches a provider the API never registered fails in a way no
  // guest can act on.
  //
  // The client's authorised redirect URI is API_URL + the guest realm's base
  // path + /callback/google. Better Auth builds it; Google matches it exactly.
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),

  // Transactional email. Absent, the mailer writes the message to the log
  // instead of sending it — usable in development, and refused at boot in
  // production by the check below.
  RESEND_API_KEY: z.string().min(1).optional(),

  MAIL_FROM: z.string().min(1).default("Mariva <no-reply@mariva.local>"),

  // The hour the business date rolls over, in the property's own zone —
  // docs/architecture/property-and-tariff.md §2. 04:00 by default, which is when
  // the night audit runs and closes the date that just ended.
  //
  // Here rather than in `property_tariff`, and the reason is who may change it.
  // `rbac-matrix.md` §3 files the business date under System config — `ADMIN`
  // edits, `MANAGER` only looks — while `property_tariff` sits under the rates
  // row a `MANAGER` owns, so a column there would widen the audience for it. The
  // row `FR-IDN-03` describes is `M6`'s to build, and §8 says those rows are
  // "seeded from environment at boot": this is that seed, arriving early because
  // the business date is needed before the table that will hold it exists.
  BUSINESS_DATE_ROLLOVER_HOUR: z.coerce
    .number()
    .int()
    .min(0)
    .max(23)
    .default(4),

  // How long a hold holds — `FR-BOOK-02`, which states outright that "the TTL
  // length is configuration, not a constant".
  //
  // Fifteen minutes covers the funnel's guest-details and payment steps plus a
  // gateway round trip, and it is the figure a property tunes when it finds
  // guests timing out mid-payment or rooms sitting held behind abandoned carts.
  // The floor is one minute rather than zero: a TTL of zero would have the
  // sweep cancel every hold the instant it was taken, which is the funnel
  // silently not working rather than a configuration anybody meant.
  BOOKING_HOLD_TTL_MINUTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(1_440)
    .default(15),

  // Whether this process runs the sweeps in `src/jobs` — the pg-boss workers
  // and the cron entries that wake them.
  //
  // Left unset it follows `NODE_ENV`, on everywhere except `test`, and the
  // default is derived rather than fixed because the two wrong values cost
  // opposite things. Off in a deployed process is a hold that never expires and
  // a room the property never gets back: silent, and visible only as a hotel
  // that has quietly stopped selling. On under the test runner is a set of
  // background workers polling — and writing to — the single Postgres every
  // spec truncates, which turns a deterministic suite into an intermittent one.
  //
  // It is also how a second API instance is run without a second scheduler
  // behind it. pg-boss coordinates its cron across instances, so two schedulers
  // is not a correctness problem; it is a choice about which process does the
  // work, and that choice belongs to whoever deploys it.
  JOBS_SCHEDULER_ENABLED: z.stringbool().optional(),
})
  .refine((env) => env.BETTER_AUTH_SECRET !== env.STAFF_JWT_SECRET, {
    path: ["STAFF_JWT_SECRET"],
    message: "must differ from BETTER_AUTH_SECRET — one leak must not forge both realms",
  })
  .refine((env) => env.NODE_ENV !== "production" || Boolean(env.RESEND_API_KEY), {
    path: ["RESEND_API_KEY"],
    message:
      "is required in production — without it, verification and reset emails are only logged",
  })
  // Half a credential is not a configuration anyone meant to write. An id
  // without its secret registers a provider Google refuses at the redirect,
  // which is a failure that surfaces on a guest's screen rather than at boot.
  .refine(
    (env) =>
      Boolean(env.GOOGLE_CLIENT_ID) === Boolean(env.GOOGLE_CLIENT_SECRET),
    {
      path: ["GOOGLE_CLIENT_SECRET"],
      message: "and GOOGLE_CLIENT_ID are set together, or neither is set",
    },
  )
  .refine(
    (env) => env.NODE_ENV !== "production" || Boolean(env.GOOGLE_CLIENT_ID),
    {
      path: ["GOOGLE_CLIENT_ID"],
      message:
        "is required in production — the login screen offers Google sign-in unconditionally",
    },
  )
  // Last, so every check above reads the environment exactly as it was written.
  // The one derived value in this file lives here rather than in `.default()`
  // because it is a default *about another variable*, and zod cannot express
  // that on the field itself.
  .transform((env) => ({
    ...env,
    JOBS_SCHEDULER_ENABLED:
      env.JOBS_SCHEDULER_ENABLED ?? env.NODE_ENV !== "test",
  }));

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
