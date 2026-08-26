// What the phone says when it rings.
//
// `payment-reconciliation-sweep.e2e-spec.ts` proves the page leaves the process
// and arrives at an endpoint; this proves what is written on it, which is a
// different claim and a cheaper one to make here. A responder woken at four in
// the morning acts on this sentence before they open anything, so each kind has
// to name the money, the reference and the day — and say which side reported
// what, because two of the three are about a figure only one side holds.
//
// A pure function for the reason `reconciliation.service.ts` makes `compare`
// one: it reads no clock, opens no connection and knows no gateway, so all three
// cases are reachable from literals rather than from a night that has to be
// arranged.
//
// The second suite is about the one thing the sweep does that neither the
// classification nor the sentence can be asked about: it draws two lists of
// money and holds them against each other, so it is the only place where the
// property's day boundary can be applied twice and differently. An `ADMIN`
// moving the rollover hour while a sweep runs is a committed row, and
// `transaction-runner.ts` takes `read committed` — so a sweep that asked what
// day it was per transaction would see the old hour on one side of a comparison
// and the new hour on the other. The stand-in for `SystemConfigService` below
// answers with a different hour each time it is asked, which is that edit in the
// only form a unit test can arrange, and the sweep is held to filing nothing.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import {
  convertPresentmentToVnd,
  convertVndToPresentment,
  type FxRate,
  type GatewayPaymentMethod,
  type Presentment,
  type VndAmount,
} from "@mariva/shared";
import type { PinoLogger } from "nestjs-pino";
import { describe, expect, it } from "vitest";
import type { DbExecutor } from "../../database/database.module.js";
import {
  type paymentDiscrepancy,
  paymentReconciliationRun,
} from "../../database/schema/reconciliation.js";
import { BusinessDateService } from "../booking/business-date.service.js";
import type {
  OpsAlert,
  OpsAlertService,
} from "../notification/ops-alert.service.js";
import type { SystemConfigService } from "../system-config/system-config.service.js";
import { GatewayRegistry } from "./ports/gateway-registry.js";
import type {
  GatewayTransaction,
  PaymentAttempt,
  PaymentGateway,
  SettlementWindow,
} from "./ports/payment-gateway.port.js";
import type { ReconciledAttempt } from "./reconciliation.service.js";
import { ReconciliationService } from "./reconciliation.service.js";
import { ReconciliationJob, sentenceFor } from "./reconciliation.job.js";

const A_TRADING_DAY = parseDate("2027-09-14");
const A_REFERENCE = "4c1f7a3e8d9b0f6e5a4b3c2d1e0f";

describe("the sentence a discrepancy pages with", () => {
  it("names the gateway's figure when the money never reached an account", () => {
    const said = sentenceFor(
      attempt({
        outcome: "MISSING_LOCALLY",
        gatewayAmount: 1_450_000n,
        ledgerAmount: null,
        paymentId: null,
      }),
      A_TRADING_DAY,
    );

    expect(said).toContain("1450000");
    expect(said).toContain(A_REFERENCE);
    expect(said).toContain("2027-09-14");
    // The consequence, in the responder's terms rather than the table's. This is
    // the direction that costs a guest money, and the sentence has to say so.
    expect(said).toContain("outstanding");
  });

  it("names the ledger's figure when the gateway does not report the money", () => {
    const said = sentenceFor(
      attempt({
        outcome: "MISSING_AT_GATEWAY",
        gatewayAmount: null,
        ledgerAmount: 1_450_000n,
        paymentId: "a-payment",
      }),
      A_TRADING_DAY,
    );

    expect(said).toContain("1450000");
    expect(said).toContain(A_REFERENCE);
    // The property's claim, attributed to the property. A sentence that said
    // only "1450000 đồng is missing" would leave the responder to guess which
    // of the two systems is the one making the claim.
    expect(said).toMatch(/this property recorded/i);
  });

  it("names both figures when the two disagree, and attributes each", () => {
    const said = sentenceFor(
      attempt({
        outcome: "AMOUNT_MISMATCH",
        gatewayAmount: 1_460_000n,
        ledgerAmount: 1_450_000n,
        paymentId: "a-payment",
      }),
      A_TRADING_DAY,
    );

    // Both, because the whole content of this kind is the difference between
    // them — a page carrying one figure is a page that cannot be acted on.
    expect(said).toContain("1460000");
    expect(said).toContain("1450000");
    expect(said.indexOf("1460000")).toBeLessThan(said.indexOf("1450000"));
  });
});

