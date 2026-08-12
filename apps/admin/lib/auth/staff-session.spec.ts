/* What `withStaffSession` does around a call, proved without a network.
 *
 * The wrapper is the only place in the console that recovers from a 401, and
 * the recovery is the difference between a session that survives a working day
 * and one that drops the operator at an arbitrary moment. It reads the module
 * singleton rather than taking a store, so the transport underneath it is
 * mocked and the module is loaded fresh per test — a store carried between
 * tests would be a session carried between them.
 */

import type { StaffSession } from "@mariva/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({
  signIn: vi.fn<() => Promise<StaffSession>>(),
  refresh: vi.fn<() => Promise<StaffSession>>(),
  signOut: vi.fn<() => Promise<void>>(),
}));

vi.mock("./staff-auth-requests", () => ({
  requestStaffSignIn: () => transport.signIn(),
  requestStaffRefresh: () => transport.refresh(),
  requestStaffSignOut: () => transport.signOut(),
}));

// The contract client is built at module scope and never called here. Mocked so
// loading the session does not construct an oRPC client for nobody.
vi.mock("@mariva/api-client", () => ({
  createApiClient: () => ({}),
}));

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

const unauthorized = Object.assign(new Error("401"), { status: 401 });

/** The session module, freshly evaluated. `window` is stubbed first because the
 *  module picks its transport on whether there is one — a Node render gets a
 *  transport that refuses, which is the guard being tested by its absence
 *  here. */
async function loadSession() {
  vi.resetModules();
  vi.stubGlobal("window", {});

  return import("./staff-session");
}

/** A store already holding a good token, so a test can start where a signed-in
 *  operator does. */
async function signedIn() {
  const module = await loadSession();

  transport.signIn.mockResolvedValueOnce(session("first"));
  await module.staffSession.signIn({
    email: "receptionist@mariva.test",
    password: "x",
  });

  return module;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-15T08:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  transport.signIn.mockReset();
  transport.refresh.mockReset();
  transport.signOut.mockReset();
});

describe("isUnauthorized", () => {
  it("recognises the one fact it needs, however the client spells it", async () => {
    const { isUnauthorized } = await loadSession();

    expect(isUnauthorized({ status: 401 })).toBe(true);
    expect(
      isUnauthorized(Object.assign(new Error("no"), { status: 401 })),
    ).toBe(true);
    expect(isUnauthorized({ status: 403 })).toBe(false);
    expect(isUnauthorized(new Error("network"))).toBe(false);
    expect(isUnauthorized(null)).toBe(false);
    expect(isUnauthorized("401")).toBe(false);
  });
});

describe("withStaffSession", () => {
  it("leaves a token with time to spare alone", async () => {
    const { staffSession, withStaffSession } = await signedIn();

    await expect(withStaffSession(() => Promise.resolve("done"))).resolves.toBe(
      "done",
    );

    expect(transport.refresh).not.toHaveBeenCalled();
    expect(staffSession.token()).toBe("first");
  });

  it("replaces a token inside its margin before the request leaves", async () => {
    const { staffSession, withStaffSession } = await signedIn();

    vi.advanceTimersByTime(ACCESS_TOKEN_TTL_SECONDS * 1000 - 30_000);
    transport.refresh.mockResolvedValueOnce(session("second"));

    const seen: (string | null)[] = [];

    await withStaffSession(() => {
      seen.push(staffSession.token());
      return Promise.resolve("done");
    });

    // Asserted from inside the call: the point of refreshing first is that the
    // request carries the new token, not that a new one exists afterwards.
    expect(seen).toEqual(["second"]);
    expect(transport.refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes once and retries the call after a 401", async () => {
    const { staffSession, withStaffSession } = await signedIn();

    transport.refresh.mockResolvedValueOnce(session("second"));

    const tokens: (string | null)[] = [];
    let attempts = 0;

    const result = await withStaffSession(() => {
      attempts += 1;
      tokens.push(staffSession.token());

      return attempts === 1
        ? Promise.reject(unauthorized)
        : Promise.resolve("done");
    });

    expect(result).toBe("done");
    expect(attempts).toBe(2);
    expect(tokens).toEqual(["first", "second"]);
  });

  it("does not retry a second time when the fresh token is refused too", async () => {
    const { withStaffSession } = await signedIn();

    transport.refresh.mockResolvedValueOnce(session("second"));

    let attempts = 0;

    await expect(
      withStaffSession(() => {
        attempts += 1;
        return Promise.reject(unauthorized);
      }),
    ).rejects.toBe(unauthorized);

    // Twice and not a third time: a 401 that survives a new token is the API
    // saying no about something no further token fixes.
    expect(attempts).toBe(2);
    expect(transport.refresh).toHaveBeenCalledTimes(1);
  });

  it("does not touch the session for a failure that is not a 401", async () => {
    const { withStaffSession } = await signedIn();

    const failure = Object.assign(new Error("gone"), { status: 500 });
    let attempts = 0;

    await expect(
      withStaffSession(() => {
        attempts += 1;
        return Promise.reject(failure);
      }),
    ).rejects.toBe(failure);

    expect(attempts).toBe(1);
    expect(transport.refresh).not.toHaveBeenCalled();
  });

  it("gives the caller the original refusal when the session cannot be recovered", async () => {
    const { staffSession, withStaffSession } = await signedIn();

    transport.refresh.mockRejectedValueOnce(
      Object.assign(new Error("refused"), { kind: "refused" }),
    );

    await expect(
      withStaffSession(() => Promise.reject(unauthorized)),
    ).rejects.toBe(unauthorized);

    expect(staffSession.getState()).toEqual({ status: "anonymous" });
  });
});
