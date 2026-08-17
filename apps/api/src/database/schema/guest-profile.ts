// What an account holder says about themselves — `FR-GST-01`'s editable half.
//
// This is the fourth thing in a set of four that are easy to mistake for one
// another, and the whole reason it is a table rather than columns somewhere
// else:
//
// - `guest_user` (`guest-auth.ts`) is **who signs in**. Better Auth owns it and
//   indexes it by the keys of the schema object it is handed, so it holds a
//   name, an address and nothing domain-shaped.
// - `guest` (`guest.ts`) is **who the property identified** — read off a card at
//   the desk, corrected by staff when a digit was transposed.
// - `registration` (`guest.ts`) is **who was in the building**: the statutory
//   residence record, append-only, "because a record that can be edited after
//   the fact is not a record of anything".
// - This table is **what the account holder claims about themselves**, so that a
//   future booking and a future check-in can be prefilled from it.
//
// ## Why the claim does not go on `guest`
//
// `registration` denormalises nothing — it carries a booking, a guest, which of
// them was the holder, and when. Its append-only guarantee is therefore exactly
// as strong as the row it points at, and that row is `guest`. Staff correcting a
// misheard name there preserves the record's meaning; the *subject* rewriting
// their own name, birthday and nationality does not. A guest could restate the
// identity behind a 36-month statutory record from a phone, and every
// registration row would still be byte-identical while meaning something else.
//
// So nothing in the guest realm writes to `guest`, and the feed-forward rule
// `FR-GST-01` states — an edit prefills what comes next and never rewrites a
// past registration, booking, folio or invoice — is structural here rather than
// a discipline somebody maintains. There is no path from a profile edit to any
// of those four tables, so the claim is not one a test has to keep watching.
//
// A second reason, smaller and still decisive: `guest_cccd_number_key` makes one
// CCCD one person, so a single `guest` row is deliberately shared across stays
// that different accounts booked — a guest booking for a parent registers the
// parent. "The account's guest row" is therefore not a function, and a `user_id`
// on `guest` would have to arbitrate an ownership nothing here can settle.
//
// This is the join `guest.ts` predicted and declined to make early: "joining the
// two realms before M7 needs the join would put a nullable key on every
// walk-in." Keyed the other way round, on the account, the walk-in majority
// carries no key at all — a guest who never signed up simply has no row here.
//
// ## Why every field is nullable
//
// A profile row is created by the first edit and nothing seeds one. `full_name`
// is nullable because its absence is a real answer with a real fallback — the
// account's own `guest_user.name`, which is `NOT NULL` — and a `NOT NULL` here
// would be met by copying that name in, after which the two could never be told
// apart and neither could be trusted as the thing the guest actually typed.
// `schema/guest.ts` makes the same argument about placeholder-satisfied
// columns, and it is sharper here: nothing in this table is verified against
// anything, so provenance is the only property it has.
//
// ## What is deliberately not here
//
// - **A CCCD.** The number the property holds was read off a document at the
//   desk; a number typed into a profile screen is checked against nothing, and
//   storing one would give the residence record a second, unverified source.
//   The profile *reads* the masked number off the guest record it belongs to and
//   can never write one.
// - **An email address.** The account's address is `guest_user.email`, it is what
//   the guest signs in with, and changing it is Better Auth's own re-verification
//   flow. A second address here would be an address nothing proved.
// - **A tier or a points balance.** `FR-GST-04` derives the first and `FR-GST-05`
//   sums the second; `loyalty.ts` and `guest-tier.ts` both refuse to store
//   either, and a profile row is not the place that decision gets reversed.

import { sql } from "drizzle-orm";
import { check, date, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user as guestUser } from "./guest-auth.js";

/**
 * One account's own account of itself.
 *
 * The primary key *is* the account, so the relationship is one-to-one by the
 * table's shape rather than by a unique index somebody has to keep. An upsert on
 * it is the whole of what `PATCH /profile` does.
 *
 * Deleted with the account, like `guest_session` and for that column's stated
 * reason: a profile whose account is gone describes nobody, and cleaning it up
 * later is a job nobody would remember to write. Nothing statutory is lost with
 * it — the residence record is `registration`, which references `guest` and has
 * no path to this table at all.
 */
export const guestUserProfile = pgTable(
  "guest_user_profile",
  {
    // `text` for `loyalty_ledger.user_id`'s reason: Better Auth generates the
    // guest realm's ids itself.
    userId: text("user_id")
      .primaryKey()
      .references(() => guestUser.id, { onDelete: "cascade" }),
    // What the guest would like to be called. Null falls back to
    // `guest_user.name` — see the header on why the fallback is not copied in.
    fullName: text("full_name"),
    phone: text("phone"),
    // A calendar date and not an instant, for `guest.date_of_birth`'s reason: a
    // birthday is a day in a place, and a timestamp would move it by one in
    // UTC+7.
    dateOfBirth: date("date_of_birth", { mode: "string" }),
    nationality: text("nationality"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    // Every field here is the guest's to change, so unlike `registration` this
    // row is expected to move and says when it last did.
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Absent and present-but-empty must stay tellable apart, which is
    // `guest_cccd_present_when_set`'s argument applied to the three text fields
    // a guest can clear. A blank name would fall through the fallback above
    // silently — the profile would answer with a name nobody typed and nobody
    // could see was missing — so only one of the two is storable, and
    // `guest-profile.service.ts` turns a cleared field into the absence before
    // the write.
    check(
      "guest_user_profile_full_name_present_when_set",
      sql`${table.fullName} is null or length(trim(${table.fullName})) > 0`,
    ),
    check(
      "guest_user_profile_phone_present_when_set",
      sql`${table.phone} is null or length(trim(${table.phone})) > 0`,
    ),
    check(
      "guest_user_profile_nationality_present_when_set",
      sql`${table.nationality} is null or length(trim(${table.nationality})) > 0`,
    ),
  ],
);

export type GuestUserProfileRow = typeof guestUserProfile.$inferSelect;
