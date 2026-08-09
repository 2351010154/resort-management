CREATE TABLE "payment_reconciliation_run" (
	"business_date" date PRIMARY KEY NOT NULL,
	"reconciled_at" timestamp with time zone DEFAULT now() NOT NULL
);
