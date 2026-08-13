-- Where a funnel booking's confirmation goes, and what to call the person it
-- goes to.
--
-- Nullable, and no backfill, because there is nothing to backfill it with: the
-- rows that exist are stays the desk took, and the desk has never collected a
-- contact address — it hands the confirmation over the counter and takes the
-- guest's document at check-in. A default here would invent a fact about
-- historical bookings; a `NOT NULL` would refuse the walk-in the property still
-- takes every day. The funnel's door requires the pair at the schema level
-- instead, which is `contract/booking.ts`'s split between the two creating
-- inputs.
--
-- Not on `registration`, which is where a name and an address otherwise live.
-- That row is the statutory check-in record — one primary per booking,
-- `registered_at`, and it feeds the residence report — so writing one when a
-- hold is taken would file somebody as resident in a room they have not seen and
-- move the occupancy figures a day or more before anybody arrives.
ALTER TABLE "booking" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "booking" ADD COLUMN "contact_name" text;
