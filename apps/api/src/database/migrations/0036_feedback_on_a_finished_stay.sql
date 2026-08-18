CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"rating" integer NOT NULL,
	"comment" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_rating_within_the_scale" CHECK ("feedback"."rating" between 1 and 5),
	CONSTRAINT "feedback_comment_present_when_set" CHECK ("feedback"."comment" is null or length(trim("feedback"."comment")) > 0)
);
--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_guest_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."guest_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_booking_key" ON "feedback" USING btree ("booking_id");