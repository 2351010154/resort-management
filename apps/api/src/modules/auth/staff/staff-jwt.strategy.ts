// Passport's half of the staff realm: pull the bearer token off the request,
// check its signature and expiry, then decide whether the account behind it is
// still allowed to exist.
//
// The second half is the part a signature cannot answer. A token stays
// cryptographically valid for its full thirty minutes after an account is
// deactivated or its role is changed, so `validate` re-reads the account and
// takes the role from the row rather than from the claim. That costs one
// indexed lookup per request and is what makes "revoke access" mean it.

import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { ENV, type Env } from "../../../config/env.js";
import type { StaffPrincipal } from "../../../common/auth/principal.js";
import { StaffUserService } from "../../identity/staff-user.service.js";
import { staffRoleSchema } from "../../identity/rbac/roles.js";
import {
  STAFF_REALM_CLAIM,
  type StaffTokenPayload,
} from "./staff-token.service.js";

/** The name the guard passes to `AuthGuard(...)`. Named, not defaulted to
 *  'jwt': the guest realm may one day mount a JWT strategy of its own, and two
 *  strategies both called 'jwt' is a silent overwrite. */
export const STAFF_JWT_STRATEGY = "staff-jwt";

@Injectable()
export class StaffJwtStrategy extends PassportStrategy(
  Strategy,
  STAFF_JWT_STRATEGY,
) {
  constructor(
    @Inject(ENV) env: Env,
    private readonly staffUsers: StaffUserService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      // Expiry is enforced by passport-jwt rather than by this code. Setting
      // this to true — the tempting shortcut when a test token keeps expiring —
      // would leave every issued token valid forever.
      ignoreExpiration: false,
      secretOrKey: env.STAFF_JWT_SECRET,
      algorithms: ["HS256"],
    });
  }

  async validate(payload: StaffTokenPayload): Promise<StaffPrincipal> {
    if (payload.realm !== STAFF_REALM_CLAIM) {
      throw new UnauthorizedException("Token is not a staff token");
    }

    const account = await this.staffUsers.findActiveById(payload.sub);

    if (!account) {
      throw new UnauthorizedException("Account is no longer active");
    }

    const role = staffRoleSchema.parse(account.role);

    return {
      realm: "staff",
      userId: account.id,
      email: account.email,
      role,
    };
  }
}
