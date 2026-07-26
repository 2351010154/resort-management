// Money is an integer count of đồng. VND has no minor unit, so there is nothing
// to round and no reason for a decimal type — and the moment an amount becomes
// a float the ledger stops balancing.
//
// The type is `bigint`, matching the bigint column the folio is stored in. Not
// because a room rate needs the range: it is because `bigint` and `number` do
// not mix in TypeScript, so an amount cannot be added to a count, a percentage
// or a night — arithmetic that compiles silently when both sides are `number`
// and is wrong every time. The contract carries it natively; the one place it
// has to become JSON is `formatVnd`, which produces text nobody parses back.

import { z } from "zod";

export const PROPERTY_CURRENCY = "VND" as const;

/**
 * A posting amount. Signed on purpose: a refund or a reversing entry is a
 * negative charge. Forbidding that here would push callers into subtracting
 * magnitudes instead, which is how a ledger loses the trail that makes it
 * auditable.
 */
export const vndAmountSchema = z.bigint();

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
