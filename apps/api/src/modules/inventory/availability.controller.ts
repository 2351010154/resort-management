// The two read routes of `FR-INV-03`, and the only routes in the application
// a stranger may call.
//
// `@RequiresCapability` rather than `@Unguarded`, even though nobody has to
// sign in. The matrix row carries `unauthenticated: true` and the guard honours
// it, so the declaration here is what points at the row that decided that — and
// the day the property wants rates behind a login, one boolean in the matrix
// closes both routes rather than a decorator being remembered on each.
//
// No path on the controller. The contract carries `/availability` and
// `/availability/calendar`, and a prefix here would prepend to both.
//
// **Both routes read the principal, and neither requires one.** A guest signed
// in is quoted §7's member discount here as well as at the sale — the argument
// is in `availability.service.ts`, and this is where the account it needs comes
// from. Off the session and never off the wire: an account id a caller could
// send would be a stranger asking to be priced at somebody else's tier, which is
// the same rule `booking.controller.ts` keeps for the hold this search leads to.
//
// Nothing is added to the answer. The totals are simply the guest's own, and a
// stranger's are what they always were.

import { contract } from "@mariva/shared";
import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import {
  CurrentPrincipal,
  RequiresCapability,
} from "../../common/auth/access.decorators.js";
import type { Principal } from "../../common/auth/principal.js";
import { AvailabilityService } from "./availability.service.js";

@Controller()
export class AvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @RequiresCapability("availability.search")
  @Implement(contract.availability.search)
  search(@CurrentPrincipal() principal: Principal | null) {
    return implement(contract.availability.search).handler(({ input }) =>
      this.availability.search({
        ...input,
        guestUserId: guestAccount(principal),
      }),
    );
  }

  @RequiresCapability("availability.search")
  @Implement(contract.availability.calendar)
  calendar(@CurrentPrincipal() principal: Principal | null) {
    return implement(contract.availability.calendar).handler(async ({ input }) => {
      const grid = await this.availability.calendar({
        ...input,
        guestUserId: guestAccount(principal),
      });

      // The service works in `CalendarDate`, which is the whole point of
      // `stayDateSchema` being a codec: a stay boundary is a calendar date
      // inside the application and ISO text on the wire. This is the crossing,
      // and it is one line here rather than a `toString()` remembered at every
      // place a night is built.
      return {
        ...grid,
        nights: grid.nights.map((night) => ({
          ...night,
          date: night.date.toString(),
        })),
      };
    });
  }
}

/**
 * The account a member rate is owed to, or null.
 *
 * A staff principal answers null rather than their own id. A receptionist
 * pricing a stay at the desk is pricing it for the guest in front of them, and
 * their own loyalty standing has nothing to do with it — the same reading
 * `booking.controller.ts` takes of the realm on the hold this leads to.
 */
function guestAccount(principal: Principal | null): string | null {
  return principal?.realm === "guest" ? principal.userId : null;
}
