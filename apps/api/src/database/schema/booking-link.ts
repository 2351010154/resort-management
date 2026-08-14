// The links a confirmation email carries, and the state that lets each of them
// be followed exactly once.
//
// A file of its own rather than a third table in `booking.ts`, which opens by
// saying what it is — the booking and the price it was sold at. This is neither:
// it is credential delivery, owned by `modules/auth/booking-token` the way
// `guest-auth.ts` is owned by `modules/auth/guest`, and it happens to point at a
// booking for the same reason a session points at a user.
//
// **Why there is a table here at all.** The credential a guest without an
// account holds is a signed cookie and nothing more — `booking-token.service.ts`
// verifies it by arithmetic, reads no row, and is right not to, because it is
// presented on every request under `/bookings`. A mailed link cannot be that.
// A mailbox is forwarded, synced to a second device and left open on a shared
// screen, so a link that stayed good for every reader of it would hand the stay
// to all of them for as long as the mail survives. "Followed already" is a fact
// about the world and not a property of a signature, and a fact is a row.
//
// **One table for both links, because they differ only in what they are for.**
// One re-issues the booking cookie for a guest who cleared theirs; the other
// creates the account a stay is attached to. Both are signed by the same key,
// both die at an instant, and both must be spendable once — so a second table
// would be this one under another name, with a second copy of the consumption
// race to get right. The purpose is a column, and the door that redeems a link
// names the purpose it will accept, so a link mailed for one cannot be spent at
// the other.
//
// **Consumption is a conditional `UPDATE` and never a read followed by a
// write.** Two clicks on one link arrive as two statements against one row; the
// second waits for the first, re-reads the row Postgres has just written and
// finds the instant already set, so exactly one of them redeems. A handler that
// selected, decided and then updated would have both of them decide before
// either wrote.
//
// What is deliberately *not* here:
//
// - **The signed text.** The signature is computed over this row's id, so what
//   is stored is the address of the link and not the credential itself. Keeping
//   the token would put a bearer credential in a table that support staff read.
// - **The address it was mailed to.** `booking.contact_email` is where the mail
//   went and this row is what the mail carried; copying it here would be a
//   second place for it to be wrong, and this table is not a delivery log.
// - **An index on the booking.** Every read of this table so far is by primary
//   key, which the key itself serves. "Which live links does this stay have?" is
//   the question an index would be for, and nothing asks it yet.
// - **A sweep.** A consumed or expired row is refused by the predicate below
//   whatever its age, so nothing here depends on old rows being gone. Deleting
//   them is retention housekeeping, and it belongs with the rest of it.

import { sql } from "drizzle-orm";
import {
  check,
  pgEnum,
  pgTable,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { booking } from "./booking.js";

/**
 * What a link is for — the two things a confirmation email offers.
 *
 * `STAY_REISSUE` re-mints the booking cookie for one stay, and is not a login:
 * it grants exactly what the hold's cookie granted. `ACCOUNT_CREATE` makes the
 * account the stay is attached to, and only exists in a mail sent to an address
 * that has none.
 *
 * Declared here rather than in `@mariva/shared` because neither value crosses
 * the wire. A guest is handed a signed link and never the word behind it.
 */
export const BOOKING_LINK_PURPOSES = ["STAY_REISSUE", "ACCOUNT_CREATE"] as const;

export type BookingLinkPurpose = (typeof BOOKING_LINK_PURPOSES)[number];

export const bookingLinkPurposeEnum = pgEnum(
  "booking_link_purpose",
  BOOKING_LINK_PURPOSES,
);

/** One mailed link: one booking, one purpose, one use, and a deadline. */
export const bookingLink = pgTable(
  "booking_link",
  {
    // The whole of what the mailed token names. Random rather than sequential
    // because it is signed and then read back by id: an id somebody could count
    // to would let a forged signature be tested against rows that exist.
    id: uuid("id").primaryKey().defaultRandom(),
    // A deleted stay takes its links with it, which is `guest_session`'s rule
    // about a deleted guest and holds here for the same reason: a link whose
    // booking is gone opens nothing, could never be redeemed, and cleaning it up
    // later is a job nobody would remember to write. `audit_entry` restricts
    // instead because a trail has to outlive what it describes — a spent
    // credential does not.
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => booking.id, { onDelete: "cascade" }),
    purpose: bookingLinkPurposeEnum("purpose").notNull(),
    // The two lifetimes this table holds, and they are not close. A re-issue
    // link dies with the credential it re-issues — seven days past checkout —
    // and a create link lives an hour, because it makes an account and an hour
    // is how long a mail takes to be read. `booking-token.service.ts` owns both
    // figures; the column only insists there is one.
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    // When it was followed. Null is the whole of "still spendable", which is why
    // the redeeming statement's `where` is this column being null rather than a
    // boolean somebody sets: a null cannot be written twice.
    consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // A link that expired before it was made could never be followed, so a row
    // carrying one is a mail sent with a dead link in it — a guest locked out of
    // a stay they paid for, reported as nothing at all.
    check(
      "booking_link_outlives_the_mail_that_carried_it",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    // The redeeming statement takes both facts from one `now()`, so a consumed
    // link was live at the instant it was consumed. Stated here because the row
    // is the evidence of what happened: a use dated after the deadline would say
    // the deadline is decided somewhere other than in the database.
    check(
      "booking_link_consumed_while_it_was_live",
      sql`${table.consumedAt} is null or ${table.consumedAt} <= ${table.expiresAt}`,
    ),
  ],
);

export type BookingLinkRow = typeof bookingLink.$inferSelect;
