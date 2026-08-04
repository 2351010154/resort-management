CREATE TYPE "public"."housekeeping_status" AS ENUM('CLEAN', 'DIRTY', 'INSPECTED', 'OUT_OF_ORDER');--> statement-breakpoint
CREATE TABLE "room_condition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"status" "housekeeping_status" DEFAULT 'CLEAN' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"note" text,
	CONSTRAINT "room_condition_note_present_when_set" CHECK ("room_condition"."note" is null or length(trim("room_condition"."note")) > 0)
);
--> statement-breakpoint
ALTER TABLE "room_condition" ADD CONSTRAINT "room_condition_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_condition" ADD CONSTRAINT "room_condition_updated_by_staff_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "room_condition_room_id_key" ON "room_condition" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "room_condition_status_idx" ON "room_condition" USING btree ("status");--> statement-breakpoint
-- Everything above this line was generated from the schema. This was not.
--
-- Every room needs a condition row, because the check-in guard reads one and a
-- room without one has no answer to give — and a guard that admits a guest on a
-- missing row is one that fails open. The rows for the forty rooms the seed
-- writes are the seed's own (`seed/seed.ts`); this statement is for a database
-- that already holds rooms when the migration arrives, which is every
-- environment the property has been seeded into.
--
-- On a fresh database `room` is empty and this inserts nothing, which is
-- correct: the seed that creates the rooms creates their conditions with them.
INSERT INTO "room_condition" ("room_id") SELECT "id" FROM "room";