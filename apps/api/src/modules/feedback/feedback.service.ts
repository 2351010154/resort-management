// A guest's word on a stay that is over, and the three refusals around it.
//
// Two methods, and both begin with the same two questions asked in the same
// order: is this stay the caller's, and has it ended. The order matters. A
// caller who is told "that stay is not finished" about a booking that is not
// theirs has been told the property holds a booking under that reference, one
// guess at a time — so ownership is settled first and answers the way every
// other route under `/bookings/mine/` answers it, with the same `NOT_FOUND` for
// a stranger's stay as for a reference nobody holds.
//
// **Ownership is not re-implemented here.** `BookingService.ownBooking` puts the
// account into the `where` clause rather than comparing after the row arrives,
// which is what makes it unforgettable, and it already knows that a stay the
// desk took belongs to no account. A second lookup written in this file would be
// a second place that rule could be got wrong, and it would be got wrong in the
// direction of handing a stranger's stay to whoever guessed eight characters.
//
// **The eligibility rule is stated once and used by both methods.** A stay is
// rateable when it has been checked out, and the read refuses a stay that is not
// exactly as the write does. That is what lets the screen decide what to draw
// from one call: an answer means the guest may write, `null` inside it means
// they have not yet, and a refusal means there is nothing to offer.
//
// **The second submission is refused by the index rather than by looking
// first.** Two presses arriving together — a double tap, a retry, two tabs —
// would both read no row and both insert, and the one that lost would surface as
// a constraint violation rather than as an answer. `on conflict do nothing`
// lets Postgres settle it, and an insert that wrote nothing is precisely the
// stay that has already been rated.

import type { BookingState } from "@mariva/shared";
import { Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import { eq } from "drizzle-orm";
import type { DbExecutor } from "../../database/database.module.js";
import { feedback } from "../../database/schema/feedback.js";
import {
  type Booking,
  type BookingOwner,
  BookingService,
} from "../booking/booking.service.js";

/** The one state a stay can be rated in. */
const RATEABLE: BookingState = "CHECKED_OUT";

/** One stay, named the way its guest names it and scoped to the account
 *  asking — `OwnBooking`'s pair, and this module reads nothing else. */
export interface OwnStay {
  readonly reference: string;
  readonly owner: BookingOwner;
}

/** A rating, and whatever the guest wrote beside it. */
export interface SubmitFeedback extends OwnStay {
  readonly rating: number;
  readonly comment?: string | null;
}

/** What one guest left about one stay, as the wire will carry it. */
export interface Feedback {
  readonly reference: string;
  readonly rating: number;
  readonly comment: string | null;
  readonly submittedAt: Date;
}

@Injectable()
export class FeedbackService {
  constructor(private readonly bookings: BookingService) {}

  /**
   * The guest's word on their own finished stay, written once.
   *
   * The account on the row is the owner the controller resolved from the
   * session, not a field of the input — there is no way for a caller to file an
   * opinion under somebody else's name, because no shape here has a place to put
   * one. It is the same account the ownership lookup above just matched the
   * booking against, so the two cannot disagree.
   */
  async submit(exec: DbExecutor, input: SubmitFeedback): Promise<Feedback> {
    const stay = await this.rateableStay(exec, input);

    const [written] = await exec
      .insert(feedback)
      .values({
        bookingId: stay.id,
        userId: accountOn(stay),
        rating: input.rating,
        // Absent and null are one fact — the guest wrote nothing — and the
        // column stores one value for it. The contract's trim has already
        // refused a comment that is only whitespace, and the table's check
        // refuses one that arrives by any other path.
        comment: input.comment ?? null,
      })
      .onConflictDoNothing({ target: feedback.bookingId })
      .returning();

    if (!written) {
      throw new ORPCError("CONFLICT", {
        message: "You have already left feedback on this stay",
      });
    }

    return {
      reference: stay.reference,
      rating: written.rating,
      comment: written.comment,
      submittedAt: written.submittedAt,
    };
  }

  /**
   * What the guest already said about this stay, or nothing yet.
   *
   * Scoped by the booking the ownership lookup returned rather than by the
   * account, and the difference is worth stating: the stay has already been
   * proved to be this caller's, so keying the row by `booking_id` reads the one
   * row the unique index allows. Adding the account to this `where` would look
   * safer and would in fact hide a mismatch — a row whose author is not the
   * stay's owner should be a fault worth seeing, not a silent `null`.
   */
  async own(exec: DbExecutor, input: OwnStay): Promise<Feedback | null> {
    const stay = await this.rateableStay(exec, input);

    const [row] = await exec
      .select()
      .from(feedback)
      .where(eq(feedback.bookingId, stay.id))
      .limit(1);

    return row
      ? {
          reference: stay.reference,
          rating: row.rating,
          comment: row.comment,
          submittedAt: row.submittedAt,
        }
      : null;
  }

  /**
   * The caller's own stay, once it has ended.
   *
   * Both halves refuse, and they refuse differently on purpose. A stay that is
   * not the caller's is `NOT_FOUND`, which is `ownBooking`'s answer and says
   * nothing about whether the property holds such a booking. A stay that is the
   * caller's and is not over is a conflict: the guest is told plainly, because
   * they can see the stay in front of them and hiding the reason would read as
   * the property losing their booking.
   */
  private async rateableStay(
    exec: DbExecutor,
    { reference, owner }: OwnStay,
  ): Promise<Booking> {
    const stay = await this.bookings.ownBooking(exec, { reference, owner });

    if (stay.state !== RATEABLE) {
      throw new ORPCError("CONFLICT", {
        message: "Feedback can be left once the stay is complete",
      });
    }

    return stay;
  }
}

/**
 * The account a finished stay belongs to.
 *
 * `booking.user_id` is nullable because the desk takes stays that belong to
 * nobody, and the column this writes to is not — so the one case the type admits
 * and the route cannot reach is refused here rather than met with a null inside
 * the insert. Unreachable: `ownBooking` scopes by the account for a session and
 * SQL's equality never matches a null, and the booking-scoped credential a
 * passwordless guest holds is refused this capability before any handler runs.
 * Stated anyway, because the alternative is an unattributable opinion and this
 * table exists to have none.
 */
function accountOn(stay: Booking): string {
  if (!stay.userId) {
    throw new ORPCError("FORBIDDEN", {
      message: "Only the guest who booked a stay may leave feedback on it",
    });
  }

  return stay.userId;
}
