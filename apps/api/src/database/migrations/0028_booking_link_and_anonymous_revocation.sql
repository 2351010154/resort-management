CREATE TYPE "public"."booking_link_purpose" AS ENUM('STAY_REISSUE', 'ACCOUNT_CREATE');--> statement-breakpoint
CREATE TABLE "booking_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"purpose" "booking_link_purpose" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_link_outlives_the_mail_that_carried_it" CHECK ("booking_link"."expires_at" > "booking_link"."created_at"),
	CONSTRAINT "booking_link_consumed_while_it_was_live" CHECK ("booking_link"."consumed_at" is null or "booking_link"."consumed_at" <= "booking_link"."expires_at")
);
--> statement-breakpoint
ALTER TABLE "booking" ADD COLUMN "anon_access_revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "booking_link" ADD CONSTRAINT "booking_link_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_revokes_anonymous_access_only_with_an_account" CHECK ("booking"."anon_access_revoked_at" is null or "booking"."user_id" is not null);