describe("a rollover hour an ADMIN moves while the sweep is running", () => {
  it("does not put the two sides of one night on two day boundaries", async () => {
    // The hour reads 04:00 and then 06:00, which is the edit landing between the
    // gateway's side of the night and the ledger's. The one payment was taken at
    // 05:00 in the property's zone: it belongs to the night under the first hour
    // and to the night before under the second, so a sweep that asks twice puts
    // it in the report and not in the ledger and files money the gateway is
    // holding that this property supposedly never recorded.
    const swept = await sweep({ hours: [4, 6], theGatewaySays: THE_FIGURE });

    expect(swept.filed).toEqual([]);
    expect(swept.paged).toEqual([]);

    // Asked once, which is the whole of the guarantee: whatever the hour is,
    // both sides of the comparison are drawn on it.
    expect(swept.hourReads).toBe(1);

    // And the night is still worked and still marked looked-at. A sweep that
    // avoided the false discrepancy by skipping the date would leave it
    // outstanding, which is a different defect wearing the same green test.
    expect(swept.reconciled).toEqual([THE_NIGHT.toString()]);
    expect(swept.markedReconciled).toEqual([THE_NIGHT.toString()]);
  });

  it("holds that same payment against the gateway's figure for that night", async () => {
    // The case above proves nothing on its own if the payment falls outside the
    // night on both sides, because two empty lists agree. Same fixture, same
    // hour throughout, one đồng of disagreement — and the mismatch can only be
    // reached with the payment on both sides of the night's comparison.
    const swept = await sweep({ hours: [4], theGatewaySays: THE_FIGURE + 1n });

    expect(
      swept.filed.map((row) => [row.businessDate, row.kind, row.ledgerAmount]),
    ).toEqual([[THE_NIGHT.toString(), "AMOUNT_MISMATCH", THE_FIGURE]]);

    expect(swept.paged).toHaveLength(1);
  });
});

