import { parseDate } from "@internationalized/date";
import { z } from "zod";

// A calendar date and not an instant, for the reason `stay-date.ts` gives at
// length: these bound business dates, which the property agrees on, not moments.
//
// The shape check alone accepts 2026-02-31, so `parseDate` is asked as well —
// it refuses a date that does not exist rather than rolling it into March, the
// way `new Date` would. Checked here rather than left to the column, because a
// boot that stops on a malformed variable is the whole contract of this file.
const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected a YYYY-MM-DD calendar date")
  .refine((value) => {
    try {
      parseDate(value);
      return true;
    } catch {
      return false;
    }
  }, "is not a date that exists");

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

  // The merchant terminal `FR-PAY-02`'s adapter signs with. `config.ts` says why
  // they are here and not in `system_config`: a secret in a table an `ADMIN`
  // screen reads has a wider audience than the process that uses it.
  //
  // Optional, and the reason is who is stopped by making them mandatory. A
  // terminal comes from VNPay's merchant onboarding, so requiring one at boot
  // would mean no developer and no CI runner could start the API — to run the
  // housekeeping suite, or the seed, or anything else that has nothing to do
  // with taking money. Unset, the API boots and every call to the gateway
  // fails, naming the two variables; `MailerService` makes the same trade for
  // the same reason. What is *not* traded away is the both-or-neither check
  // below: a terminal code without its secret is not a configuration anybody
  // meant to write, and it fails at a signature rather than at a boot.
  //
  // Not required in production either, and that is this milestone's boundary
  // rather than an oversight. `prd-m6.md` §Stack scope decision 2 files the
  // switch from sandbox to live credentials — and gate `G2`'s checklist behind
  // it — under `M7` with the guest funnel, which is what actually needs a live
  // gateway. A production refusal written here would assert that a deployed
  // property is already taking card payments, and it is not yet.
  VNPAY_TMN_CODE: z.string().min(1).optional(),
  VNPAY_SECRET_KEY: z.string().min(1).optional(),

  // Which VNPay the adapter talks to. Sandbox by default, because the wrong
  // value is only safe in one direction: a production deploy still pointing at
  // sandbox takes no money and is noticed on the first transaction, while a
  // staging deploy pointing at production takes real money from whoever is
  // testing it.
  VNPAY_SANDBOX: z.stringbool().default(true),

  // The hour the business date rolls over, in the property's own zone —
  // docs/architecture/property-and-tariff.md §2. 04:00 by default, which is when
  // the night audit runs and closes the date that just ended.
  //
  // Here rather than in `property_tariff`, and the reason is who may change it.
  // `rbac-matrix.md` §3 files the business date under System config — `ADMIN`
  // edits, `MANAGER` only looks — while `property_tariff` sits under the rates
  // row a `MANAGER` owns, so a column there would widen the audience for it.
  //
  // This variable seeds `system_config.business_date_rollover_hour`, which is
  // what §8 means by "seeded from environment at boot", and that is the whole of
  // what it does. Like the three money figures below, nothing reads it at run
  // time: `BusinessDateService` takes the hour from the row, so the row is what
  // decides what day the property is on and changing this after the first boot
  // changes nothing until an `ADMIN` edits the row.
  BUSINESS_DATE_ROLLOVER_HOUR: z.coerce
    .number()
    .int()
    .min(0)
    .max(23)
    .default(4),

  // The figures `property-and-tariff.md` §8 says the tree may never carry, in
  // the one place §8 sanctions them: "seeded from environment at boot".
  //
  // Nothing reads these at run time. They are read from `system_config` —
  // `SystemConfigSeeder` writes the row once and the row is the authority from
  // then on, so changing one of these after the first boot changes nothing until
  // an `ADMIN` edits it.
  //
  // Every one is ⚑ provisional. `ASM-01` is answered from published statutory
  // sources and not by a practising accountant, which is exactly why they stay
  // configuration rather than becoming an answer.
  //
  // None carries a `.default()`. §8 forbids the tree to know a tax rate, and a
  // default is the tree knowing one — the same argument the `system_config`
  // columns make about themselves, which a default here would undo one layer up:
  // an unconfigured production deploy would invoice at a figure nobody approved,
  // and never say so. Unset, they are supplied below for development and refused
  // below for production.
  //
  // Basis points, whole integers — a hundredth of a percent each, so 800 is 8%.
  // The ceiling is the table's: above 10000 the figure is a typo in a
  // basis-points field, and a typo that reaches a posting multiplies a room
  // charge by hundreds.
  //
  // Two rates and not one, because statutory relief lapses back into a standard
  // rate rather than into no rate. `system_config` holds both and resolves
  // between them by business date; a deployment that supplied only the reduced
  // one would have no answer for the day the window closes.
  STANDARD_VAT_RATE_BPS: z.coerce.number().int().min(0).max(10_000).optional(),

  REDUCED_VAT_RATE_BPS: z.coerce.number().int().min(0).max(10_000).optional(),

  // §5 puts the service charge at 5% over room and service lines.
  SERVICE_CHARGE_RATE_BPS: z.coerce
    .number()
    .int()
    .min(0)
    .max(10_000)
    .optional(),

  // §8: "this changes every gross/net calculation". A rule, so a boolean rather
  // than a number, and read at posting time rather than picked between two
  // formulas at compile time.
  VAT_INCLUDES_SERVICE_CHARGE: z.stringbool().optional(),

  // The business dates `REDUCED_VAT_RATE_BPS` covers. Every other date takes
  // `STANDARD_VAT_RATE_BPS`, so a date is never left without a rate.
  //
  // **Unset by default, and unset means no relief period rather than an
  // unbounded one**: a property that names neither end is one whose every date
  // sits at the standard rate. Setting them is how a relief period, and the day
  // it lapses, becomes visible in data instead of in an invoice — and the lapse
  // is now a rate change rather than a stopped posting, because the rate on the
  // far side of the window is configured beside it.
  REDUCED_VAT_FROM: calendarDateSchema.optional(),
  REDUCED_VAT_TO: calendarDateSchema.optional(),

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

  // The two guard relaxations `booking-state-machine.md` §7 leaves to the owner.
  // Both default to the blocked reading §7 assumes, and both are here rather
  // than hardcoded because §7 records them as open: a property that decides the
  // other way changes a line, not a guard.
  //
  // Off is the safe direction for each. Early check-in admits a guest to a room
  // the night audit has not yet counted as sold to them; a dirty-room check-in
  // hands over a room housekeeping has not released. Both are recoverable at a
  // front desk and neither is recoverable from a log after the fact, so the
  // decision is made once, in configuration, rather than per booking.
  BOOKING_EARLY_CHECK_IN_ENABLED: z.stringbool().default(false),

  // The `DIRTY` half of §7. `OUT_OF_ORDER` is **not** covered by it: that status
  // means the room cannot be occupied at all — `housekeeping-status.ts` files it
  // as a room condition and not a sales decision — and a flag that admitted a
  // guest into it would be a different decision than the one §7 asks about.
  BOOKING_DIRTY_ROOM_CHECK_IN_ENABLED: z.stringbool().default(false),

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
  // The same shape as the Google pair above, for the same reason and with a
  // sharper edge. A terminal code with no secret registers a merchant the
  // adapter cannot sign for, and the failure arrives as a rejected checksum on
  // a payment a guest is standing in front of — or, worse, as an IPN whose
  // signature never verifies, so money that moved is never posted to a folio.
  .refine(
    (env) => Boolean(env.VNPAY_TMN_CODE) === Boolean(env.VNPAY_SECRET_KEY),
    {
      path: ["VNPAY_SECRET_KEY"],
      message: "and VNPAY_TMN_CODE are set together, or neither is set",
    },
  )
  // The money figures, each refused separately so the message names the one
  // that is missing. An invoice is a legal document issued to somebody else,
  // and a rate nobody chose cannot be withdrawn from one after the fact — so a
  // production boot without them stops here, where the fix is a variable, rather
  // than at a posting, where it is an amended invoice.
  //
  // The standard rate is required whether or not a relief window is set, because
  // it is the rate on every date outside one — including every date at all when
  // no window is set.
  .refine(
    (env) =>
      env.NODE_ENV !== "production" || env.STANDARD_VAT_RATE_BPS !== undefined,
    {
      path: ["STANDARD_VAT_RATE_BPS"],
      message:
        "is required in production — it is the rate on every date the reduced-VAT window does not cover, and an invoice at a rate nobody chose cannot be withdrawn",
    },
  )
  .refine(
    (env) =>
      env.NODE_ENV !== "production" || env.REDUCED_VAT_RATE_BPS !== undefined,
    {
      path: ["REDUCED_VAT_RATE_BPS"],
      message:
        "is required in production — no rate is assumed, and an invoice at a rate nobody chose cannot be withdrawn",
    },
  )
  .refine(
    (env) =>
      env.NODE_ENV !== "production" ||
      env.SERVICE_CHARGE_RATE_BPS !== undefined,
    {
      path: ["SERVICE_CHARGE_RATE_BPS"],
      message:
        "is required in production — it is charged on every room and service line",
    },
  )
  .refine(
    (env) =>
      env.NODE_ENV !== "production" ||
      env.VAT_INCLUDES_SERVICE_CHARGE !== undefined,
    {
      path: ["VAT_INCLUDES_SERVICE_CHARGE"],
      message:
        "is required in production — it decides the base every VAT figure is computed on",
    },
  )
  // A window that closes before it opens covers no date, which reads at a
  // posting as relief that never applied. `system_config` refuses the row, but
  // the seed's failure is a log line rather than a dead process, so a boot that
  // never mentions it again would leave the property running on a configuration
  // nobody wrote. Caught here instead, where a malformed variable stops the
  // boot — and the two dates are compared as strings because `YYYY-MM-DD`
  // orders lexicographically.
  .refine(
    (env) =>
      !env.REDUCED_VAT_FROM ||
      !env.REDUCED_VAT_TO ||
      env.REDUCED_VAT_TO >= env.REDUCED_VAT_FROM,
    {
      path: ["REDUCED_VAT_TO"],
      message:
        "must not fall before REDUCED_VAT_FROM — a window that closes before it opens covers no date",
    },
  )
  // Last, so every check above reads the environment exactly as it was written.
  // The derived values in this file live here rather than in `.default()`
  // because each is a default *about another variable*, and zod cannot express
  // that on the field itself.
  //
  // The money figures are the reason that distinction earns its keep. A
  // developer gets a database that posts without configuring anything, and
  // production cannot reach these lines at all — the refines above have already
  // stopped the boot. The literals are named once, here, and the only invoice
  // they can ever reach is one nobody is billed for.
  .transform((env) => ({
    ...env,
    JOBS_SCHEDULER_ENABLED:
      env.JOBS_SCHEDULER_ENABLED ?? env.NODE_ENV !== "test",
    STANDARD_VAT_RATE_BPS: env.STANDARD_VAT_RATE_BPS ?? 1000,
    REDUCED_VAT_RATE_BPS: env.REDUCED_VAT_RATE_BPS ?? 800,
    SERVICE_CHARGE_RATE_BPS: env.SERVICE_CHARGE_RATE_BPS ?? 500,
    VAT_INCLUDES_SERVICE_CHARGE: env.VAT_INCLUDES_SERVICE_CHARGE ?? true,
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
