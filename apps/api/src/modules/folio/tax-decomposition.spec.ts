// The invariant this file exists for is one line — the three components sum to
// the gross, exactly — and every other test here is an attempt to break it from
// a different direction. `NFR-02` checks it nightly across a whole property, at
// which point a đồng lost in one posting is a discrepancy nobody can trace back.
//
// No database and no fixtures: `tax-decomposition.ts` is a pure function over
// two arguments, which is what makes an exhaustive-ish sweep affordable.

import type { VndAmount } from "@mariva/shared";
import { describe, expect, it } from "vitest";
import type { TaxRules } from "../system-config/system-config.service.js";
import {
  decomposeGross,
  type TaxDecomposition,
} from "./tax-decomposition.js";

/** §5's service charge and `config.ts`'s ⚑ VAT rate, with the base rule set. */
const VAT_ON_SERVICE: TaxRules = {
  vatRateBps: 800,
  serviceChargeRateBps: 500,
  vatIncludesServiceCharge: true,
};

/** The same two rates, with §8's flag the other way. */
const VAT_ON_ROOM_ONLY: TaxRules = {
  ...VAT_ON_SERVICE,
  vatIncludesServiceCharge: false,
};

function total({
  netCharge,
  serviceCharge,
  vat,
}: TaxDecomposition): VndAmount {
  return netCharge + serviceCharge + vat;
}

describe("a gross figure the guest agreed to", () => {
  // 1,000,000 gross at 5% service and 8% VAT compounding over both. The
  // components are asserted as figures rather than recomputed by the test,
  // because a test that re-derives them from the same formula would agree with
  // an implementation that solved the wrong equation.
  it("splits into net, service charge and VAT that sum back to it", () => {
    expect(decomposeGross(1_000_000n, VAT_ON_SERVICE)).toStrictEqual({
      netCharge: 881_835n,
      serviceCharge: 44_091n,
      vat: 74_074n,
    });
  });

  // The point of the whole exercise: nothing is added on top. §5 shows the
  // guest a gross price, and a decomposition whose lines exceeded it would be a
  // bill for more than the price that was accepted.
  it("never exceeds the figure it was given", () => {
    const decomposition = decomposeGross(1_000_000n, VAT_ON_SERVICE);

    expect(total(decomposition)).toBe(1_000_000n);
    expect(decomposition.netCharge).toBeLessThan(1_000_000n);
  });

  // §8's flag is not cosmetic — it moves 3,122 đồng of the same million out of
  // tax and into revenue. A posting path that hard-coded either formula would
  // be wrong for half the properties that could run this.
  it("splits differently when VAT does not apply to the service charge", () => {
    expect(decomposeGross(1_000_000n, VAT_ON_ROOM_ONLY)).toStrictEqual({
      netCharge: 884_957n,
      serviceCharge: 44_247n,
      vat: 70_796n,
    });
  });

  it("charges VAT on the service charge only when told to", () => {
    const included = decomposeGross(1_000_000n, VAT_ON_SERVICE);
    const excluded = decomposeGross(1_000_000n, VAT_ON_ROOM_ONLY);

    expect(included.vat).toBeGreaterThan(excluded.vat);
    expect(total(included)).toBe(total(excluded));
  });
});

describe("a rate that is switched off", () => {
  it("leaves no service-charge line when the rate is zero", () => {
    expect(
      decomposeGross(1_000_000n, {
        ...VAT_ON_SERVICE,
        serviceChargeRateBps: 0,
      }),
    ).toStrictEqual({
      netCharge: 925_926n,
      serviceCharge: 0n,
      vat: 74_074n,
    });
  });

  // A zero-rated or exempt supply, which `config.ts` calls a real answer rather
  // than a typo. The service charge still comes out of the gross.
  it("leaves no VAT line when the rate is zero", () => {
    expect(
      decomposeGross(1_000_000n, { ...VAT_ON_SERVICE, vatRateBps: 0 }),
    ).toStrictEqual({
      netCharge: 952_381n,
      serviceCharge: 47_619n,
      vat: 0n,
    });
  });

  it("hands the whole figure to the net charge when both rates are zero", () => {
    expect(
      decomposeGross(1_000_000n, {
        vatRateBps: 0,
        serviceChargeRateBps: 0,
        vatIncludesServiceCharge: true,
      }),
    ).toStrictEqual({
      netCharge: 1_000_000n,
      serviceCharge: 0n,
      vat: 0n,
    });
  });
});

