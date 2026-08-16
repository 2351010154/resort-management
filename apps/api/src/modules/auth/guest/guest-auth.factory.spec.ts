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

  // Better Auth 1.6.25 has no hook of its own for the one-step change-email
  // message: `/change-email` mints a token that says what it is for and hands
  // it to `sendVerificationEmail`, the same hook sign-up uses. So which of the
  // two wordings a guest receives is decided from the token, and these are
  // about that decision rather than about the templates, which
  // `guest-auth-emails.spec.ts` covers.
  //
  // The tokens are built here rather than minted by the library, because the
  // claim is "this payload produces that wording" and a real token would put a
  // running Better Auth between the two.
  it("sends the change-email wording for a token that moves an address", async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const auth = authWith({ enqueue });

    await auth.options.emailVerification.sendVerificationEmail({
      // The address Better Auth hands over for a change is the new one, not
      // the one the guest still signs in with.
      user: { ...A_GUEST, email: "moved-to@example.test" },
      url: A_LINK,
      token: tokenClaiming({
        email: A_GUEST.email,
        updateTo: "moved-to@example.test",
        requestType: "change-email-verification",
      }),
    });

    const message = enqueue.mock.calls[0]![0];

    expect(
      message.subject,
      "A guest moving their address was sent the sign-up wording. It tells " +
        "somebody whose account has worked for a year that it is nearly ready, " +
        "which reads as a phishing attempt and gets the real link ignored.",
    ).toContain("new email");

    expect(message.to).toBe("moved-to@example.test");
  });

  it("keeps the sign-up wording for an ordinary verification token", async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const auth = authWith({ enqueue });

    await auth.options.emailVerification.sendVerificationEmail({
      user: A_GUEST,
      url: A_LINK,
      token: tokenClaiming({ email: A_GUEST.email }),
    });

    expect(enqueue.mock.calls[0]![0].subject).toBe("Confirm your email — Mariva");
  });

  it("keeps the sign-up wording for a token it cannot read at all", async () => {
    // Nothing decides anything on this payload except the wording, so an
    // unreadable one has to land somewhere rather than throw inside a send.
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const auth = authWith({ enqueue });

    await auth.options.emailVerification.sendVerificationEmail({
      user: A_GUEST,
      url: A_LINK,
      token: "not.a.token",
    });

    expect(enqueue.mock.calls[0]![0].subject).toBe("Confirm your email — Mariva");
  });
});

describe("the guest realm's email change", () => {
  it("is enabled, and moves no address before the link is used", () => {
    const auth = authWith({ enqueue: vi.fn() });

    expect(auth.options.user.changeEmail.enabled).toBe(true);

    // Nothing else is set, and the two absences are the flow. Without
    // `sendChangeEmailConfirmation` this library version sends one link to the
    // address being proved rather than two messages starting at the old one,
    // and without `updateEmailWithoutVerification` an account whose address is
    // unproven cannot move it with no proof at all.
    expect(Object.keys(auth.options.user.changeEmail)).toEqual(["enabled"]);
  });
});

/** A verification token's payload, in the shape Better Auth signs. Only the
 *  payload segment is read, so the signature is left off. */
function tokenClaiming(claims: Record<string, string>): string {
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString(
    "base64url",
  );

  return `eyJhbGciOiJIUzI1NiJ9.${payload}.`;
}

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
