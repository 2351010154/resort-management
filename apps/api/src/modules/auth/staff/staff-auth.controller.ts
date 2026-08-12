// The staff realm's three endpoints. All three are `@Unguarded()`: they are how
// a caller acquires a session, so there is no capability to hold first.
//
// The refresh token travels as an httpOnly cookie rather than in the response
// body. The admin console is a browser application, and a token JavaScript can
// read is a token an injected script can take — the access token is short-lived
// and lives in memory for exactly that reason, while the long-lived half never
// enters the page at all.
//
// The cookie is also why these three stay outside the oRPC contract: nothing in
// a contract handler reaches `Set-Cookie`. What the console shares with them
// instead is the *shapes* — `staff-auth.dto.ts` re-exports them from
// `@mariva/shared`, and the return types below are that session schema — so the
// two hand-written ends of these routes break together or not at all.

import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { ENV, type Env } from "../../../config/env.js";
import { Unguarded } from "../../../common/auth/access.decorators.js";
import { JsonRequestGuard } from "../../../common/auth/json-request.guard.js";
import { ZodValidationPipe } from "../../../common/validation/zod-validation.pipe.js";
import {
  type StaffRefreshBody,
  staffRefreshSchema,
  type StaffSession,
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
  ): Promise<StaffSession> {
    const result = await this.auth.signIn(body, contextOf(request));

    this.setRefreshCookie(response, result);

    return {
      user: result.user,
      accessToken: result.tokens.accessToken,
      expiresIn: result.tokens.expiresIn,
    };
  }

  // The cookie is the credential here, so the browser presents it whether or
  // not the page that asked meant to — hence `JsonRequestGuard`.
  @UseGuards(JsonRequestGuard)
  @Unguarded("the refresh token is the credential; no session exists yet")
  @Post("refresh")
  @HttpCode(200)
  async refresh(
    @Body(new ZodValidationPipe(staffRefreshSchema)) body: StaffRefreshBody,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StaffSession> {
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

  @UseGuards(JsonRequestGuard)
  @Unguarded("ends a session; refusing an expired one would strand the cookie")
  @Post("sign-out")
  @HttpCode(204)
  async signOut(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.signOut(readRefreshCookie(request));

    // Every attribute except `maxAge` has to match the cookie being cleared, or
    // the browser treats this as a different cookie and leaves the real one in
    // place — which is why both calls read the same object.
    response.clearCookie(REFRESH_COOKIE_NAME, this.refreshCookieAttributes());
  }

  private setRefreshCookie(
    response: Response,
    result: StaffSignInResult,
  ): void {
    response.cookie(REFRESH_COOKIE_NAME, result.tokens.refreshToken, {
      ...this.refreshCookieAttributes(),
      maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
    });
  }

  /**
   * How the refresh cookie is scoped, and why `sameSite` is not one value.
   *
   * The console is served from a different site than this API — Vercel and
   * Fly.io per `docs/architecture/infrastructure.md` §2 — and `WEB_ORIGIN` and
   * `ADMIN_ORIGIN` being named separately for credentialed CORS is the same
   * fact stated in `main.ts`. A `lax` cookie is not sent on a cross-site
   * request and not even stored from one, so in production it would leave the
   * console signing in successfully and losing the session at the first token
   * renewal, with no way to restore it on reload. `none` is what a cookie
   * crossing sites has to say, and the browser only accepts it alongside
   * `secure`.
   *
   * Development stays `lax`: `localhost:3002` and `localhost:3001` differ by
   * port, which is not a different site, so the stricter value works there —
   * and `none` could not be used anyway, because it needs the HTTPS that a
   * local API does not serve.
   *
   * Neither is `strict`. The console is reached from a bookmark or a link, and
   * `strict` would drop the cookie on that first navigation and demand a fresh
   * sign-in.
   *
   * What `lax` was also doing, silently, was keeping cross-site requests from
   * carrying this cookie at all. `none` gives that up, so the two routes the
   * cookie alone authorises say what they accept instead —
   * `JsonRequestGuard`.
   */
  private refreshCookieAttributes(): {
    httpOnly: true;
    sameSite: "lax" | "none";
    secure: boolean;
    path: string;
  } {
    const isProduction = this.env.NODE_ENV === "production";

    return {
      httpOnly: true,
      sameSite: isProduction ? "none" : "lax",
      secure: isProduction,
      path: REFRESH_COOKIE_PATH,
    };
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
