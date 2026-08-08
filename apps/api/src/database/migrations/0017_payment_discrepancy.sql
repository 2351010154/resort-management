CREATE TYPE "public"."payment_discrepancy_kind" AS ENUM('MISSING_LOCALLY', 'MISSING_AT_GATEWAY', 'AMOUNT_MISMATCH');--> statement-breakpoint
CREATE TABLE "payment_discrepancy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_date" date NOT NULL,
	"attempt_reference" text NOT NULL,
	"kind" "payment_discrepancy_kind" NOT NULL,
	"gateway_amount" bigint,
	"ledger_amount" bigint,
	"payment_id" uuid,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_discrepancy_amounts_are_positive" CHECK (("payment_discrepancy"."gateway_amount" is null or "payment_discrepancy"."gateway_amount" > 0)
        and ("payment_discrepancy"."ledger_amount" is null or "payment_discrepancy"."ledger_amount" > 0)),
	CONSTRAINT "payment_discrepancy_kind_matches_the_sides" CHECK (case "payment_discrepancy"."kind"
        when 'MISSING_LOCALLY' then
          "payment_discrepancy"."gateway_amount" is not null
            and "payment_discrepancy"."ledger_amount" is null
            and "payment_discrepancy"."payment_id" is null
        when 'MISSING_AT_GATEWAY' then
          "payment_discrepancy"."gateway_amount" is null
            and "payment_discrepancy"."ledger_amount" is not null
            and "payment_discrepancy"."payment_id" is not null
        when 'AMOUNT_MISMATCH' then
          "payment_discrepancy"."gateway_amount" is not null
            and "payment_discrepancy"."ledger_amount" is not null
            and "payment_discrepancy"."payment_id" is not null
            and "payment_discrepancy"."gateway_amount" <> "payment_discrepancy"."ledger_amount"
      end)
);
--> statement-breakpoint
ALTER TABLE "payment_discrepancy" ADD CONSTRAINT "payment_discrepancy_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_discrepancy_business_date_attempt_unique_key" ON "payment_discrepancy" USING btree ("business_date","attempt_reference");