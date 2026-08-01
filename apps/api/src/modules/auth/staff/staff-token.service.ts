// Staff tokens: one short-lived JWT the API verifies by signature, and one
// long-lived refresh token the database can revoke.
//
// The split is the whole design. A stateless access token means an authorised
// request costs no query, which is what makes a keyboard-driven front desk feel
// immediate; a stateful refresh token means a dismissed employee's access
// actually ends. Either alone is the wrong trade — a stateless-only scheme
// cannot revoke, and a stateful-only scheme puts a query in front of every
// request to save a round trip once a day.

import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { and, eq, isNull } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../../database/database.module.js";
import { staffSession } from "../../../database/schema/identity.js";
import type { StaffUserRow } from "../../../database/schema/identity.js";
import { staffRoleSchema } from "../../identity/rbac/roles.js";
import type { StaffPrincipal } from "../../../common/auth/principal.js";

/** Thirty minutes. Long enough to survive a check-in, short enough that a
 *  revoked account cannot outlive one. */
export const ACCESS_TOKEN_TTL_SECONDS = 30 * 60;

/** Seven days: a full shift rotation, so a receptionist signs in once a week
 *  rather than once a morning. */
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * The claim that says which realm a token belongs to.
 *
 * A guest session is a cookie and a staff token is a bearer JWT, so they could
 * not be confused by accident — but "could not be confused by accident" is not
 * an assertion. This claim is checked on every verification, so a token minted
 * by some future second JWT issuer in this process is rejected by name rather
 * than by the shape of its payload.
 */
export const STAFF_REALM_CLAIM = "staff";

export interface StaffTokenPayload {
  /** Subject: the staff account id. */
  readonly sub: string;
  readonly realm: typeof STAFF_REALM_CLAIM;
  readonly email: string;
  readonly role: string;
}

export interface IssuedTokens {
  readonly accessToken: string;
  readonly expiresIn: number;
  readonly refreshToken: string;
  readonly refreshExpiresAt: Date;
}

export interface SessionContext {
  readonly userAgent?: string;
  readonly ipAddress?: string;
}

/** Refresh tokens are stored as a digest, never as themselves. SHA-256 rather
 *  than Argon2 deliberately: the input is 32 bytes of `randomBytes`, so there
 *  is no dictionary to slow down, and this runs on every refresh. */
function digest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

@Injectable()
export class StaffTokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(DRIZZLE) private readonly db: Database,
  ) {}

  /** Signs in: a fresh access token and a fresh refresh token row. */
  async issue(
    user: StaffUserRow,
    context: SessionContext = {},
  ): Promise<IssuedTokens> {
    const payload: StaffTokenPayload = {
      sub: user.id,
      realm: STAFF_REALM_CLAIM,
      email: user.email,
      role: user.role,
    };

    const accessToken = await this.jwt.signAsync(payload);
    const refreshToken = randomBytes(32).toString("base64url");
    const refreshExpiresAt = new Date(
      Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000,
    );

    await this.db.insert(staffSession).values({
      staffUserId: user.id,
      refreshTokenHash: digest(refreshToken),
      expiresAt: refreshExpiresAt,
      userAgent: context.userAgent,
      ipAddress: context.ipAddress,
    });

    return {
      accessToken,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      refreshToken,
      refreshExpiresAt,
    };
  }

  /**
   * Spends a refresh token and returns its replacement.
   *
   * Rotation, not reuse: the presented token is revoked in the same statement
   * that finds it, so a token replayed by an attacker after the real client has
   * refreshed finds nothing to revoke and fails. The `revokedAt is null` filter
   * inside the UPDATE is what makes that atomic — two concurrent refreshes with
   * the same token cannot both succeed, however they interleave.
   */
  async rotate(
    refreshToken: string,
    context: SessionContext = {},
  ): Promise<{ readonly staffUserId: string; readonly tokens: Omit<IssuedTokens, "accessToken" | "expiresIn"> }> {
    const now = new Date();

    const [spent] = await this.db
      .update(staffSession)
      .set({ revokedAt: now })
      .where(
        and(
          eq(staffSession.refreshTokenHash, digest(refreshToken)),
          isNull(staffSession.revokedAt),
        ),
      )
      .returning();

    if (!spent || spent.expiresAt <= now) {
      throw new UnauthorizedException("Refresh token is not valid");
    }

    const replacement = randomBytes(32).toString("base64url");
    const refreshExpiresAt = new Date(
      Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000,
    );

    await this.db.insert(staffSession).values({
      staffUserId: spent.staffUserId,
      refreshTokenHash: digest(replacement),
      expiresAt: refreshExpiresAt,
      userAgent: context.userAgent,
      ipAddress: context.ipAddress,
    });

    return {
      staffUserId: spent.staffUserId,
      tokens: { refreshToken: replacement, refreshExpiresAt },
    };
  }

  /** Signs one device out. Idempotent: revoking an already-revoked or unknown
   *  token is a no-op, because the caller's intent is satisfied either way. */
  async revoke(refreshToken: string): Promise<void> {
    await this.db
      .update(staffSession)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(staffSession.refreshTokenHash, digest(refreshToken)),
          isNull(staffSession.revokedAt),
        ),
      );
  }

  /** Signs every device out — used when an account is deactivated or its role
   *  changes, where a live token would carry the old authority. */
  async revokeAllFor(staffUserId: string): Promise<void> {
    await this.db
      .update(staffSession)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(staffSession.staffUserId, staffUserId),
          isNull(staffSession.revokedAt),
        ),
      );
  }

  /** Signs the access token for an account whose refresh token has just been
   *  rotated. Split from {@link issue} so a refresh does not create a second
   *  session row for the one it is replacing. */
  signAccessToken(user: StaffUserRow): Promise<string> {
    const payload: StaffTokenPayload = {
      sub: user.id,
      realm: STAFF_REALM_CLAIM,
      email: user.email,
      role: user.role,
    };

    return this.jwt.signAsync(payload);
  }

  /**
   * Turns a verified payload into a principal.
   *
   * The role is re-parsed rather than cast. A token is signed by this process,
   * so its role is trustworthy in the sense that matters — but a role removed
   * from the matrix would still be sitting inside tokens issued before the
   * removal, and a cast would let one through as a role the guard cannot find.
   */
  toPrincipal(payload: StaffTokenPayload): StaffPrincipal {
    const role = staffRoleSchema.safeParse(payload.role);

    if (payload.realm !== STAFF_REALM_CLAIM || !role.success) {
      throw new UnauthorizedException("Token is not a staff token");
    }

    return {
      realm: "staff",
      userId: payload.sub,
      email: payload.email,
      role: role.data,
    };
  }
}
