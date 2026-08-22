-- `FR-AUD-01`'s backstop, and the thing that makes `NFR-09`'s 100% a fact about
-- the database rather than a promise about the services.
--
-- Until now the change log was filed by hand, from five call sites, over three
-- pricing tables, the configuration row and the link a confirmation mail
-- carries. Everything else that moves — a booking, a room assignment, a folio
-- line, a payment, a drawer, a closure, a guest record, a staff account —
-- changed silently. The arithmetic `common/audit/audit-actor.ts` opens with is
-- what settles this: a mechanism whose omission is silent will not reach 100%,
-- because the failure mode of forgetting to call it is a write that succeeds,
-- returns, and files nothing. Nobody is told, and the coverage assertion passes
-- over the hole.
--
-- So the writer moves into the database, where forgetting is not available. A
-- row of a protected table cannot be inserted, updated or deleted by this
-- application, by a support script, by a migration or by somebody at a psql
-- prompt without an entry being written in the same transaction. That is the
-- argument `0011` makes for the folio ledger and `0023` for the loyalty one,
-- and it lands harder here, because the whole value of a trail is that it
-- covers the writes nobody anticipated.
--
-- **The entry is written by the statement that made the change, so it shares
-- its fate.** `common/audit/audit.interceptor.ts` sets out at length why an
-- after-commit writer is the wrong half of the trade: an emitter that throws
-- leaves a change that happened and a log that does not mention it, and a hole
-- is worse than an absence because nothing reports it. A trigger is the
-- strongest form of the arrangement that file argues for — there is no window
-- at all between the change and its entry, and a rolled-back edit takes its
-- entry with it, so a price that was refused never appears as a price that was
-- set.
--
-- **Who acted arrives on a transaction-local setting, not in the row.**
-- `app.audit_actor` carries the `staff_user.id` the access guard resolved;
-- `database/transaction-runner.ts` sets it at the top of every transaction it
-- opens, from the ambient actor `audit-actor.ts` carries, which is read from
-- the guard's decision and never from a request body. `SET LOCAL` — which is
-- what `set_config(..., true)` is — reverts when the transaction ends, so a
-- pooled connection cannot hand one request's actor to the next; the setting
-- reverts to the empty string rather than to unset, which is why both are read
-- as nobody below.
--
-- Unset is `system` with no actor, and that is the ordinary case rather than an
-- error: the hold-expiry sweep, the nightly room charge, the reconciliation
-- pass, VNPay's IPN and the seeder at boot all change rows with no member of
-- staff behind them. `schema/audit.ts` argues why that is two columns and not a
-- placeholder account, and `audit_entry_actor_check` refuses every row where
-- the two disagree.
--
-- **The snapshots are whole rows rendered by Postgres and never leave it.**
-- `to_jsonb` of the row, on both sides, so a column added by a later migration
-- is audited the day it exists rather than the day somebody remembers to list
-- it here. It is also the strongest form of the promise `audit.service.ts`
-- makes about đồng: the figure is copied from a `bigint` column into a `jsonb`
-- number, both arbitrary precision, without the driver — and therefore without
-- a JavaScript `number` — being anywhere on the path.
--
-- ## How a row is addressed
--
-- `audit_entry.row_id` is a `uuid`, and every many-rowed table protected here
-- carries a surrogate `id` of that type, so the address is that column. The two
-- single-row tables — `system_config` and `property_tariff` — have no such
-- column on purpose, because a surrogate key would let a second row exist; their
-- address is their name, in the shape the column requires:
-- `md5(TG_TABLE_NAME)::uuid`. That is the value `system_config`'s entries have
-- carried since the log began, so the history of that row runs continuously
-- across this migration rather than restarting at it. A derivation rather than a
-- constant somebody picked, so a reader confirms it with `select
-- md5('system_config')::uuid` and the next single-row table gets its address
-- from the same rule. Nothing joins on `row_id` — the column has no foreign key,
-- and `table_name` alone already identifies these two rows completely — so what
-- is asked of the value is only that it be the same one every time.
--
-- ## Columns a trigger may name, and the two things naming one can mean
--
-- Each trigger below takes arguments of the form `withhold:<column>` or
-- `ignore:<column>`. The behaviour is spelled at the call site rather than
-- inferred from a position or a prefix character, because these are two
-- different statements about a column and one list running them together would
-- be read as one statement made twice. An argument naming neither behaviour
-- raises rather than being skipped: an argument this function does not
-- understand is a column somebody meant to protect and is not, and the whole
-- reason for moving this into the database was that such an omission cannot be
-- silent.
--
-- **`withhold` — the change is recorded, the value is not handed over.** The key
-- stays in both snapshots, so a reader can see that the log declines to carry
-- the column rather than wondering whether it exists, and its value becomes the
-- string `withheld` where the row held one and stays JSON `null` where it did
-- not. Two columns are named:
--
--   - **`guest.cccd_number`.** `rbac-matrix.md` makes unmasking a CCCD its own
--     capability and `FR-GST-03` makes it audited per call, so a viewer that
--     printed the number would be an unmask route with no `cccd_unmask_audit`
--     row behind it — precisely the unattributable read that table exists to
--     prevent.
--   - **`staff_user.password_hash`.** An Argon2 digest is credential material,
--     and copying it into a table three roles read widens who holds it for no
--     investigative gain.
--
-- **A withheld column still counts as a change.** The comparison below is made
-- against the row as Postgres handed it over, before any masking, and that
-- ordering is the whole of it: masked first, a CCCD corrected from one number to
-- another would compare `withheld` against `withheld` and file nothing. What is
-- filed instead is an entry carrying `withheld` on both sides, which reads as
-- "this column changed and the log does not carry it" — the entry an
-- investigation into a guest identity record needs, and it needs no digit of the
-- number to be useful. The same holds for a password reset: `staff_user` has no
-- `updated_at` that moves on its own, so nothing else on that row would rescue
-- the entry, and the day somebody adds a reset route it is audited without
-- anybody having to remember.
--
-- **`ignore` — the column is not a change at all.** One column is named:
--
--   - **`booking.last_seen_at`.** `booking.service.ts` marks a hold's presence
--     every twenty seconds per open funnel and deliberately leaves `updated_at`
--     alone, on the grounds that a guest looking at a page has not modified
--     their booking. Counted as a change it would be three entries a minute per
--     funnel, each with two whole booking snapshots in it, burying the room move
--     and the cancellation in a heartbeat. It is dropped from the comparison and
--     from nothing else: an entry filed because something *else* on the booking
--     moved still carries the real instant.
--
-- **An update that leaves the row this log can see unchanged files nothing.**
-- What it can see is the row minus its ignored columns. A heartbeat reaches
-- that, and so does a reprice to the price already published. An entry saying
-- that something happened and declining to say what is what
-- `audit_entry_states_present` calls indistinguishable from a bug in whatever
-- wrote it, and it is an edit an investigation would have to rule out before it
-- could rule anything in.
--
-- ## What is not protected, and why each one is not
--
-- A silent exclusion is the hole `NFR-09` exists to close, so every table in
-- `schema/index.ts` that has no trigger below is named here with its reason:
--
--   - `audit_entry` — the log itself. An entry about an entry recurses without
--     bound, and the first insert would never return.
--   - `staff_session` — one row per issued refresh token, held as a SHA-256
--     digest. Session infrastructure rather than protected state, and copying a
--     credential digest into the log would put it in front of every reader of
--     the viewer.
--   - `guest_session`, `guest_verification`, `guest_account` — the guest
--     realm's sessions, one-time codes and credentials. The same argument, and
--     they are Better Auth's tables: its adapter writes them on its own, never
--     inside a transaction this application opened, so the actor would be
--     `system` on every row anyway.
--   - `guest_user` — Better Auth's account row. Its id is text that Better Auth
--     generates, and `audit_entry.row_id` is a `uuid`, so no row of it can be
--     addressed. `guest_tier_change` states the same obstacle about the same id.
--   - `guest_user_profile` — keyed by that same text id, and unaddressable for
--     the same reason. Nothing statutory is lost with it: the residence record
--     is `registration`, which is protected below, and the property's own
--     record of a guest is `guest`, likewise.
--   - `payment_reconciliation_run` — keyed by `business_date` and holding no
--     uuid, so again unaddressable. It is also a job's own record that a day was
--     compared, carrying the instant it was compared at; an entry would restate
--     the row rather than describe a change to it.
--   - `drizzle.__drizzle_migrations`, and pg-boss's job tables — migration and
--     queue bookkeeping, in schemas of their own, describing this application's
--     machinery rather than the property's state.
--
-- `modules/audit/financial-tables.ts` decides only which of these an
-- `ACCOUNTANT` may read. It is not a list of what is audited, and the two do
-- not have to agree in either direction.
CREATE FUNCTION audit_row_change() RETURNS trigger
	LANGUAGE plpgsql AS $$
