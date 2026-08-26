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

/**
 * The wire form: the same integer as decimal text. "1850000".
 *
 * Text and not a JSON number, and the reason is the range this type was chosen
 * for. A room rate fits in a double; a folio total in đồng need not, and a
 * number that silently loses its last digits is worse than one that never
 * arrives. Serialisers agree — the one under the contract already writes a
 * `bigint` out this way, which is why an amount is read back with `BigInt(…)`
 * on the far side.
 */
export const vndAmountTextSchema = z
  .string()
  .regex(/^-?\d+$/, "expected a whole number of đồng");

/**
 * An amount arriving in a request, decoded from that text.
 *
 * A *response* declares {@link vndAmountSchema} and this asymmetry is the same
 * one `stay-date.ts` sets out at length. Validating a handler's output means
 * checking what the handler produced — a `bigint`, which the serialiser then
 * writes as text on its own. Validating an input means checking what arrived,
 * which is text, and `z.bigint()` rejects it. So a request takes this and a
 * response takes the native schema, and the one conversion between them is
 * declared here rather than remembered at each call site.
 */
export const vndAmountInputSchema = z.codec(
  vndAmountTextSchema,
  vndAmountSchema,
  {
    decode: (value) => BigInt(value),
    encode: (amount) => amount.toString(),
  },
);

/**
 * What a foreign gateway showed the payer — never what the property posted.
 *
 * PayPal does not support VND at all: đồng is absent from its transaction
 * currencies, so a guest paying that way is charged in something else. That
 * makes a second figure unavoidable, and the rule above is what stops it
 * becoming a second ledger — **presentment is a record, not an amount.** It is
 * never summed, never posted, never compared against a folio, and never added
 * to a `VndAmount`, which the type system enforces by giving it a nominal shape
 * of its own rather than reusing the ledger's.
 *
 * The property's books stay in đồng because the legal invoice is: `FR-FOL-04`
 * issues the *hóa đơn điện tử* off folio close, and Decree 123/2020/NĐ-CP makes
 * đồng the invoice currency unless the transaction is licensed foreign
 * currency — and even then the VND rate has to appear on the invoice. So the
 * conversion happens once, at the gateway's edge, and what it produces is
 * filed beside the payment rather than carried into it.
 */
export const PRESENTMENT_CURRENCIES = ["USD"] as const;

export const presentmentCurrencySchema = z.enum(PRESENTMENT_CURRENCIES);

export type PresentmentCurrency = z.infer<typeof presentmentCurrencySchema>;

/**
 * The charged figure in that currency's minor unit — cents, for USD.
 *
 * `bigint` for the reason the ledger uses one, and minor units for the reason
 * đồng needs none: a currency with a hundredth cannot be held in a decimal
 * without inviting a float, and every gateway that counts dollars counts cents.
 * The scaling to and from a major unit belongs to the adapter that speaks to
 * the gateway, exactly as `money.ts` forbids scaling a `VndAmount` anywhere
 * above one.
 */
export const presentmentMinorUnitsSchema = z.bigint();

export type PresentmentMinorUnits = z.infer<typeof presentmentMinorUnitsSchema>;

/**
 * Đồng per one major unit of the presentment currency, as decimal text.
 *
 * Text and not a number, for `vndAmountTextSchema`'s reason turned around: a
 * rate is the one figure in this file that legitimately has a fraction, and a
 * double that loses its last digits converts a stay to within a few đồng of
 * right — which is exactly the drift `FR-PAY-05` would surface a month later as
 * a day that will not reconcile.
 *
 * Frozen onto the payment when the attempt opens. A refund, a reconciliation
 * and an invoice all have to quote the rate the guest was actually charged at,
 * and re-reading today's would make each of them disagree with the others the
 * first time the property edited it.
 */
export const fxRateSchema = z
  .string()
  .regex(/^\d+(\.\d+)?$/, "expected a positive decimal rate")
  .refine((rate) => Number(rate) > 0, "a rate of nothing converts nothing");

export type FxRate = z.infer<typeof fxRateSchema>;

/** What the payer was charged, and on what terms. All three or none. */
export const presentmentSchema = z.object({
  currency: presentmentCurrencySchema,
  minorUnits: presentmentMinorUnitsSchema,
  rate: fxRateSchema,
});

export type Presentment = z.infer<typeof presentmentSchema>;

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

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

/** Display only — "$72.45". The figure a payer is about to approve abroad. */
export function formatPresentment(presentment: Presentment): string {
  // Cents back to dollars for `Intl`, which counts in the major unit. A
  // `Number` is safe here and nowhere else in this file: the value is bounded
  // by one folio's balance, it is about to become a string, and nothing reads
  // it back.
  return usdFormatter.format(Number(presentment.minorUnits) / 100);
}

/**
 * The rate as an exact fraction — `26150.5` is `261505 / 10`.
 *
 * Parsed rather than floated, because every conversion below is the one place
 * a fraction touches money in this codebase. A double holding `26150.5` is
 * fine; a double holding the quotient it divides into is not, and the two are
 * one expression apart.
 */
function rateFraction(rate: FxRate): {
  numerator: bigint;
  denominator: bigint;
} {
  const [whole, fraction = ""] = rate.split(".");

  return {
    numerator: BigInt(`${whole}${fraction}`),
    denominator: 10n ** BigInt(fraction.length),
  };
}

/** Half-up division of two positive bigints — no float, no truncation bias. */
function divideRoundingHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

/**
 * Đồng into the minor unit of what the gateway will actually charge.
 *
 * Rounded half-up to the cent, and rounded **once**: a stay is converted as a
 * total rather than a night at a time, for the reason `roundVndForDisplay`
 * gives about summing rounded figures. What comes back is the payer's figure
 * and the property's record of it — never a posting.
 *
 * A cent is worth roughly 250 đồng, so the rounding is real money in one
 * direction or the other. It is not hidden: the amount charged is frozen onto
 * the payment beside the rate that produced it, which is what lets
 * `FR-PAY-05` reconcile a settlement it did not itself compute.
 */
export function convertVndToPresentment(
  amount: VndAmount,
  currency: PresentmentCurrency,
  rate: FxRate,
): Presentment {
  if (amount <= 0n) {
    throw new RangeError("only a positive amount can be presented to a payer");
  }

  const { numerator, denominator } = rateFraction(rate);

  // amount ÷ rate, in the major unit, scaled to the minor one. The two scalings
  // are folded into one division so nothing rounds twice.
  const minorUnits = divideRoundingHalfUp(
    amount * denominator * 100n,
    numerator,
  );

  if (minorUnits <= 0n) {
    throw new RangeError(
      "that amount converts to nothing at the configured rate",
    );
  }

  return { currency, minorUnits, rate };
}

/**
 * Back the other way, at the rate that was frozen — never at today's.
 *
 * What `FR-PAY-05` compares and what a partial refund is computed from. The
 * round trip is deliberately not guaranteed to return the amount it started
 * from: a cent is coarser than a đồng, so converting out and back can land a
 * few hundred đồng away. That gap is the tolerance reconciliation has to state
 * explicitly, and it is why this is a named function with a comment rather than
 * a multiplication somebody writes twice and rounds differently.
 */
export function convertPresentmentToVnd(presentment: Presentment): VndAmount {
  const { numerator, denominator } = rateFraction(presentment.rate);

  return divideRoundingHalfUp(
    presentment.minorUnits * numerator,
    denominator * 100n,
  );
}
