import { describe, expect, it } from "vitest";

import { apiMessage, apiStatus, runCallsThrough } from "./api";

/* `runCallsThrough` is checked against a stand-in client rather than the real
 * one, because what it has to get right is structural: an oRPC client is itself
 * a proxy, so the only way to assert "the nesting survived and the call went
 * through the runner" is to hold both ends. */
describe("runCallsThrough", () => {
  const client = {
    housekeeping: {
      board: (input: { day: string }) => Promise.resolve(`board:${input.day}`),
    },
  };

  it("reaches a nested procedure and returns what it resolved with", async () => {
    const guarded = runCallsThrough(client, (call) => call());

    await expect(
      guarded.housekeeping.board({ day: "2026-08-16" }),
    ).resolves.toBe("board:2026-08-16");
  });

  it("runs every call inside the runner", async () => {
    const around: string[] = [];

    const guarded = runCallsThrough(client, async (call) => {
      around.push("before");
      const result = await call();
      around.push("after");

      return result;
    });

    await guarded.housekeeping.board({ day: "2026-08-16" });

    expect(around).toEqual(["before", "after"]);
  });

  it("lets the runner replace a refused call, which is how a token is renewed", async () => {
    let attempts = 0;

    const flaky = {
      housekeeping: {
        board: () => {
          attempts += 1;

          return attempts === 1
            ? Promise.reject({ status: 401 })
            : Promise.resolve("board");
        },
      },
    };

    const guarded = runCallsThrough(flaky, async (call) => {
      try {
        return await call();
      } catch {
        return call();
      }
    });

    await expect(guarded.housekeeping.board()).resolves.toBe("board");
    expect(attempts).toBe(2);
  });

  it("propagates a failure the runner did not absorb", async () => {
    const guarded = runCallsThrough(
      {
        housekeeping: {
          board: () => Promise.reject(new Error("the API is not up")),
        },
      },
      (call) => call(),
    );

    await expect(guarded.housekeeping.board()).rejects.toThrow(
      "the API is not up",
    );
  });

  it("is not mistaken for a promise", async () => {
    const guarded = runCallsThrough(client, (call) => call());

    // Awaiting the client itself must resolve to the client. A proxy that
    // answered `then` with another callable proxy would be treated as a
    // thenable, called with the resolver, and never settle.
    await expect(Promise.resolve(guarded)).resolves.toBe(guarded);
  });
});

describe("apiStatus", () => {
  it("reads the status oRPC carries on a refusal", () => {
    expect(apiStatus({ status: 409, message: "the hold has expired" })).toBe(
      409,
    );
  });

  it("answers null when nothing answered at all", () => {
    expect(apiStatus(new TypeError("Failed to fetch"))).toBeNull();
    expect(apiStatus("offline")).toBeNull();
    expect(apiStatus(null)).toBeNull();
  });
});

describe("apiMessage", () => {
  it("prefers the sentence the handler wrote", () => {
    expect(apiMessage({ message: "the hold has expired" }, "fallback")).toBe(
      "the hold has expired",
    );
  });

  it("falls back when the failure carries no sentence to read", () => {
    expect(apiMessage({ message: "   " }, "fallback")).toBe("fallback");
    expect(apiMessage({ message: 500 }, "fallback")).toBe("fallback");
    expect(apiMessage(undefined, "fallback")).toBe("fallback");
  });
});
