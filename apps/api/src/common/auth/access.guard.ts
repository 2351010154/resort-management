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
//   4. Look the caller's grant up in the matrix. `denied` is a 403 whether the
//      caller is a guest on a staff route, a staff member on a guest route, or
//      a receptionist reaching for a manager's endpoint. All three are the same
//      sentence: this identity is not the wrong identity, it is the wrong
//      authority.

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
import {
  capability,
  type CapabilityKey,
} from "../../modules/identity/rbac/matrix.js";
import { GuestAuthService } from "../../modules/auth/guest/guest-auth.service.js";
import { STAFF_JWT_STRATEGY } from "../../modules/auth/staff/staff-jwt.strategy.js";
import { CAPABILITY_KEY, UNGUARDED_KEY } from "./access.decorators.js";
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

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly guestAuth: GuestAuthService,
    private readonly staffJwt: StaffJwtGuard,
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

    const key = this.reflector.getAllAndOverride<CapabilityKey | undefined>(
      CAPABILITY_KEY,
      targets,
    );

    if (!key) {
      throw new ForbiddenException(
        "This route declares no capability, so nobody may reach it",
      );
    }

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

    const grant = grantFor(row, principal);

    if (grant === "denied") {
      throw new ForbiddenException(`Not permitted: ${row.row}`);
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

    return this.guestAuth.principalFrom(request.headers);
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
  return principal.realm === "guest" ? row.guest : row.staff[principal.role];
}
