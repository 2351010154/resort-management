// Staff sign-in, refresh and sign-out.
//
// Every failure path out of this file returns the same message. "No such
// account" and "wrong password" are different facts, and telling them apart is
// how an attacker turns a stolen address list into a list of staff addresses —
// so they are one answer here, and the timing is levelled to match.

import { Injectable, UnauthorizedException, type OnModuleInit } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type { StaffUserRow } from "../../../database/schema/identity.js";
import { PasswordHasher } from "../../identity/password-hasher.js";
import { StaffUserService } from "../../identity/staff-user.service.js";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  type IssuedTokens,
  type SessionContext,
  StaffTokenService,
} from "./staff-token.service.js";

/** What sign-in and refresh hand back to the controller. */
export interface StaffSignInResult {
  readonly tokens: IssuedTokens;
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly fullName: string;
    readonly role: string;
  };
}

const SAME_ANSWER_FOR_EVERY_FAILURE = "Email or password is incorrect";

@Injectable()
export class StaffAuthService implements OnModuleInit {
  /**
   * An Argon2 digest of a value nobody knows, verified against whenever the
   * address does not exist.
   *
   * Without it, an unknown address returns in under a millisecond and a known
   * one takes the ~50ms Argon2 costs, which is a timing oracle wide enough to
   * measure over the internet. Generated at boot from `randomBytes` rather than
   * hardcoded, so it is not a password anybody can ever type.
   */
  private absentAccountDigest = "";

  constructor(
    private readonly staffUsers: StaffUserService,
    private readonly hasher: PasswordHasher,
    private readonly tokens: StaffTokenService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.absentAccountDigest = await this.hasher.hash(
      randomBytes(32).toString("base64url"),
    );
  }

  async signIn(
    credentials: { readonly email: string; readonly password: string },
    context: SessionContext,
  ): Promise<StaffSignInResult> {
    const account = await this.staffUsers.findByEmail(credentials.email);

    // Unconditional: the verification runs whether or not the account exists,
    // and only its result is discarded. Short-circuiting here is the bug this
    // whole arrangement is built to avoid.
    const passwordMatches = await this.hasher.verify(
      account?.passwordHash ?? this.absentAccountDigest,
      credentials.password,
    );

    if (!account || !account.isActive || !passwordMatches) {
      throw new UnauthorizedException(SAME_ANSWER_FOR_EVERY_FAILURE);
    }

    const issued = await this.tokens.issue(account, context);
    await this.staffUsers.recordSignIn(account.id);

    return { tokens: issued, user: publicView(account) };
  }

  /**
   * Spends a refresh token for a new pair.
   *
   * The account is re-read rather than trusted from the old token: a staff
   * member deactivated an hour ago still holds a refresh token that is
   * cryptographically fine, and this is where it stops working. Their remaining
   * tokens are revoked at the same time, so the next device does not have to
   * discover the same thing separately.
   */
  async refresh(
    refreshToken: string,
    context: SessionContext,
  ): Promise<StaffSignInResult> {
    const rotated = await this.tokens.rotate(refreshToken, context);
    const account = await this.staffUsers.findActiveById(rotated.staffUserId);

    if (!account) {
      await this.tokens.revokeAllFor(rotated.staffUserId);
      throw new UnauthorizedException("Account is no longer active");
    }

    const accessToken = await this.tokens.signAccessToken(account);

    return {
      tokens: {
        accessToken,
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        refreshToken: rotated.tokens.refreshToken,
        refreshExpiresAt: rotated.tokens.refreshExpiresAt,
      },
      user: publicView(account),
    };
  }

  async signOut(refreshToken: string | undefined): Promise<void> {
    if (refreshToken) {
      await this.tokens.revoke(refreshToken);
    }
  }
}

/** The account as a client may see it. The hash and the activity flags are not
 *  in it, and adding them here is how they end up in a JSON response. */
function publicView(account: StaffUserRow): StaffSignInResult["user"] {
  return {
    id: account.id,
    email: account.email,
    fullName: account.fullName,
    role: account.role,
  };
}
