// The second limiter on the funnel's doors, in front of the cheapest write in
// the application.
//
// A funnel with a live hold says it is still open every twenty seconds, so this
// route takes more requests than every other route in this API put together and
// each one is a single `update` by primary key. It is limited for the reason any
// route reachable without an account is limited — a call that costs the property
// a row lock is still a call somebody can make in a loop — and not because the
// caller is suspected of anything.
//
// **Its own policy, and never the hold's.** Sharing `HoldRateLimitGuard` would
// spend the hold allowance on heartbeats: thirty requests in ten minutes is one
// funnel pinging for ten of them, after which the guest could not take a room.
// The two doors count different acts at different rates and each has to say so
// separately.
//
// **The counting is `caller-windows.ts`'s**, including the caveat that it lives
// in this process. Both limiters key on `caller-key.ts`, so "who asked" means the
// same thing here as it does at the hold cap.
//
// **What a refusal costs the guest is nothing they can see, and that is the
// point.** A ping that is refused is presence not recorded, and the grace in
// `env.ts` is generous against the interval precisely so that a handful of
// missing ones cannot cost anybody a room. So the sentence is short, the funnel
// swallows it, and nothing about it reaches a screen.

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

/** How often one address may say it is still there, and over what. */
export type PresenceRateLimitPolicy = CallerRatePolicy;

/** Injected for the reason the hold's policy is: a suite states a small figure
 *  rather than sending two hundred requests to prove the refusal. */
export const PRESENCE_RATE_LIMIT_POLICY = "mariva:presence-rate-limit";

/**
 * Two hundred pings in ten minutes from one address.
 *
 * The figure is derived from what an honest address can produce rather than
 * chosen for feel. A ping only happens on a live hold, and one address may hold
 * at most `CONCURRENT_HOLDS_PER_CALLER` rooms — three — so three funnels pinging
 * every twenty seconds for the whole window is ninety. The rest is headroom for
 * the pings a page sends when it is reloaded or brought back to the foreground,
 * which cluster exactly when a household on one router picks their phones up
 * again.
 *
 * Above that figure the caller is not a funnel, and the answer is a refusal that
 * changes nothing about their holds: the rooms they are actually holding still
 * run out their TTL, which is what the caps are for.
 */
export const DEFAULT_PRESENCE_RATE_LIMIT: PresenceRateLimitPolicy = {
  limit: 200,
  windowMs: 10 * 60_000,
};

@Injectable()
export class PresenceRateLimitGuard implements CanActivate {
  private readonly windows: CallerWindows;

  constructor(
    @Inject(PRESENCE_RATE_LIMIT_POLICY)
    policy: PresenceRateLimitPolicy,
  ) {
    this.windows = new CallerWindows(policy);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    if (this.windows.admits(callerOf(request.ip ?? request.socket.remoteAddress))) {
      return true;
    }

    // No wait is named, unlike the three refusals on the hold's door. Those are
    // read by a guest standing in front of a room they wanted; this one is read
    // by nobody at all — the funnel sends it in the background and drops the
    // answer — so a sentence instructing somebody to wait would be addressed to
    // no one.
    throw new HttpException(
      "Too many presence updates from here.",
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
