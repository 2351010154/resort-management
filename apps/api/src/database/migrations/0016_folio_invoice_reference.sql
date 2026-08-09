ALTER TABLE "folio" ADD COLUMN "invoice_reference" text;--> statement-breakpoint
CREATE INDEX "folio_awaiting_invoice_idx" ON "folio" USING btree ("closed_at") WHERE "folio"."state" = 'CLOSED' and "folio"."invoice_reference" is null;--> statement-breakpoint
ALTER TABLE "folio" ADD CONSTRAINT "folio_invoice_reference_only_when_closed" CHECK ("folio"."invoice_reference" is null or "folio"."state" = 'CLOSED');--> statement-breakpoint
-- Everything above this line was generated from the schema. The two triggers
-- below were not and cannot be — a trigger has no Drizzle expression — and they
-- are here rather than in `0011_folio_ledger.sql` because until this migration
-- nothing in the tree could close a folio. `folio.service.ts` recorded that
-- reasoning at the time: `FR-FOL-01`'s "a closed account takes no further
-- lines" belongs with the close that creates the state, and a guard on a state
-- nothing can reach is a rule with nothing to enforce.
--
-- ## A closed account takes no further lines
--
-- The close is the moment the account is agreed, and `FR-FOL-04` draws the
-- invoice from the lines standing at that moment. A posting arriving afterwards
-- is therefore a legal document that no longer states what the guest owes, and
-- — because `0011` makes the ledger append-only — it cannot be taken back off,
-- only compensated by a second line that is equally late.
--
-- Enforced here rather than in the service that posts, for the reason `0011`
-- gives about the same table: a service's refusal holds for its own callers and
-- for nobody else, and the account this protects is one a migration, a support
-- script or a `psql` session can reach as easily as a route can.
--
-- **`FOR SHARE` is what makes it true under concurrency, and not decoration.**
-- The foreign key already takes a `FOR KEY SHARE` lock on the folio when a
-- posting is inserted, and that lock does not conflict with the `FOR NO KEY
-- UPDATE` an ordinary `UPDATE` of `state` takes — so without this, a posting
-- and the close that ends the account can run concurrently and both commit,
-- which is the one arrangement that produces exactly the row this trigger
-- exists to refuse. `FOR SHARE` conflicts with that update in both orders: a
-- close waiting on a posting in flight sums a balance that includes it, and a
-- posting that arrives after the close reads `CLOSED` and is refused. Two
-- postings on one folio still take the share lock together, so nothing here
-- serialises the ordinary path.
--
-- ## The provider's number is written once
--
-- `FR-FOL-04` makes it the legal reference, and `schema/folio.ts` explains why
-- a *điều chỉnh* or a *thay thế* is not an edit of it. What this refuses is the
-- overwrite: a retrying job, or a second issuance after a provider changed, that
-- replaced the number would leave the property holding a reference the tax
-- authority has no record of and no pointer to the one it does. Clearing it is
-- refused on the same terms — a folio whose number was set back to null re-enters
-- the issuing job's queue and is invoiced a second time.
--
-- The service that writes it does not depend on this: it writes conditionally,
-- `where invoice_reference is null`, so the ordinary retry is settled by the
-- predicate and never reaches the exception. This is what holds for the next
-- caller.
CREATE FUNCTION folio_posting_refuse_closed_folio() RETURNS trigger
	LANGUAGE plpgsql AS $$
DECLARE
	account_state folio_state;
BEGIN
	SELECT state INTO account_state FROM folio WHERE id = NEW.folio_id FOR SHARE;

	IF account_state = 'CLOSED' THEN
		RAISE EXCEPTION
			'folio % is closed: the account was agreed and invoiced as it then stood, so it takes no further lines',
			NEW.folio_id
			USING ERRCODE = 'MV002';
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "folio_posting_stops_at_a_closed_folio"
	BEFORE INSERT ON "folio_posting"
	FOR EACH ROW EXECUTE FUNCTION folio_posting_refuse_closed_folio();--> statement-breakpoint
CREATE FUNCTION folio_refuse_reissued_invoice() RETURNS trigger
	LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION
		'folio % already carries invoice reference %: a correction is a second invoice, never an edit of the first',
		OLD.id, OLD.invoice_reference
		USING ERRCODE = 'MV003';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "folio_invoice_reference_is_written_once"
	BEFORE UPDATE OF "invoice_reference" ON "folio"
	FOR EACH ROW
	WHEN (OLD."invoice_reference" IS NOT NULL AND NEW."invoice_reference" IS DISTINCT FROM OLD."invoice_reference")
	EXECUTE FUNCTION folio_refuse_reissued_invoice();