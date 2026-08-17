import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type ConsoleMeta,
  createQueryClient,
  DEFAULT_STALE_TIME_MS,
  isWorthRetrying,
} from "./query-client";

/* The toast is the one thing these handlers do, so it is the one thing stood
 * in for: `sonner` renders into a tree there is no browser for here, and what
 * has to be proved is which failures reach it and which do not. Everything
 * else below is the real cache running a real failing query. */
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

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

/* The floor, and the one door through it. Run against the real cache — a
 * genuinely rejected query on a real client — because what is being asserted is
 * the handler's own reading of `meta`, and a hand-called `onError` would prove
 * only that this spec can call a function. */
describe("the central failure report", () => {
  const refused = { status: 404, message: "No account has been opened." };

  beforeEach(() => {
    vi.mocked(toast.error).mockClear();
  });

  /* One failing read, awaited to the point where the cache has reported it.
   * `meta` is taken as the free-form record TanStack declares and the console's
   * shape is asserted at the call, which is how a screen writes one. */
  async function failOneQuery(meta?: Record<string, unknown>): Promise<void> {
    await createQueryClient()
      .fetchQuery({
        queryKey: ["a-read-that-fails"],
        queryFn: () => Promise.reject(refused),
        meta,
      })
      .catch(() => undefined);
  }

  it("tells the operator when a read fails, in the API's own words", async () => {
    await failOneQuery({
      errorMessage: "Today's arrivals could not be loaded.",
    } satisfies ConsoleMeta);

    expect(toast.error).toHaveBeenCalledWith(
      refused.message,
      expect.anything(),
    );
  });

  it("still tells them when the read said nothing about itself", async () => {
    await failOneQuery();

    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("says nothing when the screen draws the failure where the operator is", async () => {
    await failOneQuery({ rendersFailureInline: true } satisfies ConsoleMeta);

    expect(toast.error).not.toHaveBeenCalled();
  });

  it("asks for that silence exactly, so a value that is merely truthy does not buy it", async () => {
    // `meta` is a free-form record: the console's shape is a convention the
    // compiler does not hold a caller to, and a stray value must fall back to
    // reporting rather than to hiding.
    await failOneQuery({ rendersFailureInline: "yes" });

    expect(toast.error).toHaveBeenCalledTimes(1);
  });
});
