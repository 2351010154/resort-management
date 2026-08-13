// The one unauthenticated write in the application, held to a rate.
//
// `booking.create-own` is public — `rbac-matrix.md` §3's second row — and
// unlike the search above it, it takes rooms off the shelf. Without a limit the
// public door is a way for one caller to hold the property empty for the length
// of a TTL, repeatedly, at no cost and with no account behind it. Everything
// else in this API either identifies its caller or changes nothing.
//
// **A guard and not a check inside the handler**, so a refused call has not
// priced a stay, has not consumed a night and has not spent a reference. The
// transaction the controller opens is downstream of this.
//
// **In memory, which is correct for one instance and wrong for two.** The
// counter lives in this process, so two Fly machines behind one hostname would
// each allow the full rate and the property would face twice the limit written
// here. That is the same caveat Better Auth's own limiter carries
// (`guest-auth.factory.ts`), and the same answer applies: it is honest at one
// instance, it is the deployment this milestone has, and the day a second
// machine is started the counter has to move to a shared store rather than
// being tuned down to compensate.
//
// It is also why this is a rate and not the whole answer. A limit that resets
// per process cannot bound how many rooms are held at one moment, so
// `booking.service.ts` bounds that in SQL — three live holds per caller — and
// keys it off the same {@link callerOf} this counts by. The two are one policy
// with one definition of a caller, and neither is a substitute for the other:
// this refuses a caller asking too often, that refuses a caller holding too
// much.
//
// **Who a caller is lives in `caller-key.ts`**, with the argument for the /64
// and for the proxy hop the address is read off.
//
// **Fixed windows, not a token bucket.** A window that resets lets a caller
// spend the whole allowance at the boundary and again immediately after, which
// is twice the rate for one moment. For a limit whose job is to stop sustained
// automated holds rather than to smooth traffic, that is an acceptable and
// well-understood edge; the alternative is per-caller timestamp lists, which is
// memory this guard would then have to bound.

import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";
import { callerOf } from "./caller-key.js";

/** How many holds one address may take, and over what. */
export interface HoldRateLimitPolicy {
  readonly limit: number;
  readonly windowMs: number;
}

/** Injected rather than read off a constant, so a test can state a small limit
 *  without taking thirty rooms off the shelf to prove the refusal. */
export const HOLD_RATE_LIMIT_POLICY = "mariva:hold-rate-limit";

/**
 * Thirty holds in ten minutes from one address.
 *
 * Far above a person — a guest takes one hold, occasionally two when they
 * change their mind about a room type — and far below what makes the door
 * useful to somebody automating it. Left generous on purpose: this is the only
 * limiter in front of the funnel, and a figure tight enough to catch a
 * determined script would also refuse a family sharing one hotel wifi.
 */
export const DEFAULT_HOLD_RATE_LIMIT: HoldRateLimitPolicy = {
  limit: 30,
  windowMs: 10 * 60_000,
};

/**
 * How many callers are tracked at once, and what happens past it.
 *
 * A hard ceiling and not only an expiry sweep. A caller cycling addresses —
 * which the grouping below makes expensive but not impossible — would otherwise
 * grow this map without bound, and a sweep that found every window fresh would
 * walk the whole thing on every request while freeing nothing. Past the ceiling
 * the expired entries go first and, if that frees none, the oldest window is
 * evicted: the caller it belonged to gets a fresh allowance, which is the safe
 * direction to fail for a limiter whose job is to make sustained automation
 * expensive rather than to be an authorisation decision.
 */
const TRACKED_CEILING = 10_000;

interface Window {
  count: number;
  startedAt: number;
}

@Injectable()
export class HoldRateLimitGuard implements CanActivate {
  private readonly windows = new Map<string, Window>();

  constructor(
    @Inject(HOLD_RATE_LIMIT_POLICY)
    private readonly policy: HoldRateLimitPolicy,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const caller = callerOf(request.ip ?? request.socket.remoteAddress);
    const now = Date.now();

    if (this.windows.size >= TRACKED_CEILING) {
      this.makeRoom(now);
    }

    const current = this.windows.get(caller);

    if (!current || now - current.startedAt >= this.policy.windowMs) {
      this.windows.set(caller, { count: 1, startedAt: now });

      return true;
    }

    current.count += 1;

    if (current.count > this.policy.limit) {
      // 429 and a sentence a person could act on. The reply says nothing about
      // the property's inventory, because a refused call never looked at any.
      throw new HttpException(
        "Too many rooms held from here. Wait a few minutes and try again.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  /** Expired windows first, then the oldest — see {@link TRACKED_CEILING}. */
  private makeRoom(now: number): void {
    let oldest: [string, Window] | undefined;

    for (const entry of this.windows) {
      if (now - entry[1].startedAt >= this.policy.windowMs) {
        this.windows.delete(entry[0]);

        continue;
      }

      if (!oldest || entry[1].startedAt < oldest[1].startedAt) {
        oldest = entry;
      }
    }

    if (this.windows.size >= TRACKED_CEILING && oldest) {
      this.windows.delete(oldest[0]);
    }
  }
}