describe("the edges of the range", () => {
  it("decomposes nothing into nothing", () => {
    expect(decomposeGross(0n, VAT_ON_SERVICE)).toStrictEqual({
      netCharge: 0n,
      serviceCharge: 0n,
      vat: 0n,
    });
  });

  // A single đồng cannot be split at these rates, and the invariant decides
  // where it goes rather than a rounding rule: both tax lines truncate to zero,
  // so the residual is the whole đồng. Anything else would post a folio line of
  // zero tax against a gross of one and lose the đồng.
  it("keeps a single đồng whole", () => {
    expect(decomposeGross(1n, VAT_ON_SERVICE)).toStrictEqual({
      netCharge: 1n,
      serviceCharge: 0n,
      vat: 0n,
    });
  });

  // Far past any folio, and that is the point `money.ts` makes about the type:
  // there is no precision cliff to reason about. The same figure as a `number`
  // has already lost its last digit.
  it("holds an amount beyond a double's integer range", () => {
    const huge = 9_007_199_254_740_993n;

    expect(total(decomposeGross(huge, VAT_ON_SERVICE))).toBe(huge);
    expect(Number(huge)).not.toBe(huge);
  });

  // 100% on both, which `system_config`'s CHECK permits at the ceiling. Absurd
  // as a tax position, but the arithmetic must not overflow into a different
  // shape of wrong at the boundary the database allows.
  it("survives both rates at their ceiling", () => {
    const decomposition = decomposeGross(1_000_000n, {
      vatRateBps: 10_000,
      serviceChargeRateBps: 10_000,
      vatIncludesServiceCharge: true,
    });

    expect(total(decomposition)).toBe(1_000_000n);
    expect(decomposition.netCharge).toBe(250_000n);
  });
});

// `money.ts` makes an amount signed so that a reversing entry is a negative
// charge, and `FR-FOL-01` corrects a mistake with one rather than an UPDATE. A
// reversal whose three lines did not cancel the three it reverses would leave
// the ledger unbalanced by the difference — the `NFR-02` failure arriving
// through the correction rather than through the charge.
describe("reversing a posting", () => {
  it("decomposes to the exact negative of the charge it reverses", () => {
    const charge = decomposeGross(1_000_000n, VAT_ON_SERVICE);
    const reversal = decomposeGross(-1_000_000n, VAT_ON_SERVICE);

    expect(reversal).toStrictEqual({
      netCharge: -charge.netCharge,
      serviceCharge: -charge.serviceCharge,
      vat: -charge.vat,
    });
  });

  it("still sums to the figure it was given", () => {
    expect(total(decomposeGross(-1_000_000n, VAT_ON_ROOM_ONLY))).toBe(
      -1_000_000n,
    );
  });
});

// A deterministic sweep rather than random generation: a property this file
// cannot afford to fail is a property whose counterexample has to reproduce on
// the next run, in CI, from the same file. The amounts below visit every đồng
// across the first thousand — where truncation has the most room to be wrong
// relative to the figure — then step through realistic room and folio totals by
// a prime, so the sweep lands on every residue class of the denominators rather
// than on the round numbers a hand-written case would pick.
const SWEEP_AMOUNTS: readonly VndAmount[] = [
  ...Array.from({ length: 1_000 }, (_, index) => BigInt(index)),
  ...Array.from(
    { length: 400 },
    (_, index) => 300_000n + BigInt(index) * 7_919n,
  ),
  ...Array.from(
    { length: 200 },
    (_, index) => 12_500_000n + BigInt(index) * 104_729n,
  ),
  ...Array.from({ length: 100 }, (_, index) => -(BigInt(index) * 33_331n)),
];

// §5's pair, the zero cases, the ceiling, and three rates chosen for having no
// common factor with 10,000 — 137, 1,234 and 9,999 all leave a remainder the
// tidy rates do not.
const SWEEP_RATES: [number, number][] = [
  [800, 500],
  [0, 0],
  [0, 500],
  [800, 0],
  [10_000, 10_000],
  [137, 9_999],
  [9_999, 137],
  [1_234, 1_234],
  [150, 750],
];

