// The one place authorisation happens.
//
// Registered globally, so it runs before every handler in the application —
// including handlers written months from now by someone who has not read this
// file. That is the point: docs/architecture/rbac-matrix.md §2 says a route
// with no declaration is unreachable, and the only way to mean it is for the
// default path through this guard to be a refusal.
//
// The order below is deliberate.
//
//   1. `@Unguarded("…")` — sign-in and its neighbours, which exist so a caller
//      can acquire the session everything else requires, plus the liveness
//      probe, which has no subject at all.
//   2. No capability declared → 403. Not 404, not 401: the route exists and no
//      credential would help, because nothing has said who may use it.
//   3. Resolve the caller. A bearer token goes to Passport, a cookie to Better
//      Auth, and a request carrying both is treated as staff — one request, one
//      realm, never a union of two.
//
//      There is now a third realm, and it does not change that sentence. A
//      guest who booked without an account holds the booking-scoped credential
//      the hold issued, and it is resolved only when neither of the first two
//      answered: a request carrying a session *and* a booking cookie is the
//      session's, because the session is the wider claim, it names an account
//      the ownership query can be scoped by, and a credential that could
//      override it would be a way to make a signed-in guest act as somebody
//      else. So the order is bearer, then session, then booking token — one of
//      the three, decided by what arrived, never a union.
//   3b. The third realm has a ceiling the other two do not. `BOOKING_TOKEN_ROWS`
//      is the whole of what it may reach; every other row is `denied` for it,
//      including rows nobody has written yet. A route inside one of those two
//      rows may still close itself to the credential with `@SessionOnly` — a
//      row is wider than a route, and one route of `booking.read-own` answers
//      with every stay an account has taken rather than with the one a token
//      names.
//   4. Look the caller's grant up in the matrix and compare it to what the
//      route does with the row. `denied` is a 403 whether the caller is a guest
//      on a staff route, a staff member on a guest route, or a receptionist
//      reaching for a manager's endpoint. So is a 👁 grant on a route that
//      writes — a row is wider than a route, and "may see the rate calendar" is
//      not "may reprice it". All of them are the same sentence: this identity
//      is not the wrong identity, it is the wrong authority.

import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";
import type { Request } from "express";
import { isObservable, lastValueFrom } from "rxjs";
import { capability } from "../../modules/identity/rbac/matrix.js";
import { permits } from "../../modules/identity/rbac/roles.js";
import { BookingTokenService } from "../../modules/auth/booking-token/booking-token.service.js";
import { GuestAuthService } from "../../modules/auth/guest/guest-auth.service.js";
import { STAFF_JWT_STRATEGY } from "../../modules/auth/staff/staff-jwt.strategy.js";
import {
  CAPABILITY_KEY,
  type CapabilityRequirement,
  SESSION_ONLY_KEY,
  UNGUARDED_KEY,
} from "./access.decorators.js";
import {
  ACCESS_DECISION,
  type Principal,
  type RequestWithAccess,
  type StaffPrincipal,
} from "./principal.js";

/** Passport's staff strategy as an injectable guard. Invoked by hand below
 *  rather than attached to routes, because only some requests are staff
 *  requests and `AuthGuard` rejects the rest. */
@Injectable()
export class StaffJwtGuard extends AuthGuard(STAFF_JWT_STRATEGY) {}

const BEARER_PREFIX = "bearer ";

/**
 * Every row a booking token opens, and the list is closed.
 *
 * The three the funnel's guest needs on the stay they took: read it, pay for
 * it, and call it off. Written as a list rather than as a property of the row,
 * so that adding a capability to `matrix.ts` cannot widen a credential already
 * in circulation — the new row is refused by default and admitting it is an
 * edit to this line, which is a line a reviewer sees.
 *
 * Payment is here because the funnel is passwordless end to end or it is not
 * passwordless: a guest who may hold a room and may call it off, and who must
 * register to pay for it, meets the sign-up wall one screen later than if there
 * had never been a credential. Every row here is still one booking's — the
 * handler behind each is scoped to the stay the token names, and
 * `payment.service.ts` refuses an attempt opened against any other.
 */
