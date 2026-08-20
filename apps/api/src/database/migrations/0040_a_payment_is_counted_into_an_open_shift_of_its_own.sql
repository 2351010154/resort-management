-- `FR-OPS-01`'s other half — the one a check constraint cannot state.
--
-- `payment_shift_binding` in `0037` says that a cash payment names a shift and
-- that nothing else may. It says nothing about *which* shift, because a check
-- sees one row and this rule is about two: the drawer named has to still be
-- open, and it has to be the drawer of the person who took the money. Both
-- facts live in `shift`, and only a trigger can read them.
--
-- Left to the service the rule would hold for its own callers and for nobody
-- else — the argument `0011` and `0016` make about the ledger, and it is
-- sharper here because the row being refused is money. Cash bound to a shift
-- that was closed an hour ago is đồng counted into a drawer already counted
-- out: the operator who signed for that count is short by the whole of it, with
-- nothing anywhere saying why. Cash bound to a colleague's open shift is the
-- same đồng, moved onto somebody else's handover.
--
-- **`FOR SHARE` is what makes the first half true under concurrency, and not
-- decoration.** The foreign key on `payment.shift_id` takes `FOR KEY SHARE`
-- when a payment is inserted, and that does not conflict with the `FOR NO KEY
-- UPDATE` an ordinary `UPDATE` of `closed_at` takes — so without this, a
-- payment and the close that ends the shift run side by side, the trigger reads
-- a row whose `closed_at` is still null in its own snapshot, and both commit.
-- That is precisely the row this exists to refuse. `FOR SHARE` conflicts with
-- the close in both orders: a payment arriving while a close is in flight waits
-- for it and is then refused against the committed row, and a close waiting on
-- a payment in flight counts the drawer with that payment in it. Two payments
-- into one drawer still take the share lock together, so nothing here
-- serialises the ordinary path.
--
-- **A shift that is not there at all is left to the foreign key.**
-- `payment_shift_id_shift_id_fk` says that with `23503`, which is the more
-- precise answer; a refusal from here would tell a caller their drawer was
-- closed when what they actually named was nothing.
--
-- **A poster who is not a staff account is left to its own foreign key**, for
-- the same reason. `payment_posted_by_staff_user_id_fk` refuses that, and
-- pre-empting it would answer "this drawer is not yours" to a caller whose
-- mistake was naming somebody who does not exist.
--
-- **A payment that names no poster is not this trigger's refusal either.**
-- `posted_by` is nullable by design — `schema/payment.ts` says why the money no
-- person authored may not carry a placeholder account — so whether cash is
-- allowed to go unattributed is a question about the `payment` row, answerable
-- by a constraint on that column, and not about the drawer. What is refused
-- here is a *named* poster who is not the operator the shift belongs to.
--
-- Each of this system's own boundaries raises its own SQLSTATE, so a caller
-- that catches a refusal knows which one refused without matching message text.
-- `MV001` and `MV002` are the folio's, `MV003` its invoice reference, `MV004`
-- the loyalty ledger's and `MV005` the tier trail's; the drawer takes `MV006`.
-- Both refusals below carry it: they are one rule about one column, and a
-- caller acts on either by finding a shift of its own that is open.
--
-- It fires on insert alone, and on the rows that name a drawer alone. A
-- payment's shift is written when the money is taken and nothing in the tree
-- moves it afterwards; a trigger on `UPDATE OF shift_id` would fire for every
-- statement that merely listed the column, and would refuse an ordinary
-- correction to a row whose shift has since — correctly — been closed.
CREATE FUNCTION payment_refuse_a_shift_it_cannot_be_counted_into() RETURNS trigger
	LANGUAGE plpgsql AS $$
DECLARE
	drawer_operator uuid;
	drawer_closed_at timestamptz;
BEGIN
	SELECT operator_id, closed_at
	INTO drawer_operator, drawer_closed_at
	FROM shift
	WHERE id = NEW.shift_id
	FOR SHARE;

	IF NOT FOUND THEN
		RETURN NEW;
	END IF;

	IF drawer_closed_at IS NOT NULL THEN
		RAISE EXCEPTION
			'shift % was counted out at % and takes no further cash: money into a drawer already counted leaves the operator who signed for that count short by the whole of it',
			NEW.shift_id, drawer_closed_at
			USING ERRCODE = 'MV006';
	END IF;

	IF NEW.posted_by IS NOT NULL AND NEW.posted_by <> drawer_operator THEN
		IF EXISTS (SELECT 1 FROM staff_user WHERE id = NEW.posted_by) THEN
			RAISE EXCEPTION
				'shift % belongs to % and not to %: cash counted into another operator''s drawer moves the variance onto their handover',
				NEW.shift_id, drawer_operator, NEW.posted_by
				USING ERRCODE = 'MV006';
		END IF;
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "payment_is_counted_into_an_open_shift_of_its_own"
	BEFORE INSERT ON "payment"
	FOR EACH ROW
	WHEN (NEW."shift_id" IS NOT NULL)
	EXECUTE FUNCTION payment_refuse_a_shift_it_cannot_be_counted_into();
