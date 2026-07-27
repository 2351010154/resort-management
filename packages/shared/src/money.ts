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

const thousandsFormatter = new Intl.NumberFormat("vi-VN", {
  maximumFractionDigits: 0,
});

/** Display only — "1.250.000 ₫". Never parse this back into an amount. */
export function formatVnd(amount: VndAmount): string {
  return vndFormatter.format(amount);
}

/**
 * The same string, split at the currency mark.
 *
 * For the one caller that needs to style the two halves differently. ₫ (U+20AB)
 * is a Vietnamese glyph, and a Latin-only face does not have it — so a price set
 * in one will draw its digits and borrow its currency mark from somewhere else,
 * usually at the wrong size. Returning the parts lets the mark be set in a face
 * that actually contains it without the digits changing face too.
 *
 * `formatToParts` rather than a split on the character: where the mark goes, and
 * whether a space precedes it, belong to the locale data and not to this file.
 */
export function splitVnd(amount: VndAmount): {
  readonly amount: string;
  readonly currency: string;
} {
  const parts = vndFormatter.formatToParts(amount);

  return {
    amount: parts
      .filter((part) => part.type !== "currency")
      .map((part) => part.value)
      .join("")
      .trim(),
    currency:
      parts.find((part) => part.type === "currency")?.value ??
      PROPERTY_CURRENCY,
  };
}

/** The step tariffs are quoted in — `property-and-tariff.md` §5. */
const DISPLAY_STEP = 1000n;

/**
 * Round to the nearest 1,000 đồng for display. Presentation only, per
 * `property-and-tariff.md` §5 — the rounded figure is never posted, summed or
 * persisted.
 *
 * The reason this is a named function rather than four characters at each call
 * site: a total is the rounded sum of the nights, never the sum of the rounded
 * nights. Two nights at 1,850,400 are 3,700,800 — which displays as 3,701,000,
 * while twice the rounded night displays as 3,700,000. Both lines are on the
 * same card, a thousand đồng apart, and the guest is right to distrust it.
 * Round once, at the edge, and only here.
 */
export function roundVndForDisplay(amount: VndAmount): VndAmount {
  const half = DISPLAY_STEP / 2n;
  // Away from zero on a tie, in both directions: a reversing entry is negative,
  // and truncating toward zero would round a refund and its charge differently.
  return amount < 0n
    ? -(((-amount + half) / DISPLAY_STEP) * DISPLAY_STEP)
    : ((amount + half) / DISPLAY_STEP) * DISPLAY_STEP;
}

/**
 * Thousands of đồng, unsuffixed — "1.850" for 1,850,000.
 *
 * For the one place a full amount will not fit: a price line inside a 44 px
 * calendar cell. The unit belongs in the grid's legend, once, rather than
 * repeated 31 times in type too small to read it.
 */
export function formatVndThousands(amount: VndAmount): string {
  return thousandsFormatter.format(roundVndForDisplay(amount) / DISPLAY_STEP);
}