describe("a night with money from both of the property's gateways", () => {
  // 1,200,000 ₫ at 26,150.5 — the same worked example `money.ts` and
  // `reconciliation.service.ts` carry, chosen here for the same reason: it is
  // a conversion that does not round-trip, which is exactly what makes the
  // cents-equality path below distinguishable from the đồng one.
  const RATE: FxRate = "26150.5";
  const PAYPAL_FIGURE: VndAmount = 1_200_000n;
  const VNPAY_FIGURE: VndAmount = 900_000n;
  const paypalPresentment = convertVndToPresentment(PAYPAL_FIGURE, "USD", RATE);

  it("reconciles clean when both gateways agree with the ledger", async () => {
    const swept = await sweepTwoGateways({ paypalSettled: paypalPresentment });

    expect(swept.filed).toEqual([]);
    expect(swept.paged).toEqual([]);
  });

  it("pages a PayPal settlement short by one cent, and the alert names the payment", async () => {
    const shortByACent: Presentment = {
      ...paypalPresentment,
      minorUnits: paypalPresentment.minorUnits - 1n,
    };

    const swept = await sweepTwoGateways({ paypalSettled: shortByACent });

    expect(
      swept.filed.map((row) => [row.attemptReference, row.kind]),
    ).toEqual([[PAYPAL_REFERENCE, "AMOUNT_MISMATCH"]]);

    expect(swept.paged).toHaveLength(1);
    expect(swept.paged[0]?.details).toMatchObject({
      reference: PAYPAL_REFERENCE,
      paymentId: "the-paypal-payment",
    });
  });

  it("asks a gateway that implements settledBetween once for the window, never per attempt", async () => {
    const swept = await sweepTwoGateways({ paypalSettled: paypalPresentment });

    expect(swept.paypal.windowCalls).toBe(1);
    expect(swept.paypal.attemptCalls).toBe(0);
  });

  it("asks a reporting gateway through itself, so an adapter reaching for its own client still has one", async () => {
    // The fixtures above answer out of a closure and would survive being
    // lifted off the object and called bare. A real adapter does not:
    // `paypal.adapter.ts` opens `settledBetween` with `this.paypal()`, so a
    // sweep that detached the method would throw before fetching anything,
    // and — nothing being caught per gateway — would roll the whole night
    // back, every night, silently. This is a class for that reason: it can
    // only answer if it was called on itself.
    class ReachesForItself implements PaymentGateway {
      private readonly own: readonly GatewayTransaction[];

      constructor(settled: readonly GatewayTransaction[]) {
        this.own = settled;
      }

      async createPayment(): Promise<never> {
        throw new Error("not asked to open an attempt");
      }

      async verifyCallback(): Promise<never> {
        throw new Error("not asked to verify a callback");
      }

      async refund(): Promise<never> {
        throw new Error("not asked for a refund");
      }

      async queryTransaction(): Promise<never> {
        throw new Error("asked attempt by attempt despite answering a window");
      }

      async settledBetween(): Promise<readonly GatewayTransaction[]> {
        // The dereference under test. Detached, `this` is undefined here and
        // this line throws rather than returning a report.
        return await Promise.resolve(this.own);
      }
    }

    const businessDates = new BusinessDateService(
      new RolloverHours([4]) as unknown as SystemConfigService,
    );
    const books = new TheNightsBooks(ALREADY_LOOKED_AT, []);

    const job = new ReconciliationJob(
      new GatewayRegistry({ PAYPAL: new ReachesForItself([]) }),
      new ReconciliationService(),
      businessDates,
      {
        page: async () => await Promise.resolve(true),
      } as unknown as OpsAlertService,
      {
        setContext: () => undefined,
        error: () => undefined,
      } as unknown as PinoLogger,
    );

    // The night reconciles rather than throwing, which is the whole assertion:
    // a detached `settledBetween` never reaches the return above.
    await expect(job.run(books.executor, TODAY)).resolves.toEqual([
      THE_NIGHT.toString(),
    ]);
  });

  it("reconstructs a gateway with no settledBetween attempt by attempt, asking only about its own method's attempts", async () => {
    const swept = await sweepTwoGateways({ paypalSettled: paypalPresentment });

    // Exactly the one VNPay attempt, and never the PayPal reference sharing
    // the same night — the whole of what the method filter buys.
    expect(swept.vnpay.asked).toEqual([VNPAY_REFERENCE]);
  });

  /** The reference the night's VNPay attempt is opened under. */
  const VNPAY_REFERENCE = `2b6e9f14${"0123456789abcdef".repeat(4)}`;

  /** The reference the night's PayPal attempt is opened under. */
  const PAYPAL_REFERENCE = `8f3a71c0${"fedcba9876543210".repeat(4)}`;

  /** One night, both gateways bound, and everything the sweep left behind. */
  async function sweepTwoGateways({
    paypalSettled,
  }: {
    readonly paypalSettled: Presentment;
  }) {
    const businessDates = new BusinessDateService(
      new RolloverHours([4]) as unknown as SystemConfigService,
    );

    const books = new TheNightsBooks(ALREADY_LOOKED_AT, [
      {
        id: "the-vnpay-payment",
        reference: VNPAY_REFERENCE,
        method: "VNPAY",
        amount: VNPAY_FIGURE,
        createdAt: AT_FIVE_IN_THE_MORNING,
        paidAt: AT_FIVE_IN_THE_MORNING,
        presentmentCurrency: null,
        presentmentAmount: null,
        fxRate: null,
      },
      {
        id: "the-paypal-payment",
        reference: PAYPAL_REFERENCE,
        method: "PAYPAL",
        amount: PAYPAL_FIGURE,
        createdAt: AT_FIVE_IN_THE_MORNING,
        paidAt: AT_FIVE_IN_THE_MORNING,
        presentmentCurrency: paypalPresentment.currency,
        presentmentAmount: paypalPresentment.minorUnits,
        fxRate: RATE,
      },
    ]);

    const vnpay = reconstructingGateway({
      [VNPAY_REFERENCE]: {
        status: "SUCCESS",
        reference: VNPAY_REFERENCE,
        amount: VNPAY_FIGURE,
        gatewayTransactionId: "vnp-at-the-gateway",
        paidAt: AT_FIVE_IN_THE_MORNING,
      },
    });

    const paypal = reportingGateway([
      {
        status: "SUCCESS",
        reference: PAYPAL_REFERENCE,
        amount: convertPresentmentToVnd(paypalSettled),
        presentment: paypalSettled,
        gatewayTransactionId: "paypal-capture",
        paidAt: AT_FIVE_IN_THE_MORNING,
      },
    ]);

    const paged: OpsAlert[] = [];

    const job = new ReconciliationJob(
      new GatewayRegistry({ VNPAY: vnpay, PAYPAL: paypal }),
      new ReconciliationService(),
      businessDates,
      {
        page: async (alert: OpsAlert) => {
          paged.push(alert);

          return await Promise.resolve(true);
        },
      } as unknown as OpsAlertService,
      {
        setContext: () => undefined,
        error: () => undefined,
      } as unknown as PinoLogger,
    );

    await job.run(books.executor, TODAY);

    return { paged, filed: books.discrepancies, vnpay, paypal };
  }
});

