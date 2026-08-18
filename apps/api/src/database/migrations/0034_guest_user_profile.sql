-- What an account holder says about themselves, so a future booking and a
-- future check-in can be prefilled from it — `FR-GST-01`'s editable half.
--
-- Keyed on the account rather than adding a column to `guest`, and that is the
-- feed-forward rule expressed as a schema instead of as a discipline. A
-- registration row denormalises nothing, so its append-only guarantee is only
-- as strong as the `guest` row it points at; letting the subject rewrite that
-- row would leave every statutory record byte-identical and meaning something
-- else. With the claim in its own table there is no path from a profile edit to
-- a registration, a booking, a folio or an invoice at all.
--
-- Keyed this way round for a second reason too: a walk-in has no account, so the
-- forty-room property's ordinary guest carries no key here — which is the
-- nullable column `schema/guest.ts` declined to put on every guest row.
--
-- Every field is nullable because a row is created by the first edit and nothing
-- seeds one. `full_name` absent falls back to `guest_user.name`; the three
-- checks below keep absent and present-but-empty tellable apart, so a cleared
-- field cannot become a blank that reads like a name nobody typed.
CREATE TABLE "guest_user_profile" (
	"user_id" text PRIMARY KEY NOT NULL,
	"full_name" text,
	"phone" text,
	"date_of_birth" date,
	"nationality" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_user_profile_full_name_present_when_set" CHECK ("guest_user_profile"."full_name" is null or length(trim("guest_user_profile"."full_name")) > 0),
	CONSTRAINT "guest_user_profile_phone_present_when_set" CHECK ("guest_user_profile"."phone" is null or length(trim("guest_user_profile"."phone")) > 0),
	CONSTRAINT "guest_user_profile_nationality_present_when_set" CHECK ("guest_user_profile"."nationality" is null or length(trim("guest_user_profile"."nationality")) > 0)
);
--> statement-breakpoint
ALTER TABLE "guest_user_profile" ADD CONSTRAINT "guest_user_profile_user_id_guest_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."guest_user"("id") ON DELETE cascade ON UPDATE no action;