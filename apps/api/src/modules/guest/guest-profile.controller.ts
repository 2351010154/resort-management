// The two routes a guest reaches about themselves — `FR-GST-01`.
//
// A file of its own beside `guest.controller.ts`, because the two carry opposite
// requirements over the same domain. That one is `FR-GST-03`: staff reading a
// *named* guest's record, and the audited call that reveals the number on it.
// This one is a guest reading and correcting their *own* account, under a
// different matrix row, reachable by a different realm, against a different
// service. Folding them together would put a staff capability and a guest one
// behind one class, which is the shape `rbac-matrix.md` §2 refuses at every
// level it can be refused at.
//
// **`guest.profile` governs both routes, and the split is the action.** The row
// grants the guest realm `⚠` and three staff roles `👁`, so the read declares
// itself a read and the edit takes `@RequiresCapability`'s default of `write` —
// which is what refuses a receptionist the `PATCH` without a second row existing
// to say so. `access.decorators.ts` argues that default; here it is doing real
// work rather than being safe by luck.
//
// **A booking token cannot reach either.** `guest.profile` is not one of
// `access.guard.ts`'s `BOOKING_TOKEN_ROWS`, so the credential a hold issues is
// refused at the guard with no `@SessionOnly` needed. That is the right ceiling:
// a credential scoped to one stay must not read the account's tier, its balance
// or its personal details, and the row it *is* scoped to has its own routes.
//
// **The account is the session and never an input.** Neither route has a path
// segment or a body field naming a guest, so there is no ownership comparison to
// perform and none to forget — the route that could answer about somebody else
// does not exist. `contract/guest.ts` states the same thing as a path.
//
// **The staff `👁` on this row is not this route.** A receptionist has no guest
// account, so `/profile` has no subject for them; what the grant is for is the
// staff-facing screen that reads a guest the desk has named, which is
// `guest.readRecord` next door and the Guests screen above it. A staff principal
// arriving here is therefore refused by {@link accountOf} rather than answered
// with somebody's profile — the same sentence `booking.controller.ts` writes for
// the same situation, and for its reason: an unreachable branch should be a
// refusal rather than a null meeting a query.

import { contract } from "@mariva/shared";
import { Controller, UseGuards } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import {
  CurrentPrincipal,
  RequiresCapability,
} from "../../common/auth/access.decorators.js";
import type { Principal } from "../../common/auth/principal.js";
import { JsonRequestGuard } from "../../common/auth/json-request.guard.js";
import { TransactionRunner } from "../../database/transaction-runner.js";
import type { GuestProfile } from "./guest-profile.service.js";
import { GuestProfileService } from "./guest-profile.service.js";

@Controller()
export class GuestProfileController {
  constructor(
    private readonly profiles: GuestProfileService,
    private readonly transactions: TransactionRunner,
  ) {}

  /** The account's own record of itself, derived figures included. */
  @RequiresCapability("guest.profile", "read")
  @Implement(contract.guest.readProfile)
  readProfile(@CurrentPrincipal() principal: Principal | null) {
    return implement(contract.guest.readProfile).handler(async () =>
      onWire(
        await this.transactions.run((exec) =>
          this.profiles.readProfile(
            exec,
            accountOf(principal, "read their own profile"),
          ),
        ),
      ),
    );
  }

  /**
   * The four fields a guest may change, and nothing else.
   *
   * A write, so the declaration takes the default and the staff `👁` on the row
   * is refused by the guard before this runs. What may arrive is
   * `updateProfileInput`'s strict shape — an unknown key is a `400` rather than
   * a field quietly dropped — and what it can reach is `guest_user_profile` and
   * no other table.
   */
  // The credential on this route is a cookie, so the browser presents it whether
  // or not the page that asked meant to. `json-request.guard.ts` is the answer
  // the guest's other writes already use: refuse the three content types a
  // `<form>` can post, leaving `fetch`, which preflights into `main.ts`'s origin
  // allowlist.
  @UseGuards(JsonRequestGuard)
  @RequiresCapability("guest.profile")
  @Implement(contract.guest.updateProfile)
  updateProfile(@CurrentPrincipal() principal: Principal | null) {
    return implement(contract.guest.updateProfile).handler(async ({ input }) =>
      onWire(
        await this.transactions.run((exec) =>
          this.profiles.updateProfile(
            exec,
            accountOf(principal, "change their own profile"),
            input,
          ),
        ),
      ),
    );
  }
}

/**
 * The account a profile is about.
 *
 * There is nothing else it could be: both routes name no subject, so the session
 * is the only thing that can scope them. A booking token has no account and is
 * already refused by the guard, and a staff principal holds a `👁` over a
 * different screen entirely — see the header.
 */
function accountOf(principal: Principal | null, act: string): string {
  if (principal?.realm !== "guest") {
    throw new ORPCError("FORBIDDEN", {
      message: `Only a signed-in guest may ${act}`,
    });
  }

  return principal.userId;
}

/**
 * A profile as the wire carries it — the birthday as ISO text, the account's
 * opening as an instant.
 *
 * `stay-date.ts` argues the first: a response carries the encoded form, and the
 * crossing happens at the controller where it can be seen. The points are left
 * as a `bigint` and the serialiser renders them, which is `money.ts`'s split for
 * every integer this application does not want narrowed to a `number`.
 */
function onWire(profile: GuestProfile) {
  return {
    ...profile,
    dateOfBirth: profile.dateOfBirth?.toString() ?? null,
    createdAt: profile.createdAt.toISOString(),
  };
}
