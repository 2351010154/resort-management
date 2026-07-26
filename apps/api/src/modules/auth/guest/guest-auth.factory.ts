// The guest realm, as Better Auth is configured for it.
//
// A factory rather than a module-scope `export const auth`: the instance needs
// the Drizzle client and the parsed environment, both of which come from Nest's
// container, and a top-level instance would build itself at import time with
// whatever `process.env` happened to hold. Every option below is set
// deliberately — Better Auth's defaults are sensible, but a default that
// matters is a decision nobody made.

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Env } from "../../../config/env.js";
import type { Database } from "../../../database/database.module.js";
import * as guestAuthSchema from "../../../database/schema/guest-auth.js";
import type { MailerService } from "../../notification/mailer.service.js";
import {
  resetPassword,
  verifyEmail,
} from "../../notification/templates/guest-auth-emails.js";

/** Better Auth is mounted here, and the web client is pointed at the same
 *  path. Changing it changes every callback URL already in an inbox. */
export const GUEST_AUTH_BASE_PATH = "/api/auth";

const HOUR_IN_SECONDS = 60 * 60;
const DAY_IN_SECONDS = 24 * HOUR_IN_SECONDS;

// A guest signs in to book a room and comes back months later. Thirty days,
// refreshed daily while they are active, is the balance between that and a
// cookie that outlives the laptop it was issued to.
const SESSION_LIFETIME_SECONDS = 30 * DAY_IN_SECONDS;
const SESSION_REFRESH_AFTER_SECONDS = DAY_IN_SECONDS;

// Twelve, not eight. The guest realm holds passport scans and stay history, and
// the only cost of the longer floor is paid once, at sign-up.
const MIN_PASSWORD_LENGTH = 12;

// Better Auth's own ceiling is 128; naming it here is what stops a future edit
// raising the floor past it and locking everybody out.
const MAX_PASSWORD_LENGTH = 128;

export type GuestAuth = ReturnType<typeof createGuestAuth>;

export function createGuestAuth(deps: {
  readonly db: Database;
  readonly env: Env;
  readonly mailer: MailerService;
}) {
  const { db, env, mailer } = deps;

  return betterAuth({
    appName: "Mariva",
    baseURL: env.API_URL,
    basePath: GUEST_AUTH_BASE_PATH,
    secret: env.BETTER_AUTH_SECRET,

    // The same Drizzle client, and therefore the same pool, as every other
    // query in the process — `R2#13`. The schema object's keys are Better
    // Auth's model names; see database/schema/guest-auth.ts for why.
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: guestAuthSchema,
    }),

    // The only origin allowed to drive this API with credentials. Better Auth
    // checks it on every callback and redirect, so an open redirect out of the
    // verification flow is not reachable from a link in an email.
    trustedOrigins: [env.WEB_ORIGIN],

    emailAndPassword: {
      enabled: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,

      // Sign-in is refused until the address is confirmed. A booking
      // confirmation that goes to an address nobody owns is a guest who arrives
      // to no reservation, so the address is proven before an account can hold
      // one.
      requireEmailVerification: true,
      resetPasswordTokenExpiresIn: HOUR_IN_SECONDS,

      sendResetPassword: async ({ user, url }) => {
        await mailer.send(
          resetPassword({ to: user.email, name: user.name, url }),
        );
      },

      // Every other session is revoked when a password changes. The point of
      // resetting a password is to lock somebody out; leaving their session
      // alive does not do that.
      revokeSessionsOnPasswordReset: true,
    },

    // Registered only when both halves of the credential are present. Better
    // Auth would otherwise publish /sign-in/social and send the guest to an
    // authorize URL Google rejects — a boot that looks healthy until somebody
    // clicks. env.ts refuses production without them, so the absent branch is
    // development only.
    socialProviders:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,

              // Without this Google signs the guest straight back in as
              // whichever account the browser already holds, which on a shared
              // machine books a room under someone else's name. The chooser
              // costs one click and makes whose account this is a decision.
              prompt: "select_account",
            },
          }
        : {},

    account: {
      accountLinking: {
        // A guest who signed up with a password and later presses Google is one
        // guest, not two rows. Better Auth links them when Google says the
        // address is verified **and** the Mariva account already proved the
        // same address itself — the second half is what stops a stranger
        // registering someone's address, never confirming it, and being handed
        // the account the day its owner arrives by Google. That gate is the
        // library's, and it is on its way to being unconditional; this is here
        // to say the linking it guards is wanted.
        enabled: true,

        // Empty on purpose. A trusted provider skips the `email_verified`
        // check above, and there is no provider here worth trusting further
        // than what it puts in the token.
        trustedProviders: [],
      },
    },

    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: HOUR_IN_SECONDS,

      sendVerificationEmail: async ({ user, url }) => {
        await mailer.send(verifyEmail({ to: user.email, name: user.name, url }));
      },
    },

    session: {
      expiresIn: SESSION_LIFETIME_SECONDS,
      updateAge: SESSION_REFRESH_AFTER_SECONDS,

      // The signed cookie carries the session for five minutes before the
      // database is consulted again. Without it every authenticated request
      // costs a round trip, and the guest funnel makes several per page.
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },

    advanced: {
      // Better Auth turns its Origin check off by default when NODE_ENV is
      // `test`, on the assumption that a test client cannot send an Origin
      // header. Ours can, and a CSRF defence that is absent from the
      // environment the tests run in is a defence no test can prove exists —
      // so it is switched back on, explicitly, everywhere.
      disableOriginCheck: false,

      // Prefixed because the staff realm will eventually set cookies on the
      // same host. Two realms sharing a cookie name is the ambiguity §1 of the
      // RBAC matrix forbids, expressed in the one place browsers can see.
      cookiePrefix: "mariva_guest",
      useSecureCookies: env.NODE_ENV === "production",
      defaultCookieAttributes: {
        httpOnly: true,
        // `lax`, not `strict`: the verification link in an email is a
        // cross-site navigation, and `strict` would drop the session cookie on
        // arrival — the guest would land signed out having just proved they
        // own the address.
        sameSite: "lax",
      },
    },

    rateLimit: {
      // On by default in production only; the guest realm's credential
      // endpoints are worth limiting everywhere, including in the tests that
      // assert the limit exists.
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        // Five attempts a minute stops credential stuffing without troubling a
        // guest who mistypes. In-memory, which is correct for one Fly instance
        // and would need revisiting the day there are two.
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 60, max: 3 },
        "/reset-password": { window: 60, max: 5 },
        "/send-verification-email": { window: 60, max: 3 },
      },
    },
  });
}
