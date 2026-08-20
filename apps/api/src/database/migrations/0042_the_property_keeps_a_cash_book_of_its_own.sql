-- `FR-OPS-02` — the property's own cash book, and the three rules that keep it
-- honest.
--
-- What lands here is money the folio system never sees. `screens.md` is narrow
-- about it: Finance is "strictly the money the folio system does not capture —
-- categorised income and expense such as supplies, utilities and salaries",
-- while stay revenue "lives in Reports, computed from night-audit snapshots".
-- So no row of this table posts to a folio, none reads one, and no category
-- below names a night. `schema/cash-book.ts` carries the columns and the checks;
-- what needs a migration of its own — and what this file adds beyond the table —
-- are the three rules a `CHECK` cannot state, because each is about more than
-- one row.
--
-- ## The book is append-only
--
-- `0011` makes this argument for the folio ledger and it is sharper here, for a
-- reason that file did not have: a shift's expected cash is computed from these
-- rows. An expense edited after the drawer it came out of was counted would move
-- a variance somebody has already signed for, on a handover that has already
-- happened, with nothing anywhere saying it moved. A row deleted would do it
-- silently. The trigger raises rather than a `RULE … DO INSTEAD NOTHING`, for
-- `0011`'s reason: a book that quietly discards an `UPDATE` hides the very edit
-- it exists to prevent, and the caller is told nothing.
--
-- A mistake is corrected the way the ledger corrects one — by a reversing entry
-- that names the row it undoes — so both the mistake and the correction stay in
-- the book. `cash_book_entry_reversal_unique_key` makes that at most one, and
-- the reversal binds to whichever drawer is open when it is made, which is where
-- the đồng physically go back.
--
-- That is also why `cash_book_entry_direction_suits_its_category` lets a row
-- naming a reversed entry past. Most categories belong to one side — wages are
-- never money the property took — but a correction's side is the opposite of the
-- row it undoes, by construction rather than by choice, and its category is that
-- row's: an expense on `SUPPLIES` is undone by income on `SUPPLIES`, which is
-- exactly the pairing the rule refuses of anything a person chose. Filing the
-- correction under some neutral category instead would be worse than the
-- exemption — the column an accountant reads a month by would show supplies that
-- were never bought, with the money coming back somewhere else entirely. The shift that was already counted out is left
-- exactly as it was signed for, and its arithmetic is reproducible forever
-- afterwards because every row it sums is a row nothing can change.
--
-- The SQLSTATE is this system's own, in the class the standard reserves for
-- implementations, so a route can tell this refusal from any other a function
-- might raise without matching message text. `MV001` and `MV002` are the
-- folio's, `MV003` its invoice reference, `MV004` the loyalty ledger's, `MV005`
-- the tier trail's and `MV006` the drawer's; the cash book takes `MV007`.
--
-- ## Cash goes into a drawer that is open
--
-- `cash_book_entry_shift_binding` says a `CASH` entry names a shift and that
-- nothing else may. It says nothing about *which* shift, because a check sees
-- one row and this rule is about two: the drawer named has to still be open.
-- That fact lives in `shift`, and only a trigger can read it. `shift.service.ts`
-- already refuses a second close with the sentence this echoes — a counted
-- drawer's variance stands on the count that closed it — and money added to it
-- afterwards would leave the operator who signed for that count short by the
-- whole of it.
--
-- It raises `MV006` and not a code of its own. That is the drawer refusing, in
-- exactly the terms `0040` established for a cash payment, and a caller acts on
-- either the same way: by naming a drawer that is open.
--
-- **`FOR SHARE` is what makes it true under concurrency**, for the reason `0040`
-- sets out at length. The foreign key on `shift_id` takes `FOR KEY SHARE`, which
-- does not conflict with the `FOR NO KEY UPDATE` an ordinary update of
-- `closed_at` takes — so without this, an entry and the close that ends the
-- shift run side by side, the trigger reads a row whose `closed_at` is still
-- null in its own snapshot, and both commit. That is precisely the row this
-- exists to refuse. `ShiftService.close` takes `FOR UPDATE` before it sums, and
-- `FOR SHARE` conflicts with it in both orders: an entry arriving while a close
-- is in flight waits for it and is then refused against the committed row, and a
-- close waiting on an entry in flight counts the drawer with that đồng
-- accounted for. Two entries into one drawer still take the share lock together,
-- so nothing here serialises the ordinary path.
--
-- **A shift that is not there at all is left to the foreign key**, which says it
-- with `23503` — the more precise answer. A refusal from here would tell a
-- caller their drawer was closed when what they actually named was nothing.
--
-- **Nothing here compares the recorder against the drawer's operator, and that
-- is the difference from `0040`.** A payment is taken by the person on the desk,
-- so cash into a colleague's drawer is always a mistake. A cash-book entry is
-- recorded by an accountant or a manager — `rbac-matrix.md` puts *Income /
-- expense (thu chi)* at `full` for those two and `ADMIN`, and grants a
-- receptionist nothing at all on the row — and the ordinary case of it is
-- precisely a manager booking the money they took out of a receptionist's till.
-- The receptionist sees it as their drawer's expected figure moving, which is
-- what the count they are about to sign for has to agree with.
--
-- ## Every change says who made it
--
-- The third trigger is `0041`'s, attached here because this table is protected
-- state and it is money. `every-change-is-recorded.e2e-spec.ts` asserts that
-- every table in `schema/index.ts` either carries it or is named in that
-- migration's list of decisions, and a cash book in neither would be the exact
-- hole `NFR-09` exists to close. No `withhold:` and no `ignore:` arguments: the
-- table holds no credential and no column that moves on its own, and the note is
-- the part of an entry an investigation most wants to read.
--
-- It files inserts and nothing else, which is not a gap — the append-only
-- trigger above is `BEFORE`, so an update or a delete raises before this one
-- could run. `folio_posting` is audited on the same terms.