const SWEEP: [string, TaxRules][] = SWEEP_RATES.flatMap(
  ([vatRateBps, serviceChargeRateBps]) =>
    [true, false].map((vatIncludesServiceCharge): [string, TaxRules] => [
      `${vatRateBps} bps VAT, ${serviceChargeRateBps} bps service, VAT ` +
        `${vatIncludesServiceCharge ? "over" : "not over"} the service line`,
      { vatRateBps, serviceChargeRateBps, vatIncludesServiceCharge },
    ]),
);

describe("the sum invariant, swept", () => {
  // The failures are collected rather than asserted one at a time so that a
  // regression names the amounts it broke on instead of stopping at the first.
  it.each(SWEEP)("holds at %s", (_label, rules) => {
    const lost = SWEEP_AMOUNTS.filter(
      (gross) => total(decomposeGross(gross, rules)) !== gross,
    );

    expect(lost).toStrictEqual([]);
  });

  // The direction of the residual, asserted rather than described: both tax
  // lines truncate downward, so neither can exceed its own rate applied to the
  // base as the decomposition reports it. An invoice that over-states VAT
  // claims a figure the rate does not yield.
  it.each(SWEEP)("never over-states a tax line at %s", (_label, rules) => {
    const overstated = SWEEP_AMOUNTS.filter((gross) => {
      if (gross < 0n) return false;

      const { netCharge, serviceCharge, vat } = decomposeGross(gross, rules);
      const vatBase = rules.vatIncludesServiceCharge
        ? netCharge + serviceCharge
        : netCharge;
      const atRate = (base: VndAmount, bps: number): VndAmount =>
        (base * BigInt(bps)) / 10_000n;

      return (
        serviceCharge > atRate(netCharge, rules.serviceChargeRateBps) ||
        vat > atRate(vatBase, rules.vatRateBps)
      );
    });

    expect(overstated).toStrictEqual([]);
  });

  // A positive gross cannot produce a negative line. A folio that could would
  // be crediting the guest tax it never charged.
  it.each(SWEEP)("keeps every line non-negative at %s", (_label, rules) => {
    const negative = SWEEP_AMOUNTS.filter((gross) => {
      if (gross < 0n) return false;

      const { netCharge, serviceCharge, vat } = decomposeGross(gross, rules);

      return netCharge < 0n || serviceCharge < 0n || vat < 0n;
    });

    expect(negative).toStrictEqual([]);
  });
});

describe("a rate that could not have come from config", () => {
  // 0.08 is §8's named defect — a VAT rate written as a fraction instead of as
  // basis points — and the whole reason it is expensive is that it does not
  // throw anywhere else. It throws here.
  it.each([0.08, 8.5, -1, 10_001, Number.NaN])(
    "refuses a VAT rate of %s",
    (vatRateBps) => {
      expect(() =>
        decomposeGross(1_000_000n, { ...VAT_ON_SERVICE, vatRateBps }),
      ).toThrow(RangeError);
    },
  );

  it.each([0.05, -500, 10_001])(
    "refuses a service-charge rate of %s",
    (serviceChargeRateBps) => {
      expect(() =>
        decomposeGross(1_000_000n, {
          ...VAT_ON_SERVICE,
          serviceChargeRateBps,
        }),
      ).toThrow(RangeError);
    },
  );

  it("says which rate it refused and what basis points look like", () => {
    expect(() =>
      decomposeGross(1_000_000n, { ...VAT_ON_SERVICE, vatRateBps: 0.08 }),
    ).toThrow(/The VAT rate is basis points.*800 is 8%/);
  });
});

// `NFR-12`: money is `bigint` and the claim is a compile-time one, asserted the
// way `stay-date.spec.ts` asserts its own — this file is typechecked by
// `tsconfig.test.json`, so an `@ts-expect-error` below becomes an error the
// moment the line under it starts compiling. The runtime throw is only the
// second line of defence, for an amount that arrives from somewhere the
// compiler cannot see.
describe("money that arrived as a number", () => {
  it("cannot be decomposed", () => {
    expect(() =>
      // @ts-expect-error đồng are counted in bigint
      decomposeGross(1_000_000, VAT_ON_SERVICE),
    ).toThrow(TypeError);
  });

  it("cannot be read back out of a decomposition", () => {
    const { netCharge } = decomposeGross(1_000_000n, VAT_ON_SERVICE);

    // @ts-expect-error a decomposed line is đồng, and đồng are bigint
    const asNumber: number = netCharge;

    expect(typeof asNumber).toBe("bigint");
  });
});
