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
// **The counting itself is `caller-windows.ts`'s**, shared with the presence
// route's own limiter — including the fact that it is in memory, which is correct
// for one instance and wrong for two. What stays here is the policy this door
// takes and the sentence it refuses with, which are the two things about a limit
// that are not arithmetic.
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
import { type CallerRatePolicy, CallerWindows } from "./caller-windows.js";

/** How many holds one address may take, and over what. */
export type HoldRateLimitPolicy = CallerRatePolicy;

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
 * A wait, in the words a refusal names it in.
 *
 * All three 429s on this route quote a figure the property configures — the
 * window below, and `BOOKING_HOLD_TTL_MINUTES` for the two caps in
 * `booking.service.ts`, which is why this is exported and imported there rather
 * than written out twice. A property is free to set either to one, and
 * "1 minutes" is the kind of sentence a guest notices instead of the
 * instruction inside it.
 *
 * Rounded up, always. A wait quoted shorter than it is sends the guest back to
 * the refusal they were told they had already waited out.
 */
export function minutesInWords(minutes: number): string {
  const whole = Math.max(1, Math.ceil(minutes));

  return whole === 1 ? "a minute" : `${whole} minutes`;
}

@Injectable()
export class HoldRateLimitGuard implements CanActivate {
  private readonly windows: CallerWindows;

  constructor(
    @Inject(HOLD_RATE_LIMIT_POLICY)
    private readonly policy: HoldRateLimitPolicy,
  ) {
    this.windows = new CallerWindows(policy);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const caller = callerOf(request.ip ?? request.socket.remoteAddress);

    if (this.windows.admits(caller)) {
      return true;
    }

    // 429 and a sentence a person could act on. The reply says nothing about
    // the property's inventory, because a refused call never looked at any.
    //
    // **It says requests and not rooms, and the difference is not pedantry.**
    // This counts asking, including the asks the caps downstream refused — the
    // case `hold-rate-limit.guard.spec.ts` holds it to — so the caller most
    // likely to arrive here is one whose earlier attempts were all turned down
    // and who has therefore held nothing at all. "Too many rooms held from
    // here" told that person about rooms that do not exist.
    //
    // **And it names the wait rather than gesturing at one.** The window is
    // fixed, so it reopens `windowMs` after it started and waiting the whole
    // of it always works; "a few minutes" against a ten-minute window is an
    // instruction that sends the guest back to this same sentence.
    throw new HttpException(
      `Too many attempts to hold a room from here. Wait ${minutesInWords(
        this.policy.windowMs / 60_000,
      )} and try again.`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
