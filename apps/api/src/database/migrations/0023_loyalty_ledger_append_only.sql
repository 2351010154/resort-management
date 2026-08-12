-- A loyalty balance is the sum of this ledger, not a counter. Rewriting or
-- removing one accrual would therefore rewrite the balance without leaving the
-- compensating fact an audit can follow. Keep the invariant in Postgres so it
-- holds for jobs and support scripts as well as for application services.
--
-- `MV002` is distinct from the folio ledger's `MV001`: a caller can identify
-- which append-only boundary refused a write without matching message text.
CREATE FUNCTION loyalty_ledger_refuse_rewrite() RETURNS trigger
	LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION
		'loyalty_ledger is append-only: % is refused',
		lower(TG_OP)
		USING ERRCODE = 'MV002';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "loyalty_ledger_is_append_only"
	BEFORE UPDATE OR DELETE ON "loyalty_ledger"
	FOR EACH ROW EXECUTE FUNCTION loyalty_ledger_refuse_rewrite();
