// Both of the guest realm's emails leave the request that composed them.
//
// The sign-up route is covered end to end by
// `guest-auth.sign-up-enumeration.spec.ts`; this file reaches the two hooks
// directly, because the reset one is the harder to prove from outside and the
// easier to forget. `/request-password-reset` answers an address nobody holds
// and an address somebody holds identically — and only the second has a
// message to send, so an awaited send there is the same oracle sign-up had.
//
// No database is touched: `betterAuth` builds its adapter lazily and the hooks
// are called as the library would call them, with the user and the link.

import "reflect-metadata";

import { getIp } from "better-auth/api";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "../../../config/env.js";
import type { Database } from "../../../database/database.module.js";
import type { MailQueue } from "../../notification/mail-queue.service.js";
import { createGuestAuth } from "./guest-auth.factory.js";

const A_GUEST = {
  id: "guest-id",
  email: "khach@example.test",
  name: "Anh Nguyễn",
  emailVerified: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const A_LINK = "https://mariva.test/api/auth/verify-email?token=secret-token";

const env = {
  NODE_ENV: "test",
  API_URL: "https://api.mariva.test",
  WEB_ORIGIN: "https://mariva.test",
  BETTER_AUTH_SECRET: "0".repeat(32),
} as Env;

function authWith(mail: { enqueue: ReturnType<typeof vi.fn> }) {
  return createGuestAuth({
    db: {} as Database,
    env,
    mail: mail as unknown as MailQueue,
  });
}

/** The realm as a deployment configures it, behind a named edge. */
function authBehind(header: string | undefined) {
  return createGuestAuth({
    db: {} as Database,
    env: { ...env, TRUSTED_CLIENT_IP_HEADER: header },
    mail: { enqueue: async () => {} } as unknown as MailQueue,
  });
}

/** A credential attempt, carrying whatever headers the caller chose to send. */
function attempt(headers: Record<string, string>): Request {
  return new Request("https://api.mariva.test/api/auth/sign-up/email", {
    method: "POST",
    headers,
  });
}

describe("the emails this realm sends", () => {
  it("hands the verification message to the queue rather than sending it", async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const auth = authWith({ enqueue });

    await auth.options.emailVerification.sendVerificationEmail({
      user: A_GUEST,
      url: A_LINK,
      token: "secret-token",
    });

    expect(
      enqueue,
      "The verification email is no longer queued. Awaiting the send inside " +
        "sign-up makes a request for an unregistered address take a mail " +
        "vendor's round trip longer than one for a registered address, and " +
        "that difference is an account-existence oracle.",
    ).toHaveBeenCalledTimes(1);

    const message = enqueue.mock.calls[0]![0];

    expect(message.to).toBe(A_GUEST.email);
    expect(message.text).toContain(A_LINK);
    expect(message.html).toContain(A_LINK);
  });

  it("hands the password reset message to the queue too", async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const auth = authWith({ enqueue });

    await auth.options.emailAndPassword.sendResetPassword({
      user: A_GUEST,
      url: A_LINK,
      token: "secret-token",
    });

    expect(
      enqueue,
      "The password reset email is no longer queued. The reset route answers " +
        "an unknown address and a registered one the same way, so the only " +
        "thing left to tell them apart is how long the one with a message to " +
        "send took.",
    ).toHaveBeenCalledTimes(1);

    expect(enqueue.mock.calls[0]![0].to).toBe(A_GUEST.email);
  });
});

// Whose quota an attempt spends.
//
// Better Auth resolves this from headers and never from the socket, so nothing
// Express is told about proxies reaches it — `main.ts`'s `trust proxy 1`
// protects `request.ip`, which is what the hold limiter keys on, and this realm
// is not on that path. Left to its default the library reads `x-forwarded-for`
// exactly as sent, so the bucket an attempt lands in is a value the caller
// picked. These are about the deployment that names its edge instead.
describe("the address the guest realm rate-limits on", () => {
  const SPOOFED = "203.0.113.7";
  const ALSO_SPOOFED = "198.51.100.4";
  const FROM_THE_EDGE = "192.0.2.55";

  it("ignores an address the caller wrote for themselves", () => {
    const auth = authBehind("fly-client-ip");

    expect(
      getIp(attempt({ "x-forwarded-for": SPOOFED }), auth.options),
      "The realm is reading an address out of a header the caller controls. " +
        "Every attempt can then name a fresh one, and the five-a-minute floor " +
        "on the credential routes stops holding anybody.",
    ).not.toBe(SPOOFED);
  });

  it("gives two forged addresses one quota rather than two", () => {
    const auth = authBehind("fly-client-ip");

    // The bucket key is the resolved address, so an attempt that resolves to no
    // address shares a bucket with every other one that does. Rotating the
    // header buys no room — the whole property, stated the way an attacker
    // would test it, and stated as an equality because what the two resolve to
    // differs by environment: a deployed process has nothing to fall back on,
    // and under the test runner the library substitutes localhost for both.
    expect(getIp(attempt({ "x-forwarded-for": SPOOFED }), auth.options)).toBe(
      getIp(attempt({ "x-forwarded-for": ALSO_SPOOFED }), auth.options),
    );
  });

  it("reads the address the named edge wrote, even beside a forged one", () => {
    const auth = authBehind("fly-client-ip");

    expect(
      getIp(
        attempt({
          "fly-client-ip": FROM_THE_EDGE,
          "x-forwarded-for": SPOOFED,
        }),
        auth.options,
      ),
    ).toBe(FROM_THE_EDGE);
  });

  it("keeps the library's own default where no edge is named", () => {
    // Development and CI. Nothing is in front, so there is no header with more
    // standing than another — and this is the behaviour a developer already
    // had, kept rather than traded for the strict one.
    const auth = authBehind(undefined);

    expect(getIp(attempt({ "x-forwarded-for": SPOOFED }), auth.options)).toBe(
      SPOOFED,
    );
  });
});
