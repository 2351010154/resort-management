// One agreed figure in, three folio lines out — `FR-FOL-02`, and
// `docs/architecture/property-and-tariff.md` §5.
//
// §5 asks for two views of the same money and says outright that collapsing
// either into the other breaks one of them: the guest sees a **gross** price,
// VAT and service charge already inside it, and the folio shows charge, service
// charge and tax as separate lines. So the three lines are *derived* from the
// figure the guest accepted and never added on top of it. A decomposition that
// computed 5% and 8% and appended them would hand the guest a bill larger than
// the price they agreed to, which is the same defect as quoting net and calling
// it gross.
//
// **The algebra.** Write the rates as fractions of 10,000 basis points, s and
// v. §5 defines the components as
//
//     service = net × s
//     vat     = (net + service) × v   when the VAT base includes service charge
//     vat     = net × v               when it does not
//     gross   = net + service + vat
//
// which is one equation in one unknown once the others are substituted in. With
// the service charge inside the VAT base the two rates compound —
//
//     gross = net(1 + s)(1 + v)   →   net = gross · B² / ((B + S)(B + V))
//
// — and with it outside they merely add:
//
//     gross = net(1 + s + v)      →   net = gross · B / (B + S + V)
//
// That is the whole of `system_config.vat_includes_service_charge`: §8 calls it
// the flag that "changes every gross/net calculation", and this is the pair of
// denominators it chooses between. Both are computed in `bigint`, so the
// numerator carries the ×B² without a float anywhere near it.
//
// **Where the odd đồng goes, and why it is not a patch.** Integer division
// leaves a few đồng over — six at the worst rates, one on an ordinary night —
// and `NFR-02` gives them nowhere to be lost: Σ postings must equal Σ payments
// plus outstanding, nightly, and three lines that sum to a đồng under the
// figure the guest paid fail it silently and unprovably. The remainder lands on
// the net charge, because the net charge is the only one of the three that is a
// residual rather than a rate. The service charge is the staff's and the VAT is
// the state's; each is a stated percentage of a stated base, and a line
// carrying a đồng more than that percentage yields is a line that does not
// reconcile against the rate it claims to apply — on an invoice, which §8 notes
// is a legal document a third party cannot quietly reissue. Truncating both
// downward means neither is ever over-stated, and the property absorbs what is
// left rather than the guest or the tax authority paying for a rounding step.
//
// Writing the net charge as `gross - service - vat` rather than as its own
// division is what makes that structural: the three sum to the agreed figure by
// construction, not by an adjustment somebody has to remember to apply. §5's
// "no rounding inside a calculation" is honoured for the same reason — nothing
// here rounds to anything, it divides integers and keeps the residue.
//
// **Signed, and exactly antisymmetric.** `money.ts` makes an amount signed on
// purpose because a refund or a reversing entry is a negative charge, and
// `FR-FOL-01` corrects a mistake with one rather than an `UPDATE`. Reversing a
// decomposed posting therefore means decomposing its negative, and `bigint`
// division truncates toward zero in both directions — so each line of
// `decomposeGross(-x)` is the exact negation of the matching line of
// `decomposeGross(x)`, and a reversal cancels the posting it reverses to the
// đồng. `roundVndForDisplay` guards the same symmetry for the same reason.
//
// Pure, and it reads nothing. `FR-FOL-02` says the rates are read from config at
// posting time; `SystemConfigService` is what reads them, inside the caller's
// transaction, and hands the result here.

import type { VndAmount } from "@mariva/shared";
import type { TaxRules } from "../system-config/system-config.service.js";

/** 10,000 basis points is 100%. A rate of 800 is 8%; `config.ts` says why. */
const BASIS_POINTS = 10_000n;

/**
 * The three lines one gross figure posts as.
 *
 * They sum to that figure exactly. Nothing downstream may re-derive one of them
 * from the other two at a different precision.
 */
export interface TaxDecomposition {
  readonly netCharge: VndAmount;
  readonly serviceCharge: VndAmount;
  readonly vat: VndAmount;
}

/**
 * Split the price the guest agreed to into the lines the accountant expects.
 *
 * The rules arrive as one object rather than as three positional arguments, and
 * that is worth a sentence: `vatRateBps` and `serviceChargeRateBps` are both
 * rates, both plausible in either position, and a swap between them compiles
 * and mis-invoices every folio it touches. {@link TaxRules} is already the shape
 * `SystemConfigService` returns in a single atomic read, so the posting path
 * passes what it was given and there is no call site at which the two can trade
 * places.
 *
 * @throws RangeError if a rate is not whole basis points within 0–10,000 — the
 * bounds `system_config`'s own `CHECK` constraints hold the stored values to.
 */
export function decomposeGross(
  grossAmount: VndAmount,
  rules: TaxRules,
): TaxDecomposition {
  const serviceRate = basisPoints(
    rules.serviceChargeRateBps,
    "The service-charge rate",
  );
  const vatRate = basisPoints(rules.vatRateBps, "The VAT rate");

  // The net before the remainder joins it — the solved equation, truncated.
  const netBase = rules.vatIncludesServiceCharge
    ? (grossAmount * BASIS_POINTS * BASIS_POINTS) /
      ((BASIS_POINTS + serviceRate) * (BASIS_POINTS + vatRate))
    : (grossAmount * BASIS_POINTS) /
      (BASIS_POINTS + serviceRate + vatRate);

  const serviceCharge = (netBase * serviceRate) / BASIS_POINTS;
  const vat = rules.vatIncludesServiceCharge
    ? ((netBase + serviceCharge) * vatRate) / BASIS_POINTS
    : (netBase * vatRate) / BASIS_POINTS;

  return {
    // The residual, and the reason the three always sum to the gross.
    netCharge: grossAmount - serviceCharge - vat,
    serviceCharge,
    vat,
  };
}

/**
 * A rate as `bigint`, or a refusal.
 *
 * The refusal exists because the argument is a `number` and the compiler cannot
 * tell 8% written as 800 from 8% written as 0.08 — and §8 names that second
 * spelling as the expensive defect precisely because it does not throw. Here it
 * does. The bounds are `system_config`'s: zero is a real answer at one end, a
 * zero-rated supply or a property that levies no service charge, and above 100%
 * the figure is a typo that would multiply a room charge by hundreds.
 */
function basisPoints(value: number, what: string): bigint {
  if (!Number.isInteger(value) || value < 0 || value > BASIS_POINTS) {
    throw new RangeError(
      `${what} is basis points: a whole number from 0 to ${BASIS_POINTS}, ` +
        `where 800 is 8% and 500 is 5%. Received ${value}.`,
    );
  }

  return BigInt(value);
}
