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
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import { and, eq, isNotNull } from "drizzle-orm";
import type { Env } from "../../../config/env.js";
import type { Database } from "../../../database/database.module.js";
import * as guestAuthSchema from "../../../database/schema/guest-auth.js";
import type { MailQueue } from "../../notification/mail-queue.service.js";
import {
  confirmEmailChange,
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

/**
 * Whether a verification token is one that would move an account's address.
 *
 * Better Auth mints these itself and puts the errand in the payload:
 * `requestType: "change-email-verification"` beside the address to move to. The
 * payload is read here without checking the signature, and that is safe for
 * exactly one reason — nothing is decided by it except which of two wordings
 * goes in an email whose recipient the library has already chosen. The token's
 * signature is verified by Better Auth when the link is followed, which is the
 * only place it authorises anything.
 */
function movesTheAddress(token: string): boolean {
  const payload = token.split(".")[1];

  if (payload === undefined) {
    return false;
  }

  try {
    const claims: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );

    return (
      typeof claims === "object" &&
      claims !== null &&
      (claims as { requestType?: unknown }).requestType ===
        "change-email-verification"
    );
  } catch {
    // A token this cannot read is a token from a flow this does not know
    // about, and the sign-up wording is the one that suits an address being
    // proved for the first time.
    return false;
  }
}

/**
 * Whether an account has a password of its own.
 *
 * `providerId = 'credential'` is Better Auth's own name for the email/password
 * row, and the hash has to be there as well as the row: an account that has
 * been unlinked from its password keeps neither. The same pair is what
 * `/change-password` looks for before it will verify anything.
 */
async function hasPasswordCredential(
  db: Database,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: guestAuthSchema.account.id })
    .from(guestAuthSchema.account)
    .where(
      and(
        eq(guestAuthSchema.account.userId, userId),
        eq(guestAuthSchema.account.providerId, "credential"),
        isNotNull(guestAuthSchema.account.password),
      ),
    )
    .limit(1);

  return row !== undefined;
}

export type GuestAuth = ReturnType<typeof createGuestAuth>;

