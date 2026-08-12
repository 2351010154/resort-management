import type { StaffSession } from "@mariva/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CREDENTIALS_REFUSED,
  createStaffSessionStore,
  needsRefresh,
  REFRESH_MARGIN_MS,
  refreshDelayMs,
  SIGN_IN_UNREACHABLE,
  type StaffAuthTransport,
} from "./staff-session-store";

const ACCESS_TOKEN_TTL_SECONDS = 30 * 60;

function session(accessToken: string): StaffSession {
  return {
    user: {
      id: "5b0f7c6a-8b1e-4a4b-9d51-2f3a6c7d8e90",
      email: "receptionist@mariva.test",
      fullName: "Nguyễn Thị Hạnh",
      role: "RECEPTIONIST",
    },
    accessToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  };
}

/** The API's refusal, as `staff-auth-requests.ts` throws it. Structural, which
 *  is the whole reason the store tests a `kind` rather than an instance. */
const refused = Object.assign(new Error("refused"), { kind: "refused" });

/** A transport whose refresh is resolved by the test, so two callers can be
 *  observed asking while one request is still in the air. */
function deferredTransport() {
  const calls: Array<{
    resolve: (value: StaffSession) => void;
    reject: (reason: unknown) => void;
  }> = [];

  const transport: StaffAuthTransport = {
    signIn: () => Promise.reject(new Error("not used")),
    refresh: () =>
      new Promise<StaffSession>((resolve, reject) => {
        calls.push({ resolve, reject });
      }),
    signOut: () => Promise.resolve(),
  };

  return { transport, calls };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-15T08:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("refresh timing", () => {
  it("renews a token one margin before it expires", () => {
    const now = Date.now();

    expect(refreshDelayMs(now + 30 * 60_000, now)).toBe(
      30 * 60_000 - REFRESH_MARGIN_MS,
    );
  });

  it("renews immediately when the margin has already been eaten", () => {
    const now = Date.now();

    // A laptop reopened after being asleep. The delay is clamped rather than
    // negative, and the decision below says the same thing.
    expect(refreshDelayMs(now - 5 * 60_000, now)).toBe(0);
    expect(needsRefresh(now - 5 * 60_000, now)).toBe(true);
  });

  it("leaves a token with time to spare alone", () => {
    const now = Date.now();

    expect(needsRefresh(now + REFRESH_MARGIN_MS + 1, now)).toBe(false);
    expect(needsRefresh(now + REFRESH_MARGIN_MS, now)).toBe(true);
  });
});

describe("ensureFresh", () => {
  it("does not spend the refresh cookie on a token that is still good", async () => {
    const { transport, calls } = deferredTransport();
    const store = createStaffSessionStore({
      ...transport,
      signIn: () => Promise.resolve(session("first")),
    });

    await store.signIn({ email: "a@mariva.test", password: "x" });
    vi.advanceTimersByTime(60_000);

    await store.ensureFresh();

    expect(calls).toHaveLength(0);
    expect(store.token()).toBe("first");
  });

  it("replaces a token that is inside its margin", async () => {
    const { transport, calls } = deferredTransport();
    const store = createStaffSessionStore({
      ...transport,
      signIn: () => Promise.resolve(session("first")),
    });

    await store.signIn({ email: "a@mariva.test", password: "x" });
    vi.advanceTimersByTime(ACCESS_TOKEN_TTL_SECONDS * 1000 - REFRESH_MARGIN_MS);

    const fresh = store.ensureFresh();
    expect(calls).toHaveLength(1);

    calls[0]?.resolve(session("second"));
    await fresh;

    expect(store.token()).toBe("second");
  });

  it("does not ask again once the cookie has already failed to produce a session", async () => {
    const { transport, calls } = deferredTransport();
    const store = createStaffSessionStore(transport);

    const first = store.refresh();
    calls[0]?.reject(refused);
    await first;

    await store.ensureFresh();
    await store.ensureFresh();

    expect(calls).toHaveLength(1);
    expect(store.getState()).toEqual({ status: "anonymous" });
  });
});

describe("refresh", () => {
  it("serves concurrent callers from one request", async () => {
    const { transport, calls } = deferredTransport();
    const store = createStaffSessionStore(transport);

    const first = store.refresh();
    const second = store.refresh();
    const third = store.ensureFresh();

    // The refresh token rotates on use, so a second request while the first is
    // in the air would be spending a token the API has already retired.
    expect(calls).toHaveLength(1);

    calls[0]?.resolve(session("shared"));
    const states = await Promise.all([first, second, third]);

    expect(states[0]).toBe(states[1]);
    expect(states[1]).toBe(states[2]);
    expect(store.token()).toBe("shared");
  });

  it("opens a new request once the shared one has settled", async () => {
    const { transport, calls } = deferredTransport();
    const store = createStaffSessionStore(transport);

    const first = store.refresh();
    calls[0]?.resolve(session("first"));
    await first;

    const second = store.refresh();
    expect(calls).toHaveLength(2);

    calls[1]?.resolve(session("second"));
    await second;

    expect(store.token()).toBe("second");
  });

  it("ends the session on a failure rather than retrying it", async () => {
    const { transport, calls } = deferredTransport();
    const store = createStaffSessionStore(transport);

    const attempt = store.refresh();
    calls[0]?.reject(refused);

    await expect(attempt).resolves.toEqual({ status: "anonymous" });
    expect(store.token()).toBeNull();
    expect(calls).toHaveLength(1);
  });
});

describe("signIn", () => {
  it("holds the token in memory and publishes the operator", async () => {
    const { transport } = deferredTransport();
    const seen: string[] = [];
    const store = createStaffSessionStore({
      ...transport,
      signIn: () => Promise.resolve(session("first")),
    });

    store.subscribe(() => {
      seen.push(store.getState().status);
    });

    const outcome = await store.signIn({
      email: "receptionist@mariva.test",
      password: "x",
    });

    expect(outcome).toMatchObject({ ok: true });
    expect(seen).toEqual(["authenticated"]);
    expect(store.getState()).toMatchObject({
      status: "authenticated",
      expiresAt: Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000,
    });
    expect(store.token()).toBe("first");
  });

  it("repeats the API's one answer for a refusal", async () => {
    const { transport } = deferredTransport();
    const store = createStaffSessionStore({
      ...transport,
      signIn: () => Promise.reject(refused),
    });

    await expect(
      store.signIn({ email: "a@mariva.test", password: "x" }),
    ).resolves.toEqual({ ok: false, message: CREDENTIALS_REFUSED });
  });

  it("distinguishes an API that did not answer from one that said no", async () => {
    const { transport } = deferredTransport();
    const store = createStaffSessionStore({
      ...transport,
      signIn: () =>
        Promise.reject(
          Object.assign(new Error("unreachable"), { kind: "unreachable" }),
        ),
    });

    await expect(
      store.signIn({ email: "a@mariva.test", password: "x" }),
    ).resolves.toEqual({ ok: false, message: SIGN_IN_UNREACHABLE });
  });
});

describe("signOut", () => {
  it("drops the token before it waits for the API", async () => {
    let revoked = false;
    const store = createStaffSessionStore({
      signIn: () => Promise.resolve(session("first")),
      refresh: () => Promise.reject(new Error("not used")),
      signOut: () => {
        // Asserted from inside the request: the operator is signed out of this
        // page from the moment they asked, whatever the network then does.
        expect(store.token()).toBeNull();
        revoked = true;
        return Promise.resolve();
      },
    });

    await store.signIn({ email: "a@mariva.test", password: "x" });
    await store.signOut();

    expect(revoked).toBe(true);
    expect(store.getState()).toEqual({ status: "anonymous" });
  });
});
