-- What a payer was charged, when the gateway could not charge đồng.
--
-- PayPal does not support VND — đồng is absent from its transaction currencies,
-- so there is no arrangement in which a PayPal guest is charged the figure the
-- folio posts. Something has to record the dollars that actually left their
-- account, and these three columns are it.
--
-- ## The ledger does not move
--
-- `payment.amount` stays whole đồng and every folio, every sum and every
-- reconciliation keeps reading it. What arrives here is a *record of a charge*,
-- not an amount: nothing sums these columns, no posting is computed from them,
-- and no balance reads them. `money.ts` states that rule at the type level and
-- this migration is the storage half of it.
--
-- The reason the ledger does not move is not convenience. `FR-FOL-04` issues the
-- legal *hóa đơn điện tử* off folio close, and Decree 123/2020/NĐ-CP Art. 10
-- makes đồng the invoice currency by default — foreign currency is the licensed
-- exception, and even then the invoice has to carry the VND rate. A folio in
-- dollars would produce an invoice this property may not be entitled to issue.
-- A folio in đồng with the rate recorded beside the payment produces exactly the
-- figures that reading asks for.
--
-- ## Why three columns and not one
--
-- The currency names the unit, the amount is what left the payer's account in
-- it, and the rate is the only lawful bridge back to `amount`. Any two of them
-- describe a charge nobody can check: a currency and an amount with no rate
-- cannot be brought back to đồng once the property has edited its rate, and a
-- rate with no amount records the terms of a conversion that was never written
-- down. So the row is either silent about presentment or complete about it, and
-- `payment_presentment_is_whole_or_absent` is what makes that a rule rather than
-- a habit.
--
-- The rate is frozen when the attempt opens and never re-read. A refund, a
-- reconciliation and an invoice all have to quote the rate the guest was
-- actually charged at; re-converting at today's would make each of them
-- disagree with the others the first time somebody moved it.
--
-- `numeric` and not a float. This is the one fraction anywhere near the money in
-- this codebase, and a double that loses its last digits converts a stay to
-- within a few đồng of right — which `FR-PAY-05` surfaces a month later as a day
-- that will not reconcile.
ALTER TABLE "payment" ADD COLUMN "presentment_currency" text;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "presentment_amount" bigint;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "fx_rate" numeric;--> statement-breakpoint

-- All three or none.
ALTER TABLE "payment" ADD CONSTRAINT "payment_presentment_is_whole_or_absent"
  CHECK (num_nonnulls("presentment_currency", "presentment_amount", "fx_rate") IN (0, 3));--> statement-breakpoint

-- And a gateway that settles in another currency may not stay silent. A
-- `PAYPAL` row without presentment is one nothing can reconcile: the ledger
-- would hold đồng the gateway never reports, and the report would hold dollars
-- the ledger cannot be matched against.
--
-- Written as an implication over `PAYPAL` rather than as a list of the methods
-- that are exempt, for the reason `payment_shift_binding` gives about closed
-- lists — the exempt set is every method that settles in đồng, and naming them
-- would refuse the first payment taken through whatever comes next.
--
-- **`method::text` and not `method`, and the cast is load-bearing.** `0044` adds
-- `PAYPAL` to the enum, and the migrator applies every pending file in one
-- transaction — so a constraint naming the bare enum label is Postgres' 55P04,
-- `unsafe use of new value "PAYPAL" of enum type`, and the whole migration
-- refuses. Splitting the two files was not enough on its own; they still share a
-- transaction. Compared as text, no enum label is ever materialised and the same
-- rule holds with the same meaning. Verified against a scratch database rather
-- than assumed: the bare form is refused, this one applies.
ALTER TABLE "payment" ADD CONSTRAINT "payment_foreign_gateway_states_what_it_charged"
  CHECK ("method"::text <> 'PAYPAL' OR "presentment_currency" IS NOT NULL);--> statement-breakpoint

-- A charge of nothing is not a charge, and the sign convention that keeps
-- `amount` unsigned keeps this one unsigned too.
ALTER TABLE "payment" ADD CONSTRAINT "payment_presentment_amount_is_positive"
  CHECK ("presentment_amount" IS NULL OR "presentment_amount" > 0);--> statement-breakpoint

-- A rate of nothing converts nothing, and a negative one converts money into its
-- opposite. Both divide into a folio that cannot be balanced against any report.
ALTER TABLE "payment" ADD CONSTRAINT "payment_fx_rate_is_positive"
  CHECK ("fx_rate" IS NULL OR "fx_rate" > 0);--> statement-breakpoint

-- The rate itself, as data the property sets rather than a feed it depends on.
--
-- Named for the currency pair and not for a provider: a rate is a fact about two
-- currencies, and which gateway settles in the second one is a binding in the
-- application. A column named after a provider would put that provider's name
-- into the property's own configuration, which is the leak `FR-PAY-01` spends a
-- port preventing.
--
-- A rate service in the payment path is a third party who can stop a guest from
-- paying, and a rate that moves between the screen quoting it and the gateway
-- charging it is a chargeback the property loses. This column is read once per
-- attempt and copied onto the payment.
--
-- The default is a plausible mid-market figure and is **not** a rate anybody
-- agreed to. It exists so the column is never null on an upgrade; the property
-- sets its own before `G2` opens PayPal to real money.
ALTER TABLE "system_config" ADD COLUMN "rate_vnd_per_usd" numeric DEFAULT 26150 NOT NULL;