/** One classified attempt, with only the fields the sentence reads. */
function attempt(
  outcome: Omit<ReconciledAttempt, "reference">,
): ReconciledAttempt {
  return { reference: A_REFERENCE, ...outcome };
}

/** The day the property is having when the sweep runs, and never reconciles. */
const TODAY = parseDate("2027-11-04");

/** The one closed day the sweep below finds outstanding. */
const THE_NIGHT = TODAY.subtract({ days: 1 });

/**
 * Every other day in the look-back window, already on file.
 *
 * Written as the offsets rather than as six dates, so that the one gap is the
 * visible part: `reconciliation.job.ts` looks back seven days and this leaves
 * exactly the day before today outstanding.
 */
const ALREADY_LOOKED_AT = [7, 6, 5, 4, 3, 2].map((back) =>
  TODAY.subtract({ days: back }).toString(),
);

/**
 * 05:00 on the night, in the property's own zone.
 *
 * The instant the whole suite turns on: past a 04:00 rollover and before a
 * 06:00 one, so the two hours date it to two different business days.
 */
const AT_FIVE_IN_THE_MORNING = new Date("2027-11-02T22:00:00Z");

const AN_ATTEMPT = `3d9a71e0c85b4f26a1470e9d2b6c8f53${"0123456789abcdef".repeat(2)}`;

const THE_FIGURE: VndAmount = 1_200_000n;

type DiscrepancyValues = typeof paymentDiscrepancy.$inferInsert;

/** One night swept, and everything the sweep left behind. */
async function sweep({
  hours,
  theGatewaySays,
}: {
  readonly hours: readonly number[];
  readonly theGatewaySays: VndAmount;
}) {
  const configuration = new RolloverHours(hours);
  const businessDates = new BusinessDateService(
    configuration as unknown as SystemConfigService,
  );
  const books = new TheNightsBooks(ALREADY_LOOKED_AT, [
    {
      id: "the-payment-row",
      reference: AN_ATTEMPT,
      method: "VNPAY",
      amount: THE_FIGURE,
      // Attempts are opened minutes before they are paid, and the sweep's
      // coarse range is over this column rather than over `paid_at`.
      createdAt: AT_FIVE_IN_THE_MORNING,
      paidAt: AT_FIVE_IN_THE_MORNING,
      presentmentCurrency: null,
      presentmentAmount: null,
      fxRate: null,
    },
  ]);
  const paged: OpsAlert[] = [];

  const job = new ReconciliationJob(
    new GatewayRegistry({
      VNPAY: gatewayHolding({
        status: "SUCCESS",
        reference: AN_ATTEMPT,
        amount: theGatewaySays,
        gatewayTransactionId: "vnp-at-the-gateway",
        paidAt: AT_FIVE_IN_THE_MORNING,
      }),
    }),
    new ReconciliationService(),
    businessDates,
    {
      page: async (alert: OpsAlert) => {
        paged.push(alert);

        return await Promise.resolve(true);
      },
    } as unknown as OpsAlertService,
    {
      setContext: () => undefined,
      error: () => undefined,
    } as unknown as PinoLogger,
  );

  const reconciled = await job.run(books.executor, TODAY);

  return {
    reconciled,
    paged,
    filed: books.discrepancies,
    markedReconciled: books.markedReconciled,
    hourReads: configuration.reads,
  };
}

