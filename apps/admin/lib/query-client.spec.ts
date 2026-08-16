import { describe, expect, it } from "vitest";

import {
  createQueryClient,
  DEFAULT_STALE_TIME_MS,
  isWorthRetrying,
} from "./query-client";

describe("isWorthRetrying", () => {
  it("re-asks when nothing answered — a dropped connection, an API mid-restart", () => {
    expect(isWorthRetrying(0, new TypeError("Failed to fetch"))).toBe(true);
    expect(isWorthRetrying(0, { status: 502 })).toBe(true);
  });

  it("does not re-ask a question the API already answered", () => {
    // A refusal, a missing capability, a row that is gone, a state that has
    // moved on. Asking again produces the same answer several seconds later.
    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(isWorthRetrying(0, { status })).toBe(false);
    }
  });

  it("gives up rather than retrying without end", () => {
    expect(isWorthRetrying(1, { status: 500 })).toBe(true);
    expect(isWorthRetrying(2, { status: 500 })).toBe(false);
  });
});

describe("createQueryClient", () => {
  it("gives every screen the same caching and retry policy", () => {
    const defaults = createQueryClient().getDefaultOptions();

    expect(defaults.queries?.staleTime).toBe(DEFAULT_STALE_TIME_MS);
    expect(defaults.queries?.retry).toBe(isWorthRetrying);
    expect(defaults.queries?.refetchOnWindowFocus).toBe(true);
  });

  it("never retries a write on its own", () => {
    expect(createQueryClient().getDefaultOptions().mutations?.retry).toBe(
      false,
    );
  });

  it("is a new cache per call, so a server render cannot share one operator's answers", () => {
    expect(createQueryClient()).not.toBe(createQueryClient());
  });
});
