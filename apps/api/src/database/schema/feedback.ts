// What a guest thought of a stay they have finished.
//
// One table, one row per stay, and every constraint on it is arguing the same
// thing: an opinion is worth nothing unless it is attributable to a person who
// actually stayed, about a stay that actually ended, and unless it says the same
// thing tomorrow as it said when it was written.
//
// **The state that makes a stay rateable is not stored here.** A row exists only
// for a booking that had reached `CHECKED_OUT` when it was written, and the
// service is what refuses the rest; copying the state onto this row would be a
// second answer to "was this stay finished?", and the two would disagree the
// first time a booking moved after the fact. `booking.state` is the answer, and
// this table joins to it.
//
// What is deliberately *not* here:
//
// - **An update path.** Nothing in the module writes this row twice and no route
//   offers to. An opinion that can be rewritten after the property has read it
//   is not a record of what the guest thought when they left, and a rating that
//   moved would quietly restate every average ever computed from it. A guest who
//   wants to say something else says it to the desk.
// - **A staff reply, a resolution flag, a "read" marker.** The matrix gives
//   `MANAGER` and `ADMIN` a 👁 over this row and nothing more — reading is the
//   whole of the authority granted, so there is no column here for an act
//   nobody may perform.
// - **A score the property computes.** An average over these rows is a query,
//   and a stored one would be a number that has to be maintained by whoever
//   remembers to.

import { sql } from "drizzle-orm";
import {
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { booking } from "./booking.js";
import { user as guestUser } from "./guest-auth.js";

/**
 * One stay, rated once, by the account that owns it.
 *
 * `user_id` is the guest realm's account and not `guest.id`, the person the desk
 * identified at check-in. The two are different facts and this row wants the
 * first: `registration` records who slept in the room, which may be a parent, a
 * colleague or a second occupant registered from somebody else's word, while
 * this records who wrote the sentence — and only a signed-in account can, since
 * the booking-scoped credential a passwordless guest holds is refused this
 * capability outright. It is the same column `guest_user_profile`,
 * `loyalty_ledger` and the tier trail key on, for the same reason: those
 * are all facts about an account rather than about a registration.
 *
 * It is `NOT NULL` although `booking.user_id` is nullable, and that difference
 * is the point. A stay the desk took belongs to no account, so the booking
 * column has to admit null; a piece of feedback with no author is not a quieter
 * opinion but an unattributable one, and this column is what makes "every row
 * here was written by somebody" a guarantee of the database rather than a
 * consequence of whichever `where` clause the handler happened to use.
 */
export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => booking.id),
    userId: text("user_id")
      .notNull()
      .references(() => guestUser.id),
    // A count on a five-rung scale, so `integer` — not the `bigint` money is
    // carried in, which exists because a đồng figure summed over a history
    // outgrows what a JavaScript `number` holds exactly. A rating never does.
    rating: integer("rating").notNull(),
    // Optional, because a rating with nothing written beside it is a complete
    // answer and the ordinary one. Requiring a sentence produces a column full
    // of "good".
    comment: text("comment"),
    // The moment somebody pressed the button, and never a stay date — this is
    // an instant in the property's life rather than a day in a place, so it
    // takes a timestamp where `booking.check_in_date` takes a `date`.
    submittedAt: timestamp("submitted_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // A stay is rated once, settled here rather than by the handler looking
    // first. Two presses arriving together would both find nothing and both
    // insert, and a check written in application code would let the second one
    // through — so the second write is refused by the index and the service
    // turns that refusal into an answer. It is also what keeps an average over
    // these rows an average over stays: without it one enthusiastic guest could
    // weigh as much as ten.
    uniqueIndex("feedback_booking_key").on(table.bookingId),
    // The scale, repeated where the wire schema already states it. A bound
    // enforced only at the edge is a bound any other writer walks around — a
    // seeder, a backfill, a psql session — and a rating of 0 or 47 corrupts
    // every figure ever computed from this column without failing anything.
    check(
      "feedback_rating_within_the_scale",
      sql`${table.rating} between 1 and 5`,
    ),
    // Absent and present-but-empty must stay tellable apart, exactly as they
    // must for a guest's document number: a comment of two spaces reads to
    // whoever opens it as a guest who wrote something the property lost.
    check(
      "feedback_comment_present_when_set",
      sql`${table.comment} is null or length(trim(${table.comment})) > 0`,
    ),
  ],
);

export type FeedbackRow = typeof feedback.$inferSelect;