const BOOKING_TOKEN_ROWS: ReadonlySet<string> = new Set([
  "booking.read-own",
  "booking.cancel-own",
  // Naming who the confirmation goes to. Admitted for the same reason payment
  // is: the funnel is passwordless end to end or it is not. The hold is taken
  // before anybody is asked who they are, so the address arrives one screen
  // later — and a token that could pay for a stay but not say where to write
  // about it would leave the anonymous guest paid up and uncontactable.
  "booking.contact-own",
  // Saying the guest is still on the hold. Admitted for the same reason the two
  // above are: the browser holding this credential is the funnel, and the funnel
  // is the only thing that can know. A hold whose presence could only be reported
  // by a signed-in guest would be one that always died at the grace for exactly
  // the passwordless guest this credential exists for.
  //
  // It widens nothing. The row it opens can shorten that one stay's hold and
  // cannot lengthen it past a TTL the property already granted, so the most a
  // stolen copy of this cookie buys is keeping alive — or giving back — a room
  // the thief cannot read, pay for or check into.
  "booking.presence-own",
  "payment.open-attempt",
]);

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly guestAuth: GuestAuthService,
    private readonly staffJwt: StaffJwtGuard,
    private readonly bookingTokens: BookingTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Nothing but HTTP reaches this application today. If something ever does —
    // a queue consumer, a WebSocket — it arrives without the metadata this
    // guard reads, and refusing is the safe half of that surprise.
    if (context.getType() !== "http") {
      return false;
    }

    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<string>(UNGUARDED_KEY, targets)) {
      return true;
    }

    const required = this.reflector.getAllAndOverride<
      CapabilityRequirement | undefined
    >(CAPABILITY_KEY, targets);

    if (!required) {
      throw new ForbiddenException(
        "This route declares no capability, so nobody may reach it",
      );
    }

    const key = required.key;
    const row = capability(key);
    const request = context.switchToHttp().getRequest<
      Request & RequestWithAccess
    >();

    const principal = await this.resolvePrincipal(context, request);

    // An explicitly public row (rbac-matrix.md §3, "Public, unauthenticated")
    // is reachable by anyone, signed in or not. The row's role columns still
    // describe what each role may *do* with the result — a housekeeper has no
    // business in a rate search — but they describe a screen, not a wall, and
    // enforcing them here would 403 a signed-in staff member on a page any
    // stranger can load.
    if (row.unauthenticated) {
      request[ACCESS_DECISION] = {
        principal,
        capabilityKey: key,
        grant: principal ? grantFor(row, principal) : "full",
      };

      return true;
    }

    if (!principal) {
      throw new UnauthorizedException("Sign in to use this");
    }

    // Asked before the grant, because the row would answer yes. A booking token
    // holds `booking.read-own` and this refusal is not about the authority it
    // holds — it is about the route being wider than the credential, which is
    // why the sentence tells the caller to sign in rather than that they may
    // not read their own stays.
    if (
      principal.realm === "booking" &&
      this.reflector.getAllAndOverride<string>(SESSION_ONLY_KEY, targets)
    ) {
      throw new ForbiddenException(
        "Sign in to use this — the link you followed opens one booking only",
      );
    }

    const grant = grantFor(row, principal);

    if (!permits(grant, required.action)) {
      // Two refusals, one status, and the sentence says which. A caller told
      // only "not permitted" on a row their screen lists cannot tell an
      // authority they will never have from one they hold at a lower level —
      // and the second is the one worth escalating to a manager.
      throw new ForbiddenException(
        grant === "read"
          ? `Read-only on: ${row.row}`
          : `Not permitted: ${row.row}`,
      );
    }

    request[ACCESS_DECISION] = { principal, capabilityKey: key, grant };

    return true;
  }

  /**
   * One realm per request.
   *
   * The `Authorization` header decides which path runs. A malformed or expired
   * bearer token fails the request rather than falling through to the cookie:
   * quietly downgrading a broken staff token to whatever guest session the same
   * browser happens to hold would answer a staff request with guest authority.
   */
  private async resolvePrincipal(
    context: ExecutionContext,
    request: Request,
  ): Promise<Principal | null> {
    const authorization = request.headers.authorization;

    if (authorization?.toLowerCase().startsWith(BEARER_PREFIX)) {
      await this.runStaffStrategy(context);

      return (request as Request & { user?: StaffPrincipal }).user ?? null;
    }

    const session = await this.guestAuth.principalFrom(request.headers);

    if (session) {
      return session;
    }

    // Last, and only when nothing else answered. An unsigned, edited or expired
    // token is `null` here and the request continues as anonymous — which is a
    // 401 on the two rows the credential exists for, and the same answer a
    // browser that never held one gets. The refusal names no booking, because
    // the token that failed is the only thing that could have named one.
    return this.bookingTokens.verify(this.bookingTokens.presentedOn(request));
  }

  private async runStaffStrategy(context: ExecutionContext): Promise<void> {
    const outcome = this.staffJwt.canActivate(context);

    // `AuthGuard` may hand back any of the three shapes `CanActivate` allows.
    const settled = isObservable(outcome)
      ? await lastValueFrom(outcome)
      : await outcome;

    if (!settled) {
      throw new UnauthorizedException("Token is not valid");
    }
  }
}

function grantFor(
  row: ReturnType<typeof capability>,
  principal: Principal,
): (typeof row)["guest"] {
  if (principal.realm === "staff") {
    return row.staff[principal.role];
  }

  if (principal.realm === "guest") {
    return row.guest;
  }

  // A booking token, which is a guest on exactly two rows and nobody anywhere
  // else. The public rows are the one exception and they are not a widening:
  // anyone at all may search for a room and take a hold, and holding a
  // credential cannot leave a caller with less authority than a stranger.
  if (row.unauthenticated) {
    return "full";
  }

  return BOOKING_TOKEN_ROWS.has(row.key) ? row.guest : "denied";
}