DECLARE
	previous_state jsonb;
	subsequent_state jsonb;
	compared_before jsonb;
	compared_after jsonb;
	withheld_columns text[] := '{}';
	ignored_columns text[] := '{}';
	named_column text;
	acting_staff text;
	changed_row jsonb;
BEGIN
	-- The two halves are assigned by branch rather than by a `CASE` over
	-- `TG_OP`, because `OLD` is unassigned in an insert trigger and `NEW` in a
	-- delete one, and a variable a plpgsql expression merely mentions is still
	-- passed to it.
	IF TG_OP = 'INSERT' THEN
		subsequent_state := to_jsonb(NEW);
	ELSIF TG_OP = 'UPDATE' THEN
		previous_state := to_jsonb(OLD);
		subsequent_state := to_jsonb(NEW);
	ELSE
		previous_state := to_jsonb(OLD);
	END IF;

	-- The arguments, sorted into the two things naming a column can mean.
	-- `coalesce` because a trigger created with no arguments has an empty
	-- argument array in some server versions and a null one in others, and
	-- `FOREACH` over a null array raises rather than doing nothing.
	FOREACH named_column IN ARRAY coalesce(TG_ARGV, '{}'::text[]) LOOP
		IF split_part(named_column, ':', 1) = 'withhold' THEN
			withheld_columns := withheld_columns
				|| split_part(named_column, ':', 2);
		ELSIF split_part(named_column, ':', 1) = 'ignore' THEN
			ignored_columns := ignored_columns
				|| split_part(named_column, ':', 2);
		ELSE
			-- No SQLSTATE of its own, unlike the ledger's and the drawer's:
			-- those are refusals a caller acts on, and this is a trigger
			-- installed wrongly. Nothing should catch it, and everything it
			-- touches should stop.
			RAISE EXCEPTION
				'audit_row_change on % was given the argument %, which names no behaviour: an argument is withhold:<column> or ignore:<column>',
				TG_TABLE_NAME, named_column;
		END IF;
	END LOOP;

	-- **Did anything this log answers for move?** Asked of the row as Postgres
	-- handed it over, before the masking below, which is what makes a withheld
	-- column still count: masked first, a corrected CCCD would compare
	-- `withheld` against `withheld` and file nothing. The ignored columns are
	-- dropped for the length of this question and carried into the entry
	-- regardless.
	IF TG_OP = 'UPDATE' THEN
		compared_before := previous_state;
		compared_after := subsequent_state;

		FOREACH named_column IN ARRAY ignored_columns LOOP
			compared_before := compared_before - named_column;
			compared_after := compared_after - named_column;
		END LOOP;

		IF compared_before = compared_after THEN
			RETURN NULL;
		END IF;
	END IF;

	FOREACH named_column IN ARRAY withheld_columns LOOP
		-- `-> key` is SQL null when the column is not in the snapshot and JSON
		-- null when it is there holding nothing. Neither is replaced: the first
		-- says the column was dropped by a later migration, the second says the
		-- row held no value, and both are answers rather than things to hide.
		IF previous_state -> named_column IS NOT NULL
			AND previous_state -> named_column <> 'null'::jsonb THEN
			previous_state := jsonb_set(
				previous_state, ARRAY[named_column], '"withheld"'::jsonb
			);
		END IF;

		IF subsequent_state -> named_column IS NOT NULL
			AND subsequent_state -> named_column <> 'null'::jsonb THEN
			subsequent_state := jsonb_set(
				subsequent_state, ARRAY[named_column], '"withheld"'::jsonb
			);
		END IF;
	END LOOP;

	changed_row := coalesce(subsequent_state, previous_state);

	-- Empty and unset are one answer. A connection that has never carried an
	-- actor reads null here; one whose previous transaction set the value reads
	-- the empty string it reverted to when that transaction ended.
	acting_staff := nullif(current_setting('app.audit_actor', true), '');

	INSERT INTO audit_entry
		(actor_kind, actor_id, table_name, row_id, action, "before", "after")
	VALUES (
		CASE WHEN acting_staff IS NULL THEN 'system' ELSE 'staff' END::audit_actor_kind,
		acting_staff::uuid,
		TG_TABLE_NAME,
		-- `jsonb_exists` rather than the `?` operator that spells it: `?` is a
		-- placeholder to several client libraries, and a migration is text that
		-- travels through one before Postgres ever sees it.
		CASE
			WHEN jsonb_exists(changed_row, 'id') THEN (changed_row ->> 'id')::uuid
			ELSE md5(TG_TABLE_NAME)::uuid
		END,
		TG_OP::audit_action,
		previous_state,
		subsequent_state
	);

	-- The return value of an `AFTER ... FOR EACH ROW` trigger is ignored; null
	-- is the conventional way of saying so.
	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "booking_changes_are_logged"
	AFTER INSERT OR UPDATE OR DELETE ON "booking"
	FOR EACH ROW
	EXECUTE FUNCTION audit_row_change('ignore:last_seen_at');--> statement-breakpoint
