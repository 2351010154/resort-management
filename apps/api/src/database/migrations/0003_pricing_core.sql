CREATE TYPE "public"."rate_plan_code" AS ENUM('STANDARD', 'BB', 'NONREF');--> statement-breakpoint
CREATE TABLE "rate_calendar" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_type_id" uuid NOT NULL,
	"stay_date" date NOT NULL,
	"gross_per_night" bigint NOT NULL,
	CONSTRAINT "rate_calendar_gross_positive" CHECK ("rate_calendar"."gross_per_night" > 0)
);
--> statement-breakpoint
CREATE TABLE "rate_plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" "rate_plan_code" NOT NULL,
	"name" text NOT NULL,
	"percent_adjustment" smallint DEFAULT 0 NOT NULL,
	"breakfast_per_person_gross" bigint,
	"display_order" smallint NOT NULL,
	CONSTRAINT "rate_plan_code_unique" UNIQUE("code"),
	CONSTRAINT "rate_plan_display_order_unique" UNIQUE("display_order"),
	CONSTRAINT "rate_plan_adjustment_within_bounds" CHECK ("rate_plan"."percent_adjustment" between -100 and 100),
	CONSTRAINT "rate_plan_breakfast_positive_when_set" CHECK ("rate_plan"."breakfast_per_person_gross" is null or "rate_plan"."breakfast_per_person_gross" > 0)
);
--> statement-breakpoint
CREATE TABLE "stay_restriction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_type_id" uuid NOT NULL,
	"stay_date" date NOT NULL,
	"minimum_stay" smallint DEFAULT 1 NOT NULL,
	"maximum_stay" smallint,
	"closed_to_arrival" boolean DEFAULT false NOT NULL,
	"closed_to_departure" boolean DEFAULT false NOT NULL,
	CONSTRAINT "stay_restriction_minimum_at_least_one_night" CHECK ("stay_restriction"."minimum_stay" >= 1),
	CONSTRAINT "stay_restriction_maximum_at_least_minimum" CHECK ("stay_restriction"."maximum_stay" is null or "stay_restriction"."maximum_stay" >= "stay_restriction"."minimum_stay")
);
--> statement-breakpoint
ALTER TABLE "rate_calendar" ADD CONSTRAINT "rate_calendar_room_type_id_room_type_id_fk" FOREIGN KEY ("room_type_id") REFERENCES "public"."room_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stay_restriction" ADD CONSTRAINT "stay_restriction_room_type_id_room_type_id_fk" FOREIGN KEY ("room_type_id") REFERENCES "public"."room_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rate_calendar_room_type_date_key" ON "rate_calendar" USING btree ("room_type_id","stay_date");--> statement-breakpoint
CREATE INDEX "rate_calendar_stay_date_idx" ON "rate_calendar" USING btree ("stay_date");--> statement-breakpoint
CREATE UNIQUE INDEX "stay_restriction_room_type_date_key" ON "stay_restriction" USING btree ("room_type_id","stay_date");--> statement-breakpoint
CREATE INDEX "stay_restriction_stay_date_idx" ON "stay_restriction" USING btree ("stay_date");