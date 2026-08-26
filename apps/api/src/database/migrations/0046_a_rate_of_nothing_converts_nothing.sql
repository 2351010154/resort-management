-- The property's own answer to "how many đồng is one dollar" could be set to
-- zero or below, and nothing here refused it.
--
-- `0045` gave `payment.fx_rate` a positivity check — `payment_fx_rate_is_positive`
-- — for the copy frozen onto a settled attempt, and argued there that a rate of
-- nothing converts nothing and a negative one converts money into its opposite.
-- The figure that copy is read *from*, `system_config.rate_vnd_per_usd`, carried
-- no such rule: every sibling rate in this table — the two VAT rates, the
-- service charge, the loyalty earn unit, both tier ladders — is bounded by a
-- `CHECK` of its own, and this column alone was not. `payment.service.ts` divides
-- đồng by exactly this figure when a PayPal attempt opens, so a zero here was
-- never a value nobody happened to type; it was a `RangeError: Division by
-- zero` reaching the guest as a 500 instead of reaching an `ADMIN` as a refusal
-- naming the field they mistyped.
ALTER TABLE "system_config" ADD CONSTRAINT "system_config_fx_rate_is_positive"
  CHECK ("rate_vnd_per_usd" > 0);
