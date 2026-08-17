-- A tier is derived, so the fact worth storing is not the tier but the night it
-- moved.
--
-- `FR-GST-04` requires two things that pull in opposite directions: the VIP tier
-- is "a **derived value**, never hand-set", and "a tier change writes an audit
-- row". Nothing that computes a tier on read can satisfy the second — it has no
-- previous answer to compare against — so the change is noticed by a
-- recomputation running against the record of the last one, and this table is
-- that record. It holds observations, never the tier: the answer to "what tier
-- is this guest" stays the derivation's, over the guest's own trailing twelve
-- months, and a reader taking the last row here for it has read a different
-- fact.
--
-- `audit_entry` cannot hold this row, and the reasons are that table's stated
-- design rather than gaps in it: `row_id` is `uuid` where a guest account id is
-- Better Auth's text, `actor_id` is NOT NULL against `staff_user` and a rollover
-- sweep has no actor, and `before`/`after` are whole rows rendered by `to_jsonb`
-- under a `table_name` naming the physical table they came from — where a
-- derived tier has neither a row nor a table. Bending the one table every other
-- audited act shares into those three shapes would cost far more than a trail of
-- its own.
--
-- **No row for a guest means the guest was MEMBER.** Exact rather than
-- conventional: MEMBER is the absence of a match, so silence here says what the
-- derivation would say, and the first recomputation after this lands writes rows
-- only for the guests actually standing above the base tier instead of a
-- baseline row for every account the property has ever opened. The same sentence
-- is what a null `from_tier` means, which is why the constraint below refuses to
-- let that side spell MEMBER as a word: the tier a change moved *from* is
-- recovered from this trail, and one absence must not have two spellings.
--
-- `to_tier` is the opposite kind of value and can say MEMBER, because a trailing
-- window moves and a guest who was Silver falls back to the base tier — which is
-- a change worth recording and cannot be recorded in a domain with no word for
-- where they landed. That is why `derived_tier` exists beside `loyalty_tier`
-- rather than widening it: `promotion.requires_loyalty_tier` states the tier a
-- discount is *gated on*, §7 gives the base tier no discount, and a promotion
-- gated on MEMBER would be gated on nothing.
CREATE TYPE "public"."derived_tier" AS ENUM('MEMBER', 'SILVER', 'GOLD');--> statement-breakpoint
CREATE TABLE "guest_tier_change" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"from_tier" "derived_tier",
	"to_tier" "derived_tier" NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_tier_change_from_member_is_the_absence" CHECK ("guest_tier_change"."from_tier" is distinct from 'MEMBER'),
	CONSTRAINT "guest_tier_change_records_a_change" CHECK ("guest_tier_change"."to_tier" <> coalesce("guest_tier_change"."from_tier", 'MEMBER'))
);
--> statement-breakpoint
ALTER TABLE "guest_tier_change" ADD CONSTRAINT "guest_tier_change_user_id_guest_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."guest_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guest_tier_change_user_observed_at_idx" ON "guest_tier_change" USING btree ("user_id","observed_at");--> statement-breakpoint
-- A guest's previous tier is the last row of this trail, so a row that can be
-- rewritten is a previous tier that can be rewritten — and the recomputation
-- that reads it would then record a promotion that already happened, or miss one
-- that did. A log of when something changed which can itself be changed is a log
-- of nothing. Keep the invariant in Postgres, where it holds for the sweep, for
-- a support script and for anybody at a psql prompt alike, exactly as
-- `loyalty_ledger` and `folio_posting` do.
--
-- Each append-only boundary raises its own SQLSTATE so a caller that catches a
-- refusal knows which one refused without matching message text. `MV001` and
-- `MV002` are the folio's, `MV003` its invoice reference and `MV004` the loyalty
-- ledger's; this trail takes `MV005`.
CREATE FUNCTION guest_tier_change_refuse_rewrite() RETURNS trigger
	LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION
		'guest_tier_change is append-only: % is refused',
		lower(TG_OP)
		USING ERRCODE = 'MV005';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "guest_tier_change_is_append_only"
	BEFORE UPDATE OR DELETE ON "guest_tier_change"
	FOR EACH ROW EXECUTE FUNCTION guest_tier_change_refuse_rewrite();
