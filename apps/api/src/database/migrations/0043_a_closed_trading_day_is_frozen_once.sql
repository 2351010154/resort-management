-- `FR-RPT-01` — what a trading day came to, written down once and never again.
--
-- `schema/night-audit.ts` carries the columns and the two checks. What needs a
-- migration of its own is the rule a `CHECK` cannot state, because it is not
-- about the contents of a row but about the row continuing to say what it said:
-- the snapshot is immutable.
--
-- ## Frozen, and frozen in Postgres
--
-- The requirement is one clause long: reports read snapshots, so history never
-- changes. Everything downstream rests on it. A manager acts on a December
-- occupancy, an owner is shown a quarter, an ADR is compared against the same
-- month last year — and all three are worthless the moment yesterday's figures
-- can be edited today. `0011` makes this argument for the folio ledger and
-- `0023` for the loyalty one; here it is sharper in one respect, which is that
-- nothing would notice. An edited posting breaks an account that somebody
-- balances; an edited snapshot changes a number on a report nobody can check
-- against anything, because the snapshot *is* what the report is checked
-- against.
--
-- Keeping the invariant in the database rather than in the service is the same
-- trade `0041` makes about the audit trail: a rule the application enforces
-- holds for the application and for nothing else — not for a support script, not
-- for a later migration, not for somebody at a psql prompt at the end of a long
-- night. The night audit inserts and never updates, so the trigger costs it
-- nothing and takes the possibility away from everybody.
--
-- It raises rather than discarding the write with a `RULE ... DO INSTEAD
-- NOTHING`, for `0011`'s reason: a table that quietly swallows an `UPDATE` hides
-- the very edit it exists to prevent, and the caller is told nothing.
--
-- A day frozen wrongly — an audit that ran while a night's charges were still
-- missing — is corrected the way the ledger corrects a mistake, by the postings
-- that follow. `folio.service.ts` dates a reversal to the day it was made on, so
-- the correction lands in the snapshot of the day somebody made it and both days
-- go on saying what was true of them. There is no path that rewrites the first.
--
-- `MV008` is distinct from the other append-only boundaries so that a caller can
-- tell which one refused a write without matching message text. One function
-- serves both tables: they are one fact at two granularities, and a type row
-- edited while its parent stands would be the same lie told about a smaller
-- number.

CREATE TABLE "night_audit_snapshot" (
	"business_date" date PRIMARY KEY NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sellable_rooms" smallint NOT NULL,
	"rooms_sold" smallint NOT NULL,
	"net_room_revenue_vnd" bigint NOT NULL,
	"other_revenue_vnd" bigint NOT NULL,
	CONSTRAINT "night_audit_snapshot_counts_are_not_negative" CHECK ("night_audit_snapshot"."sellable_rooms" >= 0 and "night_audit_snapshot"."rooms_sold" >= 0)
);
--> statement-breakpoint
CREATE TABLE "night_audit_snapshot_type" (
	"business_date" date NOT NULL,
	"room_type_id" uuid NOT NULL,
	"sellable_rooms" smallint NOT NULL,
	"rooms_sold" smallint NOT NULL,
	"net_room_revenue_vnd" bigint NOT NULL,
	CONSTRAINT "night_audit_snapshot_type_business_date_room_type_id_pk" PRIMARY KEY("business_date","room_type_id"),
	CONSTRAINT "night_audit_snapshot_type_counts_are_not_negative" CHECK ("night_audit_snapshot_type"."sellable_rooms" >= 0 and "night_audit_snapshot_type"."rooms_sold" >= 0)
);
--> statement-breakpoint
ALTER TABLE "night_audit_snapshot_type" ADD CONSTRAINT "night_audit_snapshot_type_business_date_night_audit_snapshot_business_date_fk" FOREIGN KEY ("business_date") REFERENCES "public"."night_audit_snapshot"("business_date") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "night_audit_snapshot_type" ADD CONSTRAINT "night_audit_snapshot_type_room_type_id_room_type_id_fk" FOREIGN KEY ("room_type_id") REFERENCES "public"."room_type"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION night_audit_snapshot_refuse_rewrite() RETURNS trigger
	LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION
		'% is frozen once the night audit closes a business date: % is refused',
		TG_TABLE_NAME,
		lower(TG_OP)
		USING ERRCODE = 'MV008';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "night_audit_snapshot_is_frozen"
	BEFORE UPDATE OR DELETE ON "night_audit_snapshot"
	FOR EACH ROW EXECUTE FUNCTION night_audit_snapshot_refuse_rewrite();--> statement-breakpoint
CREATE TRIGGER "night_audit_snapshot_type_is_frozen"
	BEFORE UPDATE OR DELETE ON "night_audit_snapshot_type"
	FOR EACH ROW EXECUTE FUNCTION night_audit_snapshot_refuse_rewrite();
