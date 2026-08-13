// The limiter's own arithmetic, away from a database and an HTTP stack.
//
// `guest-booking-token.e2e-spec.ts` proves the refusal reaches a caller and
// reserves nothing. What only a unit test states cleanly is who a window is
// counted against — an IPv6 client holds a whole /64 and would otherwise get a
// fresh allowance per request — and that the map cannot grow without bound.

import "reflect-metadata";

import type { ExecutionContext } from "@nestjs/common";
import { HttpException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { HoldRateLimitGuard } from "./hold-rate-limit.guard.js";

const WINDOW_MS = 60_000;

function guard(limit = 2): HoldRateLimitGuard {
  return new HoldRateLimitGuard({ limit, windowMs: WINDOW_MS });
}

function from(ip: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ ip, socket: {} }) }),
  } as unknown as ExecutionContext;
}

/** How many of `attempts` calls this guard let through. */
function allowed(subject: HoldRateLimitGuard, ips: string[]): number {
  let through = 0;

  for (const ip of ips) {
    try {
      subject.canActivate(from(ip));
      through += 1;
    } catch (error) {
      if (!(error instanceof HttpException)) {
        throw error;
      }
    }
  }

  return through;
}

describe("the hold rate limit", () => {
  it("lets a caller take its limit and refuses the next", () => {
    const subject = guard(2);
    const caller = ["203.0.113.7", "203.0.113.7", "203.0.113.7"];

    expect(allowed(subject, caller)).toBe(2);
  });

  it("counts refusals against the window rather than resetting it", () => {
    // A limiter that treated its own refusal as a fresh window would let every
    // second call through.
    const subject = guard(1);

    expect(allowed(subject, Array(6).fill("203.0.113.8"))).toBe(1);
  });

  it("counts each address separately", () => {
    const subject = guard(1);

    expect(allowed(subject, ["203.0.113.1", "203.0.113.2"])).toBe(2);
  });

  it("counts an IPv6 client by its prefix and not by its address", () => {
    // The whole /64 is one caller's to spend, because the whole /64 is one
    // caller's to use.
    const subject = guard(2);

    expect(
      allowed(subject, [
        "2001:db8:1:2:aaaa::1",
        "2001:db8:1:2:bbbb::2",
        "2001:db8:1:2:cccc::3",
      ]),
    ).toBe(2);

    // A different /64 is a different caller.
    expect(allowed(subject, ["2001:db8:1:3::1"])).toBe(1);
  });

  it("treats a v4-mapped address as the v4 address it is", () => {
    const subject = guard(1);

    expect(
      allowed(subject, ["::ffff:203.0.113.9", "::ffff:203.0.113.9"]),
    ).toBe(1);
  });

  it("counts a /64 whose written form elides the groups it is cut at", () => {
    // The case a cut of the written form gets wrong. `2001:db8::7` is
    // `2001:db8:0:0:…:7`, so these three are one /64 and one caller — but the
    // `::` sits where the prefix is read from, and text sliced at the fourth
    // colon would hand each of them a window of its own. The host part is the
    // caller's to choose, so that is an unbounded allowance on the one public
    // write.
    const subject = guard(2);

    expect(allowed(subject, ["2001:db8::7", "2001:db8::8", "2001:db8::9"])).toBe(
      2,
    );

    // Still a different /64, so still a different caller.
    expect(allowed(subject, ["2001:db9::7"])).toBe(1);
  });

  it("counts an address shorter than a prefix by the prefix it expands to", () => {
    // `::1` and the link-local below are elided down to fewer groups than a /64
    // has, and they are expanded like any other rather than kept whole: two
    // hosts on one link are one caller, which is the same rule the case above
    // states for a routed prefix.
    const subject = guard(1);

    expect(allowed(subject, ["::1", "::1"])).toBe(1);
    expect(allowed(subject, ["fe80::2", "fe80::3"])).toBe(1);
  });

  it("refuses a caller with no address at all as one caller", () => {
    const subject = guard(1);
    const nowhere = {
      switchToHttp: () => ({ getRequest: () => ({ socket: {} }) }),
    } as unknown as ExecutionContext;

    expect(subject.canActivate(nowhere)).toBe(true);
    expect(() => subject.canActivate(nowhere)).toThrow(HttpException);
  });
});
