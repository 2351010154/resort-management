// The staff realm's three endpoints. All three are `@Unguarded()`: they are how
// a caller acquires a session, so there is no capability to hold first.
//
// The refresh token travels as an httpOnly cookie rather than in the response
// body. The admin console is a browser application, and a token JavaScript can
// read is a token an injected script can take — the access token is short-lived
// and lives in memory for exactly that reason, while the long-lived half never
// enters the page at all.

import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { ENV, type Env } from "../../../config/env.js";
import { Unguarded } from "../../../common/auth/access.decorators.js";
import { ZodValidationPipe } from "../../../common/validation/zod-validation.pipe.js";
import {
  type StaffRefreshBody,
  staffRefreshSchema,
  type StaffSignInBody,
  staffSignInSchema,
} from "./staff-auth.dto.js";
import { StaffAuthService, type StaffSignInResult } from "./staff-auth.service.js";
import { REFRESH_TOKEN_TTL_SECONDS } from "./staff-token.service.js";

/** Scoped to the refresh routes: the cookie is not attached to the hundreds of
 *  ordinary API requests that have no use for it. */
const REFRESH_COOKIE_PATH = "/auth/staff";
const REFRESH_COOKIE_NAME = "mariva_staff_refresh";

@Controller("auth/staff")
export class StaffAuthController {
  constructor(
    private readonly auth: StaffAuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Unguarded("issues the session every other staff route requires")
  @Post("sign-in")
  @HttpCode(200)
  async signIn(
    @Body(new ZodValidationPipe(staffSignInSchema)) body: StaffSignInBody,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Omit<StaffSignInResult, "tokens"> & { accessToken: string; expiresIn: number }> {
    const result = await this.auth.signIn(body, contextOf(request));

    this.setRefreshCookie(response, result);

    return {
      user: result.user,
      accessToken: result.tokens.accessToken,
      expiresIn: result.tokens.expiresIn,
    };
  }

  @Unguarded("the refresh token is the credential; no session exists yet")
  @Post("refresh")
  @HttpCode(200)
  async refresh(
    @Body(new ZodValidationPipe(staffRefreshSchema)) body: StaffRefreshBody,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Omit<StaffSignInResult, "tokens"> & { accessToken: string; expiresIn: number }> {
    const presented = readRefreshCookie(request) ?? body.refreshToken;

    if (!presented) {
      throw new UnauthorizedException("No refresh token was presented");
    }

    const result = await this.auth.refresh(presented, contextOf(request));

    this.setRefreshCookie(response, result);

    return {
      user: result.user,
      accessToken: result.tokens.accessToken,
      expiresIn: result.tokens.expiresIn,
    };
  }

  @Unguarded("ends a session; refusing an expired one would strand the cookie")
  @Post("sign-out")
  @HttpCode(204)
  async signOut(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.signOut(readRefreshCookie(request));

    response.clearCookie(REFRESH_COOKIE_NAME, {
      path: REFRESH_COOKIE_PATH,
      httpOnly: true,
      sameSite: "lax",
      secure: this.env.NODE_ENV === "production",
    });
  }

  private setRefreshCookie(
    response: Response,
    result: StaffSignInResult,
  ): void {
    response.cookie(REFRESH_COOKIE_NAME, result.tokens.refreshToken, {
      httpOnly: true,
      // `lax` rather than `strict` for the same reason as the guest realm: the
      // console is reached from a bookmark or a link, and `strict` would drop
      // the cookie on that first navigation and demand a fresh sign-in.
      sameSite: "lax",
      secure: this.env.NODE_ENV === "production",
      path: REFRESH_COOKIE_PATH,
      maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
    });
  }
}

function contextOf(request: Request): {
  userAgent?: string;
  ipAddress?: string;
} {
  return {
    userAgent: request.get("user-agent") ?? undefined,
    ipAddress: request.ip,
  };
}

/**
 * Reads one cookie off the raw header.
 *
 * `cookie-parser` would do this, and would also parse every cookie the browser
 * sends on every request the API serves, to find the one name these three
 * routes read. One name, one loop, no dependency.
 */
function readRefreshCookie(request: Request): string | undefined {
  const header = request.headers.cookie;

  if (!header) {
    return undefined;
  }

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");

    if (separator === -1) {
      continue;
    }

    if (part.slice(0, separator).trim() === REFRESH_COOKIE_NAME) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }

  return undefined;
}
