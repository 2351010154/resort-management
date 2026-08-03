CREATE TABLE "cccd_unmask_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guest_id" uuid NOT NULL,
	"unmasked_by" uuid NOT NULL,
	"unmasked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "guest" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"phone" text,
	"email" text,
	"cccd_number" text,
	"date_of_birth" date,
	"nationality" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_has_a_name" CHECK (length(trim("guest"."full_name")) > 0),
	CONSTRAINT "guest_cccd_present_when_set" CHECK ("guest"."cccd_number" is null or length(trim("guest"."cccd_number")) > 0)
);
--> statement-breakpoint
CREATE TABLE "registration" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"guest_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cccd_unmask_audit" ADD CONSTRAINT "cccd_unmask_audit_guest_id_guest_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guest"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cccd_unmask_audit" ADD CONSTRAINT "cccd_unmask_audit_unmasked_by_staff_user_id_fk" FOREIGN KEY ("unmasked_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration" ADD CONSTRAINT "registration_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration" ADD CONSTRAINT "registration_guest_id_guest_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guest"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cccd_unmask_audit_guest_id_idx" ON "cccd_unmask_audit" USING btree ("guest_id","unmasked_at");--> statement-breakpoint
CREATE INDEX "cccd_unmask_audit_unmasked_by_idx" ON "cccd_unmask_audit" USING btree ("unmasked_by","unmasked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "guest_cccd_number_key" ON "guest" USING btree ("cccd_number") WHERE "guest"."cccd_number" is not null;--> statement-breakpoint
CREATE INDEX "guest_phone_idx" ON "guest" USING btree ("phone") WHERE "guest"."phone" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "registration_booking_guest_key" ON "registration" USING btree ("booking_id","guest_id");--> statement-breakpoint
CREATE UNIQUE INDEX "registration_one_primary_per_booking_key" ON "registration" USING btree ("booking_id") WHERE "registration"."is_primary";--> statement-breakpoint
CREATE INDEX "registration_guest_id_idx" ON "registration" USING btree ("guest_id");