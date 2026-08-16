// Better Auth's own routes, mounted inside Nest.
//
// A controller rather than `app.use()` in main.ts, so these routes exist in the
// same place as every other route: the logger sees them, the exception filter
// sees them, and `@Unguarded()` is visible to the guard rather than being an
// absence the guard has to guess at from a path prefix.
//
// The whole guest realm's surface — sign-up, sign-in, sign-out, verify-email,
// forget-password, reset-password, change-email, change-password, get-session —
// is served by this one handler.
// Reimplementing any of it as a Nest route would create a second door into a
// flow that has one.

import { All, Controller, Inject, Req, Res } from "@nestjs/common";
import { toNodeHandler } from "better-auth/node";
import type { Request, Response } from "express";
import { Unguarded } from "../../../common/auth/access.decorators.js";
import { GUEST_AUTH, type GuestAuth } from "./guest-auth.tokens.js";

@Controller()
export class GuestAuthController {
  private readonly handler: (
    request: Request,
    response: Response,
  ) => Promise<void>;

  constructor(@Inject(GUEST_AUTH) auth: GuestAuth) {
    this.handler = toNodeHandler(auth) as never;
  }

  // Express 5 requires the wildcard to be named — a bare `*` is a parse error,
  // not a match-all. The path is Better Auth's `basePath`; the two are the same
  // constant on purpose.
  @Unguarded(
    "Better Auth's own sign-up, sign-in, verification, reset and credential-change routes",
  )
  @All("api/auth/*path")
  async handle(
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    await this.handler(request, response);
  }
}