CREATE TRIGGER "booking_night_changes_are_logged"
	AFTER INSERT OR UPDATE OR DELETE ON "booking_night"
	FOR EACH ROW
	EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER "booking_link_changes_are_logged"
	AFTER INSERT OR UPDATE OR DELETE ON "booking_link"
	FOR EACH ROW
	EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER "cccd_unmask_audit_changes_are_logged"
	AFTER INSERT OR UPDATE OR DELETE ON "cccd_unmask_audit"
	FOR EACH ROW
	EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER "feedback_changes_are_logged"
	AFTER INSERT OR UPDATE OR DELETE ON "feedback"
	FOR EACH ROW
	EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER "folio_changes_are_logged"
	AFTER INSERT OR UPDATE OR DELETE ON "folio"
	FOR EACH ROW
	EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER "folio_posting_changes_are_logged"
	AFTER INSERT OR UPDATE OR DELETE ON "folio_posting"
	FOR EACH ROW
	EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER "guest_changes_are_logged"
	AFTER INSERT OR UPDATE OR DELETE ON "guest"
	FOR EACH ROW
	EXECUTE FUNCTION audit_row_change('withhold:cccd_number');--> statement-breakpoint
CREATE TRIGGER "guest_tier_change_changes_are_logged"
	AFTER INSERT OR UPDATE OR DELETE ON "guest_tier_change"
	FOR EACH ROW
	EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER "loyalty_ledger_changes_are_logged"
	AFTER INSERT OR UPDATE OR DELETE ON "loyalty_ledger"
	FOR EACH ROW
	EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER "payment_changes_are_logged"
	AFTER INSERT OR UPDATE OR DELETE ON "payment"
	FOR EACH ROW
	EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER "payment_discrepancy_changes_are_logged"
	AFTER INSERT OR UPDATE OR DELETE ON "payment_discrepancy"
	FOR EACH ROW
	EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER "pending_item_changes_are_logged"
	AFTER INSERT OR UPDATE OR DELETE ON "pending_item"
	FOR EACH ROW
	EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER "promotion_changes_are_logged"
	AFTER INSERT OR UPDATE OR DELETE ON "promotion"
	FOR EACH ROW
	EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER "property_tariff_changes_are_logged"
	AFTER INSERT OR UPDATE OR DELETE ON "property_tariff"
	FOR EACH ROW
	EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER "rate_calendar_changes_are_logged"
	AFTER INSERT OR UPDATE OR DELETE ON "rate_calendar"
	FOR EACH ROW
	EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER "rate_plan_changes_are_logged"
	AFTER INSERT OR UPDATE OR DELETE ON "rate_plan"
	FOR EACH ROW
	EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER "registration_changes_are_logged"
	AFTER INSERT OR UPDATE OR DELETE ON "registration"
	FOR EACH ROW
	EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER "room_changes_are_logged"
	AFTER INSERT OR UPDATE OR DELETE ON "room"
	FOR EACH ROW
	EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER "room_assignment_changes_are_logged"
	AFTER INSERT OR UPDATE OR DELETE ON "room_assignment"
	FOR EACH ROW
	EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER "room_condition_changes_are_logged"
	AFTER INSERT OR UPDATE OR DELETE ON "room_condition"
	FOR EACH ROW
	EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER "room_type_changes_are_logged"
	AFTER INSERT OR UPDATE OR DELETE ON "room_type"
	FOR EACH ROW
	EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER "service_catalog_changes_are_logged"
	AFTER INSERT OR UPDATE OR DELETE ON "service_catalog"
	FOR EACH ROW
	EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER "shift_changes_are_logged"
	AFTER INSERT OR UPDATE OR DELETE ON "shift"
	FOR EACH ROW
	EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER "staff_user_changes_are_logged"
	AFTER INSERT OR UPDATE OR DELETE ON "staff_user"
	FOR EACH ROW
	EXECUTE FUNCTION audit_row_change('withhold:password_hash');--> statement-breakpoint
CREATE TRIGGER "stay_restriction_changes_are_logged"
	AFTER INSERT OR UPDATE OR DELETE ON "stay_restriction"
	FOR EACH ROW
	EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER "system_config_changes_are_logged"
	AFTER INSERT OR UPDATE OR DELETE ON "system_config"
	FOR EACH ROW
	EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER "type_inventory_changes_are_logged"
	AFTER INSERT OR UPDATE OR DELETE ON "type_inventory"
	FOR EACH ROW
	EXECUTE FUNCTION audit_row_change();