CREATE TYPE "public"."cash_book_category" AS ENUM('SUPPLIES', 'UTILITIES', 'SALARIES', 'MAINTENANCE', 'LAUNDRY', 'MARKETING', 'TRANSPORT', 'TAXES_AND_FEES', 'VENUE_HIRE', 'PARTNER_COMMISSION', 'ASSET_SALE', 'SUPPLIER_REFUND', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."cash_book_direction" AS ENUM('INCOME', 'EXPENSE');--> statement-breakpoint
CREATE TYPE "public"."cash_book_method" AS ENUM('CASH', 'BANK_TRANSFER');--> statement-breakpoint
CREATE TABLE "cash_book_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"direction" "cash_book_direction" NOT NULL,
	"category" "cash_book_category" NOT NULL,
	"method" "cash_book_method" NOT NULL,
	"amount" bigint NOT NULL,
	"business_date" date NOT NULL,
	"shift_id" uuid,
	"note" text NOT NULL,
	"recorded_by" uuid NOT NULL,
	"reverses_entry_id" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_book_entry_amount_is_a_quantity" CHECK ("cash_book_entry"."amount" > 0),
	CONSTRAINT "cash_book_entry_shift_binding" CHECK (("cash_book_entry"."method" = 'CASH') = ("cash_book_entry"."shift_id" is not null)),
	CONSTRAINT "cash_book_entry_direction_suits_its_category" CHECK ((
        "cash_book_entry"."reverses_entry_id" is not null
      ) or (
        "cash_book_entry"."direction" = 'INCOME'
        and "cash_book_entry"."category" in ('VENUE_HIRE', 'PARTNER_COMMISSION', 'ASSET_SALE', 'SUPPLIER_REFUND', 'OTHER')
      ) or (
        "cash_book_entry"."direction" = 'EXPENSE'
        and "cash_book_entry"."category" in ('SUPPLIES', 'UTILITIES', 'SALARIES', 'MAINTENANCE', 'LAUNDRY', 'MARKETING', 'TRANSPORT', 'TAXES_AND_FEES', 'OTHER')
      )),
	CONSTRAINT "cash_book_entry_note_says_something" CHECK (btrim("cash_book_entry"."note") <> ''),
	CONSTRAINT "cash_book_entry_does_not_reverse_itself" CHECK ("cash_book_entry"."reverses_entry_id" is distinct from "cash_book_entry"."id")
);
--> statement-breakpoint
ALTER TABLE "cash_book_entry" ADD CONSTRAINT "cash_book_entry_shift_id_shift_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shift"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_book_entry" ADD CONSTRAINT "cash_book_entry_recorded_by_staff_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_book_entry" ADD CONSTRAINT "cash_book_entry_reverses_an_entry" FOREIGN KEY ("reverses_entry_id") REFERENCES "public"."cash_book_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cash_book_entry_reversal_unique_key" ON "cash_book_entry" USING btree ("reverses_entry_id") WHERE "cash_book_entry"."reverses_entry_id" is not null;--> statement-breakpoint
CREATE INDEX "cash_book_entry_business_date_idx" ON "cash_book_entry" USING btree ("business_date");--> statement-breakpoint
CREATE INDEX "cash_book_entry_shift_idx" ON "cash_book_entry" USING btree ("shift_id") WHERE "cash_book_entry"."shift_id" is not null;--> statement-breakpoint
CREATE FUNCTION cash_book_entry_refuse_rewrite() RETURNS trigger
	LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION
		'cash_book_entry is append-only: % is refused, record a reversing entry instead',
		lower(TG_OP)
		USING ERRCODE = 'MV007';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "cash_book_entry_is_append_only"
	BEFORE UPDATE OR DELETE ON "cash_book_entry"
	FOR EACH ROW EXECUTE FUNCTION cash_book_entry_refuse_rewrite();--> statement-breakpoint
CREATE FUNCTION cash_book_entry_refuse_a_counted_drawer() RETURNS trigger
	LANGUAGE plpgsql AS $$
DECLARE
	drawer_closed_at timestamptz;
BEGIN
	SELECT closed_at
	INTO drawer_closed_at
	FROM shift
	WHERE id = NEW.shift_id
	FOR SHARE;

	IF NOT FOUND THEN
		RETURN NEW;
	END IF;

	IF drawer_closed_at IS NOT NULL THEN
		RAISE EXCEPTION
			'shift % was counted out at % and its variance stands on that count: cash recorded against a drawer already counted out would move a figure the operator has already signed for',
			NEW.shift_id, drawer_closed_at
			USING ERRCODE = 'MV006';
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "cash_book_entry_is_recorded_into_an_open_drawer"
	BEFORE INSERT ON "cash_book_entry"
	FOR EACH ROW
	WHEN (NEW."shift_id" IS NOT NULL)
	EXECUTE FUNCTION cash_book_entry_refuse_a_counted_drawer();--> statement-breakpoint
CREATE TRIGGER "cash_book_entry_changes_are_logged"
	AFTER INSERT OR UPDATE OR DELETE ON "cash_book_entry"
	FOR EACH ROW
	EXECUTE FUNCTION audit_row_change();