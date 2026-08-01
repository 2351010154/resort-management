// The one thing the rest of the API asks of Better Auth: who is this request?
//
// Everything else — sign-up, sign-in, verification, reset, sign-out — is served
// by the handler Better Auth mounts, and none of it is reimplemented here. A
// service method that wrapped `signUpEmail` would be a second entry point to a
// flow that already has one, and the two would diverge at the first change.

import { Inject, Injectable } from "@nestjs/common";
import { fromNodeHeaders } from "better-auth/node";
import type { IncomingHttpHeaders } from "node:http";
import type { GuestPrincipal } from "../../../common/auth/principal.js";
import { GUEST_AUTH, type GuestAuth } from "./guest-auth.tokens.js";

@Injectable()
export class GuestAuthService {
  constructor(@Inject(GUEST_AUTH) private readonly auth: GuestAuth) {}

  /**
   * Resolves the guest session a request carries, or `null`.
   *
   * `null` is not an error here. Most requests to this API carry a staff bearer
   * token or nothing at all, and the guard tries this path for all of them.
   */
  async principalFrom(
    headers: IncomingHttpHeaders,
  ): Promise<GuestPrincipal | null> {
    const result = await this.auth.api.getSession({
      headers: fromNodeHeaders(headers),
    });

    if (!result) {
      return null;
    }

    return {
      realm: "guest",
      userId: result.user.id,
      email: result.user.email,
      emailVerified: result.user.emailVerified,
      sessionId: result.session.id,
    };
  }
}
