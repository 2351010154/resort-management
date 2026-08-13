ALTER TABLE "booking" ADD COLUMN "held_by" text;--> statement-breakpoint
CREATE INDEX "booking_held_by_idx" ON "booking" USING btree ("held_by") WHERE "booking"."state" = 'HELD';--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_held_by_only_while_held" CHECK ("booking"."held_by" is null or "booking"."state" = 'HELD');