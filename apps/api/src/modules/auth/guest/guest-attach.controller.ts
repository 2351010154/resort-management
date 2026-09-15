// The two doors that give a stay an owner.
//
// They sit in the auth module rather than beside the booking's own routes
// because what each one settles is an identity: one creates the account the
// confirmation mail offered, the other reads the account off a session. What
// they then do to the booking is `guest-attach.service.ts`'s, and through it
// `booking.service.ts`'s — no handler here decides anything about a stay.
//
// **Both paths are under `/bookings`**, and that is not decoration.
// `booking-token.service.ts` scopes the guest's credential to that path, so a
// route mounted anywhere else would be a route the browser never sends it to —
// and the signed-in path needs it on the request, because the session says who
// the guest is and only the cookie says which stay is theirs.

import { contract } from "@mariva/shared";
import { Controller, Req, Res, UseGuards } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import type { Request, Response } from "express";
import {
  CurrentPrincipal,
  RequiresCapability,
  Unguarded,
} from "../../../common/auth/access.decorators.js";
import { JsonRequestGuard } from "../../../common/auth/json-request.guard.js";
import type { Principal } from "../../../common/auth/principal.js";
import { TransactionRunner } from "../../../database/transaction-runner.js";
import { onWire } from "../../booking/booking.controller.js";
import { BookingTokenService } from "../booking-token/booking-token.service.js";
import { AccountLinkRateLimitGuard } from "./account-link-rate-limit.guard.js";
import { GuestAttachService } from "./guest-attach.service.js";

@Controller()
export class GuestAttachController {
  constructor(
    private readonly attach: GuestAttachService,
    private readonly transactions: TransactionRunner,
    private readonly bookingTokens: BookingTokenService,
  ) {}

  /**
   * The confirmation mail's account link, followed — an account created with
   * the address already verified, and the stay attached to it.
   *
   * **Unguarded because the link is the credential.** Every other door in this
   * application names a capability a caller must already hold; this one is where
   * a guest with no account at all acquires one, exactly as `/sign-up/email`
   * beside it is. What stands in for the guard is the signature over the link,
   * the row that says it has not been followed, and the hour it lives.
   *
   * **Rate limited here rather than by the realm's own limiter**, because that
   * limiter runs in Better Auth's router and this route is not on it —
   * `account-link-rate-limit.guard.ts` makes the argument and states the figure.
   *
   * `JsonRequestGuard` because this creates an account: a cross-site `<form>`
   * post cannot be read by the page that sent it, but it can be sent, and this
   * refuses the three content types one can use. What is left is `fetch`, which
   * preflights into `main.ts`'s origin allowlist.
   *
   * **The one route here that does not open its own transaction.** Creating the
   * account is a write on Better Auth's own connection, and asking for that
   * connection while holding one of this pool's ten is how a handful of
   * concurrent redemptions stall the process — so the boundaries belong to the
   * service, which is the only thing that knows where the gap has to be.
   * `guest-attach.service.ts` sets the order out.
   *
   * **The session cookies are copied out rather than composed here.** Better
   * Auth writes them when it signs the new account in — `guest-attach.service.
   * ts` says why only that path has any — and they are appended after the attach
   * has committed, so a browser is never handed a session for an attach that
   * rolled back. The path that found an account already registered hands back
   * none, and this loop then does nothing at all.
   *
   * **`signedIn` is read off that same list and is the only thing the reply
   * says about it.** Whether cookies were written is a fact about this browser
   * rather than about the address, and the page that follows the link has to
   * have it: without it every guest is sent on to a profile, and the two paths
   * that issue no session send theirs to a page their browser cannot open.
   * `contract/booking.ts` argues why stating it discloses nothing.
   */
  @UseGuards(JsonRequestGuard, AccountLinkRateLimitGuard)
  @Unguarded("the link out of a confirmation email is itself the credential")
  @Implement(contract.booking.createAccountFromLink)
  createAccountFromLink(@Res({ passthrough: true }) response: Response) {
    return implement(contract.booking.createAccountFromLink).handler(
      async ({ input }) => {
        const redeemed = await this.attach.accountFromLink({
          link: input.link,
          password: input.password,
        });

        for (const cookie of redeemed.sessionCookies) {
          response.append("set-cookie", cookie);
        }

        return {
          ...redeemed.stay,
          signedIn: redeemed.sessionCookies.length > 0,
        };
      },
    );
  }

  /**
   * The registered guest's path — signed in, and holding the booking.
   *
   * `guest.profile` is the row: what this writes is which account a stay belongs
   * to, which is the guest's own record rather than the booking's operation, and
   * it is the row `FR-GST-05`'s loyalty will later accrue against. Declaring it
   * has a second effect worth having — the row is not one a booking token opens,
   * so a caller holding only the cookie is refused by the guard before reaching
   * here. Both credentials are required and the guard can only insist on one.
   *
   * **The stay comes off the cookie and is checked against the path.** The id in
   * the path is what the client asked about; the id in the credential is what it
   * has proved. A route that trusted the path would attach any booking whose id
   * a signed-in guest could guess.
   */
  @UseGuards(JsonRequestGuard)
  @RequiresCapability("guest.profile")
  @Implement(contract.booking.attachToAccount)
  attachToAccount(
    @CurrentPrincipal() principal: Principal | null,
    @Req() request: Request,
  ) {
    return implement(contract.booking.attachToAccount).handler(
      async ({ input }) => {
        const userId = signedInGuest(principal);
        const proven = this.bookingTokens.verify(
          this.bookingTokens.presentedOn(request),
        );

        if (proven?.bookingId !== input.bookingId) {
          throw new ORPCError("FORBIDDEN", {
            message:
              "Open this booking from the link in your confirmation email, then add it to your account",
          });
        }

        const attached = await this.transactions.run((exec) =>
          this.attach.attachProvenStay(exec, {
            bookingId: input.bookingId,
            userId,
          }),
        );

        // The one crossing every booking-shaped answer performs, borrowed from
        // the controller that owns it rather than written a second time here —
        // two encoders for one schema is one of them going stale.
        return onWire(attached);
      },
    );
  }
}

/**
 * The account a stay is being filed under.
 *
 * Unreachable — `guest.profile` is denied to every staff role and to the booking
 * token, so the guard has already refused anyone this rejects — and stated
 * anyway, because the alternative is a null account reaching a column that
 * decides who owns a booking.
 */
function signedInGuest(principal: Principal | null): string {
  if (principal?.realm !== "guest") {
    throw new ORPCError("FORBIDDEN", {
      message: "Only a signed-in guest may add a stay to their account",
    });
  }

  return principal.userId;
}
