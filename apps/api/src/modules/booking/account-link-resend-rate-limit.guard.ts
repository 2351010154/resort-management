// How often the desk may cause account links to be mailed to guests.
//
// **A limiter on an authenticated route, which needs saying.** The three
// limiters beside this one stand in front of doors a stranger can reach; this
// one stands behind staff auth and the capability guard, so it is not there to
// keep strangers out. It is there because the act it bounds is *outbound mail to
// somebody else's address*, and the two ways that goes wrong are both slow-hand
// rather than anonymous: a console left signed in on a desk in a lobby, and a
// script written against a stolen token walking booking ids and mailing every
// guest of the property at once. Neither is stopped by knowing who the caller
// is. What stops them is that the tenth message in a minute is refused and the
// audit trail says who sent the first nine.
//
// **A staff figure can be looser than a guest one, and is.**
// `account-link-rate-limit.guard.ts` grants five a minute because the act behind
// it creates accounts for anyone who can reach the door. Here every call is
// attributed, reversible only in the sense that a link expires in an hour, and
// performed by somebody the property employs — so the figure is set where an
// honest desk never meets it.
//
// The counting is `caller-windows.ts`'s and who a caller is is `caller-key.ts`'s,
// both shared with the funnel's limiters rather than reimplemented, for the
// reason `caller-key.ts` gives: two limiters that disagreed about who asked
// would be one policy with the looser half deciding. One consequence is worth
// stating plainly, because it is what the figure is chosen against — a front
// desk sits behind one public address, so the whole desk is one caller here and
// the allowance is the property's rather than each receptionist's.

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
import { minutesInWords } from "./hold-rate-limit.guard.js";

/** How often one address may have the property mail an account link, and over
 *  what. */
export type AccountLinkResendRateLimitPolicy = CallerRatePolicy;

/** Injected rather than read off the constant, so a suite can state a small
 *  limit instead of mailing twenty guests to prove the refusal. */
export const ACCOUNT_LINK_RESEND_RATE_LIMIT_POLICY =
  "mariva:account-link-resend-rate-limit";

/**
 * Twenty a minute from the desk's address.
 *
 * Derived from what an honest desk produces rather than chosen for feel. The
 * flow behind this route is a telephone call or a conversation at the counter —
 * find the stay, establish who is asking, press the button — and no member of
 * staff completes that in under a minute, let alone twenty of them. Two
 * receptionists working at once, each retrying a couple of times because a guest
 * misheard their own address, is still under ten.
 *
 * So twenty leaves the whole desk unbounded in practice while putting a hard
 * ceiling on the failure this exists for: a script against a stolen token cannot
 * mail the property's entire guest list in an afternoon, and the twenty-first
 * refusal happens while the first twenty are still on the audit trail with a
 * name against them.
 */
export const DEFAULT_ACCOUNT_LINK_RESEND_RATE_LIMIT: AccountLinkResendRateLimitPolicy =
  {
    limit: 20,
    windowMs: 60_000,
  };

@Injectable()
export class AccountLinkResendRateLimitGuard implements CanActivate {
  private readonly windows: CallerWindows;

  constructor(
    @Inject(ACCOUNT_LINK_RESEND_RATE_LIMIT_POLICY)
    private readonly policy: AccountLinkResendRateLimitPolicy,
  ) {
    this.windows = new CallerWindows(policy);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    if (
      this.windows.admits(callerOf(request.ip ?? request.socket.remoteAddress))
    ) {
      return true;
    }

    // Named plainly, because a member of staff reads this with a guest in front
    // of them and has to decide what to say next. Nothing about the booking
    // appears in it: a refused call never looked at one.
    throw new HttpException(
      `Too many account links have been sent from here. Wait ${minutesInWords(
        this.policy.windowMs / 60_000,
      )} and try again.`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
