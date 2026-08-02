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

import { contract } from "@mariva/shared";
import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { RequiresCapability } from "../../common/auth/access.decorators.js";
import { AvailabilityService } from "./availability.service.js";

@Controller()
export class AvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @RequiresCapability("availability.search")
  @Implement(contract.availability.search)
  search() {
    return implement(contract.availability.search).handler(({ input }) =>
      this.availability.search(input),
    );
  }

  @RequiresCapability("availability.search")
  @Implement(contract.availability.calendar)
  calendar() {
    return implement(contract.availability.calendar).handler(async ({ input }) => {
      const grid = await this.availability.calendar(input);

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
