-- The statements below were generated from the schema; their order was not.
-- drizzle-kit emits the two foreign keys before the unique constraint they
-- reference, and Postgres refuses a key with no unique constraint matching its
-- referenced columns — so the `UNIQUE` moves to the front and nothing else here
-- is changed.
--
-- What it fixes: `0011_folio_ledger.sql` keyed both self-references on `id`
-- alone, which let a posting name a line on a different folio. A `VAT` line in
-- one guest's account levied on another guest's room charge satisfied every
-- check on the table, as did a `REVERSAL` crediting the wrong account while the
-- mistake it named stood on the right one. A `CHECK` cannot close this — it
-- reads one row and cannot ask which folio another belongs to — and the
-- append-only trigger means such a row could never be corrected, only
-- compensated by a second wrong-looking line.
--
-- Carrying `folio_id` into each key is what closes it. `MATCH SIMPLE` keeps the
-- nullable case behaving as before: `folio_id` is never null, so a null
-- reference skips the constraint entirely.
ALTER TABLE "folio_posting" ADD CONSTRAINT "folio_posting_id_folio_key" UNIQUE("id","folio_id");--> statement-breakpoint
ALTER TABLE "folio_posting" DROP CONSTRAINT "folio_posting_reverses_posting_id_folio_posting_id_fk";--> statement-breakpoint
ALTER TABLE "folio_posting" DROP CONSTRAINT "folio_posting_parent_posting_id_folio_posting_id_fk";--> statement-breakpoint
ALTER TABLE "folio_posting" ADD CONSTRAINT "folio_posting_reverses_a_line_on_the_same_folio" FOREIGN KEY ("reverses_posting_id","folio_id") REFERENCES "public"."folio_posting"("id","folio_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folio_posting" ADD CONSTRAINT "folio_posting_derives_from_a_line_on_the_same_folio" FOREIGN KEY ("parent_posting_id","folio_id") REFERENCES "public"."folio_posting"("id","folio_id") ON DELETE no action ON UPDATE no action;