export function createGuestAuth(deps: {
  readonly db: Database;
  readonly env: Env;
  readonly mail: MailQueue;
}) {
  const { db, env, mail } = deps;

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

      // Queued, not sent. Both of this realm's emails are handed over rather
      // than awaited, for the reason `mail-queue.service.ts` sets out: the
      // request that composed the message must not take longer than one that
      // had nothing to send, or how long the answer took says which of the two
      // branches ran. Reset is as exposed as sign-up here — the route answers
      // an unknown address and a registered one identically, and only a
      // registered one has a mail to send.
      sendResetPassword: async ({ user, url }) => {
        await mail.enqueue(
          resetPassword({ to: user.email, name: user.name, url }),
        );
      },

      // Every other session is revoked when a password changes. The point of
      // resetting a password is to lock somebody out; leaving their session
      // alive does not do that.
      revokeSessionsOnPasswordReset: true,
    },

    // `FR-AUTH-04`'s email change, and only the half of it this library
    // version has.
    //
    // Better Auth 1.6.25 offers two shapes here, and which one runs is decided
    // by whether `sendChangeEmailConfirmation` is set. Set, the change is
    // two-step: a confirmation to the address the guest already holds, and only
    // once that is clicked does a verification go to the new one — two messages
    // and two clicks. Unset, `/change-email` mints a token carrying
    // `requestType: change-email-verification` and hands it to
    // `emailVerification.sendVerificationEmail` with the user's address
    // overridden to the new one: a single link, sent to the address being
    // proved. That is the flow this realm wants, so the hook is deliberately
    // absent and the message is composed in `sendVerificationEmail` below.
    //
    // There is no `sendChangeEmailVerification` option in this version — the
    // one-step message has no hook of its own.
    //
    // What the route does not do is change anything before the link is used.
    // The address on the row is untouched until `/verify-email` is reached with
    // that token, so the old address stays the sign-in identifier for as long as
    // the change is unproven; `guest-email-change.e2e-spec.ts` signs in with
    // both addresses either side of the click rather than taking that on trust.
    //
    // `updateEmailWithoutVerification` is left off. It would let an account
    // whose address is unverified move that address with no proof at all, and
    // this realm refuses sign-in until an address is proved anyway.
    user: {
      changeEmail: { enabled: true },
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

      // One hook, two errands. Better Auth routes the change-email link through
      // here as well as the sign-up one, and hands both the address the link
      // proves — for a change that is already the new address, not the one the
      // guest currently signs in with. Only the wording differs, and it has to:
      // "confirm your email and your account is ready" sent to somebody whose
      // account has worked for a year reads as a phishing attempt.
      //
      // Which errand this is comes off the token, because it is the only thing
      // that carries it.
      sendVerificationEmail: async ({ user, url, token }) => {
        const message = movesTheAddress(token)
          ? confirmEmailChange({ to: user.email, name: user.name, url })
          : verifyEmail({ to: user.email, name: user.name, url });

        await mail.enqueue(message);
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

      // Where the rate limiter below is told the caller is.
      //
      // Better Auth reads this out of headers and nothing else — it is handed a
      // Web `Request`, so Express's `trust proxy` and `request.ip`, which is
      // what the hold limiter keys on, are invisible to it. Its own default is
      // `x-forwarded-for` read verbatim, and a caller behind no proxy writes
      // that header themselves: every attempt would arrive as a new address
      // holding a new quota, and the five-a-minute floor below would be a
      // formality.
      //
      // So the header is named by configuration and trusted because of what
      // wrote it. Unset — development and CI, where nothing is in front of this
      // process — the library's default stands, since no header there is more
      // truthful than another and every caller shares one bucket regardless.
      // `env.ts` refuses production without it, so the empty branch is local.
      ipAddress:
        env.TRUSTED_CLIENT_IP_HEADER === undefined
          ? {}
          : { ipAddressHeaders: [env.TRUSTED_CLIENT_IP_HEADER] },
      defaultCookieAttributes: {
        httpOnly: true,
        // `lax`, not `strict`: the verification link in an email is a
        // cross-site navigation, and `strict` would drop the session cookie on
        // arrival — the guest would land signed out having just proved they
        // own the address.
        sameSite: "lax",
      },
    },

    // The two credential-management routes, made to behave the way the rest of
    // this file already does. Both are Better Auth's own; neither is
    // reimplemented here, and this is the smallest place to say what the
    // library leaves to the caller.
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // A guest who only ever pressed Google has no password to prove and no
        // address of their own — Google owns both. Better Auth already refuses
        // them `/change-password`, because there is no credential row to verify
        // `currentPassword` against; it does not refuse them `/change-email`,
        // which would move the address out from under the account Google
        // matches them on and leave the next sign-in creating a second guest.
        //
        // Refused here rather than by hiding the form. A page that omits a
        // control is a page, and the request it omits can still be sent.
        //
        // Nothing about any other account is consulted, so this tells the
        // caller only what their own session already told them.
        if (ctx.path === "/change-email") {
          const session = await getSessionFromCtx(ctx);

          // No session is the endpoint's own answer to give — its middleware
          // returns the 401, and answering here would be a second door.
          if (session && !(await hasPasswordCredential(db, session.user.id))) {
            throw new APIError("BAD_REQUEST", {
              message:
                "This account signs in with Google, so its email address is " +
                "Google's to change.",
              code: "CREDENTIAL_ACCOUNT_NOT_FOUND",
            });
          }

          return;
        }

        // `revokeSessionsOnPasswordReset` above covers the guest who forgot
        // their password. This is the same decision for the guest who
        // remembered it: a password is changed to lock somebody out, and
        // Better Auth leaves that to a `revokeOtherSessions` flag in the
        // request body — which is to say, to whichever client sent it. The
        // flag is set here so that every caller gets the behaviour and no
        // caller can decline it.
        if (ctx.path === "/change-password") {
          return { context: { body: { revokeOtherSessions: true } } };
        }

        return;
      }),
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
