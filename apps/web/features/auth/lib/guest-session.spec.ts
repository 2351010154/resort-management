import { afterEach, describe, expect, it, vi } from "vitest";
import { readGuestSession } from "./guest-session";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reading the guest session for navigation", () => {
  it("returns the signed-in guest's identity", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              session: { id: "session-1" },
              user: { name: "Mai Tran", email: "mai@example.com" },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );

    await expect(readGuestSession()).resolves.toEqual({
      name: "Mai Tran",
      email: "mai@example.com",
    });
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:3001/api/auth/get-session",
      { credentials: "include" },
    );
  });

  it.each([
    ["a signed-out response", null],
    ["a malformed response", { user: { name: "Mai Tran" } }],
  ])("treats %s as no guest", async (_label, body) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    await expect(readGuestSession()).resolves.toBeNull();
  });

  it("keeps a failed session read out of the navigation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network unavailable");
      }),
    );

    await expect(readGuestSession()).resolves.toBeNull();
  });
});