/**
 * The configuration row as an `ADMIN` is editing it.
 *
 * Answers with the next hour in the list on each read and with the last one
 * forever after, and counts how many times it was asked. The count is the
 * assertion the suite is really making: a sweep that reads the hour once cannot
 * classify two instants under two hours, whatever anybody does to the row.
 */
class RolloverHours {
  reads = 0;

  constructor(private readonly hours: readonly number[]) {}

  async businessDateRolloverHour(): Promise<number> {
    const hour = this.hours[Math.min(this.reads, this.hours.length - 1)]!;

    this.reads += 1;

    return await Promise.resolve(hour);
  }
}

/** A gateway that answers about one attempt and knows nothing else. */
function gatewayHolding(transaction: GatewayTransaction): PaymentGateway {
  return {
    queryTransaction: async ({ reference }: PaymentAttempt) =>
      await Promise.resolve(
        reference === transaction.reference
          ? transaction
          : { status: "PENDING" as const, reference, amount: 0n },
      ),
  } as unknown as PaymentGateway;
}

/**
 * A gateway with no `settledBetween`, answering about whichever attempts it is
 * asked about and remembering every reference it was asked — which is the
 * whole of what "asked about only its own method's attempts" is a claim about.
 */
function reconstructingGateway(
  transactions: Readonly<Record<string, GatewayTransaction>>,
): PaymentGateway & { readonly asked: readonly string[] } {
  const asked: string[] = [];

  return {
    asked,
    queryTransaction: async ({ reference }: PaymentAttempt) => {
      asked.push(reference);

      return await Promise.resolve(
        transactions[reference] ??
          ({ status: "PENDING" as const, reference, amount: 0n } as const),
      );
    },
  } as unknown as PaymentGateway & { readonly asked: readonly string[] };
}

/**
 * A gateway that answers about a whole window in one call, the way PayPal's
 * adapter does. Counts both kinds of call, so a caller can assert it was asked
 * for the night once and never asked attempt by attempt at all.
 */
function reportingGateway(
  transactions: readonly GatewayTransaction[],
): PaymentGateway & {
  readonly windowCalls: number;
  readonly attemptCalls: number;
} {
  let windowCalls = 0;
  let attemptCalls = 0;

  return {
    get windowCalls() {
      return windowCalls;
    },
    get attemptCalls() {
      return attemptCalls;
    },
    queryTransaction: async ({ reference }: PaymentAttempt) => {
      attemptCalls += 1;

      return await Promise.resolve({
        status: "PENDING" as const,
        reference,
        amount: 0n,
      });
    },
    settledBetween: async (_window: SettlementWindow) => {
      windowCalls += 1;

      return await Promise.resolve(transactions);
    },
  } as unknown as PaymentGateway & {
    readonly windowCalls: number;
    readonly attemptCalls: number;
  };
}

/**
 * The `payment_method` a payment-table predicate was built with, read out of
 * the same `eq(payment.method, method)` `reconciliation.job.ts` builds — or
 * nothing, where the statement carries no such equality, which is
 * `reconciliation.service.ts`'s own ledger read.
 *
 * The value is found by its `encoder`, drizzle's own name for the column a
 * bound parameter was written for, rather than by position — a predicate's
 * shape is drizzle's business and not this stand-in's, and matching by
 * position would silently start reading the wrong operand the day
 * `reconciliation.job.ts`'s statement grew or reordered a clause.
 */
