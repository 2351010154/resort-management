CREATE TABLE "pending_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"raised_by_shift_id" uuid NOT NULL,
	"description" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_shift_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pending_item_resolved_exactly_when_a_shift_cleared_it" CHECK (("pending_item"."resolved_at" is null) = ("pending_item"."resolved_by_shift_id" is null))
);
--> statement-breakpoint
CREATE TABLE "shift" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"opening_float" bigint NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opening_business_date" date NOT NULL,
	"closing_count" bigint,
	"closed_at" timestamp with time zone,
	"handover_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shift_closed_exactly_when_counted" CHECK (("shift"."closing_count" is null) = ("shift"."closed_at" is null))
);
--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "shift_id" uuid;--> statement-breakpoint
ALTER TABLE "pending_item" ADD CONSTRAINT "pending_item_raised_by_shift_id_shift_id_fk" FOREIGN KEY ("raised_by_shift_id") REFERENCES "public"."shift"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_item" ADD CONSTRAINT "pending_item_resolved_by_shift_id_shift_id_fk" FOREIGN KEY ("resolved_by_shift_id") REFERENCES "public"."shift"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift" ADD CONSTRAINT "shift_operator_id_staff_user_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pending_item_raised_by_shift_idx" ON "pending_item" USING btree ("raised_by_shift_id");--> statement-breakpoint
CREATE INDEX "pending_item_unresolved_idx" ON "pending_item" USING btree ("created_at") WHERE "pending_item"."resolved_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "shift_one_open_per_operator" ON "shift" USING btree ("operator_id") WHERE "shift"."closed_at" is null;--> statement-breakpoint
CREATE INDEX "shift_operator_idx" ON "shift" USING btree ("operator_id");--> statement-breakpoint
CREATE INDEX "shift_opened_at_idx" ON "shift" USING btree ("opened_at");--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_shift_id_shift_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shift"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_shift_idx" ON "payment" USING btree ("shift_id");--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_shift_binding" CHECK (("payment"."method" = 'CASH') = ("payment"."shift_id" is not null));