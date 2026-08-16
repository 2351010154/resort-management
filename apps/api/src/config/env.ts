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
  // Stated, never assumed. Every production refusal in this file is written as
  // "unless NODE_ENV is production", so an unset value would not merely default
  // to something harmless — it would switch each of those checks off. A deploy
  // that forgot it would boot happily with no mailer, no OAuth client, no VAT
  // rates it chose, and no trusted address header, and would say nothing about
  // any of them. Better Auth reads the same variable out of `process.env` for
  // itself and reaches the same conclusion, resolving every caller in the world
  // to `127.0.0.1` and pooling them into one rate-limit bucket.
  //
  // So it has no default. The one environment where a mistake here is cheap is
  // the one that can afford to write it down.
  NODE_ENV: z.enum(["development", "test", "production"]),

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

  // The admin console — the second and last origin `main.ts` allows to send
  // credentialed requests, alongside WEB_ORIGIN. No `.default()` here even
  // though development gets one, `http://localhost:3002` — apps/admin's fixed
  // dev port. The fallback is assigned below instead, once the production
  // check has already refused a boot that never named it, the same shape the
  // VAT rate figures use for the same reason.
  ADMIN_ORIGIN: z.url().optional(),

  // Which request header carries the caller's own address, where something in
  // front of this process is trusted to have written it.
  //
  // Better Auth resolves the address its rate limiter keys on from headers
  // alone: it is handed a Web `Request` and never sees the socket, so `trust
  // proxy` and `request.ip` — which is what `caller-key.ts` keys the hold limit
  // on — do not reach it. Left to itself it reads `x-forwarded-for`, and a
  // single-token value there is trusted exactly as written. A caller who sends
  // their own therefore buys a fresh quota per value, which is a
  // credential-stuffing limit switched off by anyone who has read the library.
  //
  // Named here rather than written into the realm because the answer belongs to
  // whatever sits in front. On Fly it is `fly-client-ip`, set by the edge and
  // not forgeable by a client; behind a different edge it is a different name,
  // and that should be a variable rather than a deploy.
  //
  // Unset is development and CI, where nothing is in front and the library's own
  // default is the honest answer — no proxy wrote anything, so no header
  // deserves more trust than another and every caller shares one bucket anyway.
  // Production is refused without it below, because production is the only place
  // the header carries weight.
  TRUSTED_CLIENT_IP_HEADER: z
    .string()
    .regex(/^[a-zA-Z0-9-]+$/, "must be a header name, such as fly-client-ip")
    .optional(),

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

  // Where `FR-PAY-05` pages when the hourly reconciliation finds money the two
  // reports disagree about. One URL and no vendor: PagerDuty's Events API,
  // Slack, ntfy and every on-call tool worth having accept a POST, so which one
  // rings a phone at 03:00 is the property's decision and its routing rules —
  // not a client library in this tree that would have to be kept current.
  //
  // Absent, `OpsAlertService` writes the page to the log at `warn` instead of
  // sending it, so a developer sees exactly what would have been dispatched
  // without an endpoint to point at. `RESEND_API_KEY` makes the same trade.
  //
  // The production check below is conditional rather than flat, and the
  // condition is the gateway credential. Reconciliation compares the property's
  // record of *gateway* money against the gateway's own — `reconciliation.
  // service.ts` selects on `attempt_reference is not null`, which is exactly the
  // money that did not come over the desk — so a property with no terminal has
  // no attempts, no discrepancies and nothing to page about. Requiring a pager
  // there would refuse a boot over an alert that could never fire. The moment a
  // terminal is configured the money is real, and silence stops being an
  // acceptable answer.
  OPS_ALERT_WEBHOOK_URL: z.url().optional(),

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
  // Ten minutes covers the funnel's guest-details and payment steps plus a
  // gateway round trip, and it is the figure a property tunes when it finds
  // guests timing out mid-payment or rooms sitting held behind abandoned carts.
  // The floor is one minute rather than zero: a TTL of zero would have the
  // sweep cancel every hold the instant it was taken, which is the funnel
  // silently not working rather than a configuration anybody meant.
  //
  // It was fifteen, and the five minutes were given back to the property rather
  // than to the funnel. This is the length an abandoned cart costs a room, and
  // the public door it sits behind is the one an unauthenticated caller reaches
  // — so the number is a share of the property held by strangers, multiplied by
  // however many holds are outstanding. Ten still leaves a guest longer than a
  // card payment takes, and `hold-expiry-sweep.ts` collects it a minute later,
  // which puts the worst case for an abandoned room at eleven minutes.
  BOOKING_HOLD_TTL_MINUTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(1_440)
    .default(10),

  // How long a hold outlives the guest who was standing on it.
  //
  // The TTL above is the *longest* a hold can last. This is the other half of
  // when it dies: the funnel says it is still open every twenty seconds, and
  // `hold-expiry-sweep.ts` releases a hold at the earlier of its TTL and this
  // long after the last of those arrived. It is a figure rather than a constant
  // for the same reason the TTL is — the trade it makes is the property's, and
  // it is a different trade than the TTL's.
  //
  // **Two minutes, and it is generous on purpose.** What this costs when it is
  // too short is a guest in a lift, in a tunnel, or on a phone that locked,
  // losing a room they are still buying — and they lose it silently, because
  // nothing on their screen said their connection was what was holding it. Four
  // consecutive failed pings at twenty seconds is still inside two minutes.
  // Shortening it to reclaim inventory faster trades a guest's booking for a few
  // room-minutes, which is the wrong direction on every night that is not sold
  // out. Lengthen it with a complaint; shorten it only with data about guests who
  // left, never with a number about rooms.
  //
  // The floor is thirty seconds rather than zero. Below the interval the funnel
  // pings at, a guest sitting still on the review screen is released *between*
  // two of their own pings — the feature releasing exactly the guests it was
  // built to keep. Nothing above the TTL has any effect at all, since the hold
  // dies at the earlier of the two; the ceiling is an hour so that a mistyped
  // figure reads as configuration rather than as this being switched off.
  BOOKING_HOLD_GRACE_SECONDS: z.coerce
    .number()
    .int()
    .min(30)
    .max(3_600)
    .default(120),

  // How long a hold has left once its guest has been sent to the gateway.
  //
  // The two figures above are the only ways a hold dies; this is the only thing
  // that moves either of them, and it exists because the TTL starts running when
  // a room is picked and the payment is the last thing that happens under it. A
  // guest who reaches the payment page at minute eight of ten has two minutes to
  // leave the browser, authenticate in a banking app, approve, and be brought
  // back — and `hold-expiry-sweep.ts` cancels the stay in the middle of that,
  // releasing a room the gateway is at that moment collecting for. So
  // `payment.service.ts` asks `BookingService` to push the expiry out to this
  // long from now when an attempt opens, and never to pull one in that already
  // runs longer.
  //
  // **Fifteen minutes, which is a bank app rather than a card form.** The slow
  // path is a payer switching to another application, waiting for a one-time
  // code, and coming back to a tab the phone may have discarded; the fast one is
  // over in thirty seconds and does not need the figure at all. It is deliberately
  // longer than the ten-minute TTL, because the TTL is time spent choosing and
  // this is time spent paying — a window shorter than the hold it extends would
  // be a payment step racing a clock that started before the guest reached it.
  //
  // What it costs is the same thing the TTL costs, over a shorter list of
  // callers: a payer who opens checkout and walks away holds the room this long
  // from the moment they did, whatever was left of the TTL. That is the trade,
  // and it is the property's — raise it for guests reporting they timed out
  // mid-payment, lower it when rooms sit behind checkouts nobody finished. What
  // bounds the abuse of it is not this number but the per-caller hold caps in
  // `booking.service.ts`, which are unchanged: an attempt is a row somebody has
  // to open, and it is opened against a stay that caller already proved is
  // theirs.
  //
  // The floor is one minute, matching the TTL's, and for the same reason: a
  // window of zero would be the extension silently not working. The ceiling is an
  // hour, because past that this is not a payment window — it is a room off the
  // shelf for the afternoon on the strength of one checkout nobody finished, and
  // a property that wants that should be raising the TTL where the whole funnel
  // can see it.
  BOOKING_PAYMENT_WINDOW_MINUTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(60)
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
  // The admin console's own origin, required for the same reason WEB_ORIGIN's
  // is trusted rather than guessed: `main.ts` builds a CORS allow-list from
  // both, and the one place a wrong value is harmless is development, where
  // the default below stands in for it. A deploy that left it unset would have
  // every admin request to a staff-only endpoint rejected by the browser
  // before it left the CORS preflight.
  .refine(
    (env) => env.NODE_ENV !== "production" || Boolean(env.ADMIN_ORIGIN),
    {
      path: ["ADMIN_ORIGIN"],
      message:
        "is required in production — the admin console cannot reach the API without its own origin on the CORS allow-list",
    },
  )
  // Without it the guest realm's limiter keys on whatever the caller wrote in
  // `x-forwarded-for`, so every attempt can hand itself a fresh quota and the
  // five-a-minute floor under `/sign-in/email` stops existing. Refused only in
  // production, because it is the only environment with an edge whose header
  // means anything.
  .refine(
    (env) =>
      env.NODE_ENV !== "production" || Boolean(env.TRUSTED_CLIENT_IP_HEADER),
    {
      path: ["TRUSTED_CLIENT_IP_HEADER"],
      message:
        "is required in production — otherwise the guest realm's rate limiter trusts an address the caller writes, and a limit anyone can reset is not one",
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
  // A production property taking card money has somewhere for the night's
  // disagreements to land. `FR-PAY-05`'s whole value is that a callback that
  // never arrived — a guest charged, their folio still showing the amount
  // outstanding — is found the next morning rather than a month later by the
  // bank reconciliation, and a discrepancy nobody is told about is found by
  // neither. Conditional on the terminal because a property with no gateway
  // takes no gateway money; `OPS_ALERT_WEBHOOK_URL` above argues that at length.
  .refine(
    (env) =>
      env.NODE_ENV !== "production" ||
      !env.VNPAY_TMN_CODE ||
      Boolean(env.OPS_ALERT_WEBHOOK_URL),
    {
      path: ["OPS_ALERT_WEBHOOK_URL"],
      message:
        "is required in production once VNPAY_TMN_CODE is set — gateway money moves daily and a discrepancy nobody is paged about is one nobody finds",
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
    ADMIN_ORIGIN: env.ADMIN_ORIGIN ?? "http://localhost:3002",
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
