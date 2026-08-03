// Stay restrictions — `FR-PRC-02`, and the `pricing.stay-restrictions` row of
// the matrix.
//
// Its own row and so its own controller. The row is narrower than the rate one
// beside it: `RECEPTIONIST` has 👁 and `ACCOUNTANT` has nothing at all, because
// a minimum stay is a commercial rule about what the property will sell and not
// a number that appears on an invoice.
//
// One write route, two outcomes. Writing the unrestricted value clears the
// nights rather than storing a row that constrains nothing —
// `stay-restriction.service.ts` argues for why the table has to stay that way,
// and `cleared` on the response is how the caller knows which of the two
// happened without inspecting what they sent.

import { contract, isUnrestricted } from "@mariva/shared";
import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { RequiresCapability } from "../../common/auth/access.decorators.js";
import { StayRestrictionService } from "./stay-restriction.service.js";

@Controller()
export class StayRestrictionController {
  constructor(private readonly restrictions: StayRestrictionService) {}

  @RequiresCapability("pricing.stay-restrictions", "read")
  @Implement(contract.pricing.readStayRestrictions)
  readStayRestrictions() {
    return implement(contract.pricing.readStayRestrictions).handler(
      async ({ input }) => ({
        roomType: input.roomType,
        restrictions: await this.restrictions.read(input),
      }),
    );
  }

  @RequiresCapability("pricing.stay-restrictions")
  @Implement(contract.pricing.setStayRestrictions)
  setStayRestrictions() {
    return implement(contract.pricing.setStayRestrictions).handler(
      async ({ input }) => {
        const cleared = isUnrestricted(input);

        return {
          roomType: input.roomType,
          nights: cleared
            ? await this.restrictions.clear(input)
            : await this.restrictions.apply(input, input),
          cleared,
        };
      },
    );
  }
}
