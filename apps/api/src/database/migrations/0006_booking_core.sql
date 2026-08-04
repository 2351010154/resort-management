CREATE TYPE "public"."booking_state" AS ENUM('HELD', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW');--> statement-breakpoint
CREATE TYPE "public"."cancellation_reason" AS ENUM('HOLD_EXPIRED', 'GUEST_REQUEST', 'STAFF_ERROR', 'PAYMENT_FAILED', 'OVERBOOK_WALK', 'FORCE_MAJEURE');--> statement-breakpoint
CREATE TABLE "booking" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"state" "booking_state" NOT NULL,
	"cancellation_reason" "cancellation_reason",
	"room_type_id" uuid NOT NULL,
	"check_in_date" date NOT NULL,
	"check_out_date" date NOT NULL,
	"rate_plan_code" "rate_plan_code" NOT NULL,
	"adults" smallint NOT NULL,
	"child_ages" smallint[] DEFAULT '{}' NOT NULL,
	"quoted_stay_total_gross" bigint NOT NULL,
	"quoted_percent_adjustment" smallint NOT NULL,
	"quoted_breakfast_per_person_gross" bigint,
	"quoted_extra_person_per_night_gross" bigint NOT NULL,
	"hold_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_reference_unique" UNIQUE("reference"),
	CONSTRAINT "booking_covers_at_least_one_night" CHECK ("booking"."check_out_date" > "booking"."check_in_date"),
	CONSTRAINT "booking_reason_exactly_when_cancelled" CHECK (("booking"."state" = 'CANCELLED') = ("booking"."cancellation_reason" is not null)),
	CONSTRAINT "booking_hold_expiry_exactly_when_held" CHECK (("booking"."state" = 'HELD') = ("booking"."hold_expires_at" is not null)),
	CONSTRAINT "booking_has_an_adult" CHECK ("booking"."adults" >= 1),
	CONSTRAINT "booking_child_ages_are_ages" CHECK (0 <= all("booking"."child_ages")),
	CONSTRAINT "booking_quoted_total_positive" CHECK ("booking"."quoted_stay_total_gross" > 0),
	CONSTRAINT "booking_quoted_adjustment_within_bounds" CHECK ("booking"."quoted_percent_adjustment" between -100 and 100),
	CONSTRAINT "booking_quoted_breakfast_positive_when_set" CHECK ("booking"."quoted_breakfast_per_person_gross" is null or "booking"."quoted_breakfast_per_person_gross" > 0),
	CONSTRAINT "booking_quoted_extra_person_positive" CHECK ("booking"."quoted_extra_person_per_night_gross" > 0)
);
--> statement-breakpoint
CREATE TABLE "booking_night" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"stay_date" date NOT NULL,
	"standard_gross" bigint NOT NULL,
	CONSTRAINT "booking_night_gross_positive" CHECK ("booking_night"."standard_gross" > 0)
);
--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_room_type_id_room_type_id_fk" FOREIGN KEY ("room_type_id") REFERENCES "public"."room_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_night" ADD CONSTRAINT "booking_night_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_state_check_in_date_idx" ON "booking" USING btree ("state","check_in_date");--> statement-breakpoint
CREATE INDEX "booking_hold_expires_at_idx" ON "booking" USING btree ("hold_expires_at") WHERE "booking"."hold_expires_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_night_booking_date_key" ON "booking_night" USING btree ("booking_id","stay_date");--> statement-breakpoint
CREATE INDEX "room_assignment_booking_id_idx" ON "room_assignment" USING btree ("booking_id");--> statement-breakpoint
-- Everything above this line was generated from the schema. This was not, and
-- schema/inventory.ts says why: declaring the reference in Drizzle would close
-- an import cycle through booking.ts and pricing.ts, and the enum booking.ts
-- calls at load time would be undefined depending on which file was imported
-- first.
--
-- room_assignment.booking_id has carried an unconstrained id since M3, because
-- there was no table to point at. There is now. Without this line a typo in a
-- booking id holds a room against nothing — inventory consumed by a stay no
-- query can find, and no error anywhere.
ALTER TABLE "room_assignment" ADD CONSTRAINT "room_assignment_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE no action ON UPDATE no action;