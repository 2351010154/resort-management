// The account-creating door, held to a rate this realm's own limiter never sees.
//
// **Better Auth's limiter does not run here.** It lives in the router's
// `onRequest` hook, so it counts requests that arrive at the handler
// `guest-auth.controller.ts` mounts and nothing else — the 5-a-minute figure
// `guest-auth.factory.ts` states for `/sign-up/email` says nothing whatever
// about a Nest route that creates an account through the library's internal
// adapter. A door that creates accounts and is not counted is a door that
// creates accounts without limit, so this counts it.
//
// **The same allowance as sign-up, deliberately.** Five a minute per caller is
// what the realm already grants the public route that creates accounts, and two
// figures for one act would be one of them being the real policy.
//
// The counting itself is `caller-windows.ts`'s and who a caller is is
// `caller-key.ts`'s — both shared with the funnel's two limiters, and shared
// rather than reimplemented for the reason `caller-key.ts` gives: a limit that
// disagreed with its neighbour about who asked would be the looser of the two.
// The address is `request.ip` under `trust proxy 1`, which is what Fly appended
// to `X-Forwarded-For` and not what a client put there.

import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";
import { callerOf } from "../../booking/caller-key.js";
import {
  type CallerRatePolicy,
  CallerWindows,
} from "../../booking/caller-windows.js";
import { minutesInWords } from "../../booking/hold-rate-limit.guard.js";

/** How many accounts one address may create from mailed links, and over what. */
export type AccountLinkRateLimitPolicy = CallerRatePolicy;

/** Injected rather than read off the constant, so a suite can state a small
 *  limit instead of creating five accounts to prove the refusal. */
export const ACCOUNT_LINK_RATE_LIMIT_POLICY = "mariva:account-link-rate-limit";

/** Five a minute, which is what `/sign-up/email` grants for the same act. */
export const DEFAULT_ACCOUNT_LINK_RATE_LIMIT: AccountLinkRateLimitPolicy = {
  limit: 5,
  windowMs: 60_000,
};

@Injectable()
export class AccountLinkRateLimitGuard implements CanActivate {
  private readonly windows: CallerWindows;

  constructor(
    @Inject(ACCOUNT_LINK_RATE_LIMIT_POLICY)
    private readonly policy: AccountLinkRateLimitPolicy,
  ) {
    this.windows = new CallerWindows(policy);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const caller = callerOf(request.ip ?? request.socket.remoteAddress);

    if (this.windows.admits(caller)) {
      return true;
    }

    // The sentence says nothing about the link that was presented, because a
    // refused call never looked at one — and a refusal that distinguished a
    // spent link from a rate would be a way to test links against the limiter.
    throw new HttpException(
      `Too many attempts from here. Wait ${minutesInWords(
        this.policy.windowMs / 60_000,
      )} and try again.`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
