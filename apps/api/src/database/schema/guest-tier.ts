// When a guest's rung on §7's ladder moved — `FR-GST-04`, and
// `docs/architecture/property-and-tariff.md` §7.
//
// **This is a log of observations, not the tier.** `FR-GST-04` opens with "VIP
// tier is a **derived value**, never hand-set", and `tier-derivation.service.ts`
// is the only answer to what tier a guest holds: it reads the thresholds and the
// guest's own trailing twelve months and works it out, every time it is asked.
// A reader who takes the last row here as the current tier has read the wrong
// column of the wrong table. The rows say what the nightly recomputation *saw*,
// on the night it looked, which is a different fact and the one the requirement
// asks to be recorded — "a tier change writes an audit row".
//
// The relationship is the one `loyalty.ts` draws between the ledger and a
// balance, turned around. There, the sum of the rows *is* the answer and a
// balance column would be a second authority. Here the answer is computed from
// history that has nothing to do with this table, and these rows are a second
// thing entirely: the trail of when it changed. Storing a tier here to be read
// back would be the stale column `schema/guest.ts` refuses, arrived at by a
// longer route — correct only until the window moves under it, silently,
// because nothing walks past it.
//
// ## Why the trail is its own table and not `audit_entry`
//
// `schema/audit.ts` cannot hold this row, and the reasons are that file's stated
// design rather than gaps in it. `row_id` is `uuid`, where a guest account id is
// Better Auth's base-62 text (`guest-auth.ts` says why that realm mints its own
// keys), so an audit row could not address the guest it is about. `actor_id` is
// NOT NULL against `staff_user`, and a rollover sweep has no actor. And
// `before`/`after` are documented there as whole rows rendered by `to_jsonb`
// under a `table_name` naming the physical table they came from — a derived tier
// has neither a row nor a table, so it would be the first snapshot in that log
// that is not a snapshot.
//
// Bending `audit_entry` into those three shapes would widen the one table every
// other audited act in the tree shares. This is one purpose-built trail instead,
// and nothing else changes.
//
// ## No row for a guest means the guest was MEMBER
//
// Exact, not a convention. MEMBER is the absence of a match — a guest who
// reached neither rung is one, and a guest with no history at all is one — so a
// trail that is silent about an account is saying the same thing the derivation
// would. That is what lets the first sweep of a new deployment write rows only
// for the guests who are actually above the base tier, instead of a baseline row
// for every account the property has ever opened.
//
// The same sentence is what {@link guestTierChange.fromTier} being null means,
// which is why that column is nullable and never holds `MEMBER`: the tier a
// change moved *from* is recovered from this trail, and what the trail says when
// it says nothing is MEMBER. `to_tier` is the opposite kind of value — it is
// what the sweep derived and looked at, and deriving MEMBER is a positive
// finding — so it is NOT NULL and it can say so.
//
// This memory has no expiry, and it has to be said out loud because it is load
// bearing: if a retention policy ever purges these rows, a guest's previous tier
// silently becomes MEMBER and the next sweep records a promotion that already
// happened. `schema/audit.ts` makes the same choice for the same reason and
// declines to add the column.

import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { user as guestUser } from "./guest-auth.js";

/**
 * The three rungs of §7's ladder, in the order it climbs them.
 *
 * `pricing.ts`'s `loyalty_tier` is **not** widened to hold the third, and the
 * two types are different questions rather than a duplication.
 * `promotion.requires_loyalty_tier` states the tier a discount is *gated on*,
 * and `packages/shared/src/rate-calendar.ts` says why MEMBER cannot appear
 * there: §7 gives the base tier no discount, so a promotion gated on it would be
 * gated on nothing, and the column says that already by being null.
 *
 * A tier a guest *fell back to* is the opposite case. A trailing window moves,
 * a stay ages out, and a guest who was Silver is a MEMBER again — which is a
 * change worth recording and cannot be recorded in a domain that has no word
 * for where they landed.
 */
export const DERIVED_TIERS = ["MEMBER", "SILVER", "GOLD"] as const;

/**
 * A tier as the derivation answers it, which is the only way one is ever
 * produced.
 */
export const derivedTierEnum = pgEnum("derived_tier", DERIVED_TIERS);

/**
 * One observation: the night the recomputation found a guest on a different rung
 * from the one it last recorded for them.
 *
 * Append-only, held by a trigger rather than by a habit — a log of when
 * something changed that can itself be changed is a log of nothing. The
 * migration that creates it says so beside the trigger.
 *
 * There is no row on a night a guest did not move, which is the whole of the
 * idempotency: the sweep derives, compares against the last row, and writes only
 * on a difference. Running it twice over one night therefore writes once, and
 * the second run is refused by there being nothing to say rather than by a
 * unique key — the tier could genuinely change twice in a guest's life, so the
 * pair is not unique and must not be.
 */
export const guestTierChange = pgTable(
  "guest_tier_change",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // `text` for `loyalty_ledger.user_id`'s reason: Better Auth generates the
    // guest realm's ids itself.
    userId: text("user_id")
      .notNull()
      .references(() => guestUser.id),
    // Where the trail said the guest was. Null is MEMBER — see the header, and
    // the constraint below that keeps it the only spelling of it.
    fromTier: derivedTierEnum("from_tier"),
    // What the recomputation derived. MEMBER is a finding here rather than an
    // absence, because a guest falling back to the base tier is the case this
    // column exists to be able to record.
    toTier: derivedTierEnum("to_tier").notNull(),
    // An instant, not a business date. The recomputation happens at a moment and
    // the question this column answers is "when did we notice" — where
    // `loyalty_ledger.expires_at` is a calendar date because a point stops being
    // spendable at the end of a day in Ho Chi Minh City. Nothing here has a day
    // boundary in it.
    observedAt: timestamp("observed_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // The sweep's read, which is the only read of this table: the latest
    // observation for a guest. Leading with the account and ordering by the
    // instant is what lets `order by observed_at desc limit 1` be answered
    // walking the index backwards rather than sorting the guest's whole history.
    index("guest_tier_change_user_observed_at_idx").on(
      table.userId,
      table.observedAt,
    ),
    // MEMBER on the *from* side is written as the absence and never as the word,
    // so the trail has one spelling of it. Without this a writer could record
    // `MEMBER -> SILVER` while the guest's silence records the same move as
    // `null -> SILVER`, and a reader comparing two guests' histories would have
    // to know both.
    check(
      "guest_tier_change_from_member_is_the_absence",
      sql`${table.fromTier} is distinct from 'MEMBER'`,
    ),
    // A row that records no change is not an observation of one. `coalesce`
    // rather than a null check because the constraint above has already fixed
    // what a null on the left means, and the comparison the row has to survive
    // is against the tier the guest actually held.
    check(
      "guest_tier_change_records_a_change",
      sql`${table.toTier} <> coalesce(${table.fromTier}, 'MEMBER')`,
    ),
  ],
);

export type GuestTierChangeRow = typeof guestTierChange.$inferSelect;
