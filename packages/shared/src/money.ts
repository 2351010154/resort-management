// Money is an integer count of đồng. VND has no minor unit, so there is nothing
// to round and no reason for a decimal type — and the moment an amount becomes
// a float the ledger stops balancing. The database column is bigint, but every
// amount this property can produce (a night, a folio, a year of revenue) sits
// orders of magnitude below Number.MAX_SAFE_INTEGER, so amounts cross the wire
// as JSON numbers rather than strings.

import { z } from "zod";

export const PROPERTY_CURRENCY = "VND" as const;

/**
 * A posting amount. Signed on purpose: a refund or a reversing entry is a
 * negative charge. Forbidding that here would push callers into subtracting
 * magnitudes instead, which is how a ledger loses the trail that makes it
 * auditable.
 */
export const vndAmountSchema = z.number().int();

export type VndAmount = z.infer<typeof vndAmountSchema>;

const vndFormatter = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: PROPERTY_CURRENCY,
  maximumFractionDigits: 0,
});

/** Display only — "1.250.000 ₫". Never parse this back into an amount. */
export function formatVnd(amount: VndAmount): string {
  return vndFormatter.format(amount);
}
