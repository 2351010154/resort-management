// The presence limiter's own arithmetic, away from an HTTP stack.
//
// `guest-booking-token.e2e-spec.ts` proves the route works and is scoped to one
// stay. What only a unit test states cleanly is the part of this guard that is
// not the counting it shares with the hold's — that it counts by caller and not
// by stay, and that a caller past its allowance is refused with a status the
// funnel can drop rather than an error a screen would have to explain.

import "reflect-metadata";

import type { ExecutionContext } from "@nestjs/common";
import { HttpException, HttpStatus } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { PresenceRateLimitGuard } from "./presence-rate-limit.guard.js";

const WINDOW_MS = 60_000;

function guard(limit = 2): PresenceRateLimitGuard {
  return new PresenceRateLimitGuard({ limit, windowMs: WINDOW_MS });
}

function from(ip: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ ip, socket: {} }) }),
  } as unknown as ExecutionContext;
}

/** How many of these pings the guard let through. */
function allowed(subject: PresenceRateLimitGuard, ips: string[]): number {
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

describe("the presence rate limit", () => {
  it("lets a caller ping its allowance and refuses the next", () => {
    expect(allowed(guard(2), Array(3).fill("203.0.113.30"))).toBe(2);
  });

  it("counts refusals against the window rather than resetting it", () => {
    // The same property the hold's limiter has, and it matters more here: this
    // route is called on a timer, so a limiter that reset on its own refusal
    // would let every second ping through forever.
    expect(allowed(guard(1), Array(6).fill("203.0.113.31"))).toBe(1);
  });

  it("counts by caller and not by the stay being pinged", () => {
    // Both the caps and both limiters agree about who a caller is —
    // `caller-key.ts` is the one definition — so a household behind one address
    // is one window whichever of its holds is being kept alive.
    expect(allowed(guard(1), ["203.0.113.32", "203.0.113.33"])).toBe(2);
  });

  it("counts a v6 prefix as the one caller it is", () => {
    // An allowance of one against two addresses in the same /64, so the figure
    // only comes out at one if the two shared a window. Stated at the limit
    // rather than under it: two pings under an allowance of two pass whether the
    // prefix grouped them or not, which is a case that cannot fail.
    expect(allowed(guard(1), ["2001:db8:9:9:aaaa::1", "2001:db8:9:9:bbbb::2"]))
      .toBe(1);
  });

  it("refuses with a status the funnel can drop, and no instruction in it", () => {
    const subject = guard(1);
    const caller = "203.0.113.34";

    subject.canActivate(from(caller));

    try {
      subject.canActivate(from(caller));
    } catch (error) {
      const refusal = error as HttpException;

      expect(refusal.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      // No wait is named, unlike the three refusals on the hold's door. Nobody
      // reads this one — the funnel sends it in the background and drops the
      // answer — so a sentence telling somebody to wait would be addressed to no
      // one, and the grace is what absorbs the missing pings.
      expect(refusal.message).not.toMatch(/wait|minute/i);

      return;
    }

    throw new Error(`${caller} was not refused`);
  });
});
