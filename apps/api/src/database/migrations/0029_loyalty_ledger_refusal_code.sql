-- Each append-only boundary raises its own SQLSTATE, so a caller that catches a
-- refusal knows which boundary refused without matching message text. `MV002`
-- is the folio's closed-account refusal and the loyalty ledger was raising it
-- too, which made the two indistinguishable; the ledger takes `MV004` instead.
--
-- The trigger and the invariant it holds are unchanged: a loyalty balance is
-- the sum of this ledger, so an accrual is never rewritten or removed. Only the
-- code the refusal carries moves.
CREATE OR REPLACE FUNCTION loyalty_ledger_refuse_rewrite() RETURNS trigger
	LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION
		'loyalty_ledger is append-only: % is refused',
		lower(TG_OP)
		USING ERRCODE = 'MV004';
END;
$$;
