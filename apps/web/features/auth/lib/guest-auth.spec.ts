import { afterEach, describe, expect, it, vi } from "vitest";
import { resendVerificationEmail, signUpWithEmail } from "./guest-auth";

/**
 * What a sign-up promises a guest who booked without an account.
 *
 * The account is the easy half. The hard half is that the stay they made before
 * they had one is filed under nobody, and the only moment it can be attached is
 * the moment the session first exists — which, for a guest confirming an
 * address, is the redirect at the end of the emailed link. So what these tests
 * hold is the one thing the sign-up call decides about that stay: where the
 * verification returns the browser. Get it wrong and the guest is confirmed,
 * signed in, and standing somewhere their booking is not.
 *
 * The booking id in that return address is not a credential and is not treated
 * as one anywhere here. The attach is refused unless the booking cookie on the
 * request names the same stay — `guest-attach.controller.ts` compares the two —
 * so what these assertions are about is a URL surviving a round trip, not a
 * secret being handled.
 */

const ORIGIN = "https://mariva.example";
const STAY = "0f8fad5b-d9cb-469f-a165-70867728950e";

const CREDENTIALS = {
  name: "Mai Tran",
  email: "mai@example.com",
  password: "a much longer secret",
} as const;

/** The bodies these calls put on the wire, caught on their way out. */
function serving(status = 200): Record<string, unknown>[] {
  const sent: Record<string, unknown>[] = [];

  // These calls read `window.location.origin` to build a return address the
  // API will check against `trustedOrigins`. The specs run in Node, where the
  // browser they are written for does not exist.
  vi.stubGlobal("window", { location: { origin: ORIGIN } });

  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)) as Record<string, unknown>);

    return new Response("{}", {
      status,
      headers: { "content-type": "application/json" },
    });
  });

  return sent;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("signing up with a stay to keep", () => {
  it("returns the verified guest to the attach rather than to a notice", async () => {
    const sent = serving();

    await signUpWithEmail({ ...CREDENTIALS, claiming: STAY });

    const returned = new URL(String(sent[0]!.callbackURL));

    // The log-in screen's attach-on-arrival address — the same one Google's
    // round trip already comes back to, and the reason there is no second
    // attach anywhere in this flow.
    expect(returned.origin).toBe(ORIGIN);
    expect(returned.pathname).toBe("/login");
    expect(returned.searchParams.get("attach")).toBe(STAY);
  });

  // The stay is not part of the account. It exists to shape the return address
  // and must not be posted as a field of a guest — Better Auth would either
  // refuse the extra property or store it, and neither is wanted.
  it("sends the account and nothing else about the booking", async () => {
    const sent = serving();

    await signUpWithEmail({ ...CREDENTIALS, claiming: STAY });

    expect(Object.keys(sent[0]!).sort()).toEqual([
      "callbackURL",
      "email",
      "name",
      "password",
    ]);
  });

  // The id arrives from a query string this app did not mint. Encoded, so the
  // worst a crafted one can do is name a stay the cookie does not prove, which
  // is a refusal the log-in screen already renders.
  it("keeps a crafted id inside its own parameter", async () => {
    const sent = serving();
    const crafted = "not-an-id&error=denied";

    await signUpWithEmail({ ...CREDENTIALS, claiming: crafted });

    const returned = new URL(String(sent[0]!.callbackURL));

    expect(returned.searchParams.get("attach")).toBe(crafted);
    expect(returned.searchParams.get("error")).toBeNull();
  });
});

describe("signing up with no stay", () => {
  it("is the call it has always been", async () => {
    const sent = serving();

    await signUpWithEmail(CREDENTIALS);

    expect(sent[0]).toEqual({
      ...CREDENTIALS,
      callbackURL: `${ORIGIN}/verify-email?confirmed=1`,
    });
  });

  it("is that same call when the parameter is present but empty", async () => {
    const sent = serving();

    await signUpWithEmail({ ...CREDENTIALS, claiming: null });

    expect(sent[0]!.callbackURL).toBe(`${ORIGIN}/verify-email?confirmed=1`);
  });
});

/**
 * The second message, which is the whole reason the stay is carried as far as
 * the confirmation screen.
 *
 * A guest presses this because the first message never arrived — which is also
 * the failure that sent them to `/signup` rather than to their booking. A
 * replacement built without the stay would confirm the address and leave the
 * booking exactly as unclaimed as it was.
 */
describe("sending the confirmation again", () => {
  it("mints a link that returns to the attach when a stay is being kept", async () => {
    const sent = serving();

    await resendVerificationEmail(CREDENTIALS.email, STAY);

    expect(sent[0]!.callbackURL).toBe(`${ORIGIN}/login?attach=${STAY}`);
  });

  it("returns to the notice when there is no stay", async () => {
    const sent = serving();

    await resendVerificationEmail(CREDENTIALS.email);

    expect(sent[0]).toEqual({
      email: CREDENTIALS.email,
      callbackURL: `${ORIGIN}/verify-email?confirmed=1`,
    });
  });
});
