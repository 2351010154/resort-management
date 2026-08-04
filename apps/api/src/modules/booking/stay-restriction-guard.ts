// Whether the funnel may sell this stay — `FR-PRC-02`, at the point of sale.
//
// `availability.service.ts` already folds these four rules into `isAvailable`,
// and that is a flag on a search result: the funnel POSTs to `createHold`
// directly, so a stay the grid showed as unsellable is still one request away
// from a booking row unless something refuses it here. A minimum stay nothing
// enforces is a rule the property published and the software ignored.
//
// **Only the funnel is bound by this.** `createConfirmed` does not call it, and
// the split is deliberate rather than an omission. A party of six in a room that
// sleeps two is a physical impossibility and is refused on both paths in
// `stay-quote.service.ts`; a two-night minimum over a festival weekend is a
// commercial rule the front desk overrides routinely — for a regular, for a
// booking taken by telephone, for a stay somebody has already been promised. A
// desk that could not take that booking would take it on paper, and the property
// would then be running on a system that knows less than its own staff do.
//
// The read goes through the caller's executor rather than through `pricing`'s
// `StayRestrictionService`, for the reason `booking.module.ts` gives: that
// service holds its own connection, and a rule read outside the transaction that
// consumes the nights is a rule a manager may have lifted in between.
//
// Which date carries which rule is `availability.service.ts`'s reading, and it
// has to stay that reading or the grid and the sale would disagree: the arrival
// date governs where a stay may BEGIN (minimum, maximum, closed-to-arrival) and
// the departure date governs where it may END (closed-to-departure). Nights in
// the middle constrain nothing a stay running across them can break.

import { nightCount } from "@mariva/shared";
import { ORPCError } from "@orpc/nest";
import { and, eq, inArray } from "drizzle-orm";
import type { DbExecutor } from "../../database/database.module.js";
import { roomType } from "../../database/schema/inventory.js";
import { stayRestriction } from "../../database/schema/pricing.js";
import type { CreateBookingInput } from "./booking.service.js";

/**
 * Refuses a stay the property has closed to the public funnel.
 *
 * A type-date with no row is unrestricted — `schema/pricing.ts` makes the row
 * the exception rather than the rule — so an empty result is a stay that may be
 * sold and not one that could not be checked.
 */
export async function assertFunnelMaySell(
  exec: DbExecutor,
  input: CreateBookingInput,
): Promise<void> {
  const nights = nightCount(input);

  // A range covering no night is refused by `stay-quote.service.ts`, which owns
  // that message. Checking rules against it first would answer a malformed range
  // by naming a restriction, and on `checkIn === checkOut` a single row would be
  // read as both the arrival and the departure.
  if (nights < 1) {
    return;
  }

  const arrivalDate = input.checkIn.toString();
  const departureDate = input.checkOut.toString();

  // Both dates in one round trip. Two queries would read one table twice inside
  // the transaction to answer one question about one stay.
  const rules = await exec
    .select({
      stayDate: stayRestriction.stayDate,
      minimumStay: stayRestriction.minimumStay,
      maximumStay: stayRestriction.maximumStay,
      closedToArrival: stayRestriction.closedToArrival,
      closedToDeparture: stayRestriction.closedToDeparture,
    })
    .from(stayRestriction)
    .innerJoin(roomType, eq(roomType.id, stayRestriction.roomTypeId))
    .where(
      and(
        eq(roomType.code, input.roomType),
        inArray(stayRestriction.stayDate, [arrivalDate, departureDate]),
      ),
    );

  const arrival = rules.find((rule) => rule.stayDate === arrivalDate);
  const departure = rules.find((rule) => rule.stayDate === departureDate);

  if (arrival?.closedToArrival) {
    throw new ORPCError("CONFLICT", {
      message: `No stay may begin on ${arrivalDate} — the property has closed that date to arrivals`,
    });
  }

  if (departure?.closedToDeparture) {
    throw new ORPCError("CONFLICT", {
      message: `No stay may end on ${departureDate} — the property has closed that date to departures`,
    });
  }

  if (arrival && nights < arrival.minimumStay) {
    throw new ORPCError("CONFLICT", {
      message: `A stay beginning on ${arrivalDate} must run at least ${arrival.minimumStay} nights, and this one runs ${nights}`,
    });
  }

  // `!= null` and not `!== null`: no ceiling is stored as null, and an absent
  // arrival row has no ceiling either.
  if (arrival?.maximumStay != null && nights > arrival.maximumStay) {
    throw new ORPCError("CONFLICT", {
      message: `A stay beginning on ${arrivalDate} may run at most ${arrival.maximumStay} nights, and this one runs ${nights}`,
    });
  }
}
