CREATE TYPE "public"."room_type_code" AS ENUM('SUPERIOR', 'DELUXE', 'PREMIER', 'JUNIOR_SUITE', 'PANORAMA_SUITE');--> statement-breakpoint
CREATE TABLE "room" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"floor" smallint NOT NULL,
	"room_type_id" uuid NOT NULL,
	CONSTRAINT "room_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "room_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"booking_id" uuid,
	"check_in_date" date NOT NULL,
	"check_out_date" date NOT NULL,
	"closure_reason" text,
	CONSTRAINT "room_assignment_covers_at_least_one_night" CHECK ("room_assignment"."check_out_date" > "room_assignment"."check_in_date")
);
--> statement-breakpoint
CREATE TABLE "room_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" "room_type_code" NOT NULL,
	"name" text NOT NULL,
	"max_occupancy" smallint NOT NULL,
	"bedding_sleeps" smallint NOT NULL,
	"takes_extra_bed" boolean NOT NULL,
	"square_metres" smallint NOT NULL,
	"bedding" text NOT NULL,
	"aspect" text NOT NULL,
	"description" text NOT NULL,
	"display_order" smallint NOT NULL,
	CONSTRAINT "room_type_code_unique" UNIQUE("code"),
	CONSTRAINT "room_type_display_order_unique" UNIQUE("display_order"),
	CONSTRAINT "room_type_max_occupancy_at_least_bedding" CHECK ("room_type"."max_occupancy" >= "room_type"."bedding_sleeps"),
	CONSTRAINT "room_type_extra_bed_closes_the_gap" CHECK ("room_type"."takes_extra_bed" OR "room_type"."max_occupancy" = "room_type"."bedding_sleeps")
);
--> statement-breakpoint
CREATE TABLE "type_inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_type_id" uuid NOT NULL,
	"stay_date" date NOT NULL,
	"total_rooms" smallint NOT NULL,
	"sold_rooms" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "type_inventory_sold_at_most_total" CHECK ("type_inventory"."sold_rooms" <= "type_inventory"."total_rooms"),
	CONSTRAINT "type_inventory_sold_not_negative" CHECK ("type_inventory"."sold_rooms" >= 0),
	CONSTRAINT "type_inventory_total_not_negative" CHECK ("type_inventory"."total_rooms" >= 0)
);
--> statement-breakpoint
ALTER TABLE "room" ADD CONSTRAINT "room_room_type_id_room_type_id_fk" FOREIGN KEY ("room_type_id") REFERENCES "public"."room_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_assignment" ADD CONSTRAINT "room_assignment_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "type_inventory" ADD CONSTRAINT "type_inventory_room_type_id_room_type_id_fk" FOREIGN KEY ("room_type_id") REFERENCES "public"."room_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "room_room_type_id_idx" ON "room" USING btree ("room_type_id");--> statement-breakpoint
CREATE INDEX "room_assignment_room_id_idx" ON "room_assignment" USING btree ("room_id");--> statement-breakpoint
CREATE UNIQUE INDEX "type_inventory_room_type_date_key" ON "type_inventory" USING btree ("room_type_id","stay_date");--> statement-breakpoint
CREATE INDEX "type_inventory_stay_date_idx" ON "type_inventory" USING btree ("stay_date");--> statement-breakpoint
-- Everything above this line was generated from the schema. This was not, and
-- cannot be: `EXCLUDE` has no Drizzle expression, so the constraint that makes
-- two guests in one room unrepresentable is written here by hand and the table
-- in schema/inventory.ts points at this file for it.
--
-- It reads as: no two rows may agree on the room and have stays that overlap.
-- Postgres enforces it inside the index, while the entry is held — so two
-- transactions inserting conflicting stays on one room cannot both commit,
-- however the code that issued them was written. That is the whole thesis:
-- double-booking is refused by the database, not remembered by a service.
--
-- The GiST index carries both halves only because btree_gist is installed —
-- scalar `=` is not something a GiST index can do on its own. The first
-- migration enables the extension and explains why it goes first.
--
-- `[)` is half-open, and it is the difference between a hotel that can sell a
-- room twice in one week and one that cannot sell it at all on a changeover
-- day: the departure date is not a night sold, so a stay ending on the fifth
-- and one beginning on the fifth touch at a boundary and do not overlap.
ALTER TABLE "room_assignment" ADD CONSTRAINT "room_assignment_no_overlap"
	EXCLUDE USING gist (
		"room_id" WITH =,
		daterange("check_in_date", "check_out_date", '[)') WITH &&
	);