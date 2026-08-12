-- The table lands here; its append-only trigger follows in 0023 so databases
-- that had already applied this branch migration receive the invariant too.
CREATE TABLE "loyalty_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"folio_id" uuid NOT NULL,
	"points_earned" bigint NOT NULL,
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" date NOT NULL,
	"note" text,
	CONSTRAINT "loyalty_ledger_folio_id_unique" UNIQUE("folio_id"),
	CONSTRAINT "loyalty_ledger_accrues_only" CHECK ("loyalty_ledger"."points_earned" >= 0)
);
--> statement-breakpoint
ALTER TABLE "booking" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_user_id_guest_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."guest_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_folio_id_folio_id_fk" FOREIGN KEY ("folio_id") REFERENCES "public"."folio"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "loyalty_ledger_user_expires_at_idx" ON "loyalty_ledger" USING btree ("user_id","expires_at");--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_user_id_guest_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."guest_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_user_id_idx" ON "booking" USING btree ("user_id") WHERE "booking"."user_id" is not null;
