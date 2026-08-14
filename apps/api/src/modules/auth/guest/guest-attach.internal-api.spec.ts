// The Better Auth surface the attach flow reaches into, pinned.
//
// `guest-attach.service.ts` creates the account through
// `auth.$context.internalAdapter` rather than through `/sign-up/email`, because
// the public route insists on a password this screen leaves optional and mails a
// verification for an address the guest has already proved. That decision is
// recorded there. What is recorded here is its price: the adapter is internal,
// carries no semver promise and has no documentation page, so an upgrade is free
// to move it. The verification door the same flow signs the guest in through is
// public API, and is pinned below beside it because losing either one strands a
// guest at the link in their confirmation email.
//
// This file is what notices. It fails in CI, by name, with a sentence that says
// what to do — and it fails there rather than at the moment a guest follows the
// link in their confirmation email and the property discovers it cannot create
// their account.
//
// No database is touched. `betterAuth` builds its adapter lazily and nothing
// below calls anything; every assertion is about the shape of the object the
// library hands back.

import "reflect-metadata";

import { describe, expect, it } from "vitest";
import type { Env } from "../../../config/env.js";
import type { Database } from "../../../database/database.module.js";
import type { MailQueue } from "../../notification/mail-queue.service.js";
import { createGuestAuth } from "./guest-auth.factory.js";

const env = {
  NODE_ENV: "test",
  API_URL: "https://api.mariva.test",
  WEB_ORIGIN: "https://mariva.test",
  BETTER_AUTH_SECRET: "0".repeat(32),
} as Env;

const MOVED =
  "Better Auth's internal API has moved. `guest-attach.service.ts` creates a " +
  "guest account through `auth.$context.internalAdapter` and then verifies its " +
  "address at the realm's own `/verify-email`, and the library does not promise " +
  "to keep the first of those stable. Re-read the upgrade's changelog, then " +
  "either follow the surface or switch to whatever supported route now creates " +
  "an account for a guest who may set no password — and not to `signUpEmail`, " +
  "which insists on one and mails a verification the guest has already done.";

function guestAuth() {
  return createGuestAuth({
    db: {} as Database,
    env,
    mail: { enqueue: async () => {} } as unknown as MailQueue,
  });
}

describe("the Better Auth surface account creation depends on", () => {
  it("still exposes an internal adapter on the resolved context", async () => {
    const context = await guestAuth().$context;

    expect(context.internalAdapter, MOVED).toBeDefined();
  });

  it("still creates a user and links a credential through that adapter", async () => {
    const { internalAdapter } = await guestAuth().$context;

    expect(typeof internalAdapter.createUser, MOVED).toBe("function");
    expect(typeof internalAdapter.linkAccount, MOVED).toBe("function");
  });

  it("still hashes a password the way sign-up does", async () => {
    const context = await guestAuth().$context;

    // The same hasher the library's own sign-up uses, reached the same way. A
    // password hashed by anything else is a password `/sign-in/email` would
    // refuse, which would strand every guest who set one from a mailed link.
    expect(typeof context.password.hash, MOVED).toBe("function");
  });

  it("still refuses to let sign-up create a verified address", () => {
    const { emailAndPassword } = guestAuth().options;

    // One of the three reasons the public route cannot make this account, and
    // the only one a future release might quietly withdraw — the other two, a
    // mandatory password and a verification email nobody needs, are visible in
    // the options and in an inbox. Asserted rather than left as a claim in a
    // comment.
    expect(
      "emailVerified" in emailAndPassword,
      "Better Auth's email-and-password options now mention `emailVerified`. " +
        "If sign-up can produce a verified user, `guest-attach.service.ts` " +
        "should stop reaching into the internal adapter and use it.",
    ).toBe(false);
  });

  it("still signs a guest in when their address is verified", () => {
    const { emailVerification } = guestAuth().options;

    // The whole mechanism behind the session `guest-attach.service.ts` hands
    // back. It redeems the mail's proof at `/verify-email`, and the cookies
    // that come back exist only because of this option — switched off, the
    // address would still be verified and the attach would still succeed, and
    // the guest would silently be left signed out of the stay they just made an
    // account for.
    expect(
      emailVerification.autoSignInAfterVerification,
      "Verifying an address no longer signs the guest in. The attach door " +
        "relies on it for the session it gives a guest who followed the link " +
        "in their confirmation email — see `guest-attach.service.ts`.",
    ).toBe(true);
  });

  it("still mints the verification token that door is opened with", async () => {
    const { createEmailVerificationToken } = await import("better-auth/api");
    const { verifyEmail } = guestAuth().api;

    // Minted and spent inside one call, never mailed: the message this stands
    // for was already sent and already followed. Both halves are the library's
    // public API surface, and both have to be there for the mailed-link door to
    // produce a verified address at all.
    expect(typeof createEmailVerificationToken, MOVED).toBe("function");
    expect(typeof verifyEmail, MOVED).toBe("function");
  });

  it("states the password policy the attach door reads off it", () => {
    const { minPasswordLength, maxPasswordLength } =
      guestAuth().options.emailAndPassword;

    // `guest-attach.service.ts` applies these rather than restating them, so
    // that the mailed-link door and `/sign-up/email` cannot drift into two
    // different floors. They have to be numbers for that to mean anything.
    expect(typeof minPasswordLength).toBe("number");
    expect(typeof maxPasswordLength).toBe("number");
    expect(minPasswordLength).toBeLessThan(maxPasswordLength);
  });
});
