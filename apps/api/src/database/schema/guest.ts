// Who stayed, on which booking, and who looked at their ID number.
//
// Three tables and one argument running through all of them: a booking is taken
// from somebody who has not been identified yet. `booking.ts` says the same
// thing from the other side — the funnel holds a room and asks for a name
// afterwards — so identity is not a column on the stay. It is a row here, and
// `registration` is the join that says a person was in the building.
//
// The CCCD is stored as it was read. Masking is not a storage format: it is an
// answer the read path gives, and `FR-GST-03` describes it as one — the number
// is masked by default and unmasking is a *distinct capability*, audit-logged
// per call. Keeping a second column with the asterisks already in it would be
// storing a pure function of the column beside it, and the failure that invites
// is an update touching one and not the other, leaving a mask that confidently
// shows the wrong four digits. The confidentiality guarantee lives in the
// capability check and in `cccd_unmask_audit`, which is where the RBAC matrix
// (§3, Guest personal data) puts it.
//
// What is deliberately *not* here:
//
// - **ID scan images.** `FR-GST-02` puts them in a private bucket with a
//   lifecycle rule and no manual delete path, and it is M7's. A path column
//   written before the bucket exists is a pointer to nothing.
// - **VIP tier and loyalty points.** `FR-GST-04` derives the tier and
//   `FR-GST-05` sums an append-only ledger; both are computed from stay and
//   folio history at M7/M9. A stored tier here would be the hand-set value
//   `FR-GST-04` exists to forbid.
// - **A link to a guest account.** `guest_user` is Better Auth's table for the
//   people who log in. Most guests at a front desk never will, and joining the
//   two realms before M7 needs the join would put a nullable key on every walk-in.

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { booking } from "./booking.js";
import { staffUser } from "./identity.js";

/**
 * A person the property has identified.
 *
 * Everything but the name is nullable, and that is the check-in desk being
 * described rather than the schema being lax. A domestic guest hands over a
 * CCCD and no passport; a foreign guest the reverse; a second occupant on the
 * booking may be registered from the first guest's word alone. A `NOT NULL` on
 * any of these would be met by the receptionist typing something — and a
 * required field satisfied with a placeholder is worse than an absent one,
 * because it cannot be told apart from real data afterwards.
 */
export const guest = pgTable(
  "guest",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fullName: text("full_name").notNull(),
    phone: text("phone"),
    email: text("email"),
    // As read off the card. Masked by the read path, never by the writer —
    // this file's header argues why there is no second column holding the
    // asterisks.
    cccdNumber: text("cccd_number"),
    // A calendar date and not an instant, for `booking.check_in_date`'s reason:
    // a birthday is a day in a place, and a timestamp would move it by one in
    // UTC+7.
    dateOfBirth: date("date_of_birth", { mode: "string" }),
    nationality: text("nationality"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    // Guest details are corrected — a misheard name, a phone number taken down
    // wrong, a CCCD typed with a transposed digit. `registration` below is
    // append-only for exactly the opposite reason.
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // One row per CCCD, so a returning guest is found rather than duplicated.
    // Without it the second stay creates a second person, and `FR-GST-01`'s
    // stay history — and the rolling-12-month count `FR-GST-04` derives the VIP
    // tier from — is then split across rows nothing joins back together.
    //
    // Partial, because most rows have no CCCD: a passport-holder and a second
    // occupant registered by name are both null here, and a plain unique index
    // would collapse all of them into one guest.
    uniqueIndex("guest_cccd_number_key")
      .on(table.cccdNumber)
      .where(sql`${table.cccdNumber} is not null`),
    // The front desk's lookup — a guest is found by the phone number on the
    // booking far more often than by anything else. Partial for the same reason
    // as above: an index over the nulls would be mostly nulls.
    index("guest_phone_idx")
      .on(table.phone)
      .where(sql`${table.phone} is not null`),
    // A guest with no name is not identified, and an empty string is how a
    // required field gets filled in when there is nothing to put in it.
    check("guest_has_a_name", sql`length(trim(${table.fullName})) > 0`),
    // The same argument, and it matters more here: a blank CCCD masks to a row
    // of asterisks that looks exactly like a number being withheld. Absent and
    // present-but-empty must stay tellable apart, so only one of them is
    // storable.
    check(
      "guest_cccd_present_when_set",
      sql`${table.cccdNumber} is null or length(trim(${table.cccdNumber})) > 0`,
    ),
  ],
);

