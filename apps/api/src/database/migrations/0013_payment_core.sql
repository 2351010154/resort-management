CREATE TYPE "public"."payment_method" AS ENUM('VNPAY', 'CASH', 'BANK_TRANSFER');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('PENDING', 'SUCCESS', 'FAILED', 'REFUNDED');--> statement-breakpoint
CREATE TABLE "payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"folio_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"gateway_transaction_id" text,
	"amount" bigint NOT NULL,
	"status" "payment_status" NOT NULL,
	"paid_at" timestamp with time zone,
	"posted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_amount_is_positive" CHECK ("payment"."amount" > 0),
	CONSTRAINT "payment_paid_at_exactly_when_money_moved" CHECK (("payment"."status" in ('SUCCESS', 'REFUNDED')) = ("payment"."paid_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_folio_id_folio_id_fk" FOREIGN KEY ("folio_id") REFERENCES "public"."folio"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_posted_by_staff_user_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_gateway_transaction_unique_key" ON "payment" USING btree ("gateway_transaction_id") WHERE "payment"."gateway_transaction_id" is not null;--> statement-breakpoint
CREATE INDEX "payment_folio_idx" ON "payment" USING btree ("folio_id");