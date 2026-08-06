CREATE TYPE "public"."charge_basis" AS ENUM('NONE', 'FIRST_NIGHT', 'FULL_STAY', 'REMAINING_NIGHTS_HALF', 'REMAINING_NIGHTS_FULL');--> statement-breakpoint
CREATE TYPE "public"."folio_state" AS ENUM('OPEN', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."posting_type" AS ENUM('ROOM_CHARGE', 'SERVICE_ITEM', 'SERVICE_CHARGE_FEE', 'VAT', 'POLICY_CHARGE', 'PAYMENT', 'REFUND', 'REVERSAL');--> statement-breakpoint
CREATE TABLE "folio" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"state" "folio_state" DEFAULT 'OPEN' NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "folio_booking_id_unique" UNIQUE("booking_id"),
	CONSTRAINT "folio_closed_at_exactly_when_closed" CHECK (("folio"."state" = 'CLOSED') = ("folio"."closed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "folio_posting" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"folio_id" uuid NOT NULL,
	"type" "posting_type" NOT NULL,
	"amount" bigint NOT NULL,
	"description" text NOT NULL,
	"reverses_posting_id" uuid,
	"parent_posting_id" uuid,
	"service_catalog_id" uuid,
	"charge_basis" charge_basis,
	"business_date" date NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"posted_by" uuid,
	CONSTRAINT "folio_posting_reverses_exactly_when_reversal" CHECK (("folio_posting"."type" = 'REVERSAL') = ("folio_posting"."reverses_posting_id" is not null)),
	CONSTRAINT "folio_posting_does_not_reverse_itself" CHECK ("folio_posting"."reverses_posting_id" is distinct from "folio_posting"."id"),
	CONSTRAINT "folio_posting_derives_exactly_when_a_tax_line" CHECK (("folio_posting"."type" in ('SERVICE_CHARGE_FEE', 'VAT')) = ("folio_posting"."parent_posting_id" is not null)),
	CONSTRAINT "folio_posting_does_not_derive_from_itself" CHECK ("folio_posting"."parent_posting_id" is distinct from "folio_posting"."id"),
	CONSTRAINT "folio_posting_names_a_service_item_exactly_when_it_is_one" CHECK (("folio_posting"."type" = 'SERVICE_ITEM') = ("folio_posting"."service_catalog_id" is not null)),
	CONSTRAINT "folio_posting_names_a_basis_exactly_when_a_policy_charge" CHECK (("folio_posting"."type" = 'POLICY_CHARGE') = ("folio_posting"."charge_basis" is not null)),
	CONSTRAINT "folio_posting_sign_matches_type" CHECK (case "folio_posting"."type"
        when 'PAYMENT' then "folio_posting"."amount" <= 0
        when 'REVERSAL' then true
        else "folio_posting"."amount" >= 0
      end)
);
--> statement-breakpoint
ALTER TABLE "folio" ADD CONSTRAINT "folio_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folio_posting" ADD CONSTRAINT "folio_posting_folio_id_folio_id_fk" FOREIGN KEY ("folio_id") REFERENCES "public"."folio"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folio_posting" ADD CONSTRAINT "folio_posting_reverses_posting_id_folio_posting_id_fk" FOREIGN KEY ("reverses_posting_id") REFERENCES "public"."folio_posting"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folio_posting" ADD CONSTRAINT "folio_posting_parent_posting_id_folio_posting_id_fk" FOREIGN KEY ("parent_posting_id") REFERENCES "public"."folio_posting"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folio_posting" ADD CONSTRAINT "folio_posting_service_catalog_id_service_catalog_id_fk" FOREIGN KEY ("service_catalog_id") REFERENCES "public"."service_catalog"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folio_posting" ADD CONSTRAINT "folio_posting_posted_by_staff_user_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "folio_posting_folio_idx" ON "folio_posting" USING btree ("folio_id");--> statement-breakpoint
CREATE UNIQUE INDEX "folio_posting_reversal_unique_key" ON "folio_posting" USING btree ("reverses_posting_id") WHERE "folio_posting"."reverses_posting_id" is not null;--> statement-breakpoint
-- Everything above this line was generated from the schema. This was not, and
-- cannot be: a trigger has no Drizzle expression, so the guarantee that makes
-- `FR-FOL-01` a fact rather than a habit is written here by hand and
-- schema/folio.ts points at this file for it.
--
-- It reads as: a posting is written once. `FR-FOL-01` says a mistake is
-- corrected by a reversing entry, "never an `UPDATE` or `DELETE`", and this is
-- the sentence enforced against every client that ever opens this database —
-- the API, a migration, a support script, a `psql` session. A service that
-- refused to issue those statements would be a rule that holds until the next
-- caller.
--
-- A `RULE … DO INSTEAD NOTHING` was the alternative and is worse in the way
-- that matters: the statement would succeed, the client would be told a row was
-- changed, and nothing would have been. A ledger that quietly discards an
-- `UPDATE` hides the very edit it was built to prevent. The trigger raises
-- instead, so the transaction that tried it cannot commit and the caller is
-- told which rule it hit.
--
-- The SQLSTATE is this system's own — five characters in a class the standard
-- reserves for implementations — so a folio route can tell this refusal from any
-- other error a function might raise, without matching on message text.
CREATE FUNCTION folio_posting_refuse_rewrite() RETURNS trigger
	LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION
		'folio_posting is append-only: % is refused, post a reversing entry instead',
		lower(TG_OP)
		USING ERRCODE = 'MV001';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "folio_posting_is_append_only"
	BEFORE UPDATE OR DELETE ON "folio_posting"
	FOR EACH ROW EXECUTE FUNCTION folio_posting_refuse_rewrite();