/**
 * One person, registered on one booking, at check-in.
 *
 * `booking-state-machine.md` §3 writes these on `CONFIRMED` → `CHECKED_IN`,
 * alongside the mandatory room assignment. That timing is the point: a booking
 * can be cancelled, expire or no-show without anybody ever having been
 * identified, and none of those should leave a registration record behind
 * claiming somebody stayed.
 *
 * The rows are never updated and never deleted. They are the statutory
 * residence record — `ASM-02` is still waiting on written legal advice for how
 * many years that means — and a record that can be edited after the fact is not
 * a record of anything. A registration entered in error is corrected by
 * registering the right guest, leaving both facts visible.
 */
export const registration = pgTable(
  "registration",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => booking.id),
    guestId: uuid("guest_id")
      .notNull()
      .references(() => guest.id),
    // The booking holder, as against the other occupants of the room. The one
    // the folio is addressed to and the desk asks for by name.
    isPrimary: boolean("is_primary").notNull().default(false),
    registeredAt: timestamp("registered_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // The same person registered twice on one stay. Harmless-looking, and it
    // makes the occupant count — which is what a residence report is counted
    // from — depend on how many times somebody pressed the button.
    uniqueIndex("registration_booking_guest_key").on(
      table.bookingId,
      table.guestId,
    ),
    // At most one holder per booking. Two rows claiming to be primary is a
    // folio with two addressees and no rule for choosing, which surfaces at M6
    // as an invoice made out to whichever row was read first.
    uniqueIndex("registration_one_primary_per_booking_key")
      .on(table.bookingId)
      .where(sql`${table.isPrimary}`),
    // `FR-GST-01`'s stay history, read from the guest's side. The composite
    // unique above already covers lookups that lead with the booking.
    index("registration_guest_id_idx").on(table.guestId),
  ],
);

/**
 * One row per time a CCCD number was revealed.
 *
 * `FR-GST-03` makes unmasking audit-logged *per call*, not per session and not
 * per guest — the matrix grants the capability to `MANAGER` and `ADMIN`, and to
 * `RECEPTIONIST` conditionally, so the question this table answers is which
 * named person read which guest's number and when. A count would not answer it
 * and a last-read timestamp would overwrite the answer each time.
 *
 * Append-only, like `registration` and for a sharper reason: an audit trail
 * with a delete path is an audit trail that records only what nobody wanted
 * hidden. `staff_user` rows are deactivated rather than deleted (`identity.ts`)
 * precisely so the key below keeps resolving.
 */
export const cccdUnmaskAudit = pgTable(
  "cccd_unmask_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guestId: uuid("guest_id")
      .notNull()
      .references(() => guest.id),
    // Never null and never a system actor. An unmask is somebody deciding to
    // look; there is no automated path that needs the plain number, and leaving
    // room for one would let the interesting reads be the unattributable ones.
    unmaskedBy: uuid("unmasked_by")
      .notNull()
      .references(() => staffUser.id),
    unmaskedAt: timestamp("unmasked_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    // Optional, because requiring a reason produces a column full of "check
    // in". The attribution above is what makes the read accountable.
    reason: text("reason"),
  },
  // Both questions the audit viewer asks: everything read about this guest, and
  // everything this member of staff read. Neither is answerable from the other.
  (table) => [
    index("cccd_unmask_audit_guest_id_idx").on(table.guestId, table.unmaskedAt),
    index("cccd_unmask_audit_unmasked_by_idx").on(
      table.unmaskedBy,
      table.unmaskedAt,
    ),
  ],
);

export type GuestRow = typeof guest.$inferSelect;
export type RegistrationRow = typeof registration.$inferSelect;
export type CccdUnmaskAuditRow = typeof cccdUnmaskAudit.$inferSelect;