function methodOf(condition: unknown): string | undefined {
  if (!condition || typeof condition !== "object") {
    return undefined;
  }

  const node = condition as {
    readonly encoder?: { readonly name?: string };
    readonly value?: unknown;
    readonly queryChunks?: readonly unknown[];
  };

  if (node.encoder?.name === "method" && typeof node.value === "string") {
    return node.value;
  }

  for (const chunk of node.queryChunks ?? []) {
    const found = methodOf(chunk);

    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}

/** A payment row, as both statements the sweep issues hand it back. */
interface StoredPayment {
  readonly id: string;
  readonly reference: string;
  readonly method: GatewayPaymentMethod;
  readonly amount: VndAmount;
  readonly createdAt: Date;
  readonly paidAt: Date;

  /**
   * The trio `reconciliation.service.ts` reads off a row to hold a
   * foreign-settled attempt to the frozen rate — whole, or `null` on every
   * VNPay row. `payment_presentment_is_whole_or_absent` is what makes it
   * all-or-nothing on a real row, and this fixture is written the same way.
   */
  readonly presentmentCurrency: string | null;
  readonly presentmentAmount: bigint | null;
  readonly fxRate: string | null;
}

/**
 * The statements a sweep issues, and nothing either side of them.
 *
 * The two kinds of `select` are told apart by the table they are `from`,
 * because the sweep asks the run table which days are outstanding and the
 * payment table for both the attempts and the ledger. The date bound in either
 * is not read: it is a coarse range a day either side of the business date, and
 * the narrowing that decides which rows belong to the night is exactly what
 * `reconciliation.job.spec.ts`'s rollover cases are about — a stand-in that
 * filtered here would be answering the question instead of the sweep.
 *
 * The method the payment table's predicate carries **is** read, and for a
 * different reason: which of a night's attempts a reconstructing gateway is
 * asked about now turns on that filter rather than on a range, and a stand-in
 * that ignored it could not tell a job that asks every gateway about every
 * attempt from one that asks each about its own. `methodOf` walks the same
 * `eq(payment.method, method)` `reconciliation.job.ts` builds and answers with
 * nothing where the statement carries no such equality at all — which is
 * `reconciliation.service.ts`'s own ledger read, drawn over every method
 * because a night's ledger is not split by gateway.
 *
 * `insert` keeps the unique key over `(business_date, attempt_reference)` and
 * nothing else, for the reason `reconciliation.service.spec.ts` gives about the
 * same stand-in.
 */
class TheNightsBooks {
  readonly discrepancies: DiscrepancyValues[] = [];
  readonly markedReconciled: string[] = [];

  private readonly keys = new Set<string>();

  constructor(
    private readonly alreadyLookedAt: readonly string[],
    private readonly payments: readonly StoredPayment[],
  ) {}

  get executor(): DbExecutor {
    return this as unknown as DbExecutor;
  }

  select() {
    return {
      from: (table: unknown) => ({
        where: async (condition: unknown) => {
          if (table === paymentReconciliationRun) {
            return await Promise.resolve(
              this.alreadyLookedAt.map((businessDate) => ({ businessDate })),
            );
          }

          const method = methodOf(condition);

          return await Promise.resolve(
            method === undefined
              ? this.payments
              : this.payments.filter((row) => row.method === method),
          );
        },
      }),
    };
  }

  insert(table: unknown) {
    return table === paymentReconciliationRun
      ? {
          values: async (row: { readonly businessDate: string }) => {
            this.markedReconciled.push(row.businessDate);

            await Promise.resolve();
          },
        }
      : {
          values: (rows: readonly DiscrepancyValues[]) => ({
            onConflictDoNothing: () => ({
              returning: async () => await Promise.resolve(this.commit(rows)),
            }),
          }),
        };
  }

  private commit(rows: readonly DiscrepancyValues[]) {
    const written: {
      id: string;
      reference: string;
      kind: DiscrepancyValues["kind"];
    }[] = [];

    for (const row of rows) {
      const key = `${row.businessDate}|${row.attemptReference}`;

      if (this.keys.has(key)) {
        continue;
      }

      this.keys.add(key);

      const id = `discrepancy-${this.discrepancies.length + 1}`;

      this.discrepancies.push(row);
      written.push({ id, reference: row.attemptReference, kind: row.kind });
    }

    return written;
  }
}